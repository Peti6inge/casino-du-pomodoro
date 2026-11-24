"use strict";

const Logic = window.CasinoLogic;
const STORAGE_KEY = "casino-du-pomodoro:v2";
const STATE_VERSION = 3;
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
let wheelSpinning = false;
let linkedFileHandle = null;
let fileWriteQueue = Promise.resolve();

const Wheel = window.CasinoWheel;

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

function normalizeSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function normalizeActivities(activities, fallback = DEFAULT_ACTIVITIES) {
  if (!Array.isArray(activities)) return clone(fallback);
  return activities.map((activity) => ({
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
    emoji: normalizeEmoji(activity.emoji),
  }));
}

function createProfile({
  name = "Jeu 1",
  settings = DEFAULT_SETTINGS,
  activities = DEFAULT_ACTIVITIES,
  id = makeId("jeu"),
} = {}) {
  return {
    id,
    name: String(name || "Jeu").trim() || "Jeu",
    settings: normalizeSettings(settings),
    activities: normalizeActivities(activities),
  };
}

function defaultState() {
  const profile = createProfile({ name: "Jeu 1" });
  return {
    version: STATE_VERSION,
    profiles: [profile],
    activeProfileId: profile.id,
    settings: profile.settings,
    activities: profile.activities,
    sessions: [],
    activeDraw: null,
    activeSession: null,
    lastOptionalActivityId: null,
  };
}

function normalizeState(candidate) {
  const fallback = defaultState();
  if (!candidate || typeof candidate !== "object") return fallback;

  let profiles;
  if (Array.isArray(candidate.profiles) && candidate.profiles.length) {
    profiles = candidate.profiles.map((profile, index) =>
      createProfile({
        id: profile.id || makeId(`jeu-${index + 1}`),
        name: profile.name || `Jeu ${index + 1}`,
        settings: profile.settings,
        activities: profile.activities,
      })
    );
  } else {
    profiles = [
      createProfile({
        name: "Jeu 1",
        settings: candidate.settings,
        activities: candidate.activities,
      }),
    ];
  }

  const activeProfileId =
    profiles.some((profile) => profile.id === candidate.activeProfileId)
      ? candidate.activeProfileId
      : profiles[0].id;
  const active = profiles.find((profile) => profile.id === activeProfileId) || profiles[0];

  return {
    version: STATE_VERSION,
    profiles,
    activeProfileId: active.id,
    settings: active.settings,
    activities: active.activities,
    sessions: Array.isArray(candidate.sessions)
      ? candidate.sessions.filter((session) => session && session.date)
      : [],
    activeDraw: candidate.activeDraw || null,
    activeSession: candidate.activeSession || null,
    lastOptionalActivityId: candidate.lastOptionalActivityId || null,
  };
}

function getActiveProfile() {
  return (
    state.profiles.find((profile) => profile.id === state.activeProfileId) ||
    state.profiles[0]
  );
}

function bindActiveProfile() {
  const profile = getActiveProfile();
  state.activeProfileId = profile.id;
  state.settings = profile.settings;
  state.activities = profile.activities;
}

function flushActiveProfile() {
  const profile = getActiveProfile();
  profile.settings = state.settings;
  profile.activities = state.activities;
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
  flushActiveProfile();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast("Impossible d’enregistrer localement. Vérifie l’espace de stockage du navigateur.");
    console.warn(error);
  }
  if (syncFile && linkedFileHandle) queueFileWrite();
}

function switchProfile(id) {
  if (id === state.activeProfileId) return;
  const profile = state.profiles.find((entry) => entry.id === id);
  if (!profile) return;
  flushActiveProfile();
  state.activeProfileId = profile.id;
  bindActiveProfile();
  state.activeDraw = null;
  state.activeSession = null;
  state.lastOptionalActivityId = null;
  persistState();
  writeSettingsForm();
  renderAll();
}

function addProfile() {
  flushActiveProfile();
  const index = state.profiles.length + 1;
  const profile = createProfile({
    name: `Jeu ${index}`,
    settings: DEFAULT_SETTINGS,
    activities: [],
  });
  state.profiles.push(profile);
  state.activeProfileId = profile.id;
  bindActiveProfile();
  state.activeDraw = null;
  state.activeSession = null;
  state.lastOptionalActivityId = null;
  persistState();
  writeSettingsForm();
  renderAll();
}

function deleteProfile(id) {
  if (state.profiles.length <= 1) return;
  const index = state.profiles.findIndex((profile) => profile.id === id);
  if (index <= 0) {
    showToast("Le premier jeu de réglages ne peut pas être supprimé.");
    return;
  }
  if (!confirm(`Supprimer « ${state.profiles[index].name} » ?`)) return;
  const wasActive = state.activeProfileId === id;
  state.profiles.splice(index, 1);
  if (wasActive) {
    state.activeProfileId = state.profiles[0].id;
    bindActiveProfile();
    state.activeDraw = null;
    state.activeSession = null;
    state.lastOptionalActivityId = null;
    writeSettingsForm();
  }
  persistState();
  renderAll();
}

function renameProfile(id, rawName) {
  const profile = state.profiles.find((entry) => entry.id === id);
  if (!profile) return;
  const name = String(rawName || "").trim();
  if (!name) {
    const field = document.querySelector(`[data-rename-profile="${CSS.escape(id)}"]`);
    if (field) field.value = profile.name;
    return;
  }
  if (profile.name === name) return;
  profile.name = name;
  persistState();
}

function renderProfileTabs() {
  const root = $("profileTabs");
  if (!root) return;
  root.innerHTML = `
    ${state.profiles
      .map((profile, index) => {
        const active = profile.id === state.activeProfileId;
        return `
          <div class="profile-tab${active ? " is-active" : ""}" data-profile-id="${escapeHtml(profile.id)}">
            <input type="text" class="profile-tab-name" data-select-profile="${escapeHtml(profile.id)}" data-rename-profile="${escapeHtml(profile.id)}" value="${escapeHtml(profile.name)}" maxlength="40" aria-label="Nom du jeu ${escapeHtml(profile.name)}" title="Clique pour sélectionner, modifie pour renommer (ex. Semaine, Weekend)" />
            ${
              index === 0
                ? ""
                : `<button type="button" class="profile-tab-close" data-delete-profile="${escapeHtml(profile.id)}" aria-label="Supprimer ${escapeHtml(profile.name)}">×</button>`
            }
          </div>`;
      })
      .join("")}
    <button type="button" id="btnAddProfile" class="profile-tab-add" aria-label="Nouveau jeu de réglages">＋</button>
  `;
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

function normalizeEmoji(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .slice(0, 8);
}

function activityEmojiPrefix(activity) {
  const emoji = normalizeEmoji(activity?.emoji);
  return emoji ? `${emoji} ` : "";
}

function activityTitleHtml(activity) {
  return `${escapeHtml(activityEmojiPrefix(activity))}${escapeHtml(activity.name)}`;
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
}

function renderAll() {
  ensureCurrentDay();
  renderDayStatus();
  renderDraw();
  renderActivities();
  renderHistory();
  renderActivityManager();
  renderProfileTabs();
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

function wheelDrawParams(now = new Date()) {
  return {
    activities: state.activities,
    sessions: state.sessions,
    settings: state.settings,
    lastOptionalActivityId: state.lastOptionalActivityId,
    now,
  };
}

function refreshWheelFromState() {
  if (!Wheel || state.activeSession || wheelSpinning || state.activeDraw) return;
  Wheel.paint({
    activitySegments: Logic.activityWheelSegments(wheelDrawParams()),
    durationSegments: Logic.durationWheelDisplaySegments(state.settings),
    preserveRotation: false,
  });
}

function renderDraw() {
  const draw = currentDraw();
  const activity = draw ? activityById(draw.activityId) : null;
  const running = Boolean(state.activeSession);
  const hasChoice = Boolean(state.activeDraw || running);

  $("wheelArena").hidden = running;
  $("drawResult").hidden = !hasChoice;
  $("timerStage").hidden = !running;
  $("btnDraw").disabled = running || wheelSpinning;
  $("btnStart").disabled = !state.activeDraw || running || wheelSpinning;
  $("btnValidate").disabled = !running;
  $("btnDraw").hidden = Boolean(state.activeDraw) || running;
  $("btnStart").hidden = !state.activeDraw || running;
  $("btnValidate").hidden = !running;

  refreshWheelFromState();

  if (activity) {
    const optional = activity.category === Logic.CATEGORY_OPTIONAL;
    const progress = Logic.progressMinutes(activity, state.sessions, currentDay);
    const target = optional ? activity.dailyCap : activity.targetMinutes;
    $("drawnName").textContent = `${activityEmojiPrefix(activity)}${activity.name}`;
    $("plannedDuration").textContent = formatFriendly(draw.plannedMinutes);
    if (target) {
      const percentage = Math.min(100, Math.round((progress / target) * 100));
      $("drawProgress").textContent = `${percentage} % · ${formatFriendly(progress)} / ${formatFriendly(target)}`;
    } else {
      $("drawProgress").textContent = `${formatFriendly(
        Logic.actualMinutesDone(activity, state.sessions, currentDay)
      )} aujourd’hui`;
    }
    $("drawIcon").textContent = optional ? "◆" : "✦";
    $("drawIcon").classList.toggle("optional", optional);
    $("urgentBadge").hidden = !draw.urgent;
  }
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

  const reserved = activity.banned;
  const fillable = Boolean(target);
  const roomForManualAdd = optional && activity.dailyCap != null
    ? Math.max(0, activity.dailyCap - actual)
    : 5;
  return `
    <article class="activity-card ${optional ? "optional" : ""}${fillable ? " has-fill" : ""}${reserved ? " is-reserved" : ""}"${fillable ? ` style="--fill:${percentage}%" aria-label="${percentage} %"` : ""}>
      <div class="activity-card-top">
        <h3>${activityTitleHtml(activity)}</h3>
        ${activityToggleMarkup(activity)}
      </div>
      <div class="activity-stats">
        <span class="activity-stat-main">
          <span>${primary}</span>
          <button type="button" class="manual-time-button" data-add-five="${escapeHtml(activity.id)}"
            aria-label="Ajouter 5 minutes consacrées à ${escapeHtml(activity.name)}"
            title="Ajouter 5 minutes consacrées"
            ${roomForManualAdd <= 0 ? "disabled" : ""}>+5 min</button>
        </span>
        <span>${secondary}</span>
      </div>
    </article>
  `;
}

function renderActivities() {
  const active = state.activities.filter((activity) => !activity.banned);
  const required = state.activities.filter(
    (activity) => activity.category === Logic.CATEGORY_REQUIRED
  );
  const optional = state.activities.filter(
    (activity) => activity.category === Logic.CATEGORY_OPTIONAL
  );

  $("requiredList").innerHTML = required.length
    ? required.map(activityCard).join("")
    : '<div class="empty-state">Aucune mission obligatoire.</div>';
  $("optionalList").innerHTML = optional.length
    ? optional.map(activityCard).join("")
    : '<div class="empty-state">Aucune activité facultative.</div>';

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
                <small>${session.manual ? "Ajout manuel" : `Prévu ${formatFriendly(session.plannedMinutes)}`}</small></span>
              <span class="session-duration">${formatFriendly(session.actualMinutes)}</span>
            </li>`;
        })
        .join("")
    : '<li class="empty-state">Aucune partie aujourd’hui. La roue t’attend.</li>';
}

function renderActivityManager() {
  const rows = state.activities.length
    ? state.activities
        .map((activity, index) => {
          const optional = activity.category === Logic.CATEGORY_OPTIONAL;
          const durationValue = optional
            ? activity.dailyCap ?? ""
            : activity.targetMinutes ?? "";
          return `
            <div class="manager-row">
              <label class="manager-field manager-emoji">Emoji
                <input type="text" class="emoji-input" data-emoji-activity="${escapeHtml(activity.id)}" maxlength="8" value="${escapeHtml(normalizeEmoji(activity.emoji))}" placeholder="" aria-label="Emoji pour ${escapeHtml(activity.name)}" />
              </label>
              <label class="manager-field manager-name">Nom
                <input type="text" data-name-activity="${escapeHtml(activity.id)}" maxlength="80" value="${escapeHtml(activity.name)}" required />
              </label>
              <label class="manager-field manager-type">Type
                <select data-category-activity="${escapeHtml(activity.id)}" aria-label="Type de ${escapeHtml(activity.name)}">
                  <option value="required"${optional ? "" : " selected"}>Obligatoire</option>
                  <option value="optional"${optional ? " selected" : ""}>Facultative</option>
                </select>
              </label>
              <label class="manager-field manager-duration">
                ${optional ? "Plafond" : "Objectif"}
                <span class="input-with-unit">
                  <input type="number" min="1" data-duration-activity="${escapeHtml(activity.id)}" value="${escapeHtml(durationValue)}" ${optional ? '' : "required"} aria-label="${optional ? "Plafond" : "Objectif"} de ${escapeHtml(activity.name)}" />
                  <span>min</span>
                </span>
              </label>
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
    : '<div class="empty-state">Aucune activité dans ce jeu. Ajoutes-en une.</div>';

  $("activityManager").innerHTML = `
    ${rows}
    <button type="button" id="btnAddActivity" class="add-activity-button" aria-label="Ajouter une activité">＋</button>
  `;
}

function addActivity() {
  const activity = {
    id: makeId("activite"),
    name: "Nouvelle activité",
    emoji: "",
    category: Logic.CATEGORY_REQUIRED,
    targetMinutes: Math.max(1, Number(state.settings.minSession) || 15),
    dailyCap: null,
    banned: false,
  };
  state.activities.push(activity);
  persistState();
  renderAll();
  const nameInput = document.querySelector(
    `[data-name-activity="${CSS.escape(activity.id)}"]`
  );
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
}

async function requestDraw() {
  ensureCurrentDay();
  if (state.activeSession) {
    showToast("Clôture d’abord la session en cours.");
    return;
  }
  if (wheelSpinning) return;

  const now = new Date();
  const wheelParams = wheelDrawParams(now);
  const result = Logic.drawActivity(wheelParams);
  if (!result.ok) {
    const messages = {
      pause: `La roue se repose jusqu’à ${state.settings.pauseEnd}.`,
      "day-ended": "La journée est terminée. Reviens demain pour une nouvelle partie.",
      "nothing-eligible": "Toutes les activités actives sont complétées ou plafonnées.",
      "no-valid-duration": "Aucune durée de session valide n’est disponible.",
    };
    state.activeDraw = null;
    persistState();
    showToast(messages[result.reason] || "Aucun tirage possible pour le moment.");
    renderAll();
    return;
  }

  const remaining =
    result.category === Logic.CATEGORY_REQUIRED
      ? Logic.requiredRemaining(result.activity, state.sessions, Logic.dateKey(now))
      : Logic.optionalCapRemaining(result.activity, state.sessions, Logic.dateKey(now));
  const activitySegments = Logic.activityWheelSegments(wheelParams);
  const durationSegments = Logic.durationWheelSegments(
    result.activity,
    remaining,
    result.available,
    state.settings
  );

  wheelSpinning = true;
  renderDraw();

  if (Wheel) {
    await Wheel.spin({
      activitySegments,
      durationSegments,
      targetActivityId: result.activity.id,
      targetMinutes: result.plannedMinutes,
    });
  }

  wheelSpinning = false;
  state.activeDraw = {
    activityId: result.activity.id,
    category: result.category,
    plannedMinutes: result.plannedMinutes,
    urgent: result.urgent,
    drawnAt: new Date().toISOString(),
  };
  persistState();
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

function addManualMinutes(id) {
  const activity = activityById(id);
  if (!activity || activity.banned) return;
  const actual = Logic.actualMinutesDone(activity, state.sessions, currentDay);
  const remainingCap =
    activity.category === Logic.CATEGORY_OPTIONAL && activity.dailyCap != null
      ? Math.max(0, activity.dailyCap - actual)
      : 5;
  const addedMinutes = Math.min(5, remainingCap);
  if (addedMinutes <= 0) {
    showToast(`« ${activity.name} » a atteint son plafond quotidien.`);
    return;
  }
  const now = new Date();
  state.sessions.push({
    id: makeId("ajout-manuel"),
    date: currentDay,
    activityId: activity.id,
    activityName: activity.name,
    category: activity.category,
    plannedMinutes: addedMinutes,
    actualMinutes: addedMinutes,
    startedAt: now.toISOString(),
    endedAt: now.toISOString(),
    manual: true,
  });
  persistState();
  setMessage(`${formatFriendly(addedMinutes)} consacrées ajoutées à « ${activity.name} ».`);
  renderAll();
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

function commitActivity(activity) {
  persistState();
  renderAll();
}

function setActivityEmoji(id, rawEmoji) {
  const activity = activityById(id);
  if (!activity) return;
  activity.emoji = normalizeEmoji(rawEmoji);
  commitActivity(activity);
}

function setActivityName(id, rawName) {
  const activity = activityById(id);
  if (!activity) return;
  const name = String(rawName || "").trim();
  if (!name) {
    renderAll();
    return;
  }
  activity.name = name;
  commitActivity(activity);
}

function setActivityCategory(id, category) {
  const activity = activityById(id);
  if (!activity) return;
  const next =
    category === Logic.CATEGORY_OPTIONAL
      ? Logic.CATEGORY_OPTIONAL
      : Logic.CATEGORY_REQUIRED;
  if (activity.category === next) return;
  const currentMinutes = activity.targetMinutes ?? activity.dailyCap;
  if (next === Logic.CATEGORY_REQUIRED) {
    activity.category = next;
    activity.targetMinutes = Math.max(1, Number(currentMinutes) || state.settings.minSession || 1);
    activity.dailyCap = null;
  } else {
    activity.category = next;
    activity.dailyCap = currentMinutes == null ? null : Math.max(1, Number(currentMinutes) || 1);
    activity.targetMinutes = null;
  }
  commitActivity(activity);
}

function setActivityDuration(id, rawDuration) {
  const activity = activityById(id);
  if (!activity) return;
  const text = String(rawDuration ?? "").trim();
  if (activity.category === Logic.CATEGORY_OPTIONAL) {
    activity.dailyCap = text === "" ? null : Math.max(1, Number(text) || 1);
  } else {
    const minutes = Math.max(1, Number(text) || 0);
    if (!minutes) {
      renderAll();
      return;
    }
    activity.targetMinutes = minutes;
  }
  commitActivity(activity);
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
  const card = $("notificationsCard");
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";
  const hide = permission === "granted";
  if (card) card.hidden = hide;
  if (hide) return;
  const labels = {
    denied: "Notifications bloquées : les alertes internes restent actives.",
    default: "Active-les pour être prévenu une minute avant la fin.",
    unsupported: "Notifications système indisponibles : les alertes internes restent actives.",
  };
  $("notificationStatus").textContent = labels[permission] || labels.default;
  $("btnNotifications").disabled = permission === "unsupported";
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

function switchView(name) {
  const settings = name === "settings";
  $("gameView").hidden = settings;
  $("settingsView").hidden = !settings;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (settings) {
    writeSettingsForm();
    renderProfileTabs();
  }
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
  "type",
  "profileId",
  "profileName",
  "id",
  "name",
  "category",
  "target",
  "dailyCap",
  "banned",
  "emoji",
  "date",
  "planned",
  "actual",
  "startedAt",
  "endedAt",
  "key",
  "value",
];

function serializeCsv() {
  flushActiveProfile();
  const rows = [CSV_COLUMNS];
  for (const profile of state.profiles) {
    rows.push([
      "profile",
      profile.id,
      profile.name,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    for (const [key, value] of Object.entries(profile.settings)) {
      rows.push([
        "setting",
        profile.id,
        profile.name,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        key,
        value,
      ]);
    }
    for (const activity of profile.activities) {
      rows.push([
        "activity",
        profile.id,
        profile.name,
        activity.id,
        activity.name,
        activity.category,
        activity.targetMinutes ?? "",
        activity.dailyCap ?? "",
        activity.banned ? "1" : "0",
        activity.emoji || "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }
  }
  for (const session of state.sessions) {
    rows.push([
      "session",
      "",
      "",
      session.id,
      session.activityName,
      session.category,
      "",
      "",
      "",
      "",
      session.date,
      session.plannedMinutes,
      session.actualMinutes,
      session.startedAt,
      session.endedAt,
      session.activityId,
      "",
    ]);
  }
  rows.push([
    "meta",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    currentDay,
    "",
    "",
    "",
    "",
    "version",
    STATE_VERSION,
  ]);
  rows.push([
    "meta",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "activeProfileId",
    state.activeProfileId,
  ]);
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}\n`;
}

function parseLegacySingleProfileCsv(lines, indexes) {
  const settings = { ...DEFAULT_SETTINGS };
  const activities = [];
  const sessions = [];
  const value = (columns, key) =>
    indexes[key] == null ? "" : columns[indexes[key]] ?? "";

  for (const line of lines.slice(1)) {
    const columns = splitCsvLine(line);
    const type = value(columns, "type");
    if (type === "activity") {
      const category =
        value(columns, "category") === Logic.CATEGORY_OPTIONAL
          ? Logic.CATEGORY_OPTIONAL
          : Logic.CATEGORY_REQUIRED;
      activities.push({
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
        emoji: normalizeEmoji(value(columns, "emoji")),
      });
    } else if (type === "setting") {
      const key = value(columns, "key");
      const raw = value(columns, "value");
      if (key in settings) {
        settings[key] = key.includes("Session") ? Number(raw) : raw;
      }
    } else if (type === "session") {
      sessions.push({
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
  if (!activities.length) throw new Error("Le CSV ne contient aucune activité.");
  const profile = createProfile({
    name: "Jeu 1",
    settings,
    activities,
  });
  return normalizeState({
    profiles: [profile],
    activeProfileId: profile.id,
    sessions,
  });
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
  if (indexes.type == null) throw new Error("Format CSV non reconnu.");

  const hasProfiles = lines
    .slice(1)
    .some((line) => splitCsvLine(line)[indexes.type] === "profile");
  if (!hasProfiles) return parseLegacySingleProfileCsv(lines, indexes);

  const profilesById = new Map();
  const sessions = [];
  let activeProfileId = "";
  const value = (columns, key) =>
    indexes[key] == null ? "" : columns[indexes[key]] ?? "";

  for (const line of lines.slice(1)) {
    const columns = splitCsvLine(line);
    const type = value(columns, "type");
    if (type === "profile") {
      const id = value(columns, "profileId") || makeId("jeu");
      profilesById.set(
        id,
        createProfile({
          id,
          name: value(columns, "profileName") || "Jeu",
          settings: DEFAULT_SETTINGS,
          activities: [],
        })
      );
    }
  }

  for (const line of lines.slice(1)) {
    const columns = splitCsvLine(line);
    const type = value(columns, "type");
    const profileId = value(columns, "profileId");
    if (type === "setting") {
      const profile =
        profilesById.get(profileId) ||
        [...profilesById.values()][0];
      if (!profile) continue;
      const key = value(columns, "key");
      const raw = value(columns, "value");
      if (key in profile.settings) {
        profile.settings[key] = key.includes("Session") ? Number(raw) : raw;
      }
    } else if (type === "activity") {
      let profile = profilesById.get(profileId);
      if (!profile) {
        profile = createProfile({
          id: profileId || makeId("jeu"),
          name: value(columns, "profileName") || "Jeu",
          settings: DEFAULT_SETTINGS,
          activities: [],
        });
        profilesById.set(profile.id, profile);
      }
      const category =
        value(columns, "category") === Logic.CATEGORY_OPTIONAL
          ? Logic.CATEGORY_OPTIONAL
          : Logic.CATEGORY_REQUIRED;
      profile.activities.push({
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
        emoji: normalizeEmoji(value(columns, "emoji")),
      });
    } else if (type === "session") {
      sessions.push({
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
    } else if (type === "meta" && value(columns, "key") === "activeProfileId") {
      activeProfileId = value(columns, "value");
    }
  }

  const profiles = [...profilesById.values()];
  if (!profiles.length) throw new Error("Le CSV ne contient aucun jeu de réglages.");
  return normalizeState({
    profiles,
    activeProfileId: activeProfileId || profiles[0].id,
    sessions,
  });
}

function parseLegacyCsv(lines) {
  const settings = { ...DEFAULT_SETTINGS };
  const activities = [];
  const sessions = [];
  const legacyProgress = new Map();
  const idsByName = new Map();
  let fileDate = currentDay;

  for (const line of lines.slice(1)) {
    const columns = splitCsvLine(line);
    const [type, name, num1, num2, text] = columns;
    if (type === "activity") {
      const id = makeId(name);
      idsByName.set(name, id);
      activities.push({
        id,
        name,
        category: Logic.CATEGORY_REQUIRED,
        targetMinutes: Math.max(1, Number(num1) || 1),
        dailyCap: null,
        banned: false,
        emoji: "",
      });
      legacyProgress.set(id, Number(num2) || 0);
    } else if (type === "setting") {
      if (name === "min_session") settings.minSession = Number(num1) || 15;
      if (name === "max_session") settings.maxSession = Number(num1) || 40;
      if (name === "lunch_start") settings.pauseStart = text || "12:30";
      if (name === "lunch_end") settings.pauseEnd = text || "13:30";
      if (name === "day_end") settings.dayEnd = text || "17:00";
    } else if (type === "meta" && name === "date") {
      fileDate = text || currentDay;
    } else if (type === "session") {
      const [date, startedAt, endedAt] = String(text || "").split("|");
      sessions.push({
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
  for (const activity of activities) {
    const logged = Logic.actualMinutesDone(activity, sessions, fileDate);
    const missing = Math.max(0, (legacyProgress.get(activity.id) || 0) - logged);
    if (missing > 0 && fileDate === currentDay) {
      sessions.push({
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
  if (!activities.length) throw new Error("Le CSV ne contient aucune activité.");
  const profile = createProfile({ name: "Jeu 1", settings, activities });
  return normalizeState({
    profiles: [profile],
    activeProfileId: profile.id,
    sessions,
  });
}

function downloadCsv() {
  const blob = new Blob([serializeCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `casino-du-pomodoro-${currentDay}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  $("fileStatus").textContent =
    "Export téléchargé : tous les onglets et l’historique sont inclus.";
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
      types: [
        {
          description: "Données Casino du Pomodoro",
          accept: { "text/csv": [".csv"] },
        },
      ],
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
    showToast("CSV lié. Toute l’application sera synchronisée.");
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
    $("fileStatus").textContent = `Import réussi : ${file.name}.`;
    showToast(`Données importées depuis « ${file.name} ».`);
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
  $("btnExport").addEventListener("click", downloadCsv);
  $("btnLinkFile").addEventListener("click", linkCsvFile);
  $("btnSaveFile").addEventListener("click", queueFileWrite);
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
      pauseStart: $("pauseStart").value.trim(),
      pauseEnd: $("pauseEnd").value.trim(),
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

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "btnAddActivity") {
      addActivity();
      return;
    }
    if (button.id === "btnAddProfile") {
      addProfile();
      return;
    }
    if (button.dataset.deleteProfile) {
      deleteProfile(button.dataset.deleteProfile);
      return;
    }
    if (button.dataset.addFive) addManualMinutes(button.dataset.addFive);
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
  document.addEventListener("focusin", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.dataset.selectProfile) return;
    const id = field.dataset.selectProfile;
    if (id === state.activeProfileId) return;
    switchProfile(id);
    const next = document.querySelector(`[data-rename-profile="${CSS.escape(id)}"]`);
    if (next) next.focus();
  });
  document.addEventListener("change", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    if (field instanceof HTMLInputElement && field.dataset.toggleActivity) {
      const id = field.dataset.toggleActivity;
      const ok = field.checked ? restoreActivity(id) : banActivity(id);
      if (!ok) field.checked = !field.checked;
      return;
    }
    if (field.dataset.renameProfile) {
      renameProfile(field.dataset.renameProfile, field.value);
      return;
    }
    if (field.dataset.emojiActivity) setActivityEmoji(field.dataset.emojiActivity, field.value);
    if (field.dataset.nameActivity) setActivityName(field.dataset.nameActivity, field.value);
    if (field.dataset.categoryActivity) setActivityCategory(field.dataset.categoryActivity, field.value);
    if (field.dataset.durationActivity) setActivityDuration(field.dataset.durationActivity, field.value);
  });
  document.addEventListener("keydown", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || !field.dataset.renameProfile) return;
    if (event.key === "Enter") {
      event.preventDefault();
      field.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      renderProfileTabs();
    }
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
  if (Wheel) Wheel.mount();
  initEvents();
  renderAll();
  tick();
  window.setInterval(tick, 1000);
}

init();
