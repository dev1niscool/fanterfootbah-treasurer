export const GOOGLE_SHEET_ID = "1NtRDgw3Jzo5HtB4zU-lnx5niiFDKfPLJww4ToEjqsHg";
export const ESPN_API_URL =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/635040019?view=mTeam&view=mMatchup&view=mStandings&view=mSettings&view=mTransactions2";
export const ESPN_API_FILTER = JSON.stringify({
  transactions: {
    filterType: { value: ["WAIVER", "FREEAGENT"] },
    limit: 1000,
    offset: 0,
    sortProcessDate: { sortPriority: 1, sortAsc: false },
  },
});

const ESPN_TEAM_FALLBACK = [
  { id: 1, abbrev: "Joe!", name: "Bobsondinho's Revenge" },
  { id: 2, abbrev: "NEWM", name: "Big Body Newms" },
  { id: 3, abbrev: "AAAa", name: "brazil bru h" },
  { id: 4, abbrev: "W", name: "Big Chungus" },
  { id: 5, abbrev: "BEAN", name: "Hot Dog U Bean Eaters" },
  { id: 6, abbrev: "BALz", name: "Ball Fondilers" },
  { id: 7, abbrev: "UHHH", name: "Futbol Experts" },
  { id: 8, abbrev: "MMT", name: "Autism Speaks" },
  { id: 9, abbrev: "BEN", name: "Courtland Sutton" },
  { id: 10, abbrev: "Nick", name: "Tung Tung Shakir" },
  { id: 11, abbrev: "MEOW", name: "It was a G.I. Jane joke" },
  { id: 12, abbrev: ":P", name: "DeVinta Smith" },
  { id: 13, abbrev: "HAWK", name: "Hawk Tuah Hit Squad" },
  { id: 14, abbrev: "Frr", name: "Free Rashee Rice" },
  { id: 15, abbrev: "WRM", name: "wupwtw" },
  { id: 16, abbrev: "BHG", name: "Big Hog Gabe" },
];

const ESPN_2025_WIRE_ADDS = [
  { id: 1, team: "Hawk Invert Tetrahedron Etienne", wireAdds: 41 },
  { id: 2, team: "Team Newman", wireAdds: 49 },
  { id: 3, team: "brazil bru h", wireAdds: 10 },
  { id: 4, team: "Big Chungus", wireAdds: 4 },
  { id: 5, team: "Hot Dog U Bean Eaters", wireAdds: 5 },
  { id: 6, team: "Ball Fondilers", wireAdds: 8 },
  { id: 7, team: "Grilled Cheese Enjoyers", wireAdds: 21 },
  { id: 8, team: "De'von 8chan", wireAdds: 9 },
  { id: 9, team: "Hawk travis etienne jr.", wireAdds: 45 },
  { id: 10, team: "New Orleans Nicks", wireAdds: 18 },
  { id: 11, team: "It was a G.I. Jane joke", wireAdds: 13 },
  { id: 12, team: "Kancharbonnet", wireAdds: 48 },
];

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

