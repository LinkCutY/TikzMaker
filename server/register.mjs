/**
 * Shared reference frame + key-point registration.
 *
 * Every sub-agent draws in its own local units. Instead of trusting those units,
 * each region is registered onto the figure by a few NAMED key points: the model
 * reports where its own landmarks are, we fit one similarity transform, drop the
 * gross outliers, and require the remaining residual to stay under a threshold.
 * That is how a human checks a drawing: a reference object first, then a few
 * characteristic points - never every pixel.
 */

/** The one coordinate frame every sub-agent shares. */
export function referenceFrame(raster, frameInfo, axis) {
  const w = raster.w, h = raster.h;
  const frame = {
    widthPx: w,
    heightPx: h,
    // normalised 0..1000, origin top-left, y down (the contract every agent uses)
    box: frameInfo && frameInfo.bounds
      ? {
        x0: (frameInfo.bounds.x0 / w) * 1000, y0: (frameInfo.bounds.y0 / h) * 1000,
        x1: (frameInfo.bounds.x1 / w) * 1000, y1: (frameInfo.bounds.y1 / h) * 1000,
      }
      : { x0: 0, y0: 0, x1: 1000, y1: 1000 },
    axis: axis ? { y: (axis.y / h) * 1000, x0: (axis.x0 / w) * 1000, x1: (axis.x1 / w) * 1000 } : null,
  };
  return frame;
}

/** Named anchors of a region, in global normalised coordinates. */
export function regionAnchors(raster, region) {
  const w = raster.w, h = raster.h;
  const b = region.box;
  const toPx = (v, total) => (v / 1000) * total;
  const x0 = Math.max(0, Math.floor(toPx(b[0], w))), x1 = Math.min(w - 1, Math.ceil(toPx(b[0] + b[2], w)));
  const y0 = Math.max(0, Math.floor(toPx(b[1], h))), y1 = Math.min(h - 1, Math.ceil(toPx(b[1] + b[3], h)));
  const lum = (i) => (raster.rgb[i] * 299 + raster.rgb[i + 1] * 587 + raster.rgb[i + 2] * 114) / 1000;
  let left = null, right = null, top = null, bottom = null;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (lum((y * w + x) * 3) >= 200) continue;
      if (!left || x < left.x) left = { x, y };
      if (!right || x > right.x) right = { x, y };
      if (!top || y < top.y) top = { x, y };
      if (!bottom || y > bottom.y) bottom = { x, y };
    }
  }
  const norm = (p) => (p ? [Math.round((p.x / w) * 1000), Math.round((p.y / h) * 1000)] : null);
  const anchors = [];
  if (left) anchors.push({ name: "leftmost", at: norm(left) });
  if (right) anchors.push({ name: "rightmost", at: norm(right) });
  if (top) anchors.push({ name: "topmost", at: norm(top) });
  if (bottom) anchors.push({ name: "bottommost", at: norm(bottom) });
  return anchors;
}

/** Fit q = s*p + t (isotropic, no rotation) with outlier rejection. */
export function fitSimilarity(pairs, options) {
  const opts = options || {};
  const pts = (pairs || []).filter((p) => p && p[0] && p[1]);
  if (pts.length < 2) return { ok: false, reason: "need at least 2 key points", s: 1, tx: 0, ty: 0, residual: Infinity, inliers: [] };
  const solve = (list) => {
    const n = list.length;
    const mp = list.reduce((acc, p) => [acc[0] + p[0][0] / n, acc[1] + p[0][1] / n], [0, 0]);
    const mq = list.reduce((acc, p) => [acc[0] + p[1][0] / n, acc[1] + p[1][1] / n], [0, 0]);
    let num = 0, den = 0;
    for (const [p, q] of list) {
      num += (p[0] - mp[0]) * (q[0] - mq[0]) + (p[1] - mp[1]) * (q[1] - mq[1]);
      den += (p[0] - mp[0]) ** 2 + (p[1] - mp[1]) ** 2;
    }
    const s = den > 1e-6 ? num / den : 1;
    return { s, tx: mq[0] - s * mp[0], ty: mq[1] - s * mp[1] };
  };
  let model = solve(pts);
  const errOf = (p) => {
    const dx = model.s * p[0][0] + model.tx - p[1][0];
    const dy = model.s * p[0][1] + model.ty - p[1][1];
    return Math.hypot(dx, dy);
  };
  // Trimmed least squares: repeatedly drop the worst key point and refit. A
  // single bad correspondence moves the whole fit, so it must be removed, not
  // averaged in.
  let active = pts.slice();
  for (let round = 0; round < 6 && active.length > 2; round++) {
    model = solve(active);
    const worst = active.slice().sort((a, b) => errOf(b) - errOf(a))[0];
    if (errOf(worst) <= (opts.minTolerance || 6)) break;
    active = active.filter((p) => p !== worst);
  }
  model = solve(active);
  const inliers = active;
  const residual = inliers.length ? Math.sqrt(inliers.reduce((s, p) => s + errOf(p) ** 2, 0) / inliers.length) : Infinity;
  return {
    ok: inliers.length >= 2 && residual <= (opts.maxResidual == null ? 18 : opts.maxResidual),
    s: model.s, tx: model.tx, ty: model.ty, residual, inliers, dropped: pts.length - inliers.length,
    solvedOn: active,
  };
}

function median(a) {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
}

