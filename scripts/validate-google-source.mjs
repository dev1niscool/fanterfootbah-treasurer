import fs from "node:fs/promises";

import {
  ESPN_API_FILTER,
  ESPN_API_URL,
  GOOGLE_SHEET_ID,
  mergeEspnData,
  parseGoogleSheetData,
} from "../site/data-source.js";

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
const googleData = parseGoogleSheetData(
  Object.fromEntries(sources.map((source, index) => [source.key, loaded[index]])),
);
const espnResponse = await fetch(ESPN_API_URL, {
  cache: "no-store",
  headers: { "x-fantasy-filter": ESPN_API_FILTER },
});
if (!espnResponse.ok) throw new Error(`ESPN returned ${espnResponse.status}.`);
const espnData = await espnResponse.json();
if (
  !Array.isArray(espnData.transactions) ||
  !espnData.transactions.every((transaction) => ["WAIVER", "FREEAGENT"].includes(transaction.type))
) {
  throw new Error("Expected ESPN to return only waiver and free-agent transactions.");
}
const data = mergeEspnData(googleData, espnData);

if (data.teams.length !== 16) throw new Error(`Expected 16 teams; found ${data.teams.length}.`);
if (data.buyIns.length !== data.teams.length) {
  throw new Error(`Expected one buy-in row per team; found ${data.buyIns.length}.`);
}
if (data.schedule.length !== 112) throw new Error(`Expected 112 matchups; found ${data.schedule.length}.`);
if (data.playoffs.placements.length !== 3) {
  throw new Error(`Expected 3 playoff placements; found ${data.playoffs.placements.length}.`);
}
if (!data.meta.espnLive) throw new Error("Expected ESPN to be the live competition source.");
if (!data.teams.some((team) => team.owner === "Joe Berni" && team.team === "Bobsondinho's Revenge")) {
  throw new Error("Joe Berni was not matched to the current ESPN team name.");
}
if (!data.teams.some((team) => team.owner === "Christopher Morey" && team.team === "Futbol Experts")) {
  throw new Error("Christopher Morey was not matched to the ESPN team.");
}
if (!data.teams.every((team) => team.logo?.startsWith("https://") && team.logoType)) {
  throw new Error("Expected every ESPN team to include a secure logo and logo type.");
}
if (
  !data.waivers?.available ||
  !data.teams.every(
    (team) =>
      Number.isInteger(team.waiverClaims) &&
      Number.isInteger(team.freeAgentAdds) &&
      team.wireAdds === team.waiverClaims + team.freeAgentAdds,
  )
) {
  throw new Error("Expected ESPN waiver and free-agent totals for every team.");
}
if (data.waivers.totalClaims !== data.teams.reduce((sum, team) => sum + team.waiverClaims, 0)) {
  throw new Error("ESPN waiver totals do not match the team leaderboard.");
}
if (data.waivers.totalFreeAgentAdds !== data.teams.reduce((sum, team) => sum + team.freeAgentAdds, 0)) {
  throw new Error("ESPN free-agent totals do not match the team leaderboard.");
}
if (data.waivers.totalAdds !== data.teams.reduce((sum, team) => sum + team.wireAdds, 0)) {
  throw new Error("ESPN combined-add totals do not match the team leaderboard.");
}
const wireHistory2025 = data.history?.wireAdds?.[2025];
if (!wireHistory2025 || wireHistory2025.teams.length !== 12 || wireHistory2025.totalAdds !== 271) {
  throw new Error("Expected the complete 2025 ESPN acquisition archive.");
}
const wireHistory2025Bottom = [...wireHistory2025.teams]
  .sort((a, b) => a.wireAdds - b.wireAdds || a.team.localeCompare(b.team))
  .slice(0, 3)
  .map((team) => team.team);
if (wireHistory2025Bottom.join("|") !== "Big Chungus|Hot Dog U Bean Eaters|Ball Fondilers") {
  throw new Error("The 2025 bottom-three archive is incomplete.");
}
if (!data.schedule.every((game) => game.source === "espn")) {
  throw new Error("Expected every regular-season matchup to come from ESPN.");
}
const playoffPrizeTotal = data.playoffs.placements.reduce((sum, placement) => sum + placement.prize, 0);
if (Math.abs(playoffPrizeTotal - data.finances.playoffPrizePool) > 0.001) {
  throw new Error("Playoff placements do not add up to the playoff prize pool.");
}
const regularSeasonMath =
  data.season.regularSeasonWeeks * data.season.matchesPerWeek * data.finances.exactPrizePerMatch;
if (Math.abs(regularSeasonMath - data.finances.regularSeasonPool) > 0.001) {
  throw new Error("Weekly matchup shares do not add up to the regular-season pool.");
}

if (process.argv.includes("--write")) {
  const destination = new URL("../site/data/league.json", import.meta.url);
  await fs.writeFile(destination, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

console.log(
  JSON.stringify(
    {
      source: data.meta.sourceUrl,
      competitionSource: data.meta.espnLeagueUrl,
      espnLive: data.meta.espnLive,
      teams: data.teams.length,
      teamLogos: data.teams.filter((team) => team.logo).length,
      waiverClaims: data.waivers.totalClaims,
      freeAgentAdds: data.waivers.totalFreeAgentAdds,
      wireAdds: data.waivers.totalAdds,
      wireAdds2025: wireHistory2025.totalAdds,
      paidTeams: data.finances.teamsPaid,
      buyInsOutstanding: data.finances.buyInsOutstanding,
      matchups: data.schedule.length,
      playoffPlacements: data.playoffs.placements.length,
      playoffPrizeTotal,
      regularSeasonMath,
      totalPot: data.finances.totalPot,
      snapshotWritten: process.argv.includes("--write"),
    },
    null,
    2,
  ),
);
