# FanterFootbah Treasurer Room

A polished, mobile-friendly dashboard for the FanterFootbah fantasy football league. It turns the league treasurer workbook into five focused views:

- Overview of league cash, buy-ins, payouts, and earnings
- Team cards with owner and payment status
- All 14 weeks of regular-season matchups
- Playoff bracket and prize podium
- A personal “My Locker” view for each owner

## Data refresh

The committed `site/data/league.json` file is a working snapshot. The GitHub Pages workflow opens the public OneDrive workbook, downloads a fresh copy, rebuilds the JSON, and deploys the site every 30 minutes. If OneDrive is temporarily unavailable, the last committed snapshot still deploys.

To rebuild from a local workbook:

```bash
npm install
npm run refresh-data:local
```

To refresh from OneDrive, install Playwright's Chromium browser once and run:

```bash
npx playwright install chromium
npm run refresh-data
```

## Local preview

Serve the `site` directory with any static server. For example:

```bash
python3 -m http.server 4173 --directory site
```
