import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";
import XLSX from "xlsx";

const DEFAULT_SHARE_URL =
  "https://1drv.ms/x/c/8420cee342e1f353/IQA9HFrbvWfhS5oYN7S5h8lnAQOXX5uVZ_3CFWdYeMBHte8";
const DATA_PATH = path.resolve("site/data/league.json");

function commandLineValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function isChecked(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  return ["☑", "checked", "yes", "true", "paid", "x"].includes(normalized);
}

function asNumber(value, fallback = 0) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asText(value) {
  return value == null ? "" : String(value).trim();
}

function roundMoney(value) {
  return Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;
}

function excelDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? asText(value) : parsed.toISOString();
}

function rowsFor(workbook, sheetName) {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) throw new Error(`Workbook is missing the "${sheetName}" sheet.`);
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
  });
}

function findRow(rows, label, column = 0) {
  const index = rows.findIndex((row) => asText(row[column]) === label);
  if (index < 0) throw new Error(`Could not find "${label}" in the workbook.`);
  return index;
}

function findAssumptions(rows) {
  const start = findRow(rows, "Buy-In Per Team");
  const assumptions = {};
  for (let rowIndex = start; rowIndex < rows.length; rowIndex += 1) {
    const label = asText(rows[rowIndex][0]);
    if (!label) break;
    assumptions[label] = rows[rowIndex][1];
  }
  return assumptions;
}

