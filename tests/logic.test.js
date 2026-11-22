const test = require("node:test");
const assert = require("node:assert/strict");
const Logic = require("../logic.js");

const settings = {
  minSession: 10,
  maxSession: 30,
  pauseStart: "12:30",
  pauseEnd: "13:30",
  dayEnd: "17:00",
};

function required(id, targetMinutes, banned = false) {
  return { id, name: id, category: "required", targetMinutes, dailyCap: null, banned };
}

function optional(id, dailyCap = null, banned = false) {
  return { id, name: id, category: "optional", targetMinutes: null, dailyCap, banned };
}

function session(activity, actualMinutes, date = "2026-11-19") {
  return {
    date,
    activityId: activity.id,
    activityName: activity.name,
    actualMinutes,
  };
}

test("calcule le temps ouvrable restant en déduisant la pause", () => {
  assert.equal(Logic.availableMinutes(settings, new Date(2026, 10, 19, 10, 0)), 360);
  assert.equal(Logic.availableMinutes(settings, new Date(2026, 10, 19, 13, 0)), 210);
  assert.equal(Logic.availableMinutes(settings, new Date(2026, 10, 19, 17, 0)), 0);
});

test("plafonne une progression obligatoire sans altérer la durée réelle", () => {
  const activity = required("A", 12);
  const sessions = [session(activity, 15)];
  assert.equal(Logic.actualMinutesDone(activity, sessions, "2026-11-19"), 15);
  assert.equal(Logic.progressMinutes(activity, sessions, "2026-11-19"), 12);
  assert.equal(Logic.requiredRemaining(activity, sessions, "2026-11-19"), 0);
});

