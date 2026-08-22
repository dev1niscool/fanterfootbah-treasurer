# FanterFootbah Treasurer Room

A polished, mobile-friendly dashboard for the FanterFootbah fantasy football league. Owners choose their name on entry, then get five focused views:

- Competition-first overview with an earnings leaderboard and race chart
- Team cards with owner and payment status
- All 14 weeks of regular-season matchups
- Playoff bracket and prize podium
- A personal “My Locker” view for each owner

## Live data

The dashboard combines two public live sources:

- Google Sheets is authoritative for real owner names, buy-ins, prizes, and treasurer payment checkmarks.
- ESPN is authoritative for current team names, schedule, scores, and results.

The site checks both once per minute while open and reloads when either changes. The committed `site/data/league.json` file is a working fallback if a live source is temporarily unavailable. No ESPN credentials are stored in the site.

Validate both live sources and their owner/team mapping:

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
