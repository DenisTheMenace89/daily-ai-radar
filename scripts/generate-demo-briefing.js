const fs = require("fs");

const FILE = "briefings.json";

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

function nowInBerlin() {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());
}

const briefingDate = process.env.BRIEFING_DATE || yesterdayInBerlin();
const timestamp = nowInBerlin();

let briefings = [];

if (fs.existsSync(FILE)) {
  briefings = JSON.parse(fs.readFileSync(FILE, "utf8"));
}

if (!Array.isArray(briefings)) {
  briefings = [];
}

let briefing = briefings.find(item => item.date === briefingDate);

if (!briefing) {
  briefing = {
    date: briefingDate,
    title: `Automatisiertes Briefing vom ${briefingDate}`,
    summary: "Dieses Briefing wurde automatisch von GitHub Actions erzeugt.",
    stories: []
  };

  briefings.unshift(briefing);
}

const testStory = {
  title: "Automationstest ausgeführt",
  category: "System",
  priority: "niedrig",
  source: "GitHub Actions",
  summary: `Dieser Eintrag wurde automatisch aktualisiert. Zeitpunkt: ${timestamp}.`,
  why: "Damit prüfen wir, ob GitHub Actions die Datei briefings.json automatisch verändern kann. Wenn das funktioniert, ersetzen wir diesen Test später durch echte KI- & Tech-News.",
  links: ["https://github.com/DenisTheMenace89/daily-ai-radar/actions"]
};

const existingIndex = briefing.stories.findIndex(
  story => story.title === testStory.title
);

if (existingIndex >= 0) {
  briefing.stories[existingIndex] = testStory;
} else {
  briefing.stories.unshift(testStory);
}

briefings.sort((a, b) => b.date.localeCompare(a.date));

fs.writeFileSync(FILE, JSON.stringify(briefings, null, 2) + "\n", "utf8");

console.log(`briefings.json wurde für ${briefingDate} aktualisiert.`);
