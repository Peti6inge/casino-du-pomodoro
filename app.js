/**
 * Casino du Pomodoro — v1 (front-end only)
 * CSV: activités, paramètres et journal de sessions dans un seul fichier.
 */

const CSV_HEADER = "type,name,num1,num2,text";

const DEFAULT_SETTINGS = {
  minSession: 15,
  maxSession: 40,
  lunchStart: "12:30",
  lunchEnd: "13:30",
  dayEnd: "17:00",
};

const DEFAULT_ACTIVITIES = [
  { name: "Activité A", dailyTarget: 60, doneToday: 0 },
  { name: "Activité B", dailyTarget: 60, doneToday: 0 },
];

let settings = { ...DEFAULT_SETTINGS };
let activities = DEFAULT_ACTIVITIES.map((a) => ({ ...a }));
let sessionsToday = [];
let csvFileHandle = null;
let canSaveToHandle = false;

let drawnActivity = null;
let session = {
  running: false,
  startedAt: null,
  elapsedMs: 0,
  tickId: null,
};

let todayKey = todayDateKey();

const $ = (id) => document.getElementById(id);

function todayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minutesNow(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function ensureToday() {
  const key = todayDateKey();
  if (key !== todayKey) {
    todayKey = key;
    activities.forEach((a) => {
      a.doneToday = 0;
    });
    sessionsToday = [];
    drawnActivity = null;
    stopTimer();
    persistSoon();
  }
}

function isLunchTime(date = new Date()) {
  const m = minutesNow(date);
  const start = parseTimeToMinutes(settings.lunchStart);
  const end = parseTimeToMinutes(settings.lunchEnd);
  return m >= start && m < end;
}

function isAfterDayEnd(date = new Date()) {
  return minutesNow(date) >= parseTimeToMinutes(settings.dayEnd);
}

function availableMinutesUntilDayEnd(date = new Date()) {
  const now = minutesNow(date);
  const dayEnd = parseTimeToMinutes(settings.dayEnd);
  if (now >= dayEnd) return 0;

  const lunchStart = parseTimeToMinutes(settings.lunchStart);
  const lunchEnd = parseTimeToMinutes(settings.lunchEnd);

  const rangeStart = now;
  const rangeEnd = dayEnd;
  const overlapStart = Math.max(rangeStart, lunchStart);
  const overlapEnd = Math.min(rangeEnd, lunchEnd);
  const lunchOverlap = Math.max(0, overlapEnd - overlapStart);

  return Math.max(0, dayEnd - now - lunchOverlap);
}

function remainingMinutes(activity) {
  return Math.max(0, activity.dailyTarget - activity.doneToday);
}

function eligibleActivitiesForDraw() {
  ensureToday();
  const withWork = activities.filter((a) => remainingMinutes(a) > 0);
  if (withWork.length === 0) return [];

  const avail = availableMinutesUntilDayEnd();
  const totalRemaining = withWork.reduce((s, a) => s + remainingMinutes(a), 0);
  const allCanFinish = totalRemaining <= avail;

  if (allCanFinish) return withWork;
  return withWork.filter((a) => remainingMinutes(a) <= avail);
}

function pickRandomActivity() {
  const pool = eligibleActivitiesForDraw();
  if (pool.length === 0) return null;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function stopTimer() {
  if (session.tickId) {
    clearInterval(session.tickId);
    session.tickId = null;
  }
  session.running = false;
  session.startedAt = null;
  session.elapsedMs = 0;
  $("timerDisplay").textContent = "00:00";
  $("btnStart").disabled = !drawnActivity;
  $("btnValidate").disabled = true;
}

function startTimer() {
  if (!drawnActivity || session.running) return;
  if (isLunchTime()) {
    setDayMessage("Pause déjeuner : impossible de démarrer une session.");
    return;
  }
  if (isAfterDayEnd()) {
    setDayMessage("La journée est terminée (heure de fin atteinte).");
    return;
  }

  session.running = true;
  session.startedAt = Date.now();
  session.elapsedMs = 0;
  $("btnStart").disabled = true;
  $("btnValidate").disabled = false;
  $("btnDraw").disabled = true;

  session.tickId = setInterval(() => {
    ensureToday();
    session.elapsedMs = Date.now() - session.startedAt;
    $("timerDisplay").textContent = formatDuration(session.elapsedMs);

    if (isLunchTime() || isAfterDayEnd()) {
      setDayMessage(
        isLunchTime()
          ? "Pause déjeuner en cours — validez la session si vous avez terminé."
          : "Heure de fin de journée dépassée — validez la session."
      );
    }
  }, 1000);
}

function validateSession() {
  if (!session.running || !drawnActivity) return;

  const durationMin = Math.round(session.elapsedMs / 60000);
  if (durationMin < settings.minSession) {
    setDayMessage(
      `Session trop courte : minimum ${settings.minSession} min (actuellement ~${durationMin} min).`
    );
    return;
  }
  if (durationMin > settings.maxSession) {
    setDayMessage(
      `Session trop longue : maximum ${settings.maxSession} min (actuellement ~${durationMin} min).`
    );
    return;
  }

  const endedAt = new Date();
  const startedAt = new Date(session.startedAt);

  drawnActivity.doneToday += durationMin;
  sessionsToday.push({
    date: todayKey,
    name: drawnActivity.name,
    durationMin,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
  });

  stopTimer();
  drawnActivity = null;
  $("drawResult").hidden = true;
  $("btnDraw").disabled = false;

  renderActivities();
  renderSessions();
  setDayMessage(`Session enregistrée : ${durationMin} min sur « ${sessionsToday.at(-1).name} ».`);
  persistSoon();

  const next = pickRandomActivity();
  if (next) {
    drawnActivity = next;
    $("drawnName").textContent = next.name;
    $("drawResult").hidden = false;
    $("btnStart").disabled = false;
    setDayMessage(`Prochain tirage : « ${next.name} ». Démarrez quand vous êtes prêt.`);
  } else {
    setDayMessage("Plus d’activité tirée : quotas ou temps disponible insuffisant.");
  }
}

function requestDraw() {
  ensureToday();
  if (session.running) {
    setDayMessage("Terminez la session en cours avant un nouveau tirage.");
    return;
  }
  if (isLunchTime()) {
    setDayMessage("Pause déjeuner : pas de nouvelle session.");
    return;
  }
  if (isAfterDayEnd()) {
    setDayMessage("Journée terminée.");
    return;
  }

  const picked = pickRandomActivity();
  if (!picked) {
    drawnActivity = null;
    $("drawResult").hidden = true;
    $("btnStart").disabled = true;
    const avail = availableMinutesUntilDayEnd();
    if (activities.every((a) => remainingMinutes(a) === 0)) {
      setDayMessage("Tous les objectifs du jour sont atteints.");
    } else {
      setDayMessage(
        `Aucune activité ne peut encore tenir son quota avec le temps restant (${avail} min ouvrées).`
      );
    }
    return;
  }

  drawnActivity = picked;
  $("drawnName").textContent = picked.name;
  $("drawResult").hidden = false;
  $("btnStart").disabled = false;
  const firstOfDay = sessionsToday.length === 0;
  setDayMessage(
    firstOfDay
      ? `Première session : tirage uniforme parmi les activités encore réalisables (${picked.name}).`
      : `Activité tirée : ${picked.name}.`
  );
}

function setDayMessage(msg) {
  $("dayMessage").textContent = msg;
}

function readSettingsFromForm() {
  settings.minSession = Number($("minSession").value) || DEFAULT_SETTINGS.minSession;
  settings.maxSession = Number($("maxSession").value) || DEFAULT_SETTINGS.maxSession;
  settings.lunchStart = $("lunchStart").value || DEFAULT_SETTINGS.lunchStart;
  settings.lunchEnd = $("lunchEnd").value || DEFAULT_SETTINGS.lunchEnd;
  settings.dayEnd = $("dayEnd").value || DEFAULT_SETTINGS.dayEnd;

  if (settings.minSession > settings.maxSession) {
    const t = settings.minSession;
    settings.minSession = settings.maxSession;
    settings.maxSession = t;
  }

  $("hintMin").textContent = settings.minSession;
  $("hintMax").textContent = settings.maxSession;
}

function writeSettingsToForm() {
  $("minSession").value = settings.minSession;
  $("maxSession").value = settings.maxSession;
  $("lunchStart").value = settings.lunchStart;
  $("lunchEnd").value = settings.lunchEnd;
  $("dayEnd").value = settings.dayEnd;
  $("hintMin").textContent = settings.minSession;
  $("hintMax").textContent = settings.maxSession;
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function serializeCsv() {
  ensureToday();
  const lines = [CSV_HEADER];
  for (const a of activities) {
    lines.push(
      ["activity", a.name, a.dailyTarget, a.doneToday, ""].map(escapeCsv).join(",")
    );
  }
  const settingRows = [
    ["setting", "min_session", settings.minSession, "", ""],
    ["setting", "max_session", settings.maxSession, "", ""],
    ["setting", "lunch_start", 0, 0, settings.lunchStart],
    ["setting", "lunch_end", 0, 0, settings.lunchEnd],
    ["setting", "day_end", 0, 0, settings.dayEnd],
    ["meta", "date", 0, 0, todayKey],
  ];
  for (const row of settingRows) {
    lines.push(row.map(escapeCsv).join(","));
  }
  for (const s of sessionsToday) {
    lines.push(
      ["session", s.name, s.durationMin, 0, `${s.date}|${s.startedAt}|${s.endedAt}`]
        .map(escapeCsv)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const parsedActivities = [];
  const parsedSessions = [];
  const newSettings = { ...DEFAULT_SETTINGS };
  let fileDate = todayKey;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.toLowerCase().startsWith("type,")) continue;

    const cols = splitCsvLine(line);
    const type = cols[0];
    const name = cols[1] ?? "";

    if (type === "activity") {
      parsedActivities.push({
        name,
        dailyTarget: Number(cols[2]) || 0,
        doneToday: Number(cols[3]) || 0,
      });
    } else if (type === "setting") {
      if (name === "min_session") newSettings.minSession = Number(cols[2]) || 15;
      if (name === "max_session") newSettings.maxSession = Number(cols[2]) || 40;
      if (name === "lunch_start") newSettings.lunchStart = cols[4] || DEFAULT_SETTINGS.lunchStart;
      if (name === "lunch_end") newSettings.lunchEnd = cols[4] || DEFAULT_SETTINGS.lunchEnd;
      if (name === "day_end") newSettings.dayEnd = cols[4] || DEFAULT_SETTINGS.dayEnd;
    } else if (type === "meta" && name === "date") {
      fileDate = cols[4] || fileDate;
    } else if (type === "session") {
      const extra = cols[4] || "";
      const [date, startedAt, endedAt] = extra.split("|");
      parsedSessions.push({
        date: date || todayKey,
        name,
        durationMin: Number(cols[2]) || 0,
        startedAt: startedAt || "",
        endedAt: endedAt || "",
      });
    }
  }

  if (parsedActivities.length > 0) activities = parsedActivities;
  settings = newSettings;

  if (fileDate === todayKey) {
    sessionsToday = parsedSessions.filter((s) => s.date === todayKey);
    activities.forEach((a) => {
      if (parsedSessions.length && fileDate === todayKey) {
        const logged = sessionsToday
          .filter((s) => s.name === a.name)
          .reduce((sum, s) => sum + s.durationMin, 0);
        if (logged > 0) a.doneToday = logged;
      }
    });
  } else {
    sessionsToday = [];
    activities.forEach((a) => {
      a.doneToday = 0;
    });
  }

  writeSettingsToForm();
  renderActivities();
  renderSessions();
}

function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      result.push(cur);
      cur = "";
    } else cur += ch;
  }
  result.push(cur);
  return result;
}

