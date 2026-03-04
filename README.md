# GeoRecords Scout

A Tampermonkey/Greasemonkey userscript that auto-submits your finished GeoGuessr games to [GeoRecords](https://georecords-slim.onrender.com) scouting.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge/Firefox) or [Greasemonkey](https://addons.mozilla.org/firefox/addon/greasemonkey/) (Firefox)
2. **[Click here to install the script](https://raw.githubusercontent.com/YOURUSERNAME/georecords-scout/main/georecords-scout.user.js)** — Tampermonkey will show an install prompt
3. Log in to [GeoRecords](https://georecords-slim.onrender.com) in the same browser
4. Play GeoGuessr — finished games are submitted automatically

## Features

- **Auto-submit** — detects when a game finishes and sends it to GeoRecords
- **World / Regional toggle** — choose how rounds are graded (by country or by state/region)
- **Toast notifications** — see submission results without leaving GeoGuessr
- **Manual submit** — force-submit any game page via the Tampermonkey menu
- **Auto-updates** — Tampermonkey checks for new versions automatically

## Settings

Click the Tampermonkey icon on any GeoGuessr page to access:

| Command | What it does |
|---------|-------------|
| `Auto-submit: ✅ ON / ❌ OFF` | Toggle automatic submission |
| `Map type: 🌍 World / 🗺️ Regional` | Toggle grading mode |
| `🔍 Check GeoRecords connection` | Verify you're logged in |
| `📊 Submit this game now` | Manually submit the current page |

## Requirements

- A GeoRecords account (log in at georecords-slim.onrender.com)
- GeoGuessr Pro (to play games)
- Tampermonkey or Greasemonkey browser extension

## How it works

The script watches GeoGuessr pages for finished game indicators (result screens, score summaries). When detected, it sends the game URL to GeoRecords via API. Your GeoRecords session cookie handles authentication — no API keys needed.

## Privacy

- The script only communicates with `georecords-slim.onrender.com`
- Only finished game URLs are sent — no browsing data, no personal info
- All data stays on GeoRecords servers
