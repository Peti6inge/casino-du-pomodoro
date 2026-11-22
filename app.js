"use strict";

const Logic = window.CasinoLogic;
const STORAGE_KEY = "casino-du-pomodoro:v2";
const STATE_VERSION = 2;
const DEFAULT_SETTINGS = {
  minSession: 15,
  maxSession: 40,
  pauseStart: "12:30",
  pauseEnd: "13:30",
  dayEnd: "17:00",
};

const DEFAULT_ACTIVITIES = [
  {
    id: "focus-profond",
    name: "Focus profond",
    category: Logic.CATEGORY_REQUIRED,
    targetMinutes: 60,
    dailyCap: null,
    banned: false,
  },
  {
    id: "mission-principale",
    name: "Mission principale",
    category: Logic.CATEGORY_REQUIRED,
    targetMinutes: 45,
    dailyCap: null,
    banned: false,
  },
  {
    id: "lecture",
    name: "Lecture",
    category: Logic.CATEGORY_OPTIONAL,
    targetMinutes: null,
    dailyCap: 45,
    banned: false,
  },
  {
    id: "pause-creative",
    name: "Pause créative",
    category: Logic.CATEGORY_OPTIONAL,
    targetMinutes: null,
    dailyCap: null,
    banned: false,
  },
];

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));

let state = loadState();
let currentDay = "";
let uiMessage = "";

function makeId(name = "activité") {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 35);
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${slug || "activite"}-${suffix}`;
}

function defaultState() {
  return {
    version: STATE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    activities: clone(DEFAULT_ACTIVITIES),
    sessions: [],
    activeDraw: null,
    activeSession: null,
    lastOptionalActivityId: null,
  };
}

function normalizeState(candidate) {
  const fallback = defaultState();
  if (!candidate || typeof candidate !== "object") return fallback;
  return {
    version: STATE_VERSION,
    settings: { ...DEFAULT_SETTINGS, ...(candidate.settings || {}) },
    activities: Array.isArray(candidate.activities)
      ? candidate.activities.map((activity) => ({
          id: activity.id || makeId(activity.name),
          name: String(activity.name || "Activité"),
          category:
            activity.category === Logic.CATEGORY_OPTIONAL
              ? Logic.CATEGORY_OPTIONAL
              : Logic.CATEGORY_REQUIRED,
          targetMinutes:
            activity.category === Logic.CATEGORY_OPTIONAL
              ? null
              : Math.max(1, Number(activity.targetMinutes) || 1),
          dailyCap:
            activity.category === Logic.CATEGORY_OPTIONAL && activity.dailyCap != null
              ? Math.max(1, Number(activity.dailyCap) || 1)
              : null,
          banned: Boolean(activity.banned),
        }))
      : fallback.activities,
    sessions: Array.isArray(candidate.sessions)
      ? candidate.sessions.filter((session) => session && session.date)
      : [],
    activeDraw: candidate.activeDraw || null,
    activeSession: candidate.activeSession || null,
    lastOptionalActivityId: candidate.lastOptionalActivityId || null,
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : defaultState();
  } catch (error) {
    console.warn("Impossible de lire la sauvegarde locale.", error);
    return defaultState();
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast("Impossible d’enregistrer localement. Vérifie l’espace de stockage du navigateur.");
    console.warn(error);
  }
}

function ensureCurrentDay(now = new Date()) {
  const key = Logic.dateKey(now);
  if (key === currentDay) return false;
  currentDay = key;
  if (
    state.activeSession &&
    Logic.dateKey(new Date(state.activeSession.startedAt)) !== currentDay
  ) {
    state.activeSession = null;
  }
  if (
    state.activeDraw &&
    Logic.dateKey(new Date(state.activeDraw.drawnAt)) !== currentDay
  ) {
    state.activeDraw = null;
  }
  state.lastOptionalActivityId = null;
  persistState();
  uiMessage = "Nouvelle journée, nouveaux tirages : les compteurs repartent de zéro.";
  return true;
}

function activityById(id) {
  return state.activities.find((activity) => activity.id === id) || null;
}

function formatFriendly(minutes) {
  const rounded = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${String(rest).padStart(2, "0")} min`;
}

