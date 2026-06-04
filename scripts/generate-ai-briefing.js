const fs = require("fs");
const path = require("path");

const FILE = "briefings.json";
const AUDIO_DIR = "audio";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "cedar";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FORCE_REBUILD = process.env.FORCE_REBUILD === "true";
const FORCE_AUDIO = process.env.FORCE_AUDIO === "true";

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

function yesterdayInBerlin() { return berlinDate(new Date(Date.now() - 24 * 60 * 60 * 1000)); }
function todayInBerlin() { return berlinDate(new Date()); }

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

function findExistingBriefing(targetDate) {
  return readBriefings().find(item => item.date === targetDate) || null;
}

function shouldSkipExistingDate(targetDate) {
  if (FORCE_REBUILD || FORCE_AUDIO) return false;
  const existing = findExistingBriefing(targetDate);
  return Boolean(existing && existing.audioPath);
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

function normalizeTitle(title) { return title.toLowerCase().replace(/[^a-z0-9äöüß ]/gi, "").replace(/\s+/g, " ").trim(); }
function normalizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(url).split("#")[0].split("?")[0].replace(/\/$/, "");
  }
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
    const key = normalizeUrl(item.link) || normalizeTitle(item.title);
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
    originalTitle: item.title,
    category: item.source.includes("Hacker News") ? "Hacker News" : "KI & Tech",
    priority: "mittel",
    signal: "mittel",
    relevance: "mittel",
    trust: "Einzelquelle / Feed",
    source: item.source,
    summary: item.description || "Neuer KI- oder Tech-Link aus dem Quellenfeed.",
    why: "Dieser Eintrag wurde im Fallback-Modus aus RSS-/Feed-Daten übernommen.",
    opportunity: "Manuell prüfen, ob daraus eine Video-, Tool- oder Business-Idee entsteht.",
    links: [item.url]
  }));

  return {
    date: targetDate,
    title: `KI- & Tech-Radar vom ${formatGermanDate(targetDate)}`,
    summary: reason ? `Fallback-Briefing: ${reason}` : "Automatisch aus KI- und Tech-Feeds zusammengestellte Übersicht.",
    topSummary: reason ? `Fallback-Briefing: ${reason}` : "Heute gab es passende KI- und Tech-Signale aus den geprüften Feeds.",
    implications: ["Prüfe die wichtigsten Meldungen direkt in den Quellen."],
    watchlist: ["Morgen beobachten, ob es Follow-ups zu den stärksten Themen gibt."],
    tags: ["#KI", "#Tech"],
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
- Strikte Dublettenregel: Dieselbe Nachricht darf nur einmal vorkommen. Wenn zwei Meldungen denselben Link, denselben Ursprung oder denselben Sachverhalt haben, kombiniere sie zu einer einzigen Story.
- Priorisiere Themen, die für KI, Tech, Creator-Tools, YouTube/Video, Software, Hardware, Security, Startups, Plattformen und Regulierung relevant sind.
- Nimm nur Meldungen auf, die wirklich relevant sind. Lieber 5 gute Meldungen als 8 mittelmäßige.
- Maximal 8 Meldungen.
- Jede Meldung braucht: title, originalTitle, category, priority, signal, relevance, trust, source, summary, why, opportunity, links.
- category soll eine der folgenden Kategorien sein: KI-Tools, Developer, Creator, Business, Security, Regulierung, Infrastruktur, Open Source, Hardware, Plattformen, Forschung.
- priority, signal und relevance sind jeweils: hoch, mittel oder niedrig.
- trust ist kurz: "Primärquelle", "mehrere Quellen", "Einzelquelle" oder "Community-Signal".
- summary: 1-2 Sätze, was passiert ist.
- why: 1-2 Sätze, warum das wichtig ist, gerne mit Bezug auf Creator, Produktvideos, YouTube, Schauspiel/Medienrechte oder Business, aber nur wenn es wirklich passt.
- opportunity: 1 kurzer Satz, welche Chance, Videoidee, Beobachtung oder Handlungsoption sich daraus für Denis ergeben könnte. Wenn nichts passt: "Nur beobachten."
- originalTitle ist der englische oder originale Quellentitel der wichtigsten Quelle, nicht frei erfinden.
- Übersetze Headlines semantisch korrekt und eindeutig. Achte besonders darauf, wer die handelnde Person/Organisation ist.
- Beispiel für korrekte Übersetzung: "Grafana Labs says hackers stole its code, refuses to pay ransom" bedeutet "Grafana Labs sagt, Hacker hätten Code gestohlen, und Grafana Labs weigert sich, Lösegeld zu zahlen". Es bedeutet NICHT, dass die Hacker kein Lösegeld fordern.
- Wenn eine englische Headline grammatisch mehrdeutig wirken könnte, formuliere den deutschen Titel lieber als klaren Satz mit Subjekt und Verb.
- links enthält nur URLs aus den Quellen.

Zusätzliche Briefing-Ebene:
- topSummary: "Heute in 30 Sekunden" als 2-3 Sätze. Kein Hype, nur Einordnung.
- implications: 2-4 kurze Bulletpoints: "Was bedeutet das?"
- watchlist: 2-4 kurze Bulletpoints: "Was weiter beobachten?"
- tags: 3-6 kurze Hashtags, z.B. #CreatorAI, #Security, #DeveloperTools.

Antwortformat:
Gib ausschließlich gültiges JSON zurück, ohne Markdown, ohne Erklärung.

Schema:
{
  "date": "${targetDate}",
  "title": "...",
  "summary": "...",
  "topSummary": "...",
  "implications": ["..."],
  "watchlist": ["..."],
  "tags": ["#..."],
  "stories": [
    {
      "title": "...",
      "originalTitle": "...",
      "category": "...",
      "priority": "hoch|mittel|niedrig",
      "signal": "hoch|mittel|niedrig",
      "relevance": "hoch|mittel|niedrig",
      "trust": "Primärquelle|mehrere Quellen|Einzelquelle|Community-Signal",
      "source": "...",
      "summary": "...",
      "why": "...",
      "opportunity": "...",
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
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) return data.choices[0].message.content;
  return "";
}

function parseJsonFromText(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
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
    headers: { "content-type": "application/json", "authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, input: prompt })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI API Fehler: ${data?.error?.message || `${res.status} ${res.statusText}`}`);
  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI API lieferte keinen auswertbaren Text.");
  return parseJsonFromText(text);
}

function validLevel(value, fallback = "mittel") {
  return ["hoch", "mittel", "niedrig"].includes(value) ? value : fallback;
}

function validateBriefing(briefing, targetDate, sources) {
  if (!briefing || typeof briefing !== "object") throw new Error("Briefing ist kein Objekt.");
  if (!Array.isArray(briefing.stories)) throw new Error("Briefing.stories fehlt.");

  const allowedUrls = new Set(sources.map(s => normalizeUrl(s.url)));
  briefing.date = targetDate;
  briefing.title = String(briefing.title || `KI- & Tech-Radar vom ${formatGermanDate(targetDate)}`).slice(0, 140);
  briefing.summary = String(briefing.summary || "Automatisch erzeugtes KI- und Tech-Briefing.").slice(0, 500);
  briefing.topSummary = String(briefing.topSummary || briefing.summary).slice(0, 700);
  briefing.implications = Array.isArray(briefing.implications) ? briefing.implications.map(x => String(x).slice(0, 180)).slice(0, 4) : [];
  briefing.watchlist = Array.isArray(briefing.watchlist) ? briefing.watchlist.map(x => String(x).slice(0, 180)).slice(0, 4) : [];
  briefing.tags = Array.isArray(briefing.tags) ? briefing.tags.map(x => String(x).replace(/^([^#])/, "#$1").slice(0, 28)).slice(0, 6) : [];

  const cleanedStories = briefing.stories.slice(0, 12).map(story => {
    const links = Array.isArray(story.links) ? story.links.filter(url => allowedUrls.has(normalizeUrl(url))).slice(0, 4) : [];
    return {
      title: String(story.title || "Unbenannte Meldung").slice(0, 180),
      originalTitle: String(story.originalTitle || story.title || "").slice(0, 220),
      category: String(story.category || "KI & Tech").slice(0, 40),
      priority: validLevel(story.priority),
      signal: validLevel(story.signal || story.priority),
      relevance: validLevel(story.relevance || story.priority),
      trust: String(story.trust || "Einzelquelle").slice(0, 40),
      source: String(story.source || "Web").slice(0, 80),
      summary: String(story.summary || "").slice(0, 600),
      why: String(story.why || "").slice(0, 600),
      opportunity: String(story.opportunity || "Nur beobachten.").slice(0, 260),
      links
    };
  }).filter(story => story.title && story.summary && story.links.length);

  const seenUrls = new Set();
  const seenTitles = new Set();
  const uniqueStories = [];
  for (const story of cleanedStories) {
    const titleKey = normalizeTitle(story.title);
    const storyUrls = story.links.map(normalizeUrl);
    const repeatsUrl = storyUrls.some(url => seenUrls.has(url));
    const repeatsTitle = seenTitles.has(titleKey);
    if (repeatsUrl || repeatsTitle) {
      console.warn(`Doppelte Story entfernt: ${story.title}`);
      continue;
    }
    storyUrls.forEach(url => seenUrls.add(url));
    seenTitles.add(titleKey);
    uniqueStories.push(story);
    if (uniqueStories.length >= 8) break;
  }

  briefing.stories = uniqueStories;
  if (!briefing.stories.length) throw new Error("Briefing enthält keine gültigen Stories mit Quellenlinks.");
  if (!briefing.implications.length) briefing.implications = ["Die wichtigsten Meldungen nach Relevanz und Signalstärke prüfen."];
  if (!briefing.watchlist.length) briefing.watchlist = briefing.stories.slice(0, 3).map(story => story.title);
  if (!briefing.tags.length) briefing.tags = [...new Set(briefing.stories.map(story => `#${story.category.replace(/\s+/g, "")}`))].slice(0, 5);
  return briefing;
}

function buildAudioScript(briefing) {
  const stories = (briefing.stories || []).slice(0, 6);
  const highlights = (briefing.highlights && briefing.highlights.length ? briefing.highlights : stories.slice(0, 3).map(story => story.title)).slice(0, 3);
  const implications = (briefing.implications || []).slice(0, 3);
  const watchlist = (briefing.watchlist || []).slice(0, 3);

  const lines = [];
  lines.push(`Daily AI Radar vom ${formatGermanDate(briefing.date)}.`);
  lines.push("");
  lines.push("Heute in dreißig Sekunden:");
  lines.push(briefing.topSummary || briefing.summary || "Hier kommt dein kompaktes KI- und Tech-Briefing.");
  if (highlights.length) {
    lines.push("");
    lines.push("Die wichtigsten Signale:");
    highlights.forEach((item, index) => lines.push(`${index + 1}. ${item}.`));
  }
  if (implications.length) {
    lines.push("");
    lines.push("Was bedeutet das?");
    implications.forEach(item => lines.push(item));
  }
  if (stories.length) {
    lines.push("");
    lines.push("Die Meldungen im Detail:");
    stories.forEach((story, index) => {
      lines.push("");
      lines.push(`Meldung ${index + 1}: ${story.title}.`);
      lines.push(story.summary);
      if (story.why) lines.push(`Warum wichtig: ${story.why}`);
      if (story.opportunity && story.opportunity !== "Nur beobachten.") lines.push(`Chance oder Handlungsidee: ${story.opportunity}`);
    });
  }
  if (watchlist.length) {
    lines.push("");
    lines.push("Weiter beobachten:");
    watchlist.forEach(item => lines.push(item));
  }
  lines.push("");
  lines.push("Das war dein Daily AI Radar.");

  return lines.join("\n").replace(/\s+/g, " ").trim().slice(0, 3900);
}

async function callOpenAISpeech(input) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY fehlt in GitHub Secrets.");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input,
      instructions: "Sprich auf Deutsch wie ein ruhiger, klarer Morning-Briefing-Host. Natürlich, präzise, nicht werblich. Mache kurze Pausen zwischen Abschnitten.",
      response_format: "mp3"
    })
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS Fehler: ${res.status} ${res.statusText} ${errorText}`.trim());
  }
  return Buffer.from(await res.arrayBuffer());
}

async function addAudio(briefing) {
  const audioPath = `${AUDIO_DIR}/briefing-${briefing.date}.mp3`;
  if (!FORCE_AUDIO && !FORCE_REBUILD && fs.existsSync(audioPath)) {
    briefing.audioPath = audioPath;
    briefing.audioUrl = audioPath;
    return briefing;
  }

  try {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const script = buildAudioScript(briefing);
    const buffer = await callOpenAISpeech(script);
    fs.writeFileSync(audioPath, buffer);
    briefing.audioPath = audioPath;
    briefing.audioUrl = audioPath;
    briefing.audioGeneratedAt = new Date().toISOString();
    briefing.audioVoice = TTS_VOICE;
    briefing.audioModel = TTS_MODEL;
    briefing.audioScriptLength = script.length;
    console.log(`Audio-Briefing geschrieben: ${audioPath} (${buffer.length} bytes)`);
  } catch (error) {
    console.warn(`Audio-Erzeugung fehlgeschlagen: ${error.message}`);
  }
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
  const index = briefings.findIndex(item => item.date === briefing.date);

  if (index >= 0 && !FORCE_REBUILD) {
    const existing = briefings[index];
    const canAddMissingAudio = briefing.audioPath && (!existing.audioPath || FORCE_AUDIO);
    if (!canAddMissingAudio) {
      console.log(`Briefing für ${briefing.date} existiert bereits. Kein erneutes Generieren/Überschreiben ohne FORCE_REBUILD.`);
      return false;
    }
    briefings[index] = { ...existing, ...briefing };
  } else if (index >= 0 && FORCE_REBUILD) {
    console.log(`FORCE_REBUILD aktiv: Aktualisiere Briefing für ${briefing.date}.`);
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

  const existing = findExistingBriefing(targetDate);
  if (shouldSkipExistingDate(targetDate)) {
    console.log(`Keine KI-Kosten: Briefing und Audio für ${targetDate} existieren bereits. Backup-Lauf beendet.`);
    return;
  }

  if (existing && !FORCE_REBUILD) {
    console.log(`Briefing für ${targetDate} existiert bereits, aber Audio fehlt. Erzeuge nur Audio.`);
    const withAudio = await addAudio(existing);
    const changed = upsertBriefing(withAudio);
    if (changed) console.log(`Audio-Metadaten für ${targetDate} aktualisiert.`);
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
  briefing = await addAudio(briefing);
  const changed = upsertBriefing(briefing);
  if (changed) console.log(`briefings.json aktualisiert: ${briefing.title} (${briefing.stories.length} Stories, ${sources.length} Quellen, Modus: ${mode}, Audio: ${briefing.audioPath || "nein"})`);
  else console.log(`Keine Änderung geschrieben: ${briefing.date} bleibt stabil.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
