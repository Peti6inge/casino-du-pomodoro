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
let linkedFileHandle = null;
let fileWriteQueue = Promise.resolve();
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

function persistState({ syncFile = true } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast("La sauvegarde locale a échoué. Pense à exporter tes données.");
    console.warn(error);
  }
  if (syncFile && linkedFileHandle) queueFileWrite();
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
        <button type="button" class="ban-button" data-ban="${escapeHtml(activity.id)}"
          aria-label="Mettre ${escapeHtml(activity.name)} en réserve" title="Mettre en réserve">⌫</button>
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
              <button type="button" class="restore-button" data-restore="${escapeHtml(activity.id)}">Réactiver</button>
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
                <button type="button" class="order-button" data-${activity.banned ? "restore" : "ban"}="${escapeHtml(activity.id)}"
                  aria-label="${activity.banned ? "Réactiver" : "Mettre en réserve"}">${activity.banned ? "↺" : "⌫"}</button>
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
  if (!activity) return;
  if (state.activeSession?.activityId === id) {
    showToast("Cette activité est en cours : clôture-la avant de la mettre en réserve.");
    return;
  }
  activity.banned = true;
  if (state.activeDraw?.activityId === id) state.activeDraw = null;
  persistState();
  setMessage(`« ${activity.name} » est en réserve et ne participe plus aux tirages.`);
  renderAll();
}

