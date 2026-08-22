import fs from "node:fs/promises";

import { GOOGLE_SHEET_ID, parseGoogleSheetData } from "../site/data-source.js";

const sources = [
  { key: "setup", sheet: "League Setup", range: "A1:F200" },
  { key: "buyIns", sheet: "Buy-Ins", range: "A1:H200" },
  { key: "regular", sheet: "Regular Season", range: "A1:N200" },
  { key: "playoffs", sheet: "Playoffs", range: "A1:N200" },
];

async function loadRows({ sheet, range }) {
  const params = new URLSearchParams({
    tqx: "out:json;responseHandler:validateGoogleSheet",
    sheet,
    range,
    headers: "0",
  });
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?${params}`);
  if (!response.ok) throw new Error(`${sheet} returned ${response.status}.`);
  const body = await response.text();
  const start = body.indexOf("{");
  const end = body.lastIndexOf(");");
  if (start < 0 || end < start) throw new Error(`${sheet} returned an invalid response.`);
  const payload = JSON.parse(body.slice(start, end));
  if (payload.status !== "ok") throw new Error(`${sheet} did not return data.`);
  const columnCount = payload.table.cols?.length || 0;
  return (payload.table.rows || []).map((row) =>
    Array.from({ length: columnCount }, (_, index) => row.c?.[index]?.v ?? null),
  );
}

const loaded = await Promise.all(sources.map(loadRows));
const data = parseGoogleSheetData(Object.fromEntries(sources.map((source, index) => [source.key, loaded[index]])));

if (data.teams.length !== 16) throw new Error(`Expected 16 teams; found ${data.teams.length}.`);
if (data.buyIns.length !== data.teams.length) {
  throw new Error(`Expected one buy-in row per team; found ${data.buyIns.length}.`);
}
if (data.schedule.length !== 112) throw new Error(`Expected 112 matchups; found ${data.schedule.length}.`);
if (data.playoffs.placements.length !== 3) {
  throw new Error(`Expected 3 playoff placements; found ${data.playoffs.placements.length}.`);
}

if (process.argv.includes("--write")) {
  const destination = new URL("../site/data/league.json", import.meta.url);
  await fs.writeFile(destination, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

console.log(
  JSON.stringify(
    {
      source: data.meta.sourceUrl,
      teams: data.teams.length,
      paidTeams: data.finances.teamsPaid,
      buyInsOutstanding: data.finances.buyInsOutstanding,
      matchups: data.schedule.length,
      playoffPlacements: data.playoffs.placements.length,
      totalPot: data.finances.totalPot,
      snapshotWritten: process.argv.includes("--write"),
    },
    null,
    2,
  ),
);