function formatTimer(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function activityToggleMarkup(activity) {
  const enabled = !activity.banned;
  return `
    <label class="toggle-switch">
      <input type="checkbox" data-toggle-activity="${escapeHtml(activity.id)}" ${enabled ? "checked" : ""}
        aria-label="${enabled ? "Mettre en réserve" : "Réactiver"} ${escapeHtml(activity.name)}" />
      <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
    </label>`;
}

function deleteButtonMarkup(id, name) {
  return `
    <button type="button" class="delete-button" data-delete="${escapeHtml(id)}"
      aria-label="Supprimer ${escapeHtml(name)} définitivement" title="Supprimer définitivement">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
      </svg>
    </button>`;
}

function setMessage(message) {
  uiMessage = message;
  $("dayMessage").textContent = message;
}

function renderAll() {
  ensureCurrentDay();
  renderDayStatus();
  renderDraw();
  renderActivities();
  renderHistory();
  renderActivityManager();
  renderNotificationStatus();
}

function renderDayStatus(now = new Date()) {
  const available = Logic.availableMinutes(state.settings, now);
  const paused = Logic.isPauseTime(state.settings, now);
  const ended = available <= 0 && !paused;
  $("dayCountdown").textContent = formatFriendly(available);
  $("dayStateDot").className = `status-dot${paused ? " is-paused" : ended ? " is-ended" : ""}`;
  $("dayState").textContent = paused
    ? `Pause jusqu’à ${state.settings.pauseEnd}`
    : ended
      ? "Journée terminée"
      : `Fin prévue à ${state.settings.dayEnd}`;
}

function currentDraw() {
  if (state.activeSession) return state.activeSession;
  return state.activeDraw;
}

function renderDraw() {
  const draw = currentDraw();
  const activity = draw ? activityById(draw.activityId) : null;
  const running = Boolean(state.activeSession);

  $("drawResult").hidden = !activity;
  $("timerStage").hidden = !running;
  $("btnDraw").disabled = running;
  $("btnStart").disabled = !state.activeDraw || running;
  $("btnValidate").disabled = !running;
  $("btnDraw").hidden = Boolean(state.activeDraw) || running;
  $("btnStart").hidden = !state.activeDraw || running;
  $("btnValidate").hidden = !running;

  if (activity) {
    const optional = activity.category === Logic.CATEGORY_OPTIONAL;
    $("drawnName").textContent = activity.name;
    $("drawCategory").textContent = optional ? "Bonus facultatif" : "Mission obligatoire";
    $("plannedDuration").textContent = formatFriendly(draw.plannedMinutes);
    $("drawIcon").textContent = optional ? "◆" : "✦";
    $("drawIcon").classList.toggle("optional", optional);
    $("urgentBadge").hidden = !draw.urgent;
  }

  if (!uiMessage) {
    uiMessage = running
      ? "Ta session est lancée. Tu décides du moment exact où elle se termine."
      : activity
        ? "Le sort a parlé. Démarre quand tu es prêt."
        : "Lance la roue pour découvrir ta prochaine mission.";
  }
  $("dayMessage").textContent = uiMessage;
}

function activityCard(activity) {
  const optional = activity.category === Logic.CATEGORY_OPTIONAL;
  const actual = Logic.actualMinutesDone(activity, state.sessions, currentDay);
  const progress = Logic.progressMinutes(activity, state.sessions, currentDay);
  const target = optional ? activity.dailyCap : activity.targetMinutes;
  const percentage = target ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const primary = optional
    ? `${formatFriendly(actual)} consacrées`
    : `${formatFriendly(progress)} sur ${formatFriendly(activity.targetMinutes)}`;
  const secondary = optional
    ? activity.dailyCap
      ? `${formatFriendly(Math.max(0, activity.dailyCap - actual))} disponibles`
      : "Sans plafond quotidien"
    : `${percentage} % complété`;

  return `
    <article class="activity-card ${optional ? "optional" : ""}">
      <div class="activity-card-top">
        <h3>${escapeHtml(activity.name)}</h3>
        ${activityToggleMarkup(activity)}
      </div>
      ${target ? `<div class="progress-track" aria-label="${percentage} %"><div class="progress-fill" style="--progress:${percentage}%"></div></div>` : ""}
      <div class="activity-stats">
        <span>${primary}</span>
        <span>${secondary}</span>
      </div>
    </article>
  `;
}

function renderActivities() {
  const active = state.activities.filter((activity) => !activity.banned);
  const required = active.filter(
    (activity) => activity.category === Logic.CATEGORY_REQUIRED
  );
  const optional = active.filter(
    (activity) => activity.category === Logic.CATEGORY_OPTIONAL
  );
  const banned = state.activities.filter((activity) => activity.banned);

  $("requiredList").innerHTML = required.length
    ? required.map(activityCard).join("")
    : '<div class="empty-state">Aucune mission obligatoire active.</div>';
  $("optionalList").innerHTML = optional.length
    ? optional.map(activityCard).join("")
    : '<div class="empty-state">Aucune activité facultative active.</div>';

  const requiredTarget = required.reduce(
    (sum, activity) => sum + Number(activity.targetMinutes),
    0
  );
  const requiredDone = required.reduce(
    (sum, activity) => sum + Logic.progressMinutes(activity, state.sessions, currentDay),
    0
  );
  const optionalDone = optional.reduce(
    (sum, activity) => sum + Logic.actualMinutesDone(activity, state.sessions, currentDay),
    0
  );
  $("requiredSummary").textContent = requiredTarget
    ? `${formatFriendly(requiredDone)} / ${formatFriendly(requiredTarget)}`
    : "Libre";
  $("optionalSummary").textContent = `${formatFriendly(optionalDone)} jouées`;
  $("bannedCount").textContent = banned.length;
  $("bannedList").innerHTML = banned.length
    ? banned
        .map(
          (activity) => `
            <span class="banned-item">${escapeHtml(activity.name)}
              ${activityToggleMarkup(activity)}
              ${deleteButtonMarkup(activity.id, activity.name)}
            </span>`
        )
        .join("")
    : '<span class="empty-state">La réserve est vide.</span>';
}

function renderHistory() {
  const sessions = state.sessions
    .filter((session) => session.date === currentDay)
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
  const total = sessions.reduce(
    (sum, session) => sum + (Number(session.actualMinutes) || 0),
    0
  );
  $("historyTotal").textContent = formatFriendly(total);
  $("sessionLog").innerHTML = sessions.length
    ? sessions
        .map((session) => {
          const time = new Date(session.startedAt).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return `
            <li class="session-row">
              <time>${time}</time>
              <span><strong>${escapeHtml(session.activityName)}</strong>
                <small>Prévu ${formatFriendly(session.plannedMinutes)}</small></span>
              <span class="session-duration">${formatFriendly(session.actualMinutes)}</span>
            </li>`;
        })
        .join("")
    : '<li class="empty-state">Aucune partie aujourd’hui. La roue t’attend.</li>';
}

function renderActivityManager() {
  $("activityManager").innerHTML = state.activities.length
    ? state.activities
        .map((activity, index) => {
          const optional = activity.category === Logic.CATEGORY_OPTIONAL;
          const duration = optional
            ? activity.dailyCap
              ? `Plafond ${formatFriendly(activity.dailyCap)}`
              : "Sans plafond"
            : `Objectif ${formatFriendly(activity.targetMinutes)}`;
          return `
            <div class="manager-row">
              <div class="manager-name">
                <strong>${escapeHtml(activity.name)}${activity.banned ? " · en réserve" : ""}</strong>
                <small>${duration}</small>
              </div>
              <span class="type-badge ${optional ? "optional" : ""}">${optional ? "Facultative" : "Obligatoire"}</span>
              <div class="manager-actions">
                <button type="button" class="order-button" data-move-up="${escapeHtml(activity.id)}"
                  aria-label="Monter" ${index === 0 ? "disabled" : ""}>↑</button>
                <button type="button" class="order-button" data-move-down="${escapeHtml(activity.id)}"
                  aria-label="Descendre" ${index === state.activities.length - 1 ? "disabled" : ""}>↓</button>
                ${activityToggleMarkup(activity)}
                ${deleteButtonMarkup(activity.id, activity.name)}
              </div>
            </div>`;
        })
        .join("")
    : '<div class="empty-state">Ajoute ta première activité.</div>';
}

function requestDraw() {
  ensureCurrentDay();
  if (state.activeSession) {
    showToast("Clôture d’abord la session en cours.");
    return;
  }
  const result = Logic.drawActivity({
    activities: state.activities,
    sessions: state.sessions,
    settings: state.settings,
    lastOptionalActivityId: state.lastOptionalActivityId,
    now: new Date(),
  });
  if (!result.ok) {
    const messages = {
      pause: `La roue se repose jusqu’à ${state.settings.pauseEnd}.`,
      "day-ended": "La journée est terminée. Reviens demain pour une nouvelle partie.",
      "nothing-eligible": "Toutes les activités actives sont complétées ou plafonnées.",
      "no-valid-duration": "Aucune durée de session valide n’est disponible.",
    };
    state.activeDraw = null;
    persistState();
    setMessage(messages[result.reason] || "Aucun tirage possible pour le moment.");
    renderAll();
    return;
  }

  state.activeDraw = {
    activityId: result.activity.id,
    category: result.category,
    plannedMinutes: result.plannedMinutes,
    urgent: result.urgent,
    drawnAt: new Date().toISOString(),
  };
  persistState();
  setMessage(
    result.urgent
      ? "Mode urgence : la première mission obligatoire passe devant tout le reste."
      : result.category === Logic.CATEGORY_REQUIRED
        ? "Une mission obligatoire a remporté le tirage pondéré."
        : "Le hasard t’offre un bonus facultatif."
  );
  renderAll();
}

function startSession() {
  if (!state.activeDraw || state.activeSession) return;
  const now = new Date();
  if (Logic.isPauseTime(state.settings, now) || Logic.availableMinutes(state.settings, now) <= 0) {
    requestDraw();
    return;
  }
  state.activeSession = {
    ...state.activeDraw,
    startedAt: now.toISOString(),
    warningSent: false,
    endSent: false,
  };
  state.activeDraw = null;
  persistState();
  requestNotificationPermission(false);
  setMessage("C’est parti ! La durée réelle sera enregistrée quand tu clôtureras.");
  renderAll();
  tick();
}

function finishSession() {
  const active = state.activeSession;
  if (!active) return;
  const activity = activityById(active.activityId);
  if (!activity) {
    state.activeSession = null;
    persistState();
    renderAll();
    return;
  }
  const endedAt = new Date();
  const elapsed = endedAt.getTime() - new Date(active.startedAt).getTime();
  const actualMinutes = Math.max(1, Math.round(elapsed / 60000));
  state.sessions.push({
    id: makeId("session"),
    date: Logic.dateKey(new Date(active.startedAt)),
    activityId: activity.id,
    activityName: activity.name,
    category: activity.category,
    plannedMinutes: active.plannedMinutes,
    actualMinutes,
    startedAt: active.startedAt,
    endedAt: endedAt.toISOString(),
  });
  if (activity.category === Logic.CATEGORY_OPTIONAL) {
    state.lastOptionalActivityId = activity.id;
  }
  state.activeSession = null;
  persistState();
  setMessage(
    `${formatFriendly(actualMinutes)} enregistrées sur « ${activity.name} »` +
      (actualMinutes > active.plannedMinutes ? " — beau dépassement !" : ".")
  );
  celebrate();
  renderAll();
}

function tick() {
  const changedDay = ensureCurrentDay();
  renderDayStatus();
  if (!state.activeSession) {
    if (changedDay) renderAll();
    return;
  }

  const elapsed = Math.max(
    0,
    Date.now() - new Date(state.activeSession.startedAt).getTime()
  );
  const target = state.activeSession.plannedMinutes * 60000;
  const warningAt = Math.max(0, target - 60000);
  $("timerDisplay").textContent = formatTimer(elapsed);
  $("timerTarget").textContent = `sur ${formatFriendly(state.activeSession.plannedMinutes)}`;
  $("timerMessage").textContent =
    "Le chrono continue tant que tu ne clôtures pas la session.";
  $("timerRing").style.setProperty(
    "--timer-progress",
    `${Math.min(100, (elapsed / target) * 100)}%`
  );

  if (!state.activeSession.warningSent && elapsed >= warningAt && elapsed < target) {
    state.activeSession.warningSent = true;
    persistState();
    notifyUser("Plus qu’une minute", "Ta mission touche bientôt à sa fin.");
  }
  if (!state.activeSession.endSent && elapsed >= target) {
    state.activeSession.endSent = true;
    persistState();
    notifyUser("Temps prévu écoulé", "Tu peux clôturer maintenant, ou continuer à ton rythme.");
    $("timerMessage").textContent =
      "Temps prévu dépassé : le chrono continue jusqu’à ta clôture.";
  }
}

function banActivity(id) {
  const activity = activityById(id);
  if (!activity) return false;
  if (state.activeSession?.activityId === id) {
    showToast("Cette activité est en cours : clôture-la avant de la mettre en réserve.");
    return false;
  }
  activity.banned = true;
  if (state.activeDraw?.activityId === id) state.activeDraw = null;
  persistState();
  setMessage(`« ${activity.name} » est en réserve et ne participe plus aux tirages.`);
  renderAll();
  return true;
}

function restoreActivity(id) {
  const activity = activityById(id);
  if (!activity) return false;
  activity.banned = false;
  persistState();
  setMessage(`« ${activity.name} » est de retour dans le jeu.`);
  renderAll();
  return true;
}

function deleteActivity(id) {
  const activity = activityById(id);
  if (!activity) return false;
  if (state.activeSession?.activityId === id) {
    showToast("Cette activité est en cours : clôture-la avant de la supprimer.");
    return false;
  }
  if (state.activeDraw?.activityId === id) state.activeDraw = null;
  if (state.lastOptionalActivityId === id) state.lastOptionalActivityId = null;
  state.activities = state.activities.filter((item) => item.id !== id);
  persistState();
  setMessage(`« ${activity.name} » a été supprimée définitivement.`);
  renderAll();
  return true;
}

function moveActivity(id, direction) {
  const index = state.activities.findIndex((activity) => activity.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.activities.length) return;
  [state.activities[index], state.activities[target]] = [
    state.activities[target],
    state.activities[index],
  ];
  persistState();
  renderAll();
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  $("toastRegion").appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function notifyUser(title, body) {
  showToast(`${title} — ${body}`);
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: `casino-${title}` });
    } catch (error) {
      console.warn("Notification indisponible.", error);
    }
  }
}