function restoreActivity(id) {
  const activity = activityById(id);
  if (!activity) return;
  activity.banned = false;
  persistState();
  setMessage(`« ${activity.name} » est de retour dans le jeu.`);
  renderAll();
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

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

const CSV_COLUMNS = [
  "type", "id", "name", "category", "target", "dailyCap", "banned", "date",
  "planned", "actual", "startedAt", "endedAt", "key", "value",
];

function serializeCsv() {
  const rows = [CSV_COLUMNS];
  for (const activity of state.activities) {
    rows.push([
      "activity", activity.id, activity.name, activity.category,
      activity.targetMinutes ?? "", activity.dailyCap ?? "", activity.banned ? "1" : "0",
      "", "", "", "", "", "", "",
    ]);
  }
  for (const [key, value] of Object.entries(state.settings)) {
    rows.push(["setting", "", "", "", "", "", "", "", "", "", "", "", key, value]);
  }
  for (const session of state.sessions) {
    rows.push([
      "session", session.id, session.activityName, session.category, "", "", "",
      session.date, session.plannedMinutes, session.actualMinutes,
      session.startedAt, session.endedAt, session.activityId, "",
    ]);
  }
  rows.push(["meta", "", "", "", "", "", "", currentDay, "", "", "", "", "version", STATE_VERSION]);
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`;
}

function parseCsv(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) throw new Error("Le fichier est vide.");
  const header = splitCsvLine(lines[0]);
  if (header.join(",").toLowerCase() === "type,name,num1,num2,text") {
    return parseLegacyCsv(lines);
  }
  const indexes = Object.fromEntries(header.map((column, index) => [column, index]));
  if (indexes.type == null || indexes.id == null) throw new Error("Format CSV non reconnu.");
  const imported = defaultState();
  imported.activities = [];
  imported.sessions = [];

  const value = (columns, key) => columns[indexes[key]] ?? "";
  for (const line of lines.slice(1)) {
    const columns = splitCsvLine(line);
    const type = value(columns, "type");
    if (type === "activity") {
      const category =
        value(columns, "category") === Logic.CATEGORY_OPTIONAL
          ? Logic.CATEGORY_OPTIONAL
          : Logic.CATEGORY_REQUIRED;
      imported.activities.push({
        id: value(columns, "id") || makeId(value(columns, "name")),
        name: value(columns, "name") || "Activité",
        category,
        targetMinutes:
          category === Logic.CATEGORY_REQUIRED
            ? Math.max(1, Number(value(columns, "target")) || 1)
            : null,
        dailyCap:
          category === Logic.CATEGORY_OPTIONAL && value(columns, "dailyCap") !== ""
            ? Math.max(1, Number(value(columns, "dailyCap")) || 1)
            : null,
        banned: value(columns, "banned") === "1",
      });
    } else if (type === "setting") {
      const key = value(columns, "key");
      const raw = value(columns, "value");
      if (key in imported.settings) {
        imported.settings[key] = key.includes("Session") ? Number(raw) : raw;
      }
    } else if (type === "session") {
      imported.sessions.push({
        id: value(columns, "id") || makeId("session"),
        date: value(columns, "date"),
        activityId: value(columns, "key"),
        activityName: value(columns, "name"),
        category: value(columns, "category"),
        plannedMinutes: Number(value(columns, "planned")) || 0,
        actualMinutes: Number(value(columns, "actual")) || 0,
        startedAt: value(columns, "startedAt"),
        endedAt: value(columns, "endedAt"),
      });
    }
  }
  if (!imported.activities.length) throw new Error("Le CSV ne contient aucune activité.");
  return normalizeState(imported);
}

function parseLegacyCsv(lines) {
  const imported = defaultState();
  imported.activities = [];
  imported.sessions = [];
  const legacyProgress = new Map();
  const idsByName = new Map();
  let fileDate = currentDay;

  for (const line of lines.slice(1)) {
    const columns = splitCsvLine(line);
    const [type, name, num1, num2, text] = columns;
    if (type === "activity") {
      const id = makeId(name);
      idsByName.set(name, id);
      imported.activities.push({
        id,
        name,
        category: Logic.CATEGORY_REQUIRED,
        targetMinutes: Math.max(1, Number(num1) || 1),
        dailyCap: null,
        banned: false,
      });
      legacyProgress.set(id, Number(num2) || 0);
    } else if (type === "setting") {
      if (name === "min_session") imported.settings.minSession = Number(num1) || 15;
      if (name === "max_session") imported.settings.maxSession = Number(num1) || 40;
      if (name === "lunch_start") imported.settings.pauseStart = text || "12:30";
      if (name === "lunch_end") imported.settings.pauseEnd = text || "13:30";
      if (name === "day_end") imported.settings.dayEnd = text || "17:00";
    } else if (type === "meta" && name === "date") {
      fileDate = text || currentDay;
    } else if (type === "session") {
      const [date, startedAt, endedAt] = String(text || "").split("|");
      imported.sessions.push({
        id: makeId("session"),
        date: date || fileDate,
        activityId: idsByName.get(name) || "",
        activityName: name,
        category: Logic.CATEGORY_REQUIRED,
        plannedMinutes: Number(num1) || 0,
        actualMinutes: Number(num1) || 0,
        startedAt: startedAt || `${fileDate}T00:00:00`,
        endedAt: endedAt || `${fileDate}T00:00:00`,
      });
    }
  }
  for (const activity of imported.activities) {
    const logged = Logic.actualMinutesDone(activity, imported.sessions, fileDate);
    const missing = Math.max(0, (legacyProgress.get(activity.id) || 0) - logged);
    if (missing > 0 && fileDate === currentDay) {
      imported.sessions.push({
        id: makeId("migration"),
        date: fileDate,
        activityId: activity.id,
        activityName: activity.name,
        category: activity.category,
        plannedMinutes: missing,
        actualMinutes: missing,
        startedAt: `${fileDate}T00:00:00`,
        endedAt: `${fileDate}T00:00:00`,
      });
    }
  }
  if (!imported.activities.length) throw new Error("Le CSV ne contient aucune activité.");
  return normalizeState(imported);
}

function downloadCsv() {
  const blob = new Blob([serializeCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `casino-du-pomodoro-${currentDay}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  $("fileStatus").textContent = "Export téléchargé. La sauvegarde locale reste active.";
}

function queueFileWrite() {
  if (!linkedFileHandle) return;
  fileWriteQueue = fileWriteQueue
    .then(async () => {
      const writable = await linkedFileHandle.createWritable();
      await writable.write(serializeCsv());
      await writable.close();
      $("fileStatus").textContent = `Synchronisé avec ${linkedFileHandle.name}.`;
    })
    .catch((error) => {
      console.warn("Synchronisation CSV impossible.", error);
      $("fileStatus").textContent =
        "Sauvegarde locale active, mais la synchronisation CSV a échoué.";
    });
}

async function linkCsvFile() {
  if (!window.showOpenFilePicker) {
    showToast("Liaison directe indisponible : importe ou exporte le CSV.");
    $("fileImport").click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Données Casino du Pomodoro", accept: { "text/csv": [".csv"] } }],
      multiple: false,
    });
    const file = await handle.getFile();
    if (file.size > 0) {
      state = parseCsv(await file.text());
      persistState({ syncFile: false });
    }
    linkedFileHandle = handle;
    $("btnSaveFile").disabled = false;
    queueFileWrite();
    writeSettingsForm();
    setMessage("CSV importé et lié. La sauvegarde locale reste la source principale.");
    renderAll();
  } catch (error) {
    if (error.name !== "AbortError") {
      showToast(`Impossible de lier ce fichier : ${error.message}`);
    }
  }
}

async function importCsvFile(file) {
  try {
    state = parseCsv(await file.text());
    persistState();
    writeSettingsForm();
    setMessage(`Données importées depuis « ${file.name} ».`);
    $("fileStatus").textContent = `Import réussi : ${file.name}.`;
    renderAll();
  } catch (error) {
    showToast(`Import impossible : ${error.message}`);
  }
}

function initEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("btnDraw").addEventListener("click", requestDraw);
  $("btnStart").addEventListener("click", startSession);
  $("btnValidate").addEventListener("click", finishSession);
  $("btnNotifications").addEventListener("click", () => requestNotificationPermission(true));
  $("btnLinkFile").addEventListener("click", linkCsvFile);
  $("btnSaveFile").addEventListener("click", queueFileWrite);
  $("btnExport").addEventListener("click", downloadCsv);
  $("fileImport").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importCsvFile(file);
    event.target.value = "";
  });

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
    if (button.dataset.ban) banActivity(button.dataset.ban);
    if (button.dataset.restore) restoreActivity(button.dataset.restore);
    if (button.dataset.moveUp) moveActivity(button.dataset.moveUp, -1);
    if (button.dataset.moveDown) moveActivity(button.dataset.moveDown, 1);
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