/** Apply the fitted transform to an element's key points (in place, safe copy). */
export function applySimilarity(el, model) {
  const map = (p) => [model.s * p[0] + model.tx, model.s * p[1] + model.ty];
  const out = Object.assign({}, el);
  if (el.kind === "line") {
    const a = map([el.x1, el.y1]); const b = map([el.x2, el.y2]);
    out.x1 = a[0]; out.y1 = a[1]; out.x2 = b[0]; out.y2 = b[1];
  } else if (el.kind === "text" && Array.isArray(el.box)) {
    const c = map([el.box[0] + el.box[2] / 2, el.box[1] + el.box[3] / 2]);
    const w2 = el.box[2] * Math.abs(model.s), h2 = el.box[3] * Math.abs(model.s);
    out.box = [c[0] - w2 / 2, c[1] - h2 / 2, w2, h2];
  } else if (el.kind === "polyline" && Array.isArray(el.points)) {
    out.points = el.points.map(map);
  } else if (Number.isFinite(Number(el.cx))) {
    const c = map([el.cx, el.cy]);
    out.cx = c[0]; out.cy = c[1];
    if (el.r) out.r = el.r * Math.abs(model.s);
    if (el.rx) out.rx = el.rx * Math.abs(model.s);
    if (el.ry) out.ry = el.ry * Math.abs(model.s);
  }
  return out;
}
/**
 * Register a sub-agent's drawing of one region onto the figure.
 *
 * The four extreme ink points of the region (left/right/top/bottom) are the
 * reference object. We compare them with the extremes of what the sub-agent
 * drew; if they disagree, one similarity transform is fitted and applied, and
 * the fit must pass a residual threshold. Outliers are dropped, never averaged
 * away.
 */
export function registerToInk(raster, elements, options) {
  const opts = options || {};
  const w = raster.w, h = raster.h;
  const tolPx = opts.tolerancePx == null ? 6 : opts.tolerancePx;
  const radius = opts.radiusPx == null ? 18 : opts.radiusPx;
  const dark = (px, py) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return false;
    const i = (py * w + px) * 3;
    return (raster.rgb[i] * 299 + raster.rgb[i + 1] * 587 + raster.rgb[i + 2] * 114) / 1000 < 205;
  };
  // All geometry in PIXELS. Mixing normalised x with normalised y is what made
  // the first version report Infinity on a perfectly aligned region.
  const nearest = (px, py) => {
    if (dark(px, py)) return { dx: 0, dy: 0, d: 0 };
    let best = null;
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!dark(px + dx, py + dy)) continue;
          const d = Math.hypot(dx, dy);
          if (!best || d < best.d) best = { dx, dy, d };
        }
      }
      if (best) return best;
    }
    return null;
  };
  const toPx = (nx, ny) => [Math.round((nx / 1000) * w), Math.round((ny / 1000) * h)];
  const keyPoints = (el) => {
    if (!el) return [];
    const pts = [];
    if (el.kind === 'line') pts.push([el.x1, el.y1], [(el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2], [el.x2, el.y2]);
    else if (el.kind === 'text' && Array.isArray(el.box)) {
      const [x, y, bw, bh] = el.box;
      // A text box centre can sit between two glyphs: probe the corners too and
      // let the closest ink win.
      pts.push([x + bw / 2, y + bh / 2], [x + bw * 0.15, y + bh / 2], [x + bw * 0.85, y + bh / 2]);
    } else if (el.kind === 'polyline' && Array.isArray(el.points) && el.points.length) {
      const p = el.points; pts.push(p[0], p[Math.floor(p.length / 2)], p[p.length - 1]);
    } else if (Number.isFinite(Number(el.cx))) pts.push([el.cx, el.cy]);
    return pts;
  };
  const measure = (list) => {
    const rows = [];
    for (const el of list) {
      const found = [];
      for (const [nx, ny] of keyPoints(el)) {
        const [px, py] = toPx(nx, ny);
        const hit = nearest(px, py);
        if (hit) found.push(hit);
      }
      if (!found.length) { rows.push({ el, error: Infinity, count: 0 }); continue; }
      rows.push({ el, error: found.reduce((s, o) => s + o.d, 0) / found.length, count: found.length, offsets: found });
    }
    return rows;
  };
  const before = measure(elements);
  const offsets = before.flatMap((r) => r.offsets || []);
  if (!offsets.length) return { ok: false, applied: false, residual: Infinity, elements, dropped: 0, reason: 'no ink near this region' };
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] || 0; };
  const dxPx = med(offsets.map((o) => o.dx));
  const dyPx = med(offsets.map((o) => o.dy));
  const apply = Math.abs(dxPx) > 1 || Math.abs(dyPx) > 1;
  const model = { s: 1, tx: (dxPx / w) * 1000, ty: (dyPx / h) * 1000 };
  const moved = apply ? elements.map((el) => applySimilarity(el, model)) : elements;
  const after = measure(moved);
  const kept = after.filter((r) => r.error <= tolPx).map((r) => r.el);
  const dropped = after.length - kept.length;
  const residuals = after.filter((r) => r.error <= tolPx).map((r) => r.error);
  const residual = residuals.length ? Math.sqrt(residuals.reduce((s, e) => s + e * e, 0) / residuals.length) : Infinity;
  return {
    ok: kept.length > 0 && residual <= tolPx,
    applied: apply,
    residual,
    shiftPx: [dxPx, dyPx],
    elements: kept,
    dropped,
  };
}

/** Region-level registration: align a sub-drawing onto the ink, drop bad points. */
export function registerRegion(raster, region, elements, options) {
  return registerToInk(raster, elements, options);
}
