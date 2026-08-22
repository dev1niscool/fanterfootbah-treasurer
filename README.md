# FanterFootbah Treasurer Room

A polished, mobile-friendly dashboard for the FanterFootbah fantasy football league. It turns the league treasurer workbook into five focused views:

- Overview of league cash, buy-ins, payouts, and earnings
- Team cards with owner and payment status
- All 14 weeks of regular-season matchups
- Playoff bracket and prize podium
- A personal “My Locker” view for each owner

## Data refresh

The committed `site/data/league.json` file is a working snapshot. The GitHub Pages workflow opens the shared OneDrive workbook, downloads a fresh copy, rebuilds the JSON, and deploys the site every five minutes. Open dashboard tabs check for a newly deployed workbook every minute and reload automatically when fresh data arrives. If OneDrive is temporarily unavailable, the last committed snapshot still deploys.

The ESPN league is private, so ESPN's public API does not expose its standings or matchups without a member's session credentials. Those credentials are intentionally never placed in this public site. If the league is made publicly viewable later, ESPN data can be layered in without exposing an account.

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
