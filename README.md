# FanterFootbah Treasurer Room

A polished, mobile-friendly dashboard for the FanterFootbah fantasy football league. Visitors choose their team on entry, then get focused views for:

- Competition-first overview with an earnings leaderboard and race chart
- Team cards with payment status
- All 14 weeks of regular-season matchups
- Playoff bracket and prize podium
- A personal “My Locker” view for each team

## Live data

The dashboard combines two live sources directly in the browser:

- Google Sheets is authoritative for buy-ins, prizes, and treasurer payment checkmarks.
- ESPN is authoritative for current team names, schedule, scores, and results.

An open dashboard checks both sources every 30 seconds and updates its stats in place when either changes. The visible interface remains team-name-only and does not show source links. The committed `site/data/league.json` file remains a fallback if a live source is temporarily unavailable.

Validate both live sources and their team mapping:

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
