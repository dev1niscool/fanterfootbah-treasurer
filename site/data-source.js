export const GOOGLE_SHEET_ID = "1NtRDgw3Jzo5HtB4zU-lnx5niiFDKfPLJww4ToEjqsHg";
export const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit?usp=sharing`;

const GOOGLE_SHEET_RANGES = [
  { key: "setup", sheet: "League Setup", range: "A1:F200" },
  { key: "buyIns", sheet: "Buy-Ins", range: "A1:H200" },
  { key: "regular", sheet: "Regular Season", range: "A1:N200" },
  { key: "playoffs", sheet: "Playoffs", range: "A1:N200" },
];

function asText(value) {
  return value == null ? "" : String(value).trim();
}

function asNumber(value, fallback = 0) {
  if (value == null || (typeof value === "string" && !value.trim())) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

  const text = String(value).trim();
  if (text === "-") return 0;
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replaceAll(",", "").replaceAll("$", "").replace(/[()%]/g, ""));
  if (!Number.isFinite(parsed)) return fallback;
  return negative ? -parsed : parsed;
}

function roundMoney(value) {
  return Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;
}

function isChecked(value) {
  if (value === true || value === 1) return true;
  return ["☑", "checked", "yes", "true", "paid", "x"].includes(asText(value).toLocaleLowerCase());
}

function googleDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const text = asText(value);
  const googleMatch = text.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (googleMatch) {
    const [, year, month, day, hour = "0", minute = "0", second = "0"] = googleMatch;
    return new Date(Date.UTC(+year, +month, +day, +hour, +minute, +second)).toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? text : parsed.toISOString();
}

function findRow(rows, label, column = 0) {
  const index = rows.findIndex((row) => asText(row[column]) === label);
  if (index < 0) throw new Error(`Could not find "${label}" in the Google Sheet.`);
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

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tableRows(payload) {
  if (payload?.status !== "ok" || !payload.table) {
    throw new Error(payload?.errors?.[0]?.detailed_message || "Google Sheets returned an invalid response.");
  }

  const columnCount = payload.table.cols?.length || 0;
  return (payload.table.rows || []).map((row) =>
    Array.from({ length: columnCount }, (_, index) => row.c?.[index]?.v ?? null),
  );
}

function loadGoogleTable({ sheet, range }) {
  return new Promise((resolve, reject) => {
    const callbackName = `__fanterFootbahSheet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(new Error(`Timed out loading ${sheet}.`)), 15_000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    function finish(error, value) {
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }

    window[callbackName] = (payload) => {
      try {
        const rows = tableRows(payload);
        finish(null, {
          rows,
          signature: payload.sig || stableHash(JSON.stringify(rows)),
        });
      } catch (error) {
        finish(error);
      }
    };

    script.onerror = () => finish(new Error(`Could not load ${sheet} from Google Sheets.`));
    const params = new URLSearchParams({
      tqx: `out:json;responseHandler:${callbackName}`,
      sheet,
      range,
      headers: "0",
      cacheBust: String(Date.now()),
    });
    script.src = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?${params}`;
    document.head.append(script);
  });
}

export function parseGoogleSheetData(sourceTables) {
  const setupRows = sourceTables.setup;
  const buyInRows = sourceTables.buyIns;
  const regularRows = sourceTables.regular;
  const playoffRows = sourceTables.playoffs;
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
  const teamNames = new Set(teams.map((entry) => entry.team));
  const buyIns = [];
  for (let rowIndex = buyInHeader + 1; rowIndex < buyInRows.length; rowIndex += 1) {
    const team = asText(buyInRows[rowIndex][0]);
    if (!team) break;
    if (!teamNames.has(team)) break;
    const due = asNumber(buyInRows[rowIndex][2], asNumber(assumptions["Buy-In Per Team"]));
    const paid = isChecked(buyInRows[rowIndex][3]);
    const amountCollected = asNumber(buyInRows[rowIndex][5], paid ? due : 0);
    buyIns.push({
      team,
      owner: asText(buyInRows[rowIndex][1]),
      due,
      paid,
      datePaid: googleDate(buyInRows[rowIndex][4]),
      amountCollected: roundMoney(amountCollected),
      outstanding: roundMoney(asNumber(buyInRows[rowIndex][6], Math.max(0, due - amountCollected))),
      notes: asText(buyInRows[rowIndex][7]),
    });
  }

  // Google Visualization omits text headers from columns it infers as numeric,
  // so use a string column to locate this mixed-type header row.
  const regularHeader = findRow(regularRows, "Away Team", 3);
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

  const playoffHeader = findRow(playoffRows, "Round", 1);
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

  const placements = [];
  for (let rowIndex = 0; rowIndex < playoffRows.length; rowIndex += 1) {
    const place = asNumber(playoffRows[rowIndex][9], Number.NaN);
    if (!Number.isFinite(place)) continue;
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
      sourceUrl: GOOGLE_SHEET_URL,
      workbookName: "FanterFootbah Treasurer Tracker",
      syncedAt: new Date().toISOString(),
      syncMode: "live-google-sheets",
      schemaVersion: 1,
    },
    season: {
      label: "2026",
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
    playoffs: { games: playoffGames, placements },
    summary,
  };
}

export async function loadGoogleSheetData() {
  const loadedTables = await Promise.all(GOOGLE_SHEET_RANGES.map(loadGoogleTable));
  const sourceTables = Object.fromEntries(
    GOOGLE_SHEET_RANGES.map((source, index) => [source.key, loadedTables[index].rows]),
  );
  return {
    data: parseGoogleSheetData(sourceTables),
    signature: loadedTables.map((table) => table.signature).join(":"),
  };
}
