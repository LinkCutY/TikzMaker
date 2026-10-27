/**
 * Axis calibration and tick objects (§10.3).
 *
 * Ticks are OBJECTS: a numeric value, its position on the axis, the short stroke
 * and the label are generated together from ONE calibration, so the numbers and
 * the geometry cannot drift apart.
 */

/** Robust linear fit value = a + b * pixel, rejecting gross outliers. */
export function calibrate(pairs, options) {
  const opts = options || {};
  const pts = (pairs || []).filter((p) => Number.isFinite(p.px) && Number.isFinite(p.value));
  if (pts.length < 2) return { ok: false, reason: "need at least two readable ticks", ticks: pts };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const fit = (list) => {
    const mx = mean(list.map((p) => p.px));
    const my = mean(list.map((p) => p.value));
    let sxx = 0, sxy = 0;
    for (const p of list) { sxx += (p.px - mx) ** 2; sxy += (p.px - mx) * (p.value - my); }
    if (Math.abs(sxx) < 1e-9) return null;
    const b = sxy / sxx;
    return { a: my - b * mx, b };
  };
  let model = fit(pts);
  if (!model) return { ok: false, reason: "all ticks share one position", ticks: pts };
  let kept = pts;
  for (let pass = 0; pass < 2; pass++) {
    const residuals = pts.map((p) => ({ p, r: Math.abs(model.a + model.b * p.px - p.value) }));
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
  for (const p of kept) sse += (model.a + model.b * p.px - p.value) ** 2;
  return {
    ok: true, a: model.a, b: model.b,
    rmse: Math.sqrt(sse / kept.length),
    ticks: pts, inliers: kept.length, dropped: pts.length - kept.length,
    toValue: (px) => model.a + model.b * px,
    toPixel: (value) => (value - model.a) / model.b,
  };
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