function parseWorkbook(workbookPath, syncMode) {
  const workbook = XLSX.readFile(workbookPath, {
    cellDates: true,
    cellFormula: true,
    cellNF: false,
  });

  const setupRows = rowsFor(workbook, "League Setup");
  const buyInRows = rowsFor(workbook, "Buy-Ins");
  const regularRows = rowsFor(workbook, "Regular Season");
  const playoffRows = rowsFor(workbook, "Playoffs");
  const assumptions = findAssumptions(setupRows);

  const teamHeader = findRow(setupRows, "Team Name", 3);
  const teams = [];
  for (let rowIndex = teamHeader + 1; rowIndex < setupRows.length; rowIndex += 1) {
    const team = asText(setupRows[rowIndex][3]);
    const owner = asText(setupRows[rowIndex][4]);
    if (!team || !owner) break;
    teams.push({
      team,
      owner,
      active: asText(setupRows[rowIndex][5]).toLocaleLowerCase() !== "no",
    });
  }

  const buyInHeader = findRow(buyInRows, "Team");
  const buyIns = [];
  for (let rowIndex = buyInHeader + 1; rowIndex < buyInRows.length; rowIndex += 1) {
    const team = asText(buyInRows[rowIndex][0]);
    if (!team) break;
    const due = asNumber(buyInRows[rowIndex][2], asNumber(assumptions["Buy-In Per Team"]));
    const paid = isChecked(buyInRows[rowIndex][3]);
    const amountCollected = asNumber(buyInRows[rowIndex][5], paid ? due : 0);
    buyIns.push({
      team,
      owner: asText(buyInRows[rowIndex][1]),
      due,
      paid,
      datePaid: excelDate(buyInRows[rowIndex][4]),
      amountCollected: roundMoney(amountCollected),
      outstanding: roundMoney(asNumber(buyInRows[rowIndex][6], Math.max(0, due - amountCollected))),
      notes: asText(buyInRows[rowIndex][7]),
    });
  }

  const regularHeader = findRow(regularRows, "Match ID");
  const scheduledShare = asNumber(assumptions["Exact Prize Per Match"], 1.875);
  const schedule = [];
  for (let rowIndex = regularHeader + 1; rowIndex < regularRows.length; rowIndex += 1) {
    const matchId = asNumber(regularRows[rowIndex][0], Number.NaN);
    if (!Number.isFinite(matchId)) break;
    const week = asNumber(regularRows[rowIndex][1]);
    const awayTeam = asText(regularRows[rowIndex][3]);
    const homeTeam = asText(regularRows[rowIndex][4]);
    const awayWon = isChecked(regularRows[rowIndex][5]);
    const homeWon = isChecked(regularRows[rowIndex][6]);
    const enteredWinner = asText(regularRows[rowIndex][7]);
    const winner = enteredWinner || (awayWon !== homeWon ? (awayWon ? awayTeam : homeTeam) : "");
    const fallbackPayout = winner ? (week % 2 === 1 ? 1.88 : 1.87) : 0;
    const cashPayout = roundMoney(asNumber(regularRows[rowIndex][9], fallbackPayout));
    const paid = isChecked(regularRows[rowIndex][10]);
    const amountPaid = roundMoney(asNumber(regularRows[rowIndex][11], paid ? cashPayout : 0));

    schedule.push({
      matchId,
      week,
      game: asNumber(regularRows[rowIndex][2]),
      awayTeam,
      homeTeam,
      awayWon,
      homeWon,
      winner: winner || null,
      scheduledShare,
      cashPayout,
      paid,
      amountPaid,
      outstanding: roundMoney(asNumber(regularRows[rowIndex][12], Math.max(0, cashPayout - amountPaid))),
      notes: asText(regularRows[rowIndex][13]),
    });
  }

  const playoffHeader = findRow(playoffRows, "Week");
  const playoffGames = [];
  for (let rowIndex = playoffHeader + 1; rowIndex < playoffRows.length; rowIndex += 1) {
    const week = asNumber(playoffRows[rowIndex][0], Number.NaN);
    if (!Number.isFinite(week)) break;
    const teamA = asText(playoffRows[rowIndex][3]);
    const teamB = asText(playoffRows[rowIndex][4]);
    const teamAWon = isChecked(playoffRows[rowIndex][5]);
    const teamBWon = isChecked(playoffRows[rowIndex][6]);
    const enteredWinner = asText(playoffRows[rowIndex][7]);
    const winner = enteredWinner || (teamAWon !== teamBWon ? (teamAWon ? teamA : teamB) : "");
    playoffGames.push({
      week,
      round: asText(playoffRows[rowIndex][1]),
      game: asNumber(playoffRows[rowIndex][2]),
      teamA: teamA || null,
      teamB: teamB || null,
      teamAWon,
      teamBWon,
      winner: winner || null,
    });
  }

  const placementHeader = findRow(playoffRows, "Place", 9);
  const placements = [];
  for (let rowIndex = placementHeader + 1; rowIndex < playoffRows.length; rowIndex += 1) {
    const place = asNumber(playoffRows[rowIndex][9], Number.NaN);
    if (!Number.isFinite(place)) break;
    const prize = roundMoney(asNumber(playoffRows[rowIndex][11]));
    const paid = isChecked(playoffRows[rowIndex][12]);
    placements.push({
      place,
      team: asText(playoffRows[rowIndex][10]) || null,
      prize,
      paid,
      outstanding: roundMoney(asNumber(playoffRows[rowIndex][13], paid ? 0 : prize)),
    });
  }

  const buyInByTeam = new Map(buyIns.map((entry) => [entry.team, entry]));
  const placementByTeam = new Map(placements.filter((entry) => entry.team).map((entry) => [entry.team, entry]));
  const defaultBuyIn = asNumber(assumptions["Buy-In Per Team"], 30);

  const summary = teams.map((teamEntry) => {
    const teamGames = schedule.filter(
      (game) => game.awayTeam === teamEntry.team || game.homeTeam === teamEntry.team,
    );
    const gamesPlayed = teamGames.filter((game) => game.winner).length;
    const regularWins = teamGames.filter((game) => game.winner === teamEntry.team).length;
    const regularLosses = Math.max(0, gamesPlayed - regularWins);
    const wonGames = teamGames.filter((game) => game.winner === teamEntry.team);
    const regularSeasonEarnings = roundMoney(wonGames.reduce((sum, game) => sum + game.cashPayout, 0));
    const regularSeasonPaid = roundMoney(wonGames.reduce((sum, game) => sum + game.amountPaid, 0));
    const placement = placementByTeam.get(teamEntry.team);
    const playoffPrize = roundMoney(placement?.prize ?? 0);
    const playoffPaid = placement?.paid ? playoffPrize : 0;
    const totalEarnings = roundMoney(regularSeasonEarnings + playoffPrize);
    const winningsPaid = roundMoney(regularSeasonPaid + playoffPaid);
    const buyIn = buyInByTeam.get(teamEntry.team) ?? {
      due: defaultBuyIn,
      paid: false,
      amountCollected: 0,
      outstanding: defaultBuyIn,
    };

    return {
      team: teamEntry.team,
      owner: teamEntry.owner,
      active: teamEntry.active,
      buyInDue: roundMoney(buyIn.due),
      buyInPaid: Boolean(buyIn.paid),
      buyInCollected: roundMoney(buyIn.amountCollected),
      buyInOutstanding: roundMoney(buyIn.outstanding),
      gamesPlayed,
      regularWins,
      regularLosses,
      regularSeasonEarnings,
      finalPlace: placement?.place ?? null,
      playoffPrize,
      totalEarnings,
      winningsPaid,
      outstandingWinnings: roundMoney(Math.max(0, totalEarnings - winningsPaid)),
      netAfterBuyIn: roundMoney(totalEarnings - buyIn.due),
    };
  });

  const buyInsCollected = roundMoney(buyIns.reduce((sum, entry) => sum + entry.amountCollected, 0));
  const buyInsOutstanding = roundMoney(buyIns.reduce((sum, entry) => sum + entry.outstanding, 0));
  const totalWinningsPaid = roundMoney(summary.reduce((sum, entry) => sum + entry.winningsPaid, 0));
  const winningsOutstanding = roundMoney(summary.reduce((sum, entry) => sum + entry.outstandingWinnings, 0));
  const totalPot = roundMoney(asNumber(assumptions["Total Pot"], teams.length * defaultBuyIn));

  return {
    meta: {
      leagueName: "FanterFootbah",
      sourceUrl: process.env.ONEDRIVE_SHARE_URL || DEFAULT_SHARE_URL,
      workbookName: path.basename(workbookPath),
      syncedAt: new Date().toISOString(),
      syncMode,
      schemaVersion: 1,
    },
    season: {
      label: process.env.SEASON_LABEL || "2026",
      regularSeasonWeeks: asNumber(assumptions["Regular Season Weeks"], 14),
      matchesPerWeek: asNumber(assumptions["Matches Per Week"], 8),
    },
    finances: {
      buyInPerTeam: defaultBuyIn,
      teamCount: teams.length,
      teamsPaid: buyIns.filter((entry) => entry.paid).length,
      totalPot,
      buyInsCollected,
      buyInsOutstanding,
      regularSeasonPool: roundMoney(asNumber(assumptions["Regular Season Pool"], 210)),
      playoffPrizePool: roundMoney(asNumber(assumptions["Overall Prize Pool"], 270)),
      exactPrizePerMatch: scheduledShare,
      totalWinningsPaid,
      winningsOutstanding,
      leagueCashBalance: roundMoney(buyInsCollected - totalWinningsPaid),
    },
    teams,
    buyIns,
    schedule,
    playoffs: {
      games: playoffGames,
      placements,
    },
    summary,
  };
}

