/**
 * Structural relation checks and the hard gate that runs AFTER compilation and
 * BEFORE the whole-image reviewer (§8, §9). The whole-image score is soft; a
 * wrong local relation (a dip that sits above the plateau, or that misses the
 * zero axis) must fail on its own.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function pointAt(series, x) {
  const pts = (series.points || []).slice().sort((a, b) => a[0] - b[0]);
  if (!pts.length) return NaN;
  if (typeof series.evalPixel === "function") {
    const v = series.evalPixel(x);
    return Number.isFinite(v) ? v : NaN;
  }
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  let i = 1;
  while (i < pts.length - 1 && pts[i][0] < x) i++;
  const a = pts[i - 1], b = pts[i];
  const t = (x - a[0]) / Math.max(1e-9, b[0] - a[0]);
  return a[1] + t * (b[1] - a[1]);
}

function valueAt(series, x, space, yCalibration) {
  const py = pointAt(series, x);
  if (!Number.isFinite(py)) return NaN;
  if (space === "data" && yCalibration && typeof yCalibration.toValue === "function") return yCalibration.toValue(py);
  return py;
}

function extremumOf(series, at, kind) {
  const pts = (series.points || []).slice().sort((a, b) => a[0] - b[0]);
  if (!pts.length) return null;
  if (at && Array.isArray(at.point)) {
    const x = Number(at.point[0]);
    let best = pts[0];
    pts.forEach((p) => { if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p; });
    return { x: best[0], y: best[1] };
  }
  let best = pts[0];
  for (const p of pts) {
    if (kind === "maximum" ? p[1] > best[1] : p[1] < best[1]) best = p;
  }
  return { x: best[0], y: best[1] };
}

function relationError(code, message, detail) {
  return { code, message, ...(detail || {}) };
}

/**
 * Evaluate structural relations over a series map.
 * series: array of { id, points, continuous, landmarks, evalPixel? }.
 * yCalibration: { toValue, toPixel, rmse, ok } (data = value, pixel = image y down).
 */
export function evaluateRelations({ series, relations, yCalibration, coordinateSpace, options }) {
  const opts = options || {};
  const space = coordinateSpace || (yCalibration && yCalibration.ok ? "data" : "pixel");
  const byId = new Map((series || []).map((s) => [s.id, s]));
  const checks = [];
  const failures = [];

  (relations || []).forEach((rel, i) => {
    const tag = rel.id || `relations[${i}]`;
    if (rel.kind === "vertical-order") {
      const above = byId.get(rel.aboveSeriesId);
      const below = byId.get(rel.belowSeriesId);
      if (!above || !below) return;
      const atKind = (rel.at && rel.at.kind === "maximum") ? "maximum" : "minimum";
      const ex = extremumOf(below, rel.at, atKind);
      if (!ex) return;
      const yA = valueAt(above, ex.x, space, yCalibration);
      const yB = valueAt(below, ex.x, space, yCalibration);
      const margin = space === "data"
        ? (Number(rel.marginValue) || 0)
        : (Number(rel.marginPx) || opts.defaultMarginPx || 4);
      const gap = space === "data" ? yA - yB : yB - yA;
      const ok = gap >= margin - 1e-9;
      const check = { tag, kind: "vertical-order", ok, gap, margin, x: ex.x, yBelow: yB, yAbove: yA, space };
      checks.push(check);
      if (!ok) {
        failures.push(relationError("VERTICAL_ORDER", [
          `${below.id} ${atKind} is ${space === "data" ? "above" : "below"} ${above.id} by`,
          `${Math.abs(gap).toFixed(1)} (needs at least ${margin}), near x=${(ex.x).toFixed(1)} in ${space} space`,
        ].join(" "), check));
      }
      return;
    }

    if (rel.kind === "axis-contact") {
      const s = byId.get(rel.seriesId);
      if (!s) return;
      const kind = (rel.at && rel.at.kind === "maximum") ? "maximum" : "minimum";
      const ex = extremumOf(s, rel.at, kind);
      if (!ex) return;
      if (!yCalibration || !yCalibration.ok) {
        const check = { tag, kind: "axis-contact", ok: false, x: ex.x, y: ex.y, value: rel.value, reason: "y-axis not calibrated" };
        checks.push(check);
        failures.push(relationError("AXIS_CONTACT", `cannot check ${s.id} ${kind}: y-axis calibration unavailable`, check));
        return;
      }
      const actual = yCalibration.toValue(ex.y);
      const tolerance = Number(rel.tolerance) || opts.axisTolerance || Math.max(0.02, (yCalibration.rmse || 0.5) * 2);
      const ok = Math.abs(actual - Number(rel.value)) <= tolerance;
      const check = { tag, kind: "axis-contact", ok, actual, expected: Number(rel.value), tolerance, x: ex.x, y: ex.y };
      checks.push(check);
      if (!ok) {
        failures.push(relationError("AXIS_CONTACT", `${s.id} ${kind} value ${actual.toFixed(3)} is ${Math.abs(actual - Number(rel.value)).toFixed(3)} from expected ${rel.value}`, check));
      }
      return;
    }

    if (rel.kind === "crossing") {
      const a = byId.get(rel.seriesId);
      const b = byId.get(rel.withSeriesId);
      if (!a || !b) return;
      const check = { tag, kind: "crossing", ok: true, note: "crossing count checked by the sparse evidence" };
      checks.push(check);
      return;
    }

    if (rel.kind === "same-extremum") {
      const a = byId.get(rel.seriesId);
      const b = byId.get(rel.withSeriesId);
      if (!a || !b) return;
      const ea = extremumOf(a, rel.at, "minimum");
      const eb = extremumOf(b, rel.at, "minimum");
      const dx = ea && eb ? Math.abs(ea.x - eb.x) : Infinity;
      const tolerance = Number(rel.tolerancePx) || opts.extremumTolerancePx || 8;
      const ok = dx <= tolerance;
      const check = { tag, kind: "same-extremum", ok, dx, tolerance };
      checks.push(check);
      if (!ok) failures.push(relationError("SAME_EXTREMUM", `extremum x positions differ by ${dx.toFixed(1)} px`, check));
      return;
    }
  });

  return { ok: failures.length === 0, checks, failures, space };
}

