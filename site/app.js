const DATA_URL = "./data/league.json";
const UPDATE_CHECK_INTERVAL_MS = 60_000;
const OWNER_STORAGE_KEY = "fanterfootbah-owner";

const state = {
  data: null,
  activeTab: "overview",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
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
  const validTab = $(`[data-tab="${tabName}"]`) ? tabName : "overview";
  state.activeTab = validTab;

  $$("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === validTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });

  $$(".tab-panel").forEach((panel) => {
    const active = panel.id === validTab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });

  if (updateHash) history.replaceState(null, "", `#${validTab}`);
  if (focus) $(`#${validTab}`)?.focus({ preventScroll: true });
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

  $$('[data-jump-tab]').forEach((button) => {
    button.addEventListener("click", () => {
      setTab(button.dataset.jumpTab);
      $(".tab-rail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const initial = location.hash.slice(1);
  setTab(initial || "overview", { updateHash: false });
}

function renderSync() {
  const { syncedAt, syncMode } = state.data.meta;
  const syncedDate = new Date(syncedAt);
  const isValid = !Number.isNaN(syncedDate.valueOf());
  const ageMinutes = isValid ? (Date.now() - syncedDate.valueOf()) / 60_000 : 0;
  const label = isValid ? `Synced ${dateTime.format(syncedDate)}` : "Workbook snapshot loaded";
  const isStale = ageMinutes >= 20;
  $("#sync-label").textContent = isStale ? "OneDrive sync delayed" : "OneDrive synced";
  $("#sync-pill").title = `${label} · checks OneDrive every 5 minutes`;
  $("#sync-pill").classList.toggle("is-stale", isStale);
  $("#footer-sync").textContent = `${label} · automatic OneDrive pull every 5 minutes${syncMode === "snapshot" ? " · awaiting first automated pull" : ""}`;
}

function renderHero() {
  const { finances, season } = state.data;
  const collectionRate = finances.totalPot ? finances.buyInsCollected / finances.totalPot : 0;
  $("#hero-season").textContent = `${season.label} season`;
  $("#hero-pot").textContent = formatMoney(finances.totalPot);
  $("#hero-collected").textContent = formatMoney(finances.buyInsCollected);
  $("#hero-teams-paid").textContent = `${finances.teamsPaid} / ${finances.teamCount}`;
  requestAnimationFrame(() => {
    $("#hero-pot-meter").style.width = `${Math.min(100, Math.max(0, collectionRate * 100))}%`;
  });
}

function renderOverview() {
  const { finances, schedule, summary } = state.data;
  const winnersEntered = schedule.filter((game) => game.winner).length;
  const paidPayouts = schedule.filter((game) => game.paid).length;
  const totalWinnings = summary.reduce((sum, team) => sum + team.totalEarnings, 0);

  const metrics = [
    {
      icon: "$",
      value: formatMoney(finances.leagueCashBalance),
      label: "Cash currently in the league",
    },
    {
      icon: "✓",
      value: `${finances.teamsPaid} / ${finances.teamCount}`,
      label: "Teams with buy-ins marked paid",
    },
    {
      icon: "W",
      value: `${winnersEntered} / ${schedule.length}`,
      label: "Regular-season winners entered",
      warning: winnersEntered < schedule.length,
    },
    {
      icon: "↗",
      value: formatMoney(finances.winningsOutstanding),
      label: `${paidPayouts} matchup payouts sent · ${formatMoney(totalWinnings)} earned`,
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

  const leaderboard = [...summary].sort(
    (a, b) => b.totalEarnings - a.totalEarnings || b.netAfterBuyIn - a.netAfterBuyIn || a.team.localeCompare(b.team),
  );

  $("#leaderboard-body").innerHTML = leaderboard
    .slice(0, 8)
    .map(
      (team, index) => `
        <tr>
          <td><span class="rank${index < 3 ? " is-top" : ""}">${index + 1}</span></td>
          <td>
            <div class="team-cell">
              <span class="avatar" aria-hidden="true">${initials(team.team)}</span>
              <span>${escapeHtml(team.team)}<small>${escapeHtml(team.owner)}</small></span>
            </div>
          </td>
          <td>${team.regularWins}</td>
          <td>${formatMoney(team.totalEarnings)}</td>
          <td class="${moneyClass(team.netAfterBuyIn)}">${formatMoney(team.netAfterBuyIn)}</td>
        </tr>
      `,
    )
    .join("");

  const regularPercent = finances.totalPot ? (finances.regularSeasonPool / finances.totalPot) * 100 : 0;
  $("#payout-mix").innerHTML = `
    <div class="payout-ring" style="--regular-angle: ${regularPercent}%">
      <div>
        <strong>${formatMoney(finances.totalPot)}</strong>
        <small>Total pot</small>
      </div>
    </div>
    <div class="payout-legend">
      <div class="legend-row">
        <span aria-hidden="true"></span>
        <div>Regular season <small>${schedule.length} games</small></div>
        <b>${formatMoney(finances.regularSeasonPool)}</b>
      </div>
      <div class="legend-row is-playoff">
        <span aria-hidden="true"></span>
        <div>Playoff prizes <small>Top three finishers</small></div>
        <b>${formatMoney(finances.playoffPrizePool)}</b>
      </div>
    </div>
  `;
}

function renderTeamCards(query = "") {
  const term = query.trim().toLocaleLowerCase();
  const teams = state.data.summary.filter(
    (team) => !term || `${team.team} ${team.owner}`.toLocaleLowerCase().includes(term),
  );

  $("#team-grid").innerHTML = teams.length
    ? teams
        .map(
          (team) => `
            <article class="team-card">
              <div>
                <div class="team-card-top">
                  <span class="avatar" aria-hidden="true">${initials(team.team)}</span>
                  <span class="status-badge${team.buyInPaid ? "" : " is-due"}">
                    ${team.buyInPaid ? "Buy-in paid" : `${formatMoney(team.buyInOutstanding)} due`}
                  </span>
                </div>
                <h3>${escapeHtml(team.team)}</h3>
                <p class="owner-name">${escapeHtml(team.owner)}</p>
              </div>
              <div class="team-card-stats">
                <div><span>Wins</span><b>${team.regularWins}</b></div>
                <div><span>Earned</span><b>${formatMoney(team.totalEarnings)}</b></div>
                <div><span>Net</span><b class="${moneyClass(team.netAfterBuyIn)}">${formatMoney(team.netAfterBuyIn)}</b></div>
              </div>
            </article>
          `,
        )
        .join("")
    : '<div class="no-results">No team or owner matches that search.</div>';
}

function renderTeams() {
  renderTeamCards();
  $("#team-search").addEventListener("input", (event) => renderTeamCards(event.target.value));
}

function renderScheduleWeek(week) {
  const games = state.data.schedule.filter((game) => game.week === Number(week));
  const decided = games.filter((game) => game.winner).length;
  const payout = games.reduce((sum, game) => sum + game.cashPayout, 0);
  $("#week-summary").innerHTML = `
    <span><strong>Week ${week}</strong> · ${decided} of ${games.length} winners entered</span>
    <span>${formatMoney(payout)} earned this week</span>
  `;

  $("#matchup-grid").innerHTML = games
    .map(
      (game) => `
        <article class="matchup-card">
          <div class="matchup-card-header">
            <span>Game ${game.game}</span>
            <span>${game.winner ? "Final" : "Awaiting result"}</span>
          </div>
          <div class="matchup-card-body">
            ${matchupTeam(game.awayTeam, game.winner)}
            ${matchupTeam(game.homeTeam, game.winner)}
          </div>
          <div class="matchup-card-footer">
            <span>${game.winner ? `${formatMoney(game.cashPayout)} earned` : `${formatMoney(game.scheduledShare)} share`}</span>
            <span class="${game.paid ? "paid-copy" : ""}">${game.paid ? "Paid ✓" : game.winner ? "Payment due" : "—"}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function matchupTeam(team, winner) {
  return `
    <div class="matchup-team${team && team === winner ? " is-winner" : ""}">
      <span class="avatar" aria-hidden="true">${initials(team)}</span>
      <span>${escapeHtml(team || "TBD")}</span>
    </div>
  `;
}

function renderSchedule() {
  const weeks = [...new Set(state.data.schedule.map((game) => game.week))].sort((a, b) => a - b);
  const firstIncompleteWeek = weeks.find((week) =>
    state.data.schedule.some((game) => game.week === week && !game.winner),
  );
  const initialWeek = firstIncompleteWeek || weeks.at(-1) || 1;
  $("#week-select").innerHTML = weeks.map((week) => `<option value="${week}">Week ${week}</option>`).join("");
  $("#week-select").value = String(initialWeek);
  $("#week-select").addEventListener("change", (event) => renderScheduleWeek(event.target.value));
  renderScheduleWeek(initialWeek);
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
          <div class="bracket-round-heading">
            <strong>${round.label}</strong>
            <span>Week ${round.week}</span>
          </div>
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
  const decided = allGames.filter((game) => game.winner);
  const displayGames = (decided.length ? decided.slice(-4).reverse() : allGames.slice(0, 4)).map((game) => {
    const opponent = game.awayTeam === team.team ? game.homeTeam : game.awayTeam;
    const result = game.winner ? (game.winner === team.team ? "Win" : "Loss") : "Upcoming";
    return { ...game, opponent, result };
  });
  const record = `${team.regularWins}–${team.regularLosses}`;
  const paymentCopy = team.buyInPaid ? "Buy-in paid in full" : `${formatMoney(team.buyInOutstanding)} buy-in outstanding`;

  results.innerHTML = `
    <div class="locker-profile">
      <article class="profile-card">
        <span class="profile-number">${initials(team.owner)}</span>
        <h3>${escapeHtml(team.team)}</h3>
        <p>${escapeHtml(team.owner)}</p>
        <span class="profile-status">${escapeHtml(paymentCopy)}</span>
      </article>
      <div class="locker-stat-grid">
        <article class="locker-stat">
          <span>Record</span>
          <strong>${record}</strong>
          <small>${team.gamesPlayed} decided matchup${team.gamesPlayed === 1 ? "" : "s"}</small>
        </article>
        <article class="locker-stat">
          <span>Total earnings</span>
          <strong>${formatMoney(team.totalEarnings)}</strong>
          <small>${formatMoney(team.regularSeasonEarnings)} regular · ${formatMoney(team.playoffPrize)} playoffs</small>
        </article>
        <article class="locker-stat">
          <span>Net after buy-in</span>
          <strong class="${moneyClass(team.netAfterBuyIn)}">${formatMoney(team.netAfterBuyIn)}</strong>
          <small>Earnings less the ${formatMoney(team.buyInDue)} entry fee</small>
        </article>
        <article class="locker-stat">
          <span>Winnings paid</span>
          <strong>${formatMoney(team.winningsPaid)}</strong>
          <small>Cash marked as sent by the treasurer</small>
        </article>
        <article class="locker-stat">
          <span>Still owed</span>
          <strong>${formatMoney(team.outstandingWinnings)}</strong>
          <small>Earned but not yet marked paid</small>
        </article>
        <article class="locker-stat">
          <span>Final place</span>
          <strong>${team.finalPlace ? `#${team.finalPlace}` : "—"}</strong>
          <small>${team.finalPlace ? "Playoff finish entered" : "Season still in progress"}</small>
        </article>
      </div>
    </div>
    <div class="locker-bottom-grid">
      <article class="panel locker-panel">
        <p class="panel-kicker">Your money trail</p>
        <h3>Earnings breakdown</h3>
        <div class="money-breakdown">
          <div class="money-line"><span>Regular-season wins</span><strong>${formatMoney(team.regularSeasonEarnings)}</strong></div>
          <div class="money-line"><span>Playoff prize</span><strong>${formatMoney(team.playoffPrize)}</strong></div>
          <div class="money-line"><span>Entry fee</span><strong>−${formatMoney(team.buyInDue)}</strong></div>
          <div class="money-line"><span>Net position</span><strong class="${moneyClass(team.netAfterBuyIn)}">${formatMoney(team.netAfterBuyIn)}</strong></div>
        </div>
      </article>
      <article class="panel locker-panel">
        <p class="panel-kicker">${decided.length ? "Latest results" : "First up"}</p>
        <h3>Your matchups</h3>
        <div class="personal-games">
          ${displayGames
            .map(
              (game) => `
                <div class="personal-game">
                  <span>Wk ${game.week}</span>
                  <strong>${escapeHtml(game.opponent)}</strong>
                  <em class="${game.result === "Win" ? "is-win" : ""}">${game.result}</em>
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

function renderLocker() {
  const owners = [...state.data.summary].sort((a, b) => a.owner.localeCompare(b.owner));
  $("#owner-select").insertAdjacentHTML(
    "beforeend",
    owners.map((team) => `<option value="${escapeHtml(team.owner)}">${escapeHtml(team.owner)}</option>`).join(""),
  );
  const savedOwner = sessionStorage.getItem(OWNER_STORAGE_KEY);
  if (savedOwner && owners.some((team) => team.owner === savedOwner)) {
    $("#owner-select").value = savedOwner;
    renderLockerForOwner(savedOwner);
  }
  $("#owner-select").addEventListener("change", (event) => {
    sessionStorage.setItem(OWNER_STORAGE_KEY, event.target.value);
    renderLockerForOwner(event.target.value);
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
  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.data = validateData(await response.json());
    renderSync();
    renderHero();
    renderOverview();
    renderTeams();
    renderSchedule();
    renderPlayoffs();
    renderLocker();
    startUpdateChecks();
  } catch (error) {
    console.error(error);
    $("#sync-label").textContent = "Data unavailable";
    $("#footer-sync").textContent = "The workbook snapshot could not be loaded.";
    showToast("The league data did not load. Refresh the page or open the workbook directly.");
  }
}

function startUpdateChecks() {
  let checking = false;

  const checkForUpdate = async () => {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const latest = validateData(await response.json());
      if (latest.meta?.syncedAt && latest.meta.syncedAt !== state.data.meta?.syncedAt) {
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