function safeImageUrl(value) {
  const text = asText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function canonicalTeamMap(googleData, espnData) {
  const fallbackById = new Map(ESPN_TEAM_FALLBACK.map((team) => [team.id, team]));
  const liveById = new Map((espnData?.teams || []).map((team) => [team.id, team]));
  const googleBySlot = new Map(googleData.teams.map((team) => [team.slotId, team]));
  const wireAddsByTeam = new Map();
  (espnData?.transactions || [])
    .filter((transaction) => ["WAIVER", "FREEAGENT"].includes(transaction.type))
    .forEach((transaction) => {
      const teamId = asNumber(transaction.teamId);
      if (teamId <= 0) return;
      const activity = wireAddsByTeam.get(teamId) || { waiverClaims: 0, freeAgentAdds: 0 };
      if (transaction.type === "WAIVER") activity.waiverClaims += 1;
      if (transaction.type === "FREEAGENT") activity.freeAgentAdds += 1;
      wireAddsByTeam.set(teamId, activity);
    });

  return ESPN_TEAM_FALLBACK.map((fallback) => {
    const live = liveById.get(fallback.id);
    const google = googleBySlot.get(fallback.id);
    const overall = live?.record?.overall || {};
    const wireAdds = wireAddsByTeam.get(fallback.id);
    const waiverClaims = Array.isArray(espnData?.transactions)
      ? wireAdds?.waiverClaims || 0
      : asNumber(google?.waiverClaims);
    const freeAgentAdds = Array.isArray(espnData?.transactions)
      ? wireAdds?.freeAgentAdds || 0
      : asNumber(google?.freeAgentAdds);
    return {
      team: asText(live?.name) || fallback.name,
      active: google?.active !== false,
      espnTeamId: fallback.id,
      abbreviation: asText(live?.abbrev) || fallback.abbrev,
      logo: safeImageUrl(live?.logo) || safeImageUrl(google?.logo),
      logoType: asText(live?.logoType) || asText(google?.logoType) || null,
      pointsFor: asNumber(overall.pointsFor, asNumber(live?.points)),
      pointsAgainst: asNumber(overall.pointsAgainst),
      espnWins: asNumber(overall.wins),
      espnLosses: asNumber(overall.losses),
      espnTies: asNumber(overall.ties),
      playoffSeed: asNumber(live?.playoffSeed, fallback.id),
      waiverClaims,
      freeAgentAdds,
      wireAdds: waiverClaims + freeAgentAdds,
      oldTeam: google?.team || fallbackById.get(fallback.id)?.name,
    };
  });
}

function payoutForWeek(week) {
  return week % 2 === 1 ? 1.88 : 1.87;
}

export function mergeEspnData(googleData, espnData = null) {
  const teams = canonicalTeamMap(googleData, espnData);
  const waiverDataAvailable = Array.isArray(espnData?.transactions);
  const byId = new Map(teams.map((team) => [team.espnTeamId, team]));
  const historicalWireTeams = ESPN_2025_WIRE_ADDS.map((historical) => {
    const current = byId.get(historical.id);
    return {
      season: 2025,
      team: historical.team,
      espnTeamId: historical.id,
      logo: current?.logo || null,
      logoType: current?.logoType || null,
      wireAdds: historical.wireAdds,
    };
  });
  const canonicalByOldName = new Map();
  teams.forEach((team) => {
    canonicalByOldName.set(team.oldTeam, team.team);
    canonicalByOldName.set(ESPN_TEAM_FALLBACK.find((fallback) => fallback.id === team.espnTeamId)?.name, team.team);
    canonicalByOldName.set(team.team, team.team);
  });
  const financeByWeekGame = new Map(
    googleData.schedule.map((game) => [`${game.week}:${game.game}`, game]),
  );

  const liveSchedule = Array.isArray(espnData?.schedule) && espnData.schedule.length
    ? [...espnData.schedule]
        .filter((game) => asNumber(game.matchupPeriodId) <= googleData.season.regularSeasonWeeks)
        .sort((a, b) => a.matchupPeriodId - b.matchupPeriodId || a.id - b.id)
    : null;

  const gamesPerWeek = new Map();
  const schedule = (liveSchedule || googleData.schedule).map((sourceGame, index) => {
    if (!liveSchedule) {
      const { notes: _privateNotes, ...publicGame } = sourceGame;
      const awayTeam = canonicalByOldName.get(sourceGame.awayTeam) || sourceGame.awayTeam;
      const homeTeam = canonicalByOldName.get(sourceGame.homeTeam) || sourceGame.homeTeam;
      return {
        ...publicGame,
        awayTeam,
        homeTeam,
        winner: canonicalByOldName.get(sourceGame.winner) || sourceGame.winner,
        source: "google-fallback",
      };
    }

    const week = asNumber(sourceGame.matchupPeriodId);
    const game = (gamesPerWeek.get(week) || 0) + 1;
    gamesPerWeek.set(week, game);
    const manualFinance = financeByWeekGame.get(`${week}:${game}`) || {};
    const awayTeam = byId.get(sourceGame.away?.teamId)?.team || "TBD";
    const homeTeam = byId.get(sourceGame.home?.teamId)?.team || "TBD";
    const winner = sourceGame.winner === "AWAY"
      ? awayTeam
      : sourceGame.winner === "HOME"
        ? homeTeam
        : null;
    const cashPayout = winner ? payoutForWeek(week) : 0;
    const paid = Boolean(winner && manualFinance.paid);
    const amountPaid = paid ? roundMoney(asNumber(manualFinance.amountPaid, cashPayout)) : 0;

    return {
      matchId: asNumber(sourceGame.id, index + 1),
      week,
      game,
      awayTeam,
      homeTeam,
      awayScore: roundMoney(asNumber(sourceGame.away?.totalPoints)),
      homeScore: roundMoney(asNumber(sourceGame.home?.totalPoints)),
      awayWon: sourceGame.winner === "AWAY",
      homeWon: sourceGame.winner === "HOME",
      winner,
      tied: sourceGame.winner === "TIE",
      scheduledShare: googleData.finances.exactPrizePerMatch,
      cashPayout,
      paid,
      amountPaid,
      outstanding: roundMoney(Math.max(0, cashPayout - amountPaid)),
      source: "espn",
    };
  });

  const buyIns = googleData.buyIns.map((buyIn, index) => {
    const { notes: _privateNotes, ...publicBuyIn } = buyIn;
    const slotId = buyIn.slotId || index + 1;
    const canonical = byId.get(slotId);
    return { ...publicBuyIn, slotId, team: canonical?.team || canonicalByOldName.get(buyIn.team) || buyIn.team };
  });

  const placements = googleData.playoffs.placements.map((placement) => ({
    ...placement,
    team: canonicalByOldName.get(placement.team) || placement.team,
  }));
  const playoffGames = googleData.playoffs.games.map((game) => ({
    ...game,
    teamA: canonicalByOldName.get(game.teamA) || game.teamA,
    teamB: canonicalByOldName.get(game.teamB) || game.teamB,
    winner: canonicalByOldName.get(game.winner) || game.winner,
  }));

  const buyInBySlot = new Map(buyIns.map((entry) => [entry.slotId, entry]));
  const placementByTeam = new Map(placements.filter((entry) => entry.team).map((entry) => [entry.team, entry]));
  const summary = teams.map((teamEntry) => {
    const teamGames = schedule.filter(
      (game) => game.awayTeam === teamEntry.team || game.homeTeam === teamEntry.team,
    );
    const gamesPlayed = teamGames.filter((game) => game.winner || game.tied).length;
    const regularWins = teamGames.filter((game) => game.winner === teamEntry.team).length;
    const regularTies = teamGames.filter((game) => game.tied).length;
    const regularLosses = Math.max(0, gamesPlayed - regularWins - regularTies);
    const wonGames = teamGames.filter((game) => game.winner === teamEntry.team);
    const regularSeasonEarnings = roundMoney(wonGames.reduce((sum, game) => sum + game.cashPayout, 0));
    const regularSeasonPaid = roundMoney(wonGames.reduce((sum, game) => sum + game.amountPaid, 0));
    const placement = placementByTeam.get(teamEntry.team);
    const playoffPrize = roundMoney(placement?.prize ?? 0);
    const playoffPaid = placement?.paid ? playoffPrize : 0;
    const totalEarnings = roundMoney(regularSeasonEarnings + playoffPrize);
    const winningsPaid = roundMoney(regularSeasonPaid + playoffPaid);
    const buyIn = buyInBySlot.get(teamEntry.espnTeamId) || {
      due: googleData.finances.buyInPerTeam,
      paid: false,
      amountCollected: 0,
      outstanding: googleData.finances.buyInPerTeam,
    };

    return {
      ...teamEntry,
      buyInDue: roundMoney(buyIn.due),
      buyInPaid: Boolean(buyIn.paid),
      buyInCollected: roundMoney(buyIn.amountCollected),
      buyInOutstanding: roundMoney(buyIn.outstanding),
      gamesPlayed,
      regularWins,
      regularLosses,
      regularTies,
      regularSeasonEarnings,
      finalPlace: placement?.place ?? null,
      playoffPrize,
      totalEarnings,
      winningsPaid,
      outstandingWinnings: roundMoney(Math.max(0, totalEarnings - winningsPaid)),
      netAfterBuyIn: roundMoney(totalEarnings - buyIn.due),
    };
  });

  const totalWinningsPaid = roundMoney(summary.reduce((sum, entry) => sum + entry.winningsPaid, 0));
  const winningsOutstanding = roundMoney(summary.reduce((sum, entry) => sum + entry.outstandingWinnings, 0));

  return {
    ...googleData,
    meta: {
      ...googleData.meta,
      espnLive: Boolean(espnData),
      waiverDataAvailable,
      syncMode: espnData ? "live-google-sheets-and-espn" : "live-google-sheets-espn-fallback",
      syncedAt: new Date().toISOString(),
      schemaVersion: 5,
    },
    teams: teams.map(({ oldTeam, abbreviation: _privateAbbreviation, ...team }) => team),
    waivers: {
      source: "espn",
      available: waiverDataAvailable,
      totalClaims: teams.reduce((sum, team) => sum + team.waiverClaims, 0),
      totalFreeAgentAdds: teams.reduce((sum, team) => sum + team.freeAgentAdds, 0),
      totalAdds: teams.reduce((sum, team) => sum + team.wireAdds, 0),
      lastProcessedAt: espnData?.status?.waiverLastExecutionDate || null,
    },
    history: {
      ...googleData.history,
      wireAdds: {
        ...googleData.history?.wireAdds,
        2025: {
          season: 2025,
          source: "espn-transaction-counter",
          totalAdds: historicalWireTeams.reduce((sum, team) => sum + team.wireAdds, 0),
          teams: historicalWireTeams,
        },
      },
    },
    buyIns,
    schedule,
    playoffs: { games: playoffGames, placements },
    summary: summary.map(({ oldTeam, abbreviation: _privateAbbreviation, ...team }) => team),
    finances: {
      ...googleData.finances,
      totalWinningsPaid,
      winningsOutstanding,
      leagueCashBalance: roundMoney(googleData.finances.buyInsCollected - totalWinningsPaid),
    },
  };
}

export async function loadEspnLeagueData() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(ESPN_API_URL, {
      cache: "no-store",
      headers: { "x-fantasy-filter": ESPN_API_FILTER },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ESPN returned ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.teams) || !Array.isArray(data.schedule) || !Array.isArray(data.transactions)) {
      throw new Error("ESPN returned incomplete league data.");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
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
    const hasManager = Boolean(asText(setupRows[rowIndex][4]));
    if (!team || !hasManager) break;
    teams.push({
      slotId: teams.length + 1,
      team,
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
      slotId: buyIns.length + 1,
      team,
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

  const buyInBySlot = new Map(buyIns.map((entry) => [entry.slotId, entry]));
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
    const buyIn = buyInBySlot.get(teamEntry.slotId) ?? {
      due: defaultBuyIn,
      paid: false,
      amountCollected: 0,
      outstanding: defaultBuyIn,
    };

    return {
      team: teamEntry.team,
      slotId: teamEntry.slotId,
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
      workbookName: "FanterFootbah Treasurer Tracker",
      syncedAt: new Date().toISOString(),
      syncMode: "live-google-sheets",
      schemaVersion: 5,
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
  const [loadedTables, espnResult] = await Promise.all([
    Promise.all(GOOGLE_SHEET_RANGES.map(loadGoogleTable)),
    loadEspnLeagueData().catch((error) => {
      console.warn("ESPN data was unavailable; using the saved team-name mapping.", error);
      return null;
    }),
  ]);
  const sourceTables = Object.fromEntries(
    GOOGLE_SHEET_RANGES.map((source, index) => [source.key, loadedTables[index].rows]),
  );
  const googleData = parseGoogleSheetData(sourceTables);
  const espnSignature = espnResult
    ? stableHash(
        JSON.stringify({
          teams: espnResult.teams,
          schedule: espnResult.schedule,
          transactions: espnResult.transactions,
        }),
      )
    : "espn-fallback";
  return {
    data: mergeEspnData(googleData, espnResult),
    signature: `${loadedTables.map((table) => table.signature).join(":")}:${espnSignature}`,
  };
}
