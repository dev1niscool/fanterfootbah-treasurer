# FanterFootbah Treasurer Room

A polished, mobile-friendly dashboard for the FanterFootbah fantasy football league. It turns the league treasurer workbook into five focused views:

- Overview of league cash, buy-ins, payouts, and earnings
- Team cards with owner and payment status
- All 14 weeks of regular-season matchups
- Playoff bracket and prize podium
- A personal “My Locker” view for each owner

## Live data

The dashboard loads directly from the public, read-only Google Sheet using Google Visualization responses. It checks the source once per minute while open and reloads automatically when the spreadsheet changes. The committed `site/data/league.json` file remains a working fallback if Google Sheets is temporarily unavailable.

The ESPN league is private, so ESPN's public API does not expose its standings or matchups without a member's session credentials. Those credentials are intentionally never placed in this public site.

Validate the live Google Sheets source:

```bash
npm install
npm run validate-google-source
```

Refresh the committed backup snapshot:

```bash
npm run refresh-google-snapshot
```

## Local preview

Serve the `site` directory with any static server. For example:

```bash
python3 -m http.server 4173 --directory site
```
