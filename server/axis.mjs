/**
 * Axis calibration and tick objects (§10.3).
 *
 * Ticks are OBJECTS: a numeric value, its position on the axis, the short stroke
 * and the label are generated together from ONE calibration, so the numbers and
 * the geometry cannot drift apart.
 */

/** Robust linear fit value = a + b * pixel, rejecting gross outliers. */
/** Core one-dimensional linear calibration shared by the x- and y-axes (§6). */
export function calibrateAxis(pairs, options) {
  const opts = options || {};
  const direction = opts.pixelDirection === "y" ? "y" : "x";
  const key = direction === "y" ? "py" : "px";
  const raw = (pairs || []).map((p) => {
    if (Array.isArray(p)) {
      return direction === "y" ? { coord: Number(p[1]), value: Number(p[0]), py: Number(p[1]) } : { coord: Number(p[0]), value: Number(p[1]), px: Number(p[0]) };
    }
    const coord = Number(p[key]);
    const value = Number(p.value);
    return { coord, value, py: Number.isFinite(p.py) ? p.py : coord, px: Number.isFinite(p.px) ? p.px : coord };
  }).filter((p) => Number.isFinite(p.coord) && Number.isFinite(p.value));
  if (raw.length < Math.max(2, opts.minTicks || 2)) return { ok: false, reason: "need at least two readable ticks", ticks: raw, direction };
  const pts = raw;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const fit = (list) => {
    const mc = mean(list.map((p) => p.coord));
    const mv = mean(list.map((p) => p.value));
    let scc = 0, scv = 0;
    for (const p of list) { scc += (p.coord - mc) ** 2; scv += (p.coord - mc) * (p.value - mv); }
    if (Math.abs(scc) < 1e-9) return null;
    const b = scv / scc;
    return { a: mv - b * mc, b };
  };
  let model = fit(pts);
  if (!model) return { ok: false, reason: "all ticks share one position", ticks: pts, direction };
  let kept = pts;
  for (let pass = 0; pass < 2; pass++) {
    const residuals = pts.map((p) => ({ p, r: Math.abs(model.a + model.b * p.coord - p.value) }));
    const scale = Math.max(1e-9, residuals.map((x) => x.r).sort((x, y) => x - y)[Math.floor(residuals.length / 2)] || 0);
    const limit = Math.max((opts.minTolerance || 1) * scale, opts.absTolerance == null ? 0.05 : opts.absTolerance);
    const next = residuals.filter((x) => x.r <= limit).map((x) => x.p);
    if (next.length < 2 || next.length === kept.length) { kept = next.length >= 2 ? next : kept; break; }
    kept = next;
    const again = fit(kept);
    if (!again) break;
    model = again;
  }
  let sse = 0;
  for (const p of kept) sse += (model.a + model.b * p.coord - p.value) ** 2;
  const toValue = (coord) => model.a + model.b * coord;
  const toPixel = (value) => (value - model.a) / model.b;
  return {
    ok: true, a: model.a, b: model.b, direction,
    rmse: Math.sqrt(sse / kept.length),
    ticks: pts, inliers: kept.length, dropped: pts.length - kept.length,
    toValue, toPixel,
    // Explicit aliases that read naturally for the y-axis too.
    pixelToValue: toValue, valueToPixel: toPixel,
  };
}

/** Backward-compatible x-axis wrapper over `calibrateAxis`. */
export function calibrate(pairs, options) {
  const result = calibrateAxis(pairs, Object.assign({}, options || {}, { pixelDirection: "x" }));
  return result;
}

/**
 * Fallback y-axis calibration from two frame edges (§6): top/bottom borders
 * become the two tick positions. Records that the evidence came from the frame.
 */
export function calibrateYFromFrame({ topPx, bottomPx, topValue, bottomValue, rmse = 0.5 }) {
  if (!Number.isFinite(topPx) || !Number.isFinite(bottomPx) || topPx === bottomPx) {
    return { ok: false, reason: "invalid frame positions" };
  }
  const pts = [
    { py: topPx, value: topValue, source: "frame-top" },
    { py: bottomPx, value: bottomValue, source: "frame-bottom" },
  ];
  const cal = calibrateAxis(pts, { pixelDirection: "y" });
  return Object.assign({}, cal, { ok: cal.ok, evidence: "frame" });
}

/** Tick objects: value, axis position, the tick stroke and the label position. */
export function buildTicks(pairs, axis, options) {
  const opts = options || {};
  const calib = calibrate(pairs, opts);
  if (!calib.ok) return { ok: false, reason: calib.reason, ticks: [] };
  const lengthPx = opts.tickLengthPx == null ? 5 : opts.tickLengthPx;
  const ticks = calib.ticks.map((p) => ({
    value: Math.round(calib.toValue(p.px) * 1e6) / 1e6,
    px: p.px,
    py: axis ? axis.y : p.py,
    stroke: axis ? { x1: p.px, y1: axis.y - lengthPx, x2: p.px, y2: axis.y + lengthPx } : null,
    label: { value: calib.toValue(p.px), px: p.px, py: axis ? axis.y + lengthPx * 3 : p.py + 12 },
  }));
  return { ok: true, calibration: calib, ticks };
}

/** Emit the tick strokes; labels stay owned by the label pipeline. */
export function tickTikz(ticks, geometry) {
  const g = geometry || {};
  const widthCm = g.widthCm || 12;
  const heightCm = g.heightCm || 4.2;
  const widthPx = g.widthPx || 909;
  const heightPx = g.heightPx || 326;
  const X = (px) => (px / widthPx) * widthCm;
  const Y = (py) => heightCm - (py / heightPx) * heightCm;
  const out = [];
  for (const t of ticks || []) {
    if (!t.stroke) continue;
    out.push("  \\draw[line width=0.6pt] (" + X(t.stroke.x1).toFixed(3) + "," + Y(t.stroke.y1).toFixed(3) + ") -- (" + X(t.stroke.x2).toFixed(3) + "," + Y(t.stroke.y2).toFixed(3) + ");");
  }
  return out.join("\n");
}