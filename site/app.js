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

function initials(value = "") {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "FF";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
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
  $("#header-owner-initials").textContent = initials(team.owner);
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
              <span class="avatar" aria-hidden="true">${initials(team.team)}</span>
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

  $("#earnings-race-heading").textContent = state.includeBuyIn ? "Net earnings race" : "Earnings race";
  const topSix = standings.slice(0, 6);
  const maxMagnitude = Math.max(1, ...topSix.map((team) => Math.abs(displayEarnings(team))));
  $("#earnings-race").innerHTML = topSix
    .map((team, index) => {
      const value = displayEarnings(team);
      const width = value === 0 ? 3 : Math.max(12, (Math.abs(value) / maxMagnitude) * 100);
      return `
        <div class="earnings-bar-row${team.owner === state.activeOwner ? " is-you" : ""}">
          <div class="earnings-bar-label">
            <span><b>${index + 1}</b> ${escapeHtml(team.abbreviation || initials(team.team))}</span>
            <strong class="${moneyClass(value)}">${formatMoney(value)}</strong>
          </div>
          <div class="earnings-bar-track">
            <span class="${value < 0 ? "is-negative" : ""}" style="width: ${width}%"></span>
          </div>
        </div>
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
                  <span class="avatar" aria-hidden="true">${escapeHtml(team.abbreviation || initials(team.team))}</span>
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

function matchupTeam(team, winner, score, showScore) {
  return `
    <div class="matchup-team${team && team === winner ? " is-winner" : ""}">
      <span class="avatar" aria-hidden="true">${initials(team)}</span>
      <span>${escapeHtml(team || "TBD")}</span>
      ${showScore ? `<b class="matchup-score">${formatPoints(score)}</b>` : ""}
    </div>
  `;
}

function renderScheduleWeek(week) {
  const games = state.data.schedule.filter((game) => game.week === Number(week));
  const decided = games.filter((game) => game.winner || game.tied).length;
  const payout = games.reduce((sum, game) => sum + game.cashPayout, 0);
  $("#week-summary").innerHTML = `
    <span><strong>Week ${week}</strong> · ${decided} of ${games.length} ESPN results final</span>
    <span>${formatMoney(payout)} earned this week</span>
  `;

  $("#matchup-grid").innerHTML = games
    .map((game) => {
      const hasScore = game.winner || game.tied || game.awayScore > 0 || game.homeScore > 0;
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
            <span>${game.winner ? `${formatMoney(game.cashPayout)} earned` : `${formatMoney(game.scheduledShare)} share`}</span>
            <span class="${game.paid ? "paid-copy" : ""}">${game.paid ? "Paid ✓" : game.winner ? "Payment due" : "ESPN live"}</span>
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

function renderLockerForOwner(owner) {
  const empty = $("#locker-empty");
  const results = $("#locker-results");
  const team = state.data.summary.find((item) => item.owner === owner);

  if (!team) {
    empty.hidden = false;
    results.hidden = true;
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
        <span class="profile-number">${escapeHtml(team.abbreviation || initials(team.owner))}</span>
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

  empty.hidden = true;
  results.hidden = false;
}

function renderPersonalizedViews() {
  renderQuickStrip();
  renderOverview();
  renderTeamCards($("#team-search").value);
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
  $("#include-buyin-toggle").closest(".buyin-toggle").hidden = true;
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
  $("#include-buyin-toggle").closest(".buyin-toggle").hidden = false;
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