async function requestNotificationPermission(showFeedback = true) {
  if (!("Notification" in window)) {
    if (showFeedback) showToast("Ce navigateur ne prend pas en charge les notifications.");
    return;
  }
  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (showFeedback) {
      showToast(
        permission === "granted"
          ? "Notifications activées."
          : "Notifications refusées : les alertes resteront visibles dans l’application."
      );
    }
  } else if (showFeedback) {
    showToast(
      Notification.permission === "granted"
        ? "Les notifications sont déjà actives."
        : "Les notifications sont bloquées dans les réglages du navigateur."
    );
  }
  renderNotificationStatus();
}

function renderNotificationStatus() {
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";
  const labels = {
    granted: "Notifications actives : alerte une minute avant et à l’échéance.",
    denied: "Notifications bloquées : les alertes internes restent actives.",
    default: "Active-les pour être prévenu une minute avant la fin.",
    unsupported: "Notifications système indisponibles : les alertes internes restent actives.",
  };
  $("notificationStatus").textContent = labels[permission];
  $("btnNotifications").disabled = permission === "granted" || permission === "unsupported";
}

function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#ffc84a", "#ff6577", "#2bcfa6", "#7448ed", "#4baaf7"];
  for (let index = 0; index < 42; index += 1) {
    const piece = document.createElement("i");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.setProperty("--piece-color", colors[index % colors.length]);
    piece.style.setProperty("--drift", `${Math.random() * 180 - 90}px`);
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    $("confetti").appendChild(piece);
    window.setTimeout(() => piece.remove(), 2400);
  }
}

