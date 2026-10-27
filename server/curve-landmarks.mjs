/**
 * Sparse curve landmarks and the 12-point control budget (§4, §5).
 *
 * The model may return more than 12 points per series. We must keep the
 * SCIENTIFIC evidence (endpoints, extrema, crossings, plateau edges, strong
 * inflections) and fill the remaining budget by geometric significance. This
 * is the opposite of uniform / every-Nth sampling, which is exactly how a
 * single central dip gets averaged away.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const isFinitePoint = (p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));

/** Sort by x and collapse exact x-duplicates to their mean y. */
export function sortPoints(points) {
  const pts = (points || []).filter(isFinitePoint).map((p) => [Number(p[0]), Number(p[1])]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const p of pts) {
    const last = out.at(-1);
    if (last && Math.abs(last[0] - p[0]) < 1e-6) last[1] = (last[1] + p[1]) / 2;
    else out.push(p.slice());
  }
  return out;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Normalise a plot payload (accepts either `curves` or `series`, plus `relations`). */
export function normalizePlotInput(input) {
  const src = input && Array.isArray(input.curves) ? input.curves : (input && Array.isArray(input.series) ? input.series : []);
  const series = src.filter((c) => c && Array.isArray(c.points) && c.points.length >= 2).map((c, i) => {
    const copy = Object.assign({}, c);
    if (!copy.id) copy.id = "curve" + i;
    copy.points = sortPoints(copy.points);
    copy.landmarks = Array.isArray(copy.landmarks) ? copy.landmarks.map((l) => Object.assign({}, l)).filter((l) => l && l.kind) : [];
    return copy;
  });
  const relations = Array.isArray(input && input.relations) ? input.relations : [];
  return { series, relations };
}

const LANDMARK_KINDS = new Set([
  "left-end", "right-end", "minimum", "maximum", "crossing", "platform-edge",
  "inflection", "axis-contact", "jump", "apex", "shoulder",
]);

/**
 * Validate landmarks/relations. Old plot JSON (no landmarks/relations) remains
 * valid; when the new protocol IS present its references and coordinates are
 * checked strictly.
 */
export function validatePlotModel(input, options) {
  const opts = options || {};
  const strict = opts.strict !== false;
  const { series, relations } = normalizePlotInput(input);
  const errors = [];
  const warnings = [];
  const ids = new Set(series.map((s) => s.id));

  series.forEach((s) => {
    if (strict && s.points.length > 12) {
      warnings.push(`${s.id}: ${s.points.length} points exceed the 12-point budget (will be reduced)`);
    }
    const kinds = new Map();
    (s.landmarks || []).forEach((l, i) => {
      if (!LANDMARK_KINDS.has(l.kind)) errors.push(`${s.id}: unknown landmark kind "${l.kind}"`);
      if (!isFinitePoint(l.point)) errors.push(`${s.id}: landmark #${i} has no finite point`);
      const key = l.kind + "|" + (isFinitePoint(l.point) ? l.point.map((v) => Math.round(v)).join(",") : "x");
      if (kinds.has(key)) errors.push(`${s.id}: duplicate landmark ${l.kind}`);
      kinds.set(key, 1);
      if (isFinitePoint(l.point)) {
        const [x, y] = l.point.map(Number);
        if (x < -200 || x > 1200 || y < -200 || y > 1200) errors.push(`${s.id}: landmark out of normalised bounds ${x},${y}`);
      }
    });
  });

  (relations || []).forEach((r, i) => {
    if (!r || !r.kind) { errors.push(`relations[${i}]: missing kind`); return; }
    if (!["vertical-order", "axis-contact", "crossing", "same-extremum"].includes(r.kind)) {
      errors.push(`relations[${i}]: unsupported relation kind "${r.kind}"`);
    }
    const refs = [r.seriesId, r.aboveSeriesId, r.belowSeriesId, r.withSeriesId].filter(Boolean);
    refs.forEach((id) => {
      if (typeof id === "string" && !ids.has(id)) errors.push(`relations[${i}]: unknown seriesId "${id}"`);
    });
    if (r.kind === "vertical-order" && (!r.aboveSeriesId || !r.belowSeriesId)) {
      errors.push(`relations[${i}]: vertical-order requires aboveSeriesId and belowSeriesId`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

function nearestIndex(pts, p, tolerance) {
  let best = -1, bestD = Infinity;
  pts.forEach((q, i) => {
    const d = distance(q, p);
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= (tolerance == null ? 6 : tolerance) ? best : -1;
}

/**
 * Reduce a series to at most 12 control points while preserving the mandatory
 * scientific landmarks. Returns { points, landmarks, dropped, preservedKinds,
 * extremumError }.
 */
export function selectControlPoints(curve, options) {
  const opts = options || {};
  const budget = Math.max(6, Math.min(12, opts.budget == null ? 12 : opts.budget));
  const snap = opts.snapTolerance == null ? 6 : opts.snapTolerance;
  const original = sortPoints(curve && curve.points);
  const landmarks = Array.isArray(curve && curve.landmarks) ? curve.landmarks.filter((l) => l && isFinitePoint(l.point)) : [];
  if (original.length < 2) return { points: original, landmarks, dropped: 0, preservedKinds: [], extremumError: null };

  // Build a working point set that also contains landmark points the model may
  // have reported separately from the dense point list.
  const pts = original.map((p) => ({ point: p.slice(), source: "point", idx: -1 }));
  const landmarkIdx = [];
  landmarks.forEach((l) => {
    const p = l.point.map(Number);
    const hit = nearestIndex(pts.map((x) => x.point), p, snap);
    if (hit >= 0) { landmarkIdx.push(hit); pts[hit].landmarkKinds = (pts[hit].landmarkKinds || []).concat(l.kind); }
    else { landmarkIdx.push(pts.length); pts.push({ point: p, source: "landmark", landmarkKinds: [l.kind] }); }
  });

  // Sort again after landmark injection.
  pts.sort((a, b) => a.point[0] - b.point[0] || a.point[1] - b.point[1]);
  const pointAt = (i) => pts[i].point;

  // Global extrema in pixel space (y down) always survive.
  let minIdx = 0, maxIdx = 0;
  pts.forEach((entry, i) => {
    if (entry.point[1] < pointAt(minIdx)[1]) minIdx = i;
    if (entry.point[1] > pointAt(maxIdx)[1]) maxIdx = i;
  });
  const endpoints = new Set([0, pts.length - 1]);
  endpoints.add(minIdx); endpoints.add(maxIdx);

  // Slope sign changes = missed local extrema.
  const slopeExtrema = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const d1 = pointAt(i)[1] - pointAt(i - 1)[1];
    const d2 = pointAt(i + 1)[1] - pointAt(i)[1];
    if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) slopeExtrema.push(i);
  }

  const mandatory = new Set(endpoints);
  landmarkIdx.forEach((i) => mandatory.add(i));
  slopeExtrema.forEach((i) => mandatory.add(i));

  // Geometric significance for filling the remaining budget: distance from the
  // chord between the two nearest neighbours, normalised by their distance.
  const significance = (i) => {
    if (i <= 0 || i >= pts.length - 1) return 0;
    const a = pointAt(i - 1), b = pointAt(i), c = pointAt(i + 1);
    const ab = distance(a, b), bc = distance(b, c);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return area / Math.max(1e-6, ab + bc);
  };

  const chosen = [];
  for (const i of mandatory) chosen.push(i);
  const pool = [];
  for (let i = 0; i < pts.length; i++) if (!mandatory.has(i)) pool.push(i);
  pool.sort((a, b) => significance(b) - significance(a));
  let cursor = 0;
  while (chosen.length < budget && cursor < pool.length) {
    const i = pool[cursor++];
    if (!chosen.includes(i)) chosen.push(i);
  }

  // Never delete endpoints or the global extrema, even when mandatory itself
  // exceeds the budget.
  const protectedSet = new Set([...endpoints]);
  const protectedList = [...protectedSet].filter((i) => !chosen.includes(i));
  if (chosen.length + protectedList.length > budget) {
    // Drop the least significant non-protected mandatory points first.
    const protectedIndices = new Set(protectedList.concat([...protectedSet]));
    chosen.sort((a, b) => (protectedIndices.has(a) ? -1e9 : significance(a)) - (protectedIndices.has(b) ? -1e9 : significance(b)));
    chosen.length = budget;
    for (const i of protectedList) if (!chosen.includes(i) && chosen.length < budget) chosen.push(i);
  } else {
    for (const i of protectedList) chosen.push(i);
  }

  const keptIndices = [...new Set(chosen)].sort((a, b) => pts[a].point[0] - pts[b].point[0] || pts[a].point[1] - pts[b].point[1]);
  const keptPoints = keptIndices.map((i) => pts[i].point.slice());

  // Measure the change of the global extremum.
  const beforeExt = { min: pointAt(minIdx).slice(), max: pointAt(maxIdx).slice() };
  let afterMin = keptPoints[0], afterMax = keptPoints[0];
  for (const p of keptPoints) {
    if (p[1] < afterMin[1]) afterMin = p;
    if (p[1] > afterMax[1]) afterMax = p;
  }
  const extremumError = {
    minShift: distance(beforeExt.min, afterMin),
    maxShift: distance(beforeExt.max, afterMax),
  };

  const preservedKinds = landmarks.filter((l) => {
    return keptPoints.some((p) => distance(p, l.point.map(Number)) <= snap);
  }).map((l) => l.kind);

  return {
    points: keptPoints,
    landmarks,
    dropped: Math.max(0, original.length - keptPoints.length),
    preservedKinds: [...new Set(preservedKinds)],
    extremumError,
  };
}

/** Budget every series, attaching the reduced points back onto the series. */
export function budgetSeries(series, options) {
  return (series || []).map((curve) => {
    const reduced = selectControlPoints(curve, options);
    return Object.assign({}, curve, {
      points: reduced.points,
      controlPoints: reduced.points,
      landmarks: reduced.landmarks,
      dropped: reduced.dropped,
      preservedKinds: reduced.preservedKinds,
      extremumError: reduced.extremumError,
    });
  });
}