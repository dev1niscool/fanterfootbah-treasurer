# FanterFootbah Treasurer Room

A polished, mobile-friendly dashboard for the FanterFootbah fantasy football league. Visitors choose their team on entry, then get focused views for:

- Competition-first overview with an earnings leaderboard and race chart
- Team cards with payment status
- All 14 weeks of regular-season matchups
- Playoff bracket and prize podium
- A personal “My Locker” view for each team

## Live data

The deployment combines two live sources on GitHub’s runner:

- Google Sheets is authoritative for buy-ins, prizes, and treasurer payment checkmarks.
- ESPN is authoritative for current team names, schedule, scores, and results.

GitHub Pages refreshes a sanitized `site/data/league.json` snapshot every five minutes. The browser only receives team and league statistics: manager names and source links are omitted, and the backend source module is excluded from the Pages artifact. An open dashboard checks the sanitized snapshot once per minute and reloads when it changes.

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
