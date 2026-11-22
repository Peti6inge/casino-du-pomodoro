(function attachCasinoWheel(globalScope) {
  "use strict";

  const CATEGORY_REQUIRED = "required";
  const SIZE = 240;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const OUTER_OUT = 112;
  const OUTER_IN = 78;
  const INNER_R = 70;
  const INNER_LABEL_R = INNER_R * 0.78;
  const OUTER_LABEL_R = (OUTER_OUT + OUTER_IN) / 2;
  const INNER_POINTER = 0;
  const OUTER_POINTER = 0;
  const DURATION_PALETTE_STEPS = 6;

  let innerGroup = null;
  let innerLabelsGroup = null;
  let outerLabelsGroup = null;
  let outerGroup = null;
  let innerLayout = [];
  let outerLayout = [];
  let innerRotation = 0;
  let outerRotation = 0;
  let audioContext = null;

  const DURATION_STEP_COLORS = [
    { r: 26, g: 178, b: 112 },
    { r: 58, g: 184, b: 98 },
    { r: 118, g: 176, b: 74 },
    { r: 198, g: 152, b: 58 },
    { r: 228, g: 98, b: 72 },
    { r: 224, g: 58, b: 78 },
  ];

  function polar(radius, degrees) {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return {
      x: CX + radius * Math.cos(radians),
      y: CY + radius * Math.sin(radians),
    };
  }

  function wedgePath(radius, start, end) {
    const startPoint = polar(radius, start);
    const endPoint = polar(radius, end);
    const large = end - start > 180 ? 1 : 0;
    return `M ${CX} ${CY} L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${large} 1 ${endPoint.x} ${endPoint.y} Z`;
  }

  function isFullSweep(start, end) {
    return end - start >= 359.5;
  }

  function fullRingPath(rOut, rIn) {
    return [
      `M ${CX} ${CY - rOut}`,
      `A ${rOut} ${rOut} 0 1 1 ${CX} ${CY + rOut}`,
      `A ${rOut} ${rOut} 0 1 1 ${CX} ${CY - rOut}`,
      `M ${CX} ${CY - rIn}`,
      `A ${rIn} ${rIn} 0 1 0 ${CX} ${CY + rIn}`,
      `A ${rIn} ${rIn} 0 1 0 ${CX} ${CY - rIn}`,
      "Z",
    ].join(" ");
  }

  function ringPath(rOut, rIn, start, end) {
    const startOut = polar(rOut, start);
    const endOut = polar(rOut, end);
    const startIn = polar(rIn, end);
    const endIn = polar(rIn, start);
    const large = end - start > 180 ? 1 : 0;
    return [
      `M ${startOut.x} ${startOut.y}`,
      `A ${rOut} ${rOut} 0 ${large} 1 ${endOut.x} ${endOut.y}`,
      `L ${startIn.x} ${startIn.y}`,
      `A ${rIn} ${rIn} 0 ${large} 0 ${endIn.x} ${endIn.y}`,
      "Z",
    ].join(" ");
  }

  function layoutSegments(segments, pickKey) {
    let cursor = 0;
    return segments.map((segment) => {
      const sweep = segment.probability * 360;
      const start = cursor;
      const end = cursor + sweep;
      const layout = {
        ...segment,
        start,
        end,
        mid: start + sweep / 2,
        key: pickKey(segment),
      };
      cursor = end;
      return layout;
    });
  }

  function truncate(text, max = 11) {
    const value = String(text || "");
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
  }

  function labelAt(radius, angle, value, className, { upright = false } = {}) {
    const point = polar(radius, angle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", point.x.toFixed(1));
    text.setAttribute("y", point.y.toFixed(1));
    text.setAttribute("class", className);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    if (!upright) {
      text.setAttribute("transform", `rotate(${angle + 90} ${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
    }
    text.textContent = value;
    return text;
  }

  function updateInnerLabels() {
    if (!innerLabelsGroup) return;
    innerLabelsGroup.replaceChildren();
    innerLayout.forEach((segment) => {
      const emoji = String(segment.activity.emoji || "").trim();
      const wheelLabel = emoji || truncate(segment.activity.name);
      const minSweep = emoji ? 7 : 14;
      if (segment.end - segment.start < minSweep) return;
      const screenAngle = segment.mid + innerRotation;
      innerLabelsGroup.appendChild(
        labelAt(
          INNER_LABEL_R,
          screenAngle,
          wheelLabel,
          emoji ? "wheel-label inner emoji" : "wheel-label inner",
          { upright: true }
        )
      );
    });
  }

  const REQUIRED_FILL = "#d9566a";
  const OPTIONAL_FILL = "#3cb894";

  function fillInner(segment) {
    return segment.category === CATEGORY_REQUIRED ? REQUIRED_FILL : OPTIONAL_FILL;
  }

  function durationFill(minutes, minMinutes, maxMinutes) {
    const span = Math.max(1, maxMinutes - minMinutes);
    const ratio = Math.max(0, Math.min(1, (minutes - minMinutes) / span));
    const stepIndex = Math.min(
      DURATION_PALETTE_STEPS - 1,
      Math.floor(ratio * DURATION_PALETTE_STEPS)
    );
    const color = DURATION_STEP_COLORS[stepIndex];
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  function paintInner(group, segments) {
    group.replaceChildren();
    innerLayout = layoutSegments(segments, (segment) => segment.activity.id);
    const solo = innerLayout.length === 1;
    innerLayout.forEach((segment) => {
      const shape = document.createElementNS("http://www.w3.org/2000/svg", isFullSweep(segment.start, segment.end) ? "circle" : "path");
      if (shape.tagName === "circle") {
        shape.setAttribute("cx", CX);
        shape.setAttribute("cy", CY);
        shape.setAttribute("r", INNER_R);
      } else {
        shape.setAttribute("d", wedgePath(INNER_R, segment.start, segment.end));
      }
      shape.setAttribute("fill", fillInner(segment));
      if (!solo) {
        shape.setAttribute("stroke", "rgba(255,255,255,0.85)");
        shape.setAttribute("stroke-width", "1.5");
      }
      group.appendChild(shape);
    });
    updateInnerLabels();
  }

  function paintOuter(group, segments) {
    group.replaceChildren();
    outerLayout = layoutSegments(segments, (segment) => segment.minutes);
    const minutes = segments.map((segment) => segment.minutes);
    const minMinutes = Math.min(...minutes);
    const maxMinutes = Math.max(...minutes);
    const solo = outerLayout.length === 1;
    outerLayout.forEach((segment) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const full = isFullSweep(segment.start, segment.end);
      path.setAttribute(
        "d",
        full
          ? fullRingPath(OUTER_OUT, OUTER_IN)
          : ringPath(OUTER_OUT, OUTER_IN, segment.start, segment.end)
      );
      if (full) path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("fill", durationFill(segment.minutes, minMinutes, maxMinutes));
      if (!solo) {
        path.setAttribute("stroke", "rgba(255,255,255,0.85)");
        path.setAttribute("stroke-width", "1.3");
      }
      group.appendChild(path);
    });
    updateOuterLabels();
  }

  function updateOuterLabels() {
    if (!outerLabelsGroup) return;
    outerLabelsGroup.replaceChildren();
    outerLayout.forEach((segment) => {
      if (segment.end - segment.start < 8) return;
      outerLabelsGroup.appendChild(
        labelAt(
          OUTER_LABEL_R,
          segment.mid + outerRotation,
          `${segment.minutes}`,
          "wheel-label outer",
          { upright: true }
        )
      );
    });
  }

  function mount() {
    const outerSvg = document.getElementById("wheelOuter");
    const innerSvg = document.getElementById("wheelInner");
    if (!outerSvg || !innerSvg) return;
    outerGroup = outerSvg.querySelector("[data-wheel-rotor]");
    outerLabelsGroup = outerSvg.querySelector("[data-wheel-labels]");
    innerGroup = innerSvg.querySelector("[data-wheel-rotor]");
    innerLabelsGroup = innerSvg.querySelector("[data-wheel-labels]");
    applyRotation();
  }

  function applyRotation() {
    if (innerGroup) innerGroup.setAttribute("transform", `rotate(${innerRotation} ${CX} ${CY})`);
    if (outerGroup) outerGroup.setAttribute("transform", `rotate(${outerRotation} ${CX} ${CY})`);
    updateInnerLabels();
    updateOuterLabels();
  }

  function paint({ activitySegments, durationSegments, preserveRotation = false }) {
    if (!innerGroup || !outerGroup) return;
    if (activitySegments.length) paintInner(innerGroup, activitySegments);
    else {
      innerGroup.replaceChildren();
      innerLayout = [];
      updateInnerLabels();
    }
    if (durationSegments.length) paintOuter(outerGroup, durationSegments);
    else {
      outerGroup.replaceChildren();
      outerLayout = [];
      updateOuterLabels();
    }
    if (!preserveRotation) {
      innerRotation = 0;
      outerRotation = 0;
    }
    applyRotation();
  }

  function paintIdle(options) {
    paint(options);
  }

  function playClick() {
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 980;
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      const now = audioContext.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      oscillator.start(now);
      oscillator.stop(now + 0.05);
    } catch (error) {
      /* silence si audio indisponible */
    }
  }

  function easeOutSuspense(progress) {
    return 1 - (1 - progress) ** 5.2;
  }

  function spinDurationMs() {
    return 7000 + Math.random() * 2000;
  }

  function targetRotationClockwise(segmentMid, pointerDeg, startRotation, fullTurns) {
    const targetMod = ((pointerDeg - segmentMid) % 360 + 360) % 360;
    const startMod = ((startRotation % 360) + 360) % 360;
    let delta = targetMod - startMod;
    if (delta <= 0) delta += 360;
    return startRotation + fullTurns * 360 + delta;
  }

  function targetRotationCounterClockwise(segmentMid, pointerDeg, startRotation, fullTurns) {
    const targetMod = ((pointerDeg - segmentMid) % 360 + 360) % 360;
    const startMod = ((startRotation % 360) + 360) % 360;
    let delta = startMod - targetMod;
    if (delta <= 0) delta += 360;
    return startRotation - fullTurns * 360 - delta;
  }

  function segmentIndexAtPointer(layout, rotation, pointerDeg) {
    const local = ((pointerDeg - rotation) % 360 + 360) % 360;
    for (let index = 0; index < layout.length; index += 1) {
      const segment = layout[index];
      if (local >= segment.start && local < segment.end) return index;
    }
    return layout.length ? layout.length - 1 : -1;
  }

  function normalizeRotation(rotation) {
    return ((rotation % 360) + 360) % 360;
  }

  function snapRotation(segmentMid, pointerDeg, rotation) {
    const targetMod = ((pointerDeg - segmentMid) % 360 + 360) % 360;
    return rotation - normalizeRotation(rotation) + targetMod;
  }

  function animateSingleWheel({
    layout,
    segmentMid,
    pointerDeg,
    getStartRotation,
    setRotation,
    fullTurns,
    durationMs,
    counterClockwise = false,
  }) {
    return new Promise((resolve) => {
      const startRotation = getStartRotation();
      const endRotation = counterClockwise
        ? targetRotationCounterClockwise(segmentMid, pointerDeg, startRotation, fullTurns)
        : targetRotationClockwise(segmentMid, pointerDeg, startRotation, fullTurns);
      const startTime = performance.now();
      let lastIndex = segmentIndexAtPointer(layout, startRotation, pointerDeg);

      function frame(now) {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easeOutSuspense(progress);
        const rotation = startRotation + (endRotation - startRotation) * eased;
        setRotation(rotation);

        const index = segmentIndexAtPointer(layout, rotation, pointerDeg);
        if (index !== lastIndex) {
          lastIndex = index;
          playClick();
        }

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          const snapped = snapRotation(segmentMid, pointerDeg, endRotation);
          setRotation(snapped);
          resolve();
        }
      }

      requestAnimationFrame(frame);
    });
  }

  function spin({ activitySegments, durationSegments, targetActivityId, targetMinutes }) {
    return new Promise((resolve) => {
      paintInner(innerGroup, activitySegments);

      const innerTarget = innerLayout.find((segment) => segment.key === targetActivityId);
      if (!innerTarget) {
        resolve();
        return;
      }

      const innerTurns = 5 + Math.floor(Math.random() * 2);
      const outerTurns = 5 + Math.floor(Math.random() * 2);

      animateSingleWheel({
        layout: innerLayout,
        segmentMid: innerTarget.mid,
        pointerDeg: INNER_POINTER,
        getStartRotation: () => innerRotation,
        setRotation: (value) => {
          innerRotation = value;
          applyRotation();
        },
        fullTurns: innerTurns,
        durationMs: spinDurationMs(),
        counterClockwise: false,
      })
        .then(() => {
          paintOuter(outerGroup, durationSegments);
          const outerTarget = outerLayout.find((segment) => segment.key === targetMinutes);
          if (!outerTarget) return undefined;
          return animateSingleWheel({
            layout: outerLayout,
            segmentMid: outerTarget.mid,
            pointerDeg: OUTER_POINTER,
            getStartRotation: () => outerRotation,
            setRotation: (value) => {
              outerRotation = value;
              applyRotation();
            },
            fullTurns: outerTurns,
            durationMs: spinDurationMs(),
            counterClockwise: true,
          });
        })
        .then(resolve);
    });
  }

  globalScope.CasinoWheel = {
    mount,
    paint,
    paintIdle,
    spin,
  };
})(typeof window !== "undefined" ? window : globalThis);