/** One concise, quantitative retry hint (never a vague "it looks wrong"). */
export function relationFeedback(result) {
  const parts = (result && result.failures || []).map((f) => f.message);
  return parts.length ? "curve relation failed: " + parts.join("; ") : "";
}

/**
 * Continuity check over sparse control points. A steep peak is NOT a gap; only
 * an explicit discontinuity or an implausibly wide x-gap breaks a continuous
 * series (§4, §8).
 */
export function checkContinuity(series, options) {
  const opts = options || {};
  const pts = (series.points || []).slice().sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return { ok: true, gaps: [] };
  if (series.continuous === false || series.discontinuous === true) return { ok: true, gaps: [] };
  const lo = pts[0][0], hi = pts[pts.length - 1][0];
  const span = Math.max(1e-9, hi - lo);
  const maxGap = opts.maxGapRatio == null ? 0.35 : opts.maxGapRatio;
  const gaps = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    if (dx > span * maxGap) gaps.push({ from: pts[i - 1], to: pts[i], ratio: dx / span });
  }
  return { ok: gaps.length === 0, gaps };
}

/** Local review boxes for the high-confidence relations (§9). */
export function planLocalReviews(series, relations, options) {
  const opts = options || {};
  const radius = opts.radiusPx == null ? 60 : opts.radiusPx;
  const byId = new Map((series || []).map((s) => [s.id, s]));
  const boxes = [];
  (relations || []).forEach((rel) => {
    let x = null, y = null;
    if (rel.at && Array.isArray(rel.at.point)) { x = rel.at.point[0]; y = rel.at.point[1]; }
    else if (rel.seriesId && byId.has(rel.seriesId)) {
      const ex = extremumOf(byId.get(rel.seriesId), rel.at, "minimum");
      if (ex) { x = ex.x; y = ex.y; }
    }
    if (x == null || y == null) return;
    boxes.push({ kind: rel.kind, seriesId: rel.seriesId, box: [Math.max(0, x - radius), Math.max(0, y - radius), radius * 2, radius * 2], question: localQuestion(rel) });
  });
  return boxes;
}

function localQuestion(rel) {
  if (rel.kind === "vertical-order") return "Is the lower series clearly below the upper series here?";
  if (rel.kind === "axis-contact") return "Does the curve touch the stated axis value here?";
  if (rel.kind === "crossing") return "Do the two curves cross here, and only here?";
  return "Does the local structure match the source image?";
}