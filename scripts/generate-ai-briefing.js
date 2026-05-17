const fs = require("fs");

const FILE = "briefings.json";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FORCE_REBUILD = process.env.FORCE_REBUILD === "true";

const FEEDS = [
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "Hacker News Frontpage", url: "https://hnrss.org/frontpage" },
  { name: "Hacker News AI", url: "https://hnrss.org/newest?q=AI" },
  { name: "Hacker News LLM", url: "https://hnrss.org/newest?q=LLM" },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml" },
  { name: "Anthropic News", url: "https://www.anthropic.com/news/rss.xml" },
  { name: "Google DeepMind Blog", url: "https://deepmind.google/discover/blog/rss.xml" },
  { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" }
];

const KEYWORDS = [
  "ai", "artificial intelligence", "ki", "openai", "anthropic", "deepmind", "gemini", "chatgpt",
  "gpt", "llm", "agent", "agents", "model", "models", "machine learning", "robot", "robotics",
  "nvidia", "gpu", "chip", "startup", "security", "cyber", "tech", "software", "developer",
  "apple", "google", "microsoft", "meta", "amazon", "youtube", "creator", "video"
];

function berlinDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function yesterdayInBerlin() {
  return berlinDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

function todayInBerlin() {
  return berlinDate(new Date());
}

function formatGermanDate(isoDate) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function readBriefings() {
  if (!fs.existsSync(FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function latestDate(briefings) {
  return briefings.reduce((max, item) => item.date && item.date > max ? item.date : max, "");
}

function shouldSkipArchivedDate(targetDate) {
  if (FORCE_REBUILD) return false;
  const briefings = readBriefings();
  const exists = briefings.some(item => item.date === targetDate);
  const latest = latestDate(briefings);
  return exists && latest && targetDate < latest;
}

function decodeEntities(text = "") {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—");
}

function stripHtml(text = "") {
  return decodeEntities(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

function linkFromBlock(block) {
  const direct = tag(block, "link");
  if (direct && !direct.includes("<")) return direct.trim();
  const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return href ? decodeEntities(href[1]).trim() : "";
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(block => {
    const title = stripHtml(tag(block, "title"));
    const link = linkFromBlock(block);
    const pubRaw = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date");
    const description = stripHtml(tag(block, "description") || tag(block, "summary") || tag(block, "content:encoded") || "");
    const parsedDate = pubRaw ? new Date(pubRaw) : null;
    return {
      title,
      link,
      source: feed.name,
      feedUrl: feed.url,
      published: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      publishedBerlinDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? berlinDate(parsedDate) : null,
      description: description.slice(0, 700)
    };
  }).filter(item => item.title && item.link);
}

function isRelevant(item) {
  const text = `${item.title} ${item.description} ${item.source}`.toLowerCase();
  return KEYWORDS.some(keyword => text.includes(keyword));
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9äöüß ]/gi, "").replace(/\s+/g, " ").trim();
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { "user-agent": "Daily AI Radar/1.0 (+https://github.com/DenisTheMenace89/daily-ai-radar)" }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const xml = await res.text();
    return parseFeed(xml, feed);
  } catch (error) {
    console.warn(`Feed fehlgeschlagen: ${feed.name} – ${error.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function collectSources(targetDate) {
  const all = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const deduped = [];
  const seen = new Set();

  for (const item of all) {
    const key = item.link || normalizeTitle(item.title);
    const titleKey = normalizeTitle(item.title);
    if (seen.has(key) || seen.has(titleKey)) continue;
    seen.add(key);
    seen.add(titleKey);
    if (isRelevant(item)) deduped.push(item);
  }

  const targetItems = deduped.filter(item => item.publishedBerlinDate === targetDate);
  const fallbackItems = deduped
    .sort((a, b) => (new Date(b.published || 0)) - (new Date(a.published || 0)))
    .slice(0, 40);

  const selected = (targetItems.length >= 8 ? targetItems : fallbackItems).slice(0, 32);

  return selected.map((item, index) => ({
    id: index + 1,
    title: item.title,
    source: item.source,
    published: item.published,
    url: item.link,
    description: item.description
  }));
}

function fallbackBriefing(targetDate, sources, reason = "") {
  const stories = sources.slice(0, 8).map(item => ({
    title: item.title,
    category: item.source.includes("Hacker News") ? "Hacker News" : "KI & Tech",
    priority: "mittel",
    source: item.source,
    summary: item.description || "Neuer KI- oder Tech-Link aus dem Quellenfeed.",
    why: "Dieser Eintrag wurde im Fallback-Modus aus RSS-/Feed-Daten übernommen.",
    links: [item.url]
  }));

  return {
    date: targetDate,
    title: `KI- & Tech-Radar vom ${formatGermanDate(targetDate)}`,
    summary: reason ? `Fallback-Briefing: ${reason}` : "Automatisch aus KI- und Tech-Feeds zusammengestellte Übersicht.",
    stories
  };
}

function buildPrompt(targetDate, sources) {
  return `Du bist ein deutscher KI- und Tech-News-Analyst für Denis, einen Schauspieler, Video-Creator und Product-Video-Creator aus Deutschland.

Aufgabe:
Erstelle aus den folgenden Quellen ein kompaktes, deutschsprachiges Daily-Briefing für den Vortag (${targetDate}).

Wichtig:
- Nutze ausschließlich die unten gegebenen Quellen.
- Erfinde keine Fakten, Zahlen, Namen oder Zitate.
- Fasse doppelte oder sehr ähnliche Meldungen zusammen.
- Priorisiere Themen, die für KI, Tech, Creator-Tools, YouTube/Video, Software, Hardware, Security, Startups, Plattformen und Regulierung relevant sind.
- Nimm nur Meldungen auf, die wirklich relevant sind. Lieber 5 gute Meldungen als 8 mittelmäßige.
- Maximal 8 Meldungen.
- Jede Meldung braucht: title, category, priority, source, summary, why, links.
- category soll eine der folgenden Kategorien sein: KI-Tools, Developer, Creator, Business, Security, Regulierung, Infrastruktur, Open Source, Hardware, Plattformen, Forschung.
- priority ist: hoch, mittel oder niedrig.
- summary: 1-2 Sätze, was passiert ist.
- why: 1-2 Sätze, warum das wichtig ist, gerne mit Bezug auf Creator, Produktvideos, YouTube, Schauspiel/Medienrechte oder Business, aber nur wenn es wirklich passt.
- links enthält nur URLs aus den Quellen.

Antwortformat:
Gib ausschließlich gültiges JSON zurück, ohne Markdown, ohne Erklärung.

Schema:
{
  "date": "${targetDate}",
  "title": "...",
  "summary": "...",
  "stories": [
    {
      "title": "...",
      "category": "...",
      "priority": "hoch|mittel|niedrig",
      "source": "...",
      "summary": "...",
      "why": "...",
      "links": ["..."]
    }
  ]
}

Quellen:
${JSON.stringify(sources, null, 2)}`;
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content.text === "string") parts.push(content.text);
          if (typeof content.output_text === "string") parts.push(content.output_text);
        }
      }
      if (typeof item.text === "string") parts.push(item.text);
    }
    if (parts.length) return parts.join("\n");
  }
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  return "";
}

function parseJsonFromText(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error("OpenAI-Antwort enthielt kein gültiges JSON.");
  }
}

async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY fehlt in GitHub Secrets.");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      input: prompt
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(`OpenAI API Fehler: ${message}`);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI API lieferte keinen auswertbaren Text.");
  return parseJsonFromText(text);
}

function validateBriefing(briefing, targetDate, sources) {
  if (!briefing || typeof briefing !== "object") throw new Error("Briefing ist kein Objekt.");
  if (!Array.isArray(briefing.stories)) throw new Error("Briefing.stories fehlt.");

  const allowedUrls = new Set(sources.map(s => s.url));
  briefing.date = targetDate;
  briefing.title = String(briefing.title || `KI- & Tech-Radar vom ${formatGermanDate(targetDate)}`).slice(0, 140);
  briefing.summary = String(briefing.summary || "Automatisch erzeugtes KI- und Tech-Briefing.").slice(0, 500);
  briefing.stories = briefing.stories.slice(0, 8).map(story => {
    const links = Array.isArray(story.links) ? story.links.filter(url => allowedUrls.has(url)).slice(0, 4) : [];
    return {
      title: String(story.title || "Unbenannte Meldung").slice(0, 180),
      category: String(story.category || "KI & Tech").slice(0, 40),
      priority: ["hoch", "mittel", "niedrig"].includes(story.priority) ? story.priority : "mittel",
      source: String(story.source || "Web").slice(0, 80),
      summary: String(story.summary || "").slice(0, 600),
      why: String(story.why || "").slice(0, 600),
      links
    };
  }).filter(story => story.title && story.summary && story.links.length);

  if (!briefing.stories.length) throw new Error("Briefing enthält keine gültigen Stories mit Quellenlinks.");
  return briefing;
}

function addMetadata(briefing, sources, mode) {
  briefing.generatedAt = new Date().toISOString();
  briefing.generatedAtBerlin = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());
  briefing.mode = mode;
  briefing.sourceCount = sources.length;
  briefing.highlights = briefing.stories
    .slice()
    .sort((a, b) => ({hoch: 0, mittel: 1, niedrig: 2}[a.priority] ?? 1) - ({hoch: 0, mittel: 1, niedrig: 2}[b.priority] ?? 1))
    .slice(0, 3)
    .map(story => story.title);
  return briefing;
}

function upsertBriefing(briefing) {
  let briefings = readBriefings();
  const latest = latestDate(briefings);
  const index = briefings.findIndex(item => item.date === briefing.date);

  if (index >= 0 && !FORCE_REBUILD && latest && briefing.date < latest) {
    console.log(`Briefing für ${briefing.date} ist archiviert. Ältere Archivtage bleiben unverändert.`);
    return false;
  }

  if (index >= 0) {
    console.log(`Aktualisiere neuestes Briefing für ${briefing.date}.`);
    briefings[index] = briefing;
  } else {
    briefings.unshift(briefing);
  }

  briefings.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(FILE, JSON.stringify(briefings, null, 2) + "\n", "utf8");
  return true;
}

async function main() {
  const targetDate = process.env.BRIEFING_DATE || yesterdayInBerlin();
  console.log(`Erstelle KI- & Tech-Briefing für ${targetDate}. Heute Berlin: ${todayInBerlin()}`);

  if (shouldSkipArchivedDate(targetDate)) {
    console.log(`Keine KI-Kosten: ${targetDate} ist bereits ein älterer Archivtag und wird nicht neu erzeugt.`);
    return;
  }

  const sources = await collectSources(targetDate);
  console.log(`${sources.length} Quellen gesammelt.`);

  let briefing;
  let mode = "ai";
  if (!sources.length) {
    mode = "fallback";
    briefing = fallbackBriefing(targetDate, [], "Es wurden keine passenden Feed-Einträge gefunden.");
  } else {
    try {
      briefing = await callOpenAI(buildPrompt(targetDate, sources));
      briefing = validateBriefing(briefing, targetDate, sources);
    } catch (error) {
      mode = "fallback";
      console.warn(`KI-Zusammenfassung fehlgeschlagen: ${error.message}`);
      briefing = fallbackBriefing(targetDate, sources, `KI-Zusammenfassung fehlgeschlagen (${error.message}).`);
    }
  }

  briefing = addMetadata(briefing, sources, mode);
  const changed = upsertBriefing(briefing);
  if (changed) {
    console.log(`briefings.json aktualisiert: ${briefing.title} (${briefing.stories.length} Stories, ${sources.length} Quellen, Modus: ${mode})`);
  } else {
    console.log(`Keine Änderung geschrieben: ${briefing.date} bleibt stabil.`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
