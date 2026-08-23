import { loadGoogleSheetData } from "./data-source.js";

const DATA_URL = "./data/league.json";
const UPDATE_CHECK_INTERVAL_MS = 60_000;
const OWNER_STORAGE_KEY = "fanterfootbah-owner";

const state = {
  data: null,
  activeTab: "overview",
  activeOwner: "",
  sourceSignature: null,
  usingLiveData: false,
  includeBuyIn: false,
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const decimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  return money.format(Number(value) || 0);
}

function formatPoints(value) {
  return decimal.format(Number(value) || 0);
}

function formatPreciseMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(Number(value) || 0);
}

function initials(value = "") {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "FF";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

function teamForName(teamName) {
  return state.data?.summary.find((team) => team.team === teamName) || null;
}

function teamLogoContents(team, { eager = false } = {}) {
  const name = team?.team || "FanterFootbah";
  const fallback = `<span class="avatar-fallback">${initials(name)}</span>`;
  if (!team?.logo) return fallback;
  const customClass = team.logoType?.includes("CUSTOM") ? " is-custom" : "";
  return `${fallback}<img class="team-avatar-image${customClass}" src="${escapeHtml(team.logo)}" alt="" ${
    eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'
  } decoding="async" />`;
}

function teamAvatar(teamOrName, extraClass = "") {
  const team = typeof teamOrName === "string" ? teamForName(teamOrName) : teamOrName;
  const name = team?.team || String(teamOrName || "");
  return `<span class="avatar team-avatar${extraClass ? ` ${extraClass}` : ""}" aria-hidden="true">${teamLogoContents(
    team || { team: name },
  )}</span>`;
}

function moneyClass(value) {
  if (value > 0) return "money-positive";
  if (value < 0) return "money-negative";
  return "";
}

function displayEarnings(team) {
  return state.includeBuyIn ? team.netAfterBuyIn : team.totalEarnings;
}

function earningsLabel() {
  return state.includeBuyIn ? "After buy-in" : "Earnings";
}

function recordFor(team) {
  return team.regularTies
    ? `${team.regularWins}–${team.regularLosses}–${team.regularTies}`
    : `${team.regularWins}–${team.regularLosses}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

function setTab(tabName, { updateHash = true, focus = false } = {}) {
  const validTab = `#tab-${tabName}`;
  const resolvedTab = $(validTab) ? tabName : "overview";
  state.activeTab = resolvedTab;

  $$("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === resolvedTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });

  $$(".tab-panel").forEach((panel) => {
    const active = panel.id === resolvedTab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });

  if (updateHash) history.replaceState(null, "", `#${resolvedTab}`);
  if (focus) $(`#${resolvedTab}`)?.focus({ preventScroll: true });
  if (state.data && resolvedTab === "pot-split") renderPotSplit({ animate: true });
}

function setupTabs() {
  $$("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = $$("[data-tab]");
      const current = tabs.indexOf(button);
      let next = current;
      if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      tabs[next].focus();
      setTab(tabs[next].dataset.tab);
    });
  });

  $$("[data-jump-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setTab(button.dataset.jumpTab);
      $(".tab-rail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const initial = location.hash.slice(1);
  setTab(initial || "overview", { updateHash: false });
}

function renderSync() {
  const { syncedAt, espnLive } = state.data.meta;
  const syncedDate = new Date(syncedAt);
  const isValid = !Number.isNaN(syncedDate.valueOf());

  if (state.usingLiveData) {
    const sources = espnLive ? "ESPN + Sheets live" : "Sheets live";
    const label = isValid ? `Updated ${dateTime.format(syncedDate)}` : "Live league data loaded";
    $("#sync-label").textContent = sources;
    $("#sync-pill").title = `${label} · checks both sources every minute`;
    $("#sync-pill").classList.toggle("is-stale", !espnLive);
    $("#footer-sync").textContent = `${label} · ESPN controls names and results; Google Sheets controls owner names and money`;
    return;
  }

  const label = isValid ? `Saved ${dateTime.format(syncedDate)}` : "Saved league snapshot";
  $("#sync-label").textContent = "Backup snapshot";
  $("#sync-pill").title = `${label} · live sources could not be reached`;
  $("#sync-pill").classList.add("is-stale");
  $("#footer-sync").textContent = `${label} · showing the saved backup`;
}

function renderQuickStrip() {
  const team = state.data.summary.find((entry) => entry.owner === state.activeOwner);
  if (!team) return;
  $("#welcome-owner").textContent = team.owner.split(" ")[0];
  $("#welcome-team").textContent = team.team;
  $("#welcome-record").textContent = recordFor(team);
  $("#welcome-earnings-label").textContent = earningsLabel();
  $("#welcome-earnings").textContent = formatMoney(displayEarnings(team));
  $("#welcome-earnings").className = moneyClass(displayEarnings(team));
  $("#welcome-points").textContent = formatPoints(team.pointsFor);
  $("#header-owner-initials").innerHTML = teamLogoContents(team, { eager: true });
  $("#header-owner-name").textContent = team.owner;
}

function earningsStandings() {
  return [...state.data.summary].sort(
    (a, b) =>
      displayEarnings(b) - displayEarnings(a) ||
      b.regularWins - a.regularWins ||
      b.pointsFor - a.pointsFor ||
      a.team.localeCompare(b.team),
  );
}

function renderOverview() {
  const { finances, schedule, summary } = state.data;
  const decidedGames = schedule.filter((game) => game.winner || game.tied);
  const paidPayouts = schedule.filter((game) => game.paid).length;
  const totalWinnings = summary.reduce((sum, team) => sum + team.totalEarnings, 0);
  const standings = earningsStandings();

  $("#leaderboard-money-heading").textContent = earningsLabel();
  $("#leaderboard-body").innerHTML = standings
    .slice(0, 6)
    .map((team, index) => {
      const earnings = displayEarnings(team);
      return `
        <tr${team.owner === state.activeOwner ? ' class="is-you"' : ""}>
          <td><span class="rank${index < 3 ? " is-top" : ""}">${index + 1}</span></td>
          <td>
            <div class="team-cell">
              ${teamAvatar(team)}
              <span>${escapeHtml(team.team)}<small>${escapeHtml(team.owner)}${team.owner === state.activeOwner ? " · You" : ""}</small></span>
            </div>
          </td>
          <td>${team.regularWins}</td>
          <td>${formatPoints(team.pointsFor)}</td>
          <td class="${moneyClass(earnings)}">${formatMoney(earnings)}</td>
        </tr>
      `;
    })
    .join("");

  const pointsLeader = [...summary].sort((a, b) => b.pointsFor - a.pointsFor || a.team.localeCompare(b.team))[0];
  const winsLeader = [...summary].sort((a, b) => b.regularWins - a.regularWins || b.pointsFor - a.pointsFor)[0];
  const leaderValue = displayEarnings(standings[0]);
  const secondValue = displayEarnings(standings[1]);
  const margin = leaderValue - secondValue;
  const ownerRank = standings.findIndex((team) => team.owner === state.activeOwner) + 1;
  const competitionStarted = decidedGames.length > 0 || summary.some((team) => team.pointsFor > 0);
  const funStats = [
    {
      icon: "⚡",
      kicker: "Points leader",
      value: competitionStarted ? pointsLeader.team : "Kickoff pending",
      detail: competitionStarted ? `${formatPoints(pointsLeader.pointsFor)} ESPN points` : "Everyone starts level",
    },
    {
      icon: "🏆",
      kicker: "Most weekly wins",
      value: decidedGames.length ? winsLeader.team : "0 wins",
      detail: decidedGames.length ? `${winsLeader.regularWins} cash-winning matchup${winsLeader.regularWins === 1 ? "" : "s"}` : "The first payout is up for grabs",
    },
    {
      icon: "↔",
      kicker: "Cash race",
      value: margin === 0 ? "Dead heat" : `${formatMoney(margin)} margin`,
      detail: margin === 0 ? `${summary.length} teams tied at ${formatMoney(leaderValue)}` : `${standings[0].abbreviation} leads ${standings[1].abbreviation}`,
    },
    {
      icon: "✦",
      kicker: "Your money rank",
      value: ownerRank ? `#${ownerRank}` : "—",
      detail: ownerRank ? `${state.activeOwner} · ${formatMoney(displayEarnings(standings[ownerRank - 1]))}` : "Choose your name",
    },
  ];
  $("#fun-stats").innerHTML = funStats
    .map(
      (stat) => `
        <article class="fun-stat">
          <span class="fun-stat-icon" aria-hidden="true">${stat.icon}</span>
          <div><small>${escapeHtml(stat.kicker)}</small><strong>${escapeHtml(stat.value)}</strong><p>${escapeHtml(stat.detail)}</p></div>
        </article>
      `,
    )
    .join("");

  const metrics = [
    {
      icon: "$",
      value: formatMoney(finances.leagueCashBalance),
      label: "Cash currently in the league",
    },
    {
      icon: "✓",
      value: `${finances.teamsPaid} / ${finances.teamCount}`,
      label: "Buy-ins marked paid",
    },
    {
      icon: "W",
      value: `${decidedGames.length} / ${schedule.length}`,
      label: "ESPN matchups decided",
      warning: !state.data.meta.espnLive,
    },
    {
      icon: "↗",
      value: formatMoney(finances.winningsOutstanding),
      label: `${paidPayouts} payouts sent · ${formatMoney(totalWinnings)} earned`,
      warning: finances.winningsOutstanding > 0,
    },
  ];
  $("#overview-metrics").innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card${metric.warning ? " is-warning" : ""}">
          <span class="metric-icon" aria-hidden="true">${escapeHtml(metric.icon)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
          <p>${escapeHtml(metric.label)}</p>
        </article>
      `,
    )
    .join("");
}

function renderTeamCards(query = "") {
  const term = query.trim().toLocaleLowerCase();
  const teams = state.data.summary.filter(
    (team) => !term || `${team.team} ${team.owner} ${team.abbreviation}`.toLocaleLowerCase().includes(term),
  );

  $("#team-grid").innerHTML = teams.length
    ? teams
        .map((team) => {
          const earnings = displayEarnings(team);
          return `
            <article class="team-card${team.owner === state.activeOwner ? " is-you" : ""}">
              <div>
                <div class="team-card-top">
                  ${teamAvatar(team)}
                  <span class="status-badge${team.buyInPaid ? "" : " is-due"}">
                    ${team.buyInPaid ? "Buy-in paid" : `${formatMoney(team.buyInOutstanding)} due`}
                  </span>
                </div>
                <h3>${escapeHtml(team.team)}</h3>
                <p class="owner-name">${escapeHtml(team.owner)}${team.owner === state.activeOwner ? " · You" : ""}</p>
              </div>
              <div class="team-card-stats">
                <div><span>Record</span><b>${recordFor(team)}</b></div>
                <div><span>ESPN pts</span><b>${formatPoints(team.pointsFor)}</b></div>
                <div><span>${earningsLabel()}</span><b class="${moneyClass(earnings)}">${formatMoney(earnings)}</b></div>
              </div>
            </article>
          `;
        })
        .join("")
    : '<div class="no-results">No team or owner matches that search.</div>';
}

function renderWaivers() {
  const teams = state.data.summary.map((team) => ({
    ...team,
    waiverClaims: Number(team.waiverClaims) || 0,
  }));
  const waiverDataAvailable = Boolean(state.data.waivers?.available);
  const totalClaims = teams.reduce((sum, team) => sum + team.waiverClaims, 0);
  const total = $("#waiver-total");
  const leaderboard = $("#waiver-leaderboard");
  const shame = $("#waiver-shame");
  const shameNote = $("#waiver-shame-note");

  if (!waiverDataAvailable) {
    total.innerHTML = "<strong>—</strong><span>ESPN temporarily unavailable</span>";
    leaderboard.innerHTML = '<div class="waiver-unavailable"><strong>Waiver data is taking a timeout.</strong><span>The saved league data is still available.</span></div>';
    shame.innerHTML = '<div class="waiver-no-shame"><strong>?</strong><h4>No verdict</h4><p>The cellar reopens when ESPN reconnects.</p></div>';
    shameNote.textContent = "";
    return;
  }

  total.innerHTML = `<strong>${totalClaims}</strong><span>claim${totalClaims === 1 ? "" : "s"} submitted</span>`;
  const standings = [...teams].sort(
    (a, b) => b.waiverClaims - a.waiverClaims || a.team.localeCompare(b.team),
  );
  const maxClaims = Math.max(1, ...standings.map((team) => team.waiverClaims));
  let priorClaims = null;
  let currentRank = 0;

  const zeroBanner = totalClaims === 0
    ? '<div class="waiver-zero-banner"><strong>The wire is untouched.</strong><span>Everybody starts tied at zero.</span></div>'
    : "";
  leaderboard.innerHTML = `${zeroBanner}${standings
    .map((team, index) => {
      if (team.waiverClaims !== priorClaims) currentRank = index + 1;
      priorClaims = team.waiverClaims;
      const share = (team.waiverClaims / maxClaims) * 100;
      return `
        <div class="waiver-row${team.owner === state.activeOwner ? " is-you" : ""}" style="--waiver-share: ${share}%">
          <span class="waiver-rank${currentRank === 1 ? " is-top" : ""}">${currentRank}</span>
          <div class="waiver-team">
            ${teamAvatar(team)}
            <span><strong>${escapeHtml(team.team)}</strong><small>${escapeHtml(team.owner)}${team.owner === state.activeOwner ? " · You" : ""}</small></span>
          </div>
          <span class="waiver-bar" aria-hidden="true"><i></i></span>
          <span class="waiver-count"><strong>${team.waiverClaims}</strong><small>claim${team.waiverClaims === 1 ? "" : "s"}</small></span>
        </div>
      `;
    })
    .join("")}`;

  if (totalClaims === 0) {
    shame.innerHTML = '<div class="waiver-no-shame"><strong>0</strong><h4>No shame yet</h4><p>Nobody gets dragged before the first claim.</p></div>';
    shameNote.textContent = "All 16 teams are tied.";
    return;
  }

  const bottom = [...teams].sort(
    (a, b) => a.waiverClaims - b.waiverClaims || a.team.localeCompare(b.team),
  );
  const bottomThree = bottom.slice(0, 3);
  const cutoffClaims = bottomThree.at(-1)?.waiverClaims ?? 0;
  const teamsAtCutoff = bottom.filter((team) => team.waiverClaims === cutoffClaims).length;
  const cellarLabels = ["Deepest in the cellar", "Still down here", "Barely moving"];
  shame.innerHTML = bottomThree
    .map(
      (team, index) => `
        <article class="waiver-shame-card">
          <span class="waiver-shame-rank">${index + 1}</span>
          ${teamAvatar(team, "shame-avatar")}
          <div><small>${cellarLabels[index]}</small><strong>${escapeHtml(team.team)}</strong><span>${escapeHtml(team.owner)}</span></div>
          <b>${team.waiverClaims}<small> claim${team.waiverClaims === 1 ? "" : "s"}</small></b>
        </article>
      `,
    )
    .join("");
  shameNote.textContent = teamsAtCutoff > 1
    ? `${teamsAtCutoff} teams are tied at ${cutoffClaims}; three are shown alphabetically.`
    : "The cellar updates automatically with ESPN.";
}

function matchupTeam(team, winner, score, showScore) {
  return `
    <div class="matchup-team${team && team === winner ? " is-winner" : ""}">
      ${teamAvatar(team)}
      <span>${escapeHtml(team || "TBD")}</span>
      ${showScore ? `<b class="matchup-score">${formatPoints(score)}</b>` : ""}
    </div>
  `;
}

function renderScheduleWeek(week) {
  const games = state.data.schedule.filter((game) => game.week === Number(week));
  const decided = games.filter((game) => game.winner || game.tied).length;
  const paidPayouts = games.filter((game) => game.paid).length;
  const payout = games.reduce((sum, game) => sum + game.cashPayout, 0);
  $("#week-summary").innerHTML = `
    <span><strong>Week ${week}</strong> · ${decided} of ${games.length} ESPN results final</span>
    <span>${formatMoney(payout)} earned · ${paidPayouts} payout${paidPayouts === 1 ? "" : "s"} paid</span>
  `;

  $("#matchup-grid").innerHTML = games
    .map((game) => {
      const hasScore = game.winner || game.tied || game.awayScore > 0 || game.homeScore > 0;
      const payoutStatus = game.winner
        ? game.paid
          ? `${formatMoney(game.amountPaid)} paid ✓`
          : `${formatMoney(game.cashPayout)} not paid`
        : "Pending result";
      return `
        <article class="matchup-card">
          <div class="matchup-card-header">
            <span>Game ${game.game}</span>
            <span>${game.tied ? "Final · tie" : game.winner ? "Final" : hasScore ? "In progress" : "Scheduled"}</span>
          </div>
          <div class="matchup-card-body">
            ${matchupTeam(game.awayTeam, game.winner, game.awayScore, hasScore)}
            ${matchupTeam(game.homeTeam, game.winner, game.homeScore, hasScore)}
          </div>
          <div class="matchup-card-footer">
            <span>${game.winner ? `${escapeHtml(game.winner)} won` : `${formatMoney(game.scheduledShare)} prize`}</span>
            <span class="payout-status${game.paid ? " is-paid" : game.winner ? " is-due" : ""}">
              <small>Sheet payout</small>
              <b>${payoutStatus}</b>
            </span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSchedule() {
  const weeks = [...new Set(state.data.schedule.map((game) => game.week))].sort((a, b) => a - b);
  const firstIncompleteWeek = weeks.find((week) =>
    state.data.schedule.some((game) => game.week === week && !game.winner && !game.tied),
  );
  const currentSelection = Number($("#week-select").value);
  const initialWeek = weeks.includes(currentSelection) ? currentSelection : firstIncompleteWeek || weeks.at(-1) || 1;
  $("#week-select").innerHTML = weeks.map((week) => `<option value="${week}">Week ${week}</option>`).join("");
  $("#week-select").value = String(initialWeek);
  renderScheduleWeek(initialWeek);
}

function bracketGame(game) {
  const row = (team, seed) => `
    <div class="bracket-team${team && team === game.winner ? " is-winner" : ""}">
      <span class="bracket-seed">${seed}</span>
      <span>${escapeHtml(team || "TBD")}</span>
      ${team && team === game.winner ? "<em>W</em>" : ""}
    </div>
  `;

  return `
    <article class="bracket-game" aria-label="${escapeHtml(game.round)} game ${game.game}">
      ${row(game.teamA, "A")}
      ${row(game.teamB, "B")}
    </article>
  `;
}

function renderPlayoffs() {
  const roundGroups = [
    { label: "Quarterfinals", week: 15, games: state.data.playoffs.games.filter((game) => game.round === "Quarterfinals") },
    { label: "Semifinals", week: 16, games: state.data.playoffs.games.filter((game) => game.round === "Semifinals") },
    {
      label: "Finals",
      week: 17,
      games: state.data.playoffs.games.filter((game) => ["Championship", "Third Place"].includes(game.round)),
    },
  ];

  $("#playoff-bracket").innerHTML = roundGroups
    .map(
      (round) => `
        <section class="bracket-round" aria-label="${round.label}">
          <div class="bracket-round-heading"><strong>${round.label}</strong><span>Week ${round.week}</span></div>
          ${round.games.length ? round.games.map(bracketGame).join("") : '<div class="no-results">No games listed.</div>'}
        </section>
      `,
    )
    .join("");

  $("#podium-list").innerHTML = `
    <div class="podium-list">
      ${state.data.playoffs.placements
        .map(
          (placement) => `
            <div class="podium-row">
              <span class="podium-place">${placement.place}</span>
              <div class="podium-team">
                <strong>${escapeHtml(placement.team || "TBD")}</strong>
                <small>${placement.paid ? "Prize paid" : placement.team ? "Payment pending" : "Awaiting finish"}</small>
              </div>
              <span class="podium-prize">${formatMoney(placement.prize)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPotSplit({ animate = false } = {}) {
  const root = $("#pot-split-content");
  if (!root) return;
  const { finances, playoffs, season } = state.data;
  const totalPot = finances.totalPot || 0;
  const regularPercent = totalPot ? (finances.regularSeasonPool / totalPot) * 100 : 0;
  const playoffPercent = totalPot ? (finances.playoffPrizePool / totalPot) * 100 : 0;
  const weeklyPot = season.regularSeasonWeeks
    ? finances.regularSeasonPool / season.regularSeasonWeeks
    : 0;
  const perWin = season.matchesPerWeek ? weeklyPot / season.matchesPerWeek : 0;
  const placements = [...playoffs.placements].sort((a, b) => a.place - b.place);
  const placeLabels = { 1: "1st place", 2: "2nd place", 3: "3rd place" };
  const maxPrize = Math.max(1, ...placements.map((placement) => placement.prize));

  root.innerHTML = `
    <div class="pot-overview-grid">
      <article class="panel pot-total-panel">
        <div class="pot-ring" style="--regular-angle: ${regularPercent}%">
          <div><strong>${formatMoney(totalPot)}</strong><small>Total league pot</small></div>
        </div>
        <div class="pot-legend">
          <div><span class="pot-swatch is-regular"></span><p>Regular-season wins<small>${regularPercent.toFixed(2)}% of the pot</small></p><strong>${formatMoney(finances.regularSeasonPool)}</strong></div>
          <div><span class="pot-swatch is-playoffs"></span><p>Top-three finishers<small>${playoffPercent.toFixed(2)}% of the pot</small></p><strong>${formatMoney(finances.playoffPrizePool)}</strong></div>
        </div>
      </article>

      <article class="panel podium-split-panel">
        <div class="panel-heading">
          <div><p class="panel-kicker">Playoff pool · ${formatMoney(finances.playoffPrizePool)}</p><h3>Season finish prizes</h3></div>
        </div>
        <div class="prize-bars">
          ${placements
            .map((placement, index) => {
              const playoffShare = finances.playoffPrizePool
                ? (placement.prize / finances.playoffPrizePool) * 100
                : 0;
              return `
                <div class="prize-bar-row" style="--delay: ${index * 110}ms">
                  <div><span class="place-medal is-place-${placement.place}">${placement.place}</span><strong>${placeLabels[placement.place] || `#${placement.place}`}</strong><small>${playoffShare.toFixed(1)}% of the playoff pool</small></div>
                  <div class="prize-bar-track"><span style="width: ${(placement.prize / maxPrize) * 100}%"></span></div>
                  <b>${formatMoney(placement.prize)}</b>
                </div>
              `;
            })
            .join("")}
        </div>
      </article>
    </div>

    <article class="panel weekly-waterfall">
      <div class="panel-heading">
        <div><p class="panel-kicker">Regular-season pool · ${formatMoney(finances.regularSeasonPool)}</p><h3>From the season to one matchup win</h3></div>
      </div>
      <div class="waterfall-steps">
        <div class="waterfall-step" style="--delay: 80ms">
          <span>Season</span><strong>${formatMoney(finances.regularSeasonPool)}</strong><small>Reserved for weekly wins</small>
        </div>
        <span class="waterfall-operator" aria-hidden="true">→</span>
        <div class="waterfall-step" style="--delay: 200ms">
          <span>${season.regularSeasonWeeks} weeks</span><strong>${formatMoney(weeklyPot)}</strong><small>Available each week</small>
        </div>
        <span class="waterfall-operator" aria-hidden="true">→</span>
        <div class="waterfall-step is-final" style="--delay: 320ms">
          <span>${season.matchesPerWeek} winners</span><strong>${formatPreciseMoney(perWin)}</strong><small>Exact share per win</small>
        </div>
      </div>
      <p class="rounding-note"><span aria-hidden="true">↳</span> Cash payouts alternate between <strong>$1.88</strong> and <strong>$1.87</strong> so all ${season.regularSeasonWeeks * season.matchesPerWeek} wins add up to exactly ${formatMoney(finances.regularSeasonPool)}.</p>
    </article>
  `;

  root.classList.remove("is-animated");
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-animated")));
  }
}

function renderLockerForOwner(owner) {
  const results = $("#locker-results");
  const team = state.data.summary.find((item) => item.owner === owner);

  if (!team) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }

  const allGames = state.data.schedule.filter(
    (game) => game.awayTeam === team.team || game.homeTeam === team.team,
  );
  const decided = allGames.filter((game) => game.winner || game.tied);
  const displayGames = (decided.length ? decided.slice(-4).reverse() : allGames.slice(0, 4)).map((game) => {
    const opponent = game.awayTeam === team.team ? game.homeTeam : game.awayTeam;
    const result = game.tied ? "Tie" : game.winner ? (game.winner === team.team ? "Win" : "Loss") : "Upcoming";
    const teamScore = game.awayTeam === team.team ? game.awayScore : game.homeScore;
    const opponentScore = game.awayTeam === team.team ? game.homeScore : game.awayScore;
    return { ...game, opponent, result, teamScore, opponentScore };
  });
  const paymentCopy = team.buyInPaid ? "Buy-in paid in full" : `${formatMoney(team.buyInOutstanding)} buy-in outstanding`;
  const earnings = displayEarnings(team);
  const buyInLine = state.includeBuyIn
    ? `<div class="money-line"><span>Entry fee</span><strong>−${formatMoney(team.buyInDue)}</strong></div>`
    : "";

  results.innerHTML = `
    <div class="locker-profile">
      <article class="profile-card">
        ${teamAvatar(team, "profile-avatar")}
        <h3>${escapeHtml(team.team)}</h3>
        <p>${escapeHtml(team.owner)}</p>
        <span class="profile-status">${escapeHtml(paymentCopy)}</span>
      </article>
      <div class="locker-stat-grid">
        <article class="locker-stat">
          <span>Record</span>
          <strong>${recordFor(team)}</strong>
          <small>${team.gamesPlayed} decided matchup${team.gamesPlayed === 1 ? "" : "s"}</small>
        </article>
        <article class="locker-stat">
          <span>ESPN points</span>
          <strong>${formatPoints(team.pointsFor)}</strong>
          <small>${formatPoints(team.pointsAgainst)} points against</small>
        </article>
        <article class="locker-stat">
          <span>${earningsLabel()}</span>
          <strong class="${moneyClass(earnings)}">${formatMoney(earnings)}</strong>
          <small>${state.includeBuyIn ? `Earnings less the ${formatMoney(team.buyInDue)} entry fee` : "Buy-in excluded by default"}</small>
        </article>
        <article class="locker-stat">
          <span>Winnings paid</span>
          <strong>${formatMoney(team.winningsPaid)}</strong>
          <small>Cash marked sent in Google Sheets</small>
        </article>
        <article class="locker-stat">
          <span>Still owed</span>
          <strong>${formatMoney(team.outstandingWinnings)}</strong>
          <small>Earned but not yet marked paid</small>
        </article>
        <article class="locker-stat">
          <span>Playoff seed</span>
          <strong>${team.gamesPlayed ? `#${team.playoffSeed}` : "—"}</strong>
          <small>${team.gamesPlayed ? "Current ESPN seed" : "Set once play begins"}</small>
        </article>
      </div>
    </div>
    <div class="locker-bottom-grid">
      <article class="panel locker-panel">
        <p class="panel-kicker">Your money trail</p>
        <h3>${state.includeBuyIn ? "Net earnings breakdown" : "Earnings breakdown"}</h3>
        <div class="money-breakdown">
          <div class="money-line"><span>Regular-season wins</span><strong>${formatMoney(team.regularSeasonEarnings)}</strong></div>
          <div class="money-line"><span>Playoff prize</span><strong>${formatMoney(team.playoffPrize)}</strong></div>
          ${buyInLine}
          <div class="money-line"><span>${earningsLabel()}</span><strong class="${moneyClass(earnings)}">${formatMoney(earnings)}</strong></div>
        </div>
      </article>
      <article class="panel locker-panel">
        <p class="panel-kicker">${decided.length ? "Latest results" : "First up"}</p>
        <h3>Your ESPN matchups</h3>
        <div class="personal-games">
          ${displayGames
            .map(
              (game) => `
                <div class="personal-game">
                  <span>Wk ${game.week}</span>
                  <strong>${escapeHtml(game.opponent)}</strong>
                  <em class="${game.result === "Win" ? "is-win" : ""}">${game.result}${game.result !== "Upcoming" ? ` · ${formatPoints(game.teamScore)}–${formatPoints(game.opponentScore)}` : ""}</em>
                </div>
              `,
            )
            .join("")}
        </div>
      </article>
    </div>
  `;

  results.hidden = false;
}

function renderPersonalizedViews() {
  renderQuickStrip();
  renderOverview();
  renderTeamCards($("#team-search").value);
  renderWaivers();
  renderLockerForOwner(state.activeOwner);
}

function setActiveOwner(owner, { save = true } = {}) {
  if (!state.data.summary.some((team) => team.owner === owner)) return;
  state.activeOwner = owner;
  if (save) localStorage.setItem(OWNER_STORAGE_KEY, owner);
  $("#owner-select").value = owner;
  $("#signin-owner-select").value = owner;
  $("#enter-dashboard").disabled = false;
  renderPersonalizedViews();
}

function showWelcomeGate({ switcher = false } = {}) {
  const gate = $("#welcome-gate");
  gate.hidden = false;
  document.body.classList.add("is-signing-in");
  $(".page-shell").inert = true;
  $(".page-shell").setAttribute("aria-hidden", "true");
  if (state.activeOwner) {
    $("#signin-owner-select").value = state.activeOwner;
    $("#enter-dashboard").disabled = false;
  }
  window.setTimeout(() => (switcher ? $("#signin-owner-select") : $("#welcome-title")).focus?.(), 0);
}

function closeWelcomeGate() {
  $("#welcome-gate").hidden = true;
  document.body.classList.remove("is-signing-in");
  $(".page-shell").inert = false;
  $(".page-shell").removeAttribute("aria-hidden");
  $("#main").focus({ preventScroll: true });
}

function setupOwnerExperience() {
  const owners = [...state.data.summary].sort((a, b) => a.owner.localeCompare(b.owner));
  const ownerOptions = owners
    .map((team) => `<option value="${escapeHtml(team.owner)}">${escapeHtml(team.owner)}</option>`)
    .join("");
  $("#owner-select").innerHTML = `<option value="">Choose an owner…</option>${ownerOptions}`;
  $("#signin-owner-select").innerHTML = `<option value="">Choose an owner…</option>${ownerOptions}`;

  const savedOwner = localStorage.getItem(OWNER_STORAGE_KEY);
  if (savedOwner && owners.some((team) => team.owner === savedOwner)) {
    setActiveOwner(savedOwner, { save: false });
  } else {
    showWelcomeGate();
  }
}

function setupControls() {
  document.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains("team-avatar-image")) {
        event.target.hidden = true;
        event.target.closest(".team-avatar")?.classList.add("image-failed");
      }
    },
    true,
  );
  $("#team-search").addEventListener("input", (event) => renderTeamCards(event.target.value));
  $("#week-select").addEventListener("change", (event) => renderScheduleWeek(event.target.value));
  $("#owner-select").addEventListener("change", (event) => {
    if (event.target.value) setActiveOwner(event.target.value);
  });
  $("#signin-owner-select").addEventListener("change", (event) => {
    $("#enter-dashboard").disabled = !event.target.value;
  });
  $("#enter-dashboard").addEventListener("click", () => {
    const owner = $("#signin-owner-select").value;
    if (!owner) return;
    setActiveOwner(owner);
    closeWelcomeGate();
  });
  $("#signin-owner-select").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.value) $("#enter-dashboard").click();
  });
  $("#switch-owner").addEventListener("click", () => showWelcomeGate({ switcher: true }));
  $("#include-buyin-toggle").addEventListener("change", (event) => {
    state.includeBuyIn = event.target.checked;
    $("#buyin-mode-label").textContent = state.includeBuyIn ? "Buy-in included" : "Buy-in excluded";
    renderPersonalizedViews();
    showToast(state.includeBuyIn ? "Buy-in is now included in earnings." : "Buy-in removed. Earnings start at $0.");
  });
}

function validateData(data) {
  if (!data || !Array.isArray(data.teams) || !Array.isArray(data.schedule) || !Array.isArray(data.summary)) {
    throw new Error("The league data file is incomplete.");
  }
  return data;
}

async function init() {
  setupTabs();
  setupControls();
  try {
    try {
      const live = await loadGoogleSheetData();
      state.data = validateData(live.data);
      state.sourceSignature = live.signature;
      state.usingLiveData = true;
    } catch (liveError) {
      console.warn("Live league data was unavailable; loading the backup snapshot.", liveError);
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Backup data request failed (${response.status})`);
      state.data = validateData(await response.json());
      state.usingLiveData = false;
      showToast("Live sources are temporarily unavailable. Showing the latest saved backup.");
    }

    renderSync();
    renderSchedule();
    renderPlayoffs();
    renderPotSplit({ animate: state.activeTab === "pot-split" });
    renderWaivers();
    setupOwnerExperience();
    if (!state.activeOwner) {
      renderOverview();
      renderTeamCards();
    }
    if (state.usingLiveData && !state.data.meta.espnLive) {
      showToast("ESPN is temporarily delayed. Team names use the saved ESPN roster.");
    }
    document.body.classList.remove("is-booting");
    startUpdateChecks();
  } catch (error) {
    console.error(error);
    $("#sync-label").textContent = "Data unavailable";
    $("#footer-sync").textContent = "The league tracker could not be loaded.";
    showToast("The league data did not load. Refresh the page or open the Google Sheet directly.");
    document.body.classList.remove("is-booting");
  }
}

function startUpdateChecks() {
  let checking = false;

  const checkForUpdate = async () => {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const latest = await loadGoogleSheetData();
      if (!state.usingLiveData || latest.signature !== state.sourceSignature) {
        window.location.reload();
      }
    } catch (error) {
      console.warn("The automatic data check could not complete.", error);
    } finally {
      checking = false;
    }
  };

  window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForUpdate();
  });
}

init();