function writeSettingsForm() {
  $("minSession").value = state.settings.minSession;
  $("maxSession").value = state.settings.maxSession;
  $("pauseStart").value = state.settings.pauseStart;
  $("pauseEnd").value = state.settings.pauseEnd;
  $("dayEnd").value = state.settings.dayEnd;
  $("maxSession").min = state.settings.minSession * 2;
}

function updateActivityDurationField() {
  const optional = $("newActivityCategory").value === Logic.CATEGORY_OPTIONAL;
  $("activityDurationLabel").firstChild.textContent = optional
    ? "Plafond quotidien "
    : "Objectif quotidien ";
  $("newActivityDuration").required = !optional;
  $("newActivityDuration").placeholder = optional ? "Optionnel" : "";
  $("activityDurationHint").textContent = optional
    ? "Laisse vide pour une activité sans plafond."
    : "Durée à atteindre exactement chaque jour.";
}

function switchView(name) {
  const settings = name === "settings";
  $("gameView").hidden = settings;
  $("settingsView").hidden = !settings;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (settings) writeSettingsForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("btnDraw").addEventListener("click", requestDraw);
  $("btnStart").addEventListener("click", startSession);
  $("btnValidate").addEventListener("click", finishSession);
  $("btnNotifications").addEventListener("click", () => requestNotificationPermission(true));

  $("scheduleForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const candidate = {
      minSession: Number($("minSession").value),
      maxSession: Number($("maxSession").value),
      pauseStart: $("pauseStart").value,
      pauseEnd: $("pauseEnd").value,
      dayEnd: $("dayEnd").value,
    };
    const errors = Logic.validateSettings(candidate);
    $("settingsError").textContent = errors.join(" ");
    if (errors.length) return;
    state.settings = candidate;
    persistState();
    writeSettingsForm();
    showToast("Règles de la journée enregistrées.");
    renderAll();
  });

  $("minSession").addEventListener("input", () => {
    $("maxSession").min = Math.max(2, Number($("minSession").value) * 2);
  });
  $("newActivityCategory").addEventListener("change", updateActivityDurationField);
  $("activityForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("newActivityName").value.trim();
    const category = $("newActivityCategory").value;
    const rawDuration = $("newActivityDuration").value;
    const duration = rawDuration === "" ? null : Math.max(1, Number(rawDuration) || 1);
    if (!name || (category === Logic.CATEGORY_REQUIRED && !duration)) return;
    state.activities.push({
      id: makeId(name),
      name,
      category,
      targetMinutes: category === Logic.CATEGORY_REQUIRED ? duration : null,
      dailyCap: category === Logic.CATEGORY_OPTIONAL ? duration : null,
      banned: false,
    });
    event.target.reset();
    updateActivityDurationField();
    persistState();
    showToast(`« ${name} » rejoint le jeu.`);
    renderAll();
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.moveUp) moveActivity(button.dataset.moveUp, -1);
    if (button.dataset.moveDown) moveActivity(button.dataset.moveDown, 1);
    if (button.dataset.delete) {
      const activity = activityById(button.dataset.delete);
      if (
        activity &&
        confirm(`Supprimer définitivement « ${activity.name} » ? Cette action est irréversible.`)
      ) {
        deleteActivity(button.dataset.delete);
      }
    }
  });
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.toggleActivity) return;
    const id = input.dataset.toggleActivity;
    const ok = input.checked ? restoreActivity(id) : banActivity(id);
    if (!ok) input.checked = !input.checked;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      tick();
      renderAll();
    }
  });
}

function init() {
  ensureCurrentDay();
  writeSettingsForm();
  updateActivityDurationField();
  initEvents();
  renderAll();
  tick();
  window.setInterval(tick, 1000);
}

init();