async function downloadWorkbook(destination) {
  const shareUrl = process.env.ONEDRIVE_SHARE_URL || DEFAULT_SHARE_URL;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await page.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator('iframe[name^="WacFrame_Excel"]').waitFor({ state: "visible", timeout: 120_000 });

    const excel = page.frameLocator('iframe[name^="WacFrame_Excel"]');
    const fileTab = excel.getByText("File", { exact: true }).first();
    await fileTab.waitFor({ state: "visible", timeout: 120_000 });
    await fileTab.click();
    await excel.getByText("Create a Copy", { exact: true }).last().click();

    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await excel.getByText("Download a Copy", { exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(destination);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const providedWorkbook = commandLineValue("--workbook");
  let workbookPath = providedWorkbook ? path.resolve(providedWorkbook) : null;
  let temporaryDirectory = null;
  let syncMode = providedWorkbook ? "snapshot" : "automated";

  if (!workbookPath) {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanterfootbah-"));
    workbookPath = path.join(temporaryDirectory, "Fantasy_Football_Treasurer_Tracker.xlsx");
    console.log("Downloading the latest shared workbook…");
    await downloadWorkbook(workbookPath);
  }

  try {
    await fs.access(workbookPath);
    const data = parseWorkbook(workbookPath, syncMode);
    await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
    await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(
      `Updated ${path.relative(process.cwd(), DATA_PATH)} with ${data.teams.length} teams and ${data.schedule.length} matchups.`,
    );
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
