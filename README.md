# Daily AI Radar

Eine kleine GitHub-Pages-Web-App für tägliche KI- und Tech-News.

## Dateien

- `index.html` – die App
- `briefings.json` – alle Tagesbriefings
- `manifest.webmanifest` – App-/PWA-Konfiguration
- `sw.js` – Offline-Cache für die App-Oberfläche
- `icon.svg` – App-Icon

## GitHub Pages Setup

1. Neues Repository erstellen, z. B. `daily-ai-radar`.
2. Diese Dateien in den Hauptordner des Repositories hochladen.
3. In GitHub: `Settings` → `Pages`.
4. `Build and deployment`: `Deploy from a branch`.
5. Branch: `main`, Folder: `/root`.
6. Speichern. Nach kurzer Zeit ist die App online.

Die URL sieht meistens so aus:

`https://DEIN-GITHUB-NAME.github.io/daily-ai-radar/`

## Neues Briefing hinzufügen

Öffne `briefings.json` und füge oben in der Liste ein neues Objekt hinzu:

```json
{
  "date": "2026-05-18",
  "title": "Titel des Tages",
  "summary": "Kurzfazit des Tages.",
  "stories": [
    {
      "title": "Meldung",
      "category": "KI-Tools",
      "priority": "hoch",
      "source": "Quelle",
      "summary": "Was ist passiert?",
      "why": "Warum ist das wichtig?",
      "links": ["https://example.com"]
    }
  ]
}
```

Wichtig: Die Datei muss gültiges JSON bleiben. Zwischen den Tagesobjekten Kommas setzen.

## Später automatisieren

Der nächste Ausbau ist ein täglicher Workflow, der `briefings.json` automatisch aktualisiert. Optionen:

- GitHub Actions + API-Keys
- Make.com
- Zapier
- Google Apps Script
- Supabase/Firebase als Datenbank