test("ne propose pas une durée créant un reliquat inférieur au minimum", () => {
  const activity = required("A", 30);
  const valid = Logic.validPlannedDurations(activity, 30, 100, {
    ...settings,
    minSession: 10,
    maxSession: 25,
  });
  assert.deepEqual(valid, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

test("autorise un reliquat terminal sous le minimum", () => {
  const activity = required("A", 7);
  assert.deepEqual(Logic.validPlannedDurations(activity, 7, 100, settings), [7]);
});

test("plafonne une facultative à son reliquat même sous le minimum", () => {
  const activity = optional("A", 8);
  assert.deepEqual(Logic.validPlannedDurations(activity, 8, 100, settings), [8]);
});

test("force la première obligatoire lorsque toutes ne peuvent plus finir", () => {
  const a = required("A", 40);
  const b = required("B", 40);
  const result = Logic.drawActivity({
    activities: [a, b, optional("C")],
    sessions: [],
    settings: { ...settings, dayEnd: "10:50", pauseStart: "11:00", pauseEnd: "11:30" },
    now: new Date(2026, 10, 19, 10, 0),
    random: () => 0.99,
  });
  assert.equal(result.ok, true);
  assert.equal(result.urgent, true);
  assert.equal(result.activity.id, "A");
});

test("pondère les obligatoires selon leur temps restant", () => {
  const a = required("A", 20);
  const b = required("B", 15);
  const values = [0.56, 0];
  const result = Logic.drawActivity({
    activities: [a, b],
    sessions: [],
    settings,
    now: new Date(2026, 10, 19, 10, 0),
    random: () => values.shift() ?? 0,
  });
  assert.equal(result.activity.id, "A");
});

test("choisit la catégorie obligatoire selon le ratio de temps restant", () => {
  const a = required("A", 20);
  const b = optional("B");
  const requiredDraw = Logic.drawActivity({
    activities: [a, b],
    sessions: [],
    settings: { ...settings, dayEnd: "11:40", pauseStart: "12:30", pauseEnd: "13:30" },
    now: new Date(2026, 10, 19, 10, 0),
    random: () => 0.1,
  });
  const optionalDraw = Logic.drawActivity({
    activities: [a, b],
    sessions: [],
    settings: { ...settings, dayEnd: "11:40", pauseStart: "12:30", pauseEnd: "13:30" },
    now: new Date(2026, 10, 19, 10, 0),
    random: () => 0.9,
  });
  assert.equal(requiredDraw.category, "required");
  assert.equal(optionalDraw.category, "optional");
  assert.equal(requiredDraw.requiredProbability, 0.2);
});

test("ne répète pas immédiatement une facultative si une autre est éligible", () => {
  const a = optional("A");
  const b = optional("B");
  const result = Logic.drawActivity({
    activities: [a, b],
    sessions: [],
    settings,
    lastOptionalActivityId: "A",
    now: new Date(2026, 10, 19, 10, 0),
    random: () => 0,
  });
  assert.equal(result.category, "optional");
  assert.equal(result.activity.id, "B");
});

test("autorise la répétition facultative lorsqu'elle est la seule éligible", () => {
  const a = optional("A");
  const result = Logic.drawActivity({
    activities: [a],
    sessions: [],
    settings,
    lastOptionalActivityId: "A",
    now: new Date(2026, 10, 19, 10, 0),
    random: () => 0,
  });
  assert.equal(result.activity.id, "A");
});

test("pénalise les facultatives déjà pratiquées", () => {
  const a = optional("A");
  const b = optional("B");
  const c = optional("C");
  const d = optional("D");
  const sessions = [session(a, 20), session(b, 50)];
  const result = Logic.drawActivity({
    activities: [a, b, c, d],
    sessions,
    settings: { ...settings, dayEnd: "11:40", pauseStart: "12:30", pauseEnd: "13:30" },
    now: new Date(2026, 10, 19, 10, 0),
    random: () => 0.25,
  });
  assert.equal(result.activity.id, "B");
});

test("n'applique aucune pause lorsque les horaires sont vides", () => {
  const noPause = { ...settings, pauseStart: "", pauseEnd: "" };
  assert.equal(Logic.isPauseTime(noPause, new Date(2026, 10, 19, 12, 45)), false);
  assert.equal(Logic.availableMinutes(noPause, new Date(2026, 10, 19, 13, 0)), 240);
  assert.equal(Logic.validateSettings(noPause).length, 0);
});

test("ignore une pause incomplète sans bloquer l'enregistrement", () => {
  const partial = { ...settings, pauseStart: "12:30", pauseEnd: "" };
  assert.equal(Logic.isPauseTime(partial, new Date(2026, 10, 19, 12, 45)), false);
  assert.equal(Logic.availableMinutes(partial, new Date(2026, 10, 19, 13, 0)), 240);
  assert.equal(Logic.validateSettings(partial).length, 0);
});

test("distribue les angles selon les probabilités réelles du tirage", () => {
  const activities = [
    required("a", 60),
    required("b", 60),
    optional("c", null),
  ];
  const sessions = [
    {
      date: "2026-11-19",
      activityId: "a",
      activityName: "a",
      actualMinutes: 30,
      category: "required",
    },
  ];
  const segments = Logic.activityWheelSegments({
    activities,
    sessions,
    settings,
    now: new Date(2026, 10, 19, 10, 0),
  });
  const byId = Object.fromEntries(segments.map((segment) => [segment.activity.id, segment.probability]));
  assert.ok(Math.abs(byId.a - 1 / 12) < 0.001);
  assert.ok(Math.abs(byId.b - 1 / 6) < 0.001);
  assert.ok(Math.abs(byId.c - 0.75) < 0.001);
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.probability, 0) - 1) < 0.0001);
});

test("répartit les durées de façon uniforme sur la roue extérieure", () => {
  const activity = required("a", 60);
  const segments = Logic.durationWheelSegments(activity, 60, 120, settings);
  const share = 1 / segments.length;
  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => Math.abs(segment.probability - share) < 0.0001));
});

test("rejette un maximum inférieur au double du minimum", () => {
  const errors = Logic.validateSettings({
    ...settings,
    minSession: 20,
    maxSession: 25,
  });
  assert.match(errors.join(" "), /deux fois/);
});
