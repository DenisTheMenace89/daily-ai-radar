name: Daily AI Radar Briefing

on:
  workflow_dispatch:
  schedule:
    - cron: "0 6 * * *"

permissions:
  contents: write

jobs:
  update-briefing:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Generate demo briefing
        run: node scripts/generate-demo-briefing.js

      - name: Commit updated briefing
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          if [[ -n "$(git status --porcelain)" ]]; then
            git add briefings.json
            git commit -m "Update daily AI briefing"
            git push
          else
            echo "No changes to commit"
          fi