async function persistSoon() {
  if (canSaveToHandle && csvFileHandle) {
    try {
      const writable = await csvFileHandle.createWritable();
      await writable.write(serializeCsv());
      await writable.close();
      setFileStatus(`Fichier lié : ${csvFileHandle.name}`);
    } catch (err) {
      console.warn("Échec enregistrement fichier", err);
      setFileStatus("Erreur d’écriture sur le fichier lié.");
    }
  }
}

function downloadCsv() {
  const blob = new Blob([serializeCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "casino-du-pomodoro.csv";
  a.click();
  URL.revokeObjectURL(url);
  setFileStatus("Export téléchargé : casino-du-pomodoro.csv");
}

async function linkCsvFile() {
  if (!window.showOpenFilePicker) {
    setFileStatus(
      "API fichiers non supportée : utilisez Importer / Exporter (Chrome ou Edge recommandé pour lier un fichier)."
    );
    $("fileImport").click();
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: "CSV Casino du Pomodoro",
          accept: { "text/csv": [".csv"] },
        },
      ],
      multiple: false,
    });
    csvFileHandle = handle;
    canSaveToHandle = true;
    const file = await handle.getFile();
    parseCsv(await file.text());
    $("btnSaveFile").disabled = false;
    setFileStatus(`Fichier lié : ${handle.name} (enregistrement auto après chaque action)`);
    await persistSoon();
  } catch (err) {
    if (err.name !== "AbortError") console.warn(err);
  }
}

