(function attachCasinoLogic(globalScope) {
  "use strict";

  const CATEGORY_REQUIRED = "required";
  const CATEGORY_OPTIONAL = "optional";

  function dateKey(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function parseClock(value) {
    const [hours, minutes] = String(value || "00:00").split(":").map(Number);
    return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
  }

  function pauseClock(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    return parseClock(text);
  }

  function hasPauseSchedule(settings) {
    return pauseClock(settings.pauseStart) != null && pauseClock(settings.pauseEnd) != null;
  }

  function atMinuteOfDay(date, minuteOfDay) {
    const result = new Date(date);
    result.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
    return result;
  }

  function isPauseTime(settings, now = new Date()) {
    if (!hasPauseSchedule(settings)) return false;
    const current = now.getHours() * 60 + now.getMinutes();
    const start = pauseClock(settings.pauseStart);
    const finish = pauseClock(settings.pauseEnd);
    if (start == null || finish == null || start >= finish) return false;
    return current >= start && current < finish;
  }

  function availableMinutes(settings, now = new Date()) {
    const dayEnd = atMinuteOfDay(now, parseClock(settings.dayEnd));
    if (now >= dayEnd) return 0;

    let pauseMs = 0;
    if (hasPauseSchedule(settings)) {
      const startMin = pauseClock(settings.pauseStart);
      const endMin = pauseClock(settings.pauseEnd);
      if (startMin != null && endMin != null && startMin < endMin) {
        const pauseStart = atMinuteOfDay(now, startMin);
        const pauseEnd = atMinuteOfDay(now, endMin);
        const overlapStart = Math.max(now.getTime(), pauseStart.getTime());
        const overlapEnd = Math.min(dayEnd.getTime(), pauseEnd.getTime());
        pauseMs = Math.max(0, overlapEnd - overlapStart);
      }
    }
    return Math.max(0, Math.floor((dayEnd.getTime() - now.getTime() - pauseMs) / 60000));
  }

  function sessionsForActivity(sessions, activity, day = dateKey()) {
    return sessions.filter(
      (session) =>
        session.date === day &&
        (session.activityId === activity.id ||
          (!session.activityId && session.activityName === activity.name))
    );
  }

  function actualMinutesDone(activity, sessions, day = dateKey()) {
    return sessionsForActivity(sessions, activity, day).reduce(
      (total, session) => total + Math.max(0, Number(session.actualMinutes) || 0),
      0
    );
  }

  function progressMinutes(activity, sessions, day = dateKey()) {
    const actual = actualMinutesDone(activity, sessions, day);
    if (activity.category === CATEGORY_REQUIRED) {
      return Math.min(Math.max(0, Number(activity.targetMinutes) || 0), actual);
    }
    return actual;
  }

  function requiredRemaining(activity, sessions, day = dateKey()) {
    if (activity.category !== CATEGORY_REQUIRED) return 0;
    return Math.max(
      0,
      (Number(activity.targetMinutes) || 0) - progressMinutes(activity, sessions, day)
    );
  }

  function optionalCapRemaining(activity, sessions, day = dateKey()) {
    if (activity.category !== CATEGORY_OPTIONAL || activity.dailyCap == null) return Infinity;
    return Math.max(
      0,
      (Number(activity.dailyCap) || 0) - actualMinutesDone(activity, sessions, day)
    );
  }

  function weightedPick(items, weightFor, random = Math.random) {
    const weighted = items.map((item) => ({
      item,
      weight: Math.max(0, Number(weightFor(item)) || 0),
    }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return items[0] || null;

    let cursor = random() * total;
    for (const entry of weighted) {
      cursor -= entry.weight;
      if (cursor < 0) return entry.item;
    }
    return weighted.at(-1)?.item || null;
  }

  function integerRange(from, to) {
    const values = [];
    for (let value = Math.ceil(from); value <= Math.floor(to); value += 1) values.push(value);
    return values;
  }

  function validPlannedDurations(activity, remaining, available, settings) {
    const minimum = Math.max(1, Math.round(Number(settings.minSession) || 1));
    const maximum = Math.max(minimum, Math.round(Number(settings.maxSession) || minimum));
    const usable = Math.max(0, Math.floor(available));
    if (usable === 0) return [];

    if (activity.category === CATEGORY_REQUIRED) {
      const required = Math.max(0, Math.ceil(remaining));
      if (required === 0) return [];
      if (required <= minimum || usable < minimum) return [Math.min(required, usable)];

      const upper = Math.min(maximum, required, usable);
      const durations = integerRange(minimum, upper).filter((duration) => {
        const after = required - duration;
        return after === 0 || after >= minimum;
      });
      return durations.length ? durations : [upper];
    }

    const capRemaining = Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining)) : Infinity;
    if (capRemaining === 0) return [];
    const upper = Math.min(maximum, usable, capRemaining);
    if (upper <= 0) return [];
    if (upper < minimum || capRemaining <= minimum) return [upper];
    return integerRange(minimum, upper);
  }

  function pickPlannedDuration(activity, remaining, available, settings, random = Math.random) {
    const values = validPlannedDurations(activity, remaining, available, settings);
    if (!values.length) return 0;
    return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
  }

  function eligibleDrawPools(
    activities,
    sessions,
    settings,
    lastOptionalActivityId = null,
    now = new Date()
  ) {
    const day = dateKey(now);
    const available = availableMinutes(settings, now);
    const active = activities.filter((activity) => !activity.banned);
    const required = active.filter(
      (activity) =>
        activity.category === CATEGORY_REQUIRED &&
        requiredRemaining(activity, sessions, day) > 0
    );
    let optional = active.filter(
      (activity) =>
        activity.category === CATEGORY_OPTIONAL &&
        optionalCapRemaining(activity, sessions, day) > 0
    );
    if (optional.length > 1 && lastOptionalActivityId) {
      const withoutLast = optional.filter(
        (candidate) => candidate.id !== lastOptionalActivityId
      );
      if (withoutLast.length) optional = withoutLast;
    }
    const totalRequired = required.reduce(
      (total, activity) => total + requiredRemaining(activity, sessions, day),
      0
    );
    const urgent = Boolean(required.length && totalRequired > available);
    return { day, available, active, required, optional, totalRequired, urgent };
  }

  function activityWheelSegments({
    activities,
    sessions,
    settings,
    lastOptionalActivityId = null,
    now = new Date(),
  }) {
    const { day, available, active, required, optional, totalRequired, urgent } =
      eligibleDrawPools(activities, sessions, settings, lastOptionalActivityId, now);
    if (!required.length && !optional.length) return [];

    if (urgent) {
      return required.map((activity, index) => ({
        activity,
        category: activity.category,
        probability: index === 0 ? 1 : 0,
      })).filter((segment) => segment.probability > 0);
    }

    let probabilityRequired = 0;
    if (!required.length) probabilityRequired = 0;
    else if (!optional.length) probabilityRequired = 1;
    else probabilityRequired = Math.min(1, totalRequired / available);
    const probabilityOptional = 1 - probabilityRequired;

    const segments = [];

    if (required.length) {
      const weighted = required.map((activity) => ({
        activity,
        weight: requiredRemaining(activity, sessions, day),
      }));
      const weightTotal = weighted.reduce((sum, entry) => sum + entry.weight, 0);
      for (const entry of weighted) {
        const share = weightTotal > 0 ? entry.weight / weightTotal : 0;
        segments.push({
          activity: entry.activity,
          category: CATEGORY_REQUIRED,
          probability: probabilityRequired * share,
        });
      }
    }

    if (optional.length) {
      const optionalSpent = active
        .filter((candidate) => candidate.category === CATEGORY_OPTIONAL)
        .reduce(
          (total, candidate) => total + actualMinutesDone(candidate, sessions, day),
          0
        );
      const optionalDayPool = optionalSpent + Math.max(0, available - totalRequired);
      const weighted = optional.map((activity) => ({
        activity,
        weight: Math.max(1, optionalDayPool - actualMinutesDone(activity, sessions, day)),
      }));
      const weightTotal = weighted.reduce((sum, entry) => sum + entry.weight, 0);
      for (const entry of weighted) {
        const share = weightTotal > 0 ? entry.weight / weightTotal : 0;
        segments.push({
          activity: entry.activity,
          category: CATEGORY_OPTIONAL,
          probability: probabilityOptional * share,
        });
      }
    }

    const total = segments.reduce((sum, segment) => sum + segment.probability, 0);
    if (total <= 0) return segments;
    return segments.map((segment) => ({
      ...segment,
      probability: segment.probability / total,
    }));
  }

  function durationWheelSegments(activity, remaining, available, settings) {
    const values = validPlannedDurations(activity, remaining, available, settings);
    if (!values.length) return [];
    const probability = 1 / values.length;
    return values.map((minutes) => ({ minutes, probability }));
  }

  function durationWheelDisplaySegments(settings) {
    const minimum = Math.max(1, Math.round(Number(settings.minSession) || 1));
    const maximum = Math.max(minimum, Math.round(Number(settings.maxSession) || minimum));
    const values = integerRange(minimum, maximum);
    const probability = 1 / values.length;
    return values.map((minutes) => ({ minutes, probability }));
  }

  function drawActivity({
    activities,
    sessions,
    settings,
    lastOptionalActivityId = null,
    now = new Date(),
    random = Math.random,
  }) {
    if (isPauseTime(settings, now)) {
      const available = availableMinutes(settings, now);
      return { ok: false, reason: "pause", available };
    }

    const { day, available, active, required, optional, totalRequired, urgent } =
      eligibleDrawPools(activities, sessions, settings, lastOptionalActivityId, now);

    if (available <= 0) return { ok: false, reason: "day-ended", available };
    if (!required.length && !optional.length) {
      return { ok: false, reason: "nothing-eligible", available, totalRequired };
    }

    let category;
    if (urgent) {
      category = CATEGORY_REQUIRED;
    } else if (!required.length) {
      category = CATEGORY_OPTIONAL;
    } else if (!optional.length) {
      category = CATEGORY_REQUIRED;
    } else {
      category = random() < Math.min(1, totalRequired / available)
        ? CATEGORY_REQUIRED
        : CATEGORY_OPTIONAL;
    }

    let activity;
    let remaining;
    if (category === CATEGORY_REQUIRED) {
      activity = urgent
        ? required[0]
        : weightedPick(
            required,
            (candidate) => requiredRemaining(candidate, sessions, day),
            random
          );
      remaining = requiredRemaining(activity, sessions, day);
    } else {
      if (optional.length > 1 && lastOptionalActivityId) {
        const withoutLast = optional.filter(
          (candidate) => candidate.id !== lastOptionalActivityId
        );
        if (withoutLast.length) optional = withoutLast;
      }
      const optionalSpent = active
        .filter((candidate) => candidate.category === CATEGORY_OPTIONAL)
        .reduce(
          (total, candidate) => total + actualMinutesDone(candidate, sessions, day),
          0
        );
      const optionalDayPool = optionalSpent + Math.max(0, available - totalRequired);
      activity = weightedPick(
        optional,
        (candidate) =>
          Math.max(1, optionalDayPool - actualMinutesDone(candidate, sessions, day)),
        random
      );
      remaining = optionalCapRemaining(activity, sessions, day);
    }

    const plannedMinutes = pickPlannedDuration(
      activity,
      remaining,
      available,
      settings,
      random
    );
    if (!activity || plannedMinutes <= 0) {
      return { ok: false, reason: "no-valid-duration", available, totalRequired };
    }

    return {
      ok: true,
      activity,
      category,
      plannedMinutes,
      urgent,
      available,
      totalRequired,
      requiredProbability:
        required.length && optional.length ? Math.min(1, totalRequired / available) : null,
    };
  }

  function validateSettings(settings) {
    const errors = [];
    const minimum = Number(settings.minSession);
    const maximum = Number(settings.maxSession);
    if (!Number.isInteger(minimum) || minimum < 1) {
      errors.push("La durée minimale doit être un nombre entier positif.");
    }
    if (!Number.isInteger(maximum) || maximum < minimum * 2) {
      errors.push("La durée maximale doit être au moins égale à deux fois la durée minimale.");
    }
    if (hasPauseSchedule(settings)) {
      const start = pauseClock(settings.pauseStart);
      const finish = pauseClock(settings.pauseEnd);
      if (start != null && finish != null && start >= finish) {
        errors.push("La fin de pause doit être postérieure à son début.");
      }
      if (finish != null && parseClock(settings.dayEnd) <= finish) {
        errors.push("La fin de journée doit être postérieure à la fin de pause.");
      }
    }
    return errors;
  }

  const api = {
    CATEGORY_REQUIRED,
    CATEGORY_OPTIONAL,
    activityWheelSegments,
    actualMinutesDone,
    availableMinutes,
    dateKey,
    drawActivity,
    durationWheelDisplaySegments,
    durationWheelSegments,
    isPauseTime,
    optionalCapRemaining,
    parseClock,
    pickPlannedDuration,
    progressMinutes,
    requiredRemaining,
    sessionsForActivity,
    validPlannedDurations,
    validateSettings,
    weightedPick,
  };

  globalScope.CasinoLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