async function saveCsvFile() {
  if (canSaveToHandle && csvFileHandle) {
    await persistSoon();
    return;
  }
  downloadCsv();
}

function importCsvFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    parseCsv(reader.result);
    setFileStatus(`Importé : ${file.name}`);
    persistSoon();
  };
  reader.readAsText(file);
}

function setFileStatus(msg) {
  $("fileStatus").textContent = msg;
}

function renderActivities() {
  const ul = $("activityList");
  ul.innerHTML = "";
  activities.forEach((a, index) => {
    const li = document.createElement("li");
    li.className = "activity-item";
    const rem = remainingMinutes(a);
    const pct = a.dailyTarget
      ? Math.min(100, Math.round((a.doneToday / a.dailyTarget) * 100))
      : 0;
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(a.name)}</strong>
        <p class="progress-label">Objectif ${a.dailyTarget} min/jour · reste ${rem} min</p>
      </div>
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-label">${a.doneToday} / ${a.dailyTarget} min</span>
      </div>
      <button type="button" class="btn-icon" data-remove="${index}" aria-label="Supprimer">Retirer</button>
    `;
    ul.appendChild(li);
  });

  ul.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.remove);
      if (Number.isFinite(i)) {
        activities.splice(i, 1);
        renderActivities();
        persistSoon();
      }
    });
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSessions() {
  const ul = $("sessionLog");
  ul.innerHTML = "";
  if (sessionsToday.length === 0) {
    ul.innerHTML = "<li>Aucune session aujourd’hui.</li>";
    return;
  }
  for (const s of sessionsToday) {
    const li = document.createElement("li");
    const time = s.startedAt ? new Date(s.startedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
    li.textContent = `${time} — ${s.name} : ${s.durationMin} min`;
    ul.appendChild(li);
  }
}

function initEvents() {
  $("btnDraw").addEventListener("click", requestDraw);
  $("btnStart").addEventListener("click", startTimer);
  $("btnValidate").addEventListener("click", validateSession);
  $("btnLinkFile").addEventListener("click", linkCsvFile);
  $("btnSaveFile").addEventListener("click", saveCsvFile);
  $("btnExport").addEventListener("click", downloadCsv);
  $("fileImport").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importCsvFromFile(file);
    e.target.value = "";
  });

  ["minSession", "maxSession", "lunchStart", "lunchEnd", "dayEnd"].forEach((id) => {
    $(id).addEventListener("change", () => {
      readSettingsFromForm();
      persistSoon();
    });
  });

  $("activityForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("newActivityName").value.trim();
    const minutes = Number($("newActivityMinutes").value);
    if (!name || !minutes) return;
    activities.push({ name, dailyTarget: minutes, doneToday: 0 });
    $("newActivityName").value = "";
    $("newActivityMinutes").value = "";
    renderActivities();
    persistSoon();
  });

  setInterval(() => {
    ensureToday();
    if (!session.running && !isLunchTime() && !isAfterDayEnd()) {
      const avail = availableMinutesUntilDayEnd();
      if (avail > 0 && !$("dayMessage").textContent.includes("Session enregistrée")) {
        /* léger rafraîchissement implicite via ensureToday */
      }
    }
  }, 60_000);
}

function init() {
  writeSettingsToForm();
  renderActivities();
  renderSessions();
  setDayMessage("Prêt. Liez un CSV ou utilisez les activités par défaut, puis tirez une activité.");
  initEvents();
}

init();