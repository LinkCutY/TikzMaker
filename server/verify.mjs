/**
 * Deterministic geometry checks.
 *
 * A vision model can be convinced by its own story; pixels cannot. Before we
 * pay for a reviewer call (or accept a drawing), measure:
 *   - does every primitive actually sit on ink?
 *   - does the rendered document cover the original ink (recall), and does it
 *     add ink where the original has none (precision)?
 *   - are the text boxes plausibly sized?
 * The answers become concrete feedback for the next understanding round.
 */

import { decodePng } from "./trace.mjs";
import { sampleCurve } from "./plotcurve.mjs";
import { sampleGeometry } from './series-geometry.mjs';

const INF = 1e9;

function gray(raster) {
  const { w, h, rgb } = raster;
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    out[i] = (rgb[p] * 299 + rgb[p + 1] * 587 + rgb[p + 2] * 114) / 1000;
  }
  return out;
}

export function inkMask(raster, threshold) {
  const g = gray(raster);
  const mask = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] < threshold ? 1 : 0;
  return mask;
}

/** Two-pass chamfer distance (px) to the nearest ink pixel. */
export function distanceField(mask, w, h) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? INF : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[y * w + x] === 0) continue;
      let m = d[y * w + x];
      m = Math.min(m, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
      d[y * w + x] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      let m = d[y * w + x];
      m = Math.min(m, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
      d[y * w + x] = m;
    }
  }
  return d;
}

/** Points (normalised 0..1000) along one element. */
export function sampleElement(el, aspect) {
  const pts = [];
  const push = (x, y) => pts.push([x, y]);
  const kind = el && typeof el.kind === "string" ? el.kind : "";
  if (kind === "circle") {
    const r = Number(el.r) || 0;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      push((Number(el.cx) || 0) + r * Math.cos(a), (Number(el.cy) || 0) + r * Math.sin(a));
    }
    return pts;
  }
  if (kind === "ellipse" || kind === "arc") {
    const rx = Number(el.rx) || 0, ry = Number(el.ry) || 0;
    const a0 = kind === "arc" ? ((Number(el.start) || 0) * Math.PI) / 180 : 0;
    const a1 = kind === "arc" ? ((Number(el.end) || 360) * Math.PI) / 180 : Math.PI * 2;
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      push((Number(el.cx) || 0) + rx * Math.cos(a), (Number(el.cy) || 0) + ry * Math.sin(a));
    }
    return pts;
  }
  if (kind === "line") {
    const x1 = Number(el.x1) || 0, y1 = Number(el.y1) || 0;
    const x2 = Number(el.x2) || 0, y2 = Number(el.y2) || 0;
    for (let i = 0; i <= 12; i++) push(x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12);
    return pts;
  }
  if (kind === "polyline" && Array.isArray(el.points)) {
    for (let i = 0; i < el.points.length; i++) {
      const p = el.points[i];
      if (!Array.isArray(p) || p.length < 2) continue;
      const x = Number(p[0]) || 0, y = Number(p[1]) || 0;
      if (i === 0) { push(x, y); continue; }
      const prev = el.points[i - 1];
      const px = Number(prev[0]) || 0, py = Number(prev[1]) || 0;
      const steps = Math.max(1, Math.round(Math.hypot(x - px, y - py) / 6));
      for (let s = 1; s <= steps; s++) push(px + ((x - px) * s) / steps, py + ((y - py) * s) / steps);
    }
  }
  return pts;
}

/**
 * Per-element ink support + text-box sanity.
 * Returns { support: [{index, kind, ratio}], problems: [string] }.
 */
export function evaluateModel(model, aspect, raster, options) {
  const opts = options || {};
  const { w, h } = raster;
  const mask = inkMask(raster, opts.threshold == null ? 210 : opts.threshold);
  const field = distanceField(mask, w, h);
  // Thin lines: 5 px on a ~900 px wide image is sub-percent of the width and
  // reads as "on the curve" to a human. Tighter than this punishes good work.
  const tol = opts.tolerancePx == null ? 5 : opts.tolerancePx;
  const elements = Array.isArray(model && model.elements) ? model.elements : [];
  const support = [];
  const problems = [];
  elements.forEach(function (el, index) {
    const kind = el && el.kind;
    if (kind === "text") {
      const box = Array.isArray(el.box) ? el.box.map(Number) : null;
      if (!box || box.length !== 4) return;
      const heightPct = box[3] / 10; // percent of canvas height
      if (heightPct > 12) problems.push("文字「" + String(el.tex || "").slice(0, 12) + "」的框太高（" + Math.round(heightPct) + "% 画布高），字号会过大");
      const x0 = Math.max(0, Math.min(w - 1, Math.round((box[0] / 1000) * w)));
      const x1 = Math.max(0, Math.min(w - 1, Math.round(((box[0] + box[2]) / 1000) * w)));
      const y0 = Math.max(0, Math.min(h - 1, Math.round((box[1] / 1000) * h)));
      const y1 = Math.max(0, Math.min(h - 1, Math.round(((box[1] + box[3]) / 1000) * h)));
      let ink = 0, cells = 0;
      for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { cells++; if (mask[y * w + x]) ink++; }
      const density = cells ? ink / cells : 0;
      if (cells > 0 && density < 0.01) problems.push("文字「" + String(el.tex || "").slice(0, 12) + "」的框落在空白处（框里没有墨迹）");
      return;
    }
    const pts = sampleElement(el, aspect);
    if (pts.length < 2) return;
    let ok = 0;
    for (const p of pts) {
      const px = Math.max(0, Math.min(w - 1, Math.round((p[0] / 1000) * w)));
      const py = Math.max(0, Math.min(h - 1, Math.round((p[1] / 1000) * h)));
      if (field[py * w + px] <= tol) ok++;
    }
    const ratio = ok / pts.length;
    support.push({ index, kind, ratio });
    if (ratio < 0.6) {
      problems.push(kind + "#" + index + " 有 " + Math.round((1 - ratio) * 100) + "% 的采样点不在墨迹上（位置/形状与原图不符）");
    }
  });
  // Curves are reconstructed from a few control points: check that the points
  // the model chose actually sit on ink.
  const curveList = Array.isArray(model && model.curves) ? model.curves : [];
  curveList.forEach(function (curve, i) {
    const pts = curve.geometry ? sampleGeometry(curve.geometry) : sampleCurve(curve && curve.points);
    if (pts.length < 2) return;
    let ok = 0;
    for (const p of pts) {
      const px = Math.max(0, Math.min(w - 1, Math.round((p[0] / 1000) * w)));
      const py = Math.max(0, Math.min(h - 1, Math.round((p[1] / 1000) * h)));
      if (field[py * w + px] <= tol) ok++;
    }
    const ratio = ok / pts.length;
    support.push({ index: "curve" + i, kind: "curve", ratio });
    if (ratio < 0.6) {
      problems.push("曲线#" + i + " 有 " + Math.round((1 - ratio) * 100) + "% 的采样点不在墨迹上（位置或形状与原图不符）");
    }
  });

  return { support, problems };
}

/** Bounding box of the ink, in normalised 0..1000 coordinates. */
export function inkBounds(raster, threshold) {
  const thr = threshold == null ? 200 : threshold;
  const { w, h, rgb } = raster;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const g = (rgb[i] * 299 + rgb[i + 1] * 587 + rgb[i + 2] * 114) / 1000;
      if (g >= thr) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0: (x0 / w) * 1000, y0: (y0 / h) * 1000, x1: ((x1 + 1) / w) * 1000, y1: ((y1 + 1) / h) * 1000 };
}

/** Bounding box of everything the model placed. */
export function drawingBounds(model, options) {
  const opts = options || {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const el of (model.elements || [])) {
    if (el.kind === "circle") { grow(el.cx - el.r, el.cy - el.r); grow(el.cx + el.r, el.cy + el.r); }
    else if (el.kind === "ellipse" || el.kind === "arc") { grow(el.cx - el.rx, el.cy - el.ry); grow(el.cx + el.rx, el.cy + el.ry); }
    else if (el.kind === "line") { grow(el.x1, el.y1); grow(el.x2, el.y2); }
    else if (el.kind === "polyline") { for (const p of el.points || []) grow(Number(p[0]), Number(p[1])); }
    else if (el.kind === "text" && Array.isArray(el.box) && !opts.excludeText) { grow(el.box[0], el.box[1]); grow(el.box[0] + el.box[2], el.box[1] + el.box[3]); }
  }
  if (opts.curvesOnly) {
    x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  }
  for (const c of (model.curves || [])) for (const p of (c.points || [])) grow(Number(p[0]), Number(p[1]));
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Map the model's own bounding box onto the ink's bounding box.
 *
 * Vision models are decent at relative shape and bad at absolute placement:
 * their drawing is usually shrunk and offset inside the 0..1000 square. If the
 * whole content is present but displaced, one affine map fixes the layout
 * without touching the shapes.
 */
export function normalizeToInk(model, raster, options) {
  const opts = options || {};
  // Measured on a dense plot crop this mapping made placement worse (the model's
  // bbox and the ink bbox disagree about what "the figure" is), so it stays off
  // until a per-figure check can decide whether to trust it.
  if (opts.enabled === false) return { model, applied: false };
  const ink = inkBounds(raster, opts.threshold);
  // Text boxes are spread over the whole canvas and would corrupt the mapping;
  // curves (when present) are the best proxy for the plotted area.
  const hasCurves = Array.isArray(model.curves) && model.curves.length >= 2;
  const draw = drawingBounds(model, hasCurves ? { curvesOnly: true } : { excludeText: true });
  if (!ink || !draw) return { model, applied: false };
  const dw = draw.x1 - draw.x0;
  const dh = draw.y1 - draw.y0;
  const iw = ink.x1 - ink.x0;
  const ih = ink.y1 - ink.y0;
  if (dw < 50 || dh < 50 || iw <= 0 || ih <= 0) return { model, applied: false };
  const sx = iw / dw;
  const sy = ih / dh;
  const offset = Math.max(Math.abs(draw.x0 - ink.x0), Math.abs(draw.y0 - ink.y0));
  const scaleOff = Math.max(Math.abs(sx - 1), Math.abs(sy - 1));
  // Only when the mismatch is real: otherwise leave a good drawing untouched.
  if (offset < 25 && scaleOff < 0.12) return { model, applied: false };

  const mx = (x) => ink.x0 + (Number(x) - draw.x0) * sx;
  const my = (y) => ink.y0 + (Number(y) - draw.y0) * sy;
  const scale = (v) => (Number(v) * (sx + sy)) / 2;

  const elements = (model.elements || []).map(function (el) {
    const copy = Object.assign({}, el);
    if (el.kind === "circle") { copy.cx = mx(el.cx); copy.cy = my(el.cy); copy.r = scale(el.r); }
    else if (el.kind === "ellipse" || el.kind === "arc") { copy.cx = mx(el.cx); copy.cy = my(el.cy); copy.rx = scale(el.rx); copy.ry = scale(el.ry); }
    else if (el.kind === "line") { copy.x1 = mx(el.x1); copy.y1 = my(el.y1); copy.x2 = mx(el.x2); copy.y2 = my(el.y2); }
    else if (el.kind === "polyline") { copy.points = (el.points || []).map(function (p) { return [mx(p[0]), my(p[1])]; }); }
    else if (el.kind === "text" && Array.isArray(el.box)) {
      copy.box = [mx(el.box[0]), my(el.box[1]), Number(el.box[2]) * sx, Number(el.box[3]) * sy];
    }
    return copy;
  });
  const curves = (model.curves || []).map(function (c) {
    return Object.assign({}, c, { points: (c.points || []).map(function (p) { return [mx(p[0]), my(p[1])]; }) });
  });
  return { model: Object.assign({}, model, { elements, curves }), applied: true, sx, sy };
}

/** Long horizontal/vertical ink runs: a plot frame or a table border. */
export function detectFrame(raster, options) {
  const opts = options || {};
  const thr = opts.threshold == null ? 200 : opts.threshold;
  const minFrac = opts.minFrac == null ? 0.55 : opts.minFrac;
  const { w, h, rgb } = raster;
  const isInk = (x, y) => {
    const i = (y * w + x) * 3;
    return (rgb[i] * 299 + rgb[i + 1] * 587 + rgb[i + 2] * 114) / 1000 < thr;
  };
  let hLines = 0, vLines = 0;
  const horizontalRows = [], verticalColumns = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const minH = Math.floor(w * minFrac), minV = Math.floor(h * minFrac);
  for (let y = 0; y < h; y++) {
    let run = 0, best = 0, bestStart = 0, start = 0;
    for (let x = 0; x < w; x++) {
      if (isInk(x, y)) { if (!run) start = x; run++; if (run > best) { best = run; bestStart = start; } }
      else run = 0;
    }
    if (best >= minH) { hLines++; horizontalRows.push(y); x0 = Math.min(x0, bestStart); x1 = Math.max(x1, bestStart + best); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  for (let x = 0; x < w; x++) {
    let run = 0, best = 0, bestStart = 0, start = 0;
    for (let y = 0; y < h; y++) {
      if (isInk(x, y)) { if (!run) start = y; run++; if (run > best) { best = run; bestStart = start; } }
      else run = 0;
    }
    if (best >= minV) { vLines++; verticalColumns.push(x); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, bestStart); y1 = Math.max(y1, bestStart + best); }
  }
  // A 3px axis is ONE line, not three parallel frame edges. Group adjacent
  // scanlines before deciding whether a closed rectangle exists.
  const bands = xs => xs.filter((v,i) => !i || v - xs[i-1] > 2);
  const hb = bands(horizontalRows), vb = bands(verticalColumns);
  const hasBox = hb.length >= 2 && vb.length >= 2 && hb.at(-1)-hb[0]>h*0.15 && vb.at(-1)-vb[0]>w*0.15;
  return { hasBox, hLines, vLines, bounds: hasBox ? { x0, y0, x1, y1 } : null, width: w, height: h };
}

/** Does this drawing contain a line long enough to be a frame edge? */
export function hasFrameElement(model, minFrac) {
  const frac = minFrac == null ? 0.5 : minFrac;
  for (const el of (model.elements || [])) {
    if (el.kind === "line") {
      const dx = Math.abs(Number(el.x2) - Number(el.x1));
      const dy = Math.abs(Number(el.y2) - Number(el.y1));
      if (dx >= 1000 * frac || dy >= 1000 * frac) return true;
    }
    if (el.kind === "polyline" && Array.isArray(el.points) && el.points.length >= 2) {
      let minX = 1000, maxX = 0, minY = 1000, maxY = 0;
      for (const p of el.points) {
        minX = Math.min(minX, Number(p[0])); maxX = Math.max(maxX, Number(p[0]));
        minY = Math.min(minY, Number(p[1])); maxY = Math.max(maxY, Number(p[1]));
      }
      if (maxX - minX >= 1000 * frac || maxY - minY >= 1000 * frac) return true;
    }
  }
  return false;
}

/**
 * How far is a curve from the ink? Average (dx, dy) from sample points to the
 * nearest ink pixel — a direction the model can act on, unlike "40% off".
 */
export function inkOffset(points, raster, options) {
  const opts = options || {};
  const thr = opts.threshold == null ? 210 : opts.threshold;
  const radius = opts.radius == null ? 18 : opts.radius;
  const { w, h, rgb } = raster;
  const isInk = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = (y * w + x) * 3;
    return (rgb[i] * 299 + rgb[i + 1] * 587 + rgb[i + 2] * 114) / 1000 < thr;
  };
  let sx = 0, sy = 0, n = 0;
  for (const p of points || []) {
    const px = Math.round((Number(p[0]) / 1000) * w);
    const py = Math.round((Number(p[1]) / 1000) * h);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= radius && !best; r += 2) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!isInk(px + dx, py + dy)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = [dx, dy]; }
        }
      }
    }
    if (!best) continue;
    sx += best[0]; sy += best[1]; n++;
  }
  if (!n) return null;
  return { dx: sx / n, dy: sy / n, samples: n };
}

/**
 * Shape-level criticism for reconstructed curves.
 *
 * "40% off" is not actionable; "峰顶顶角 62°，高斯峰通常 >110°" is. These checks
 * look at the geometry we are about to draw, so they cost nothing and always
 * produce a concrete number.
 */
export function curveShapeIssues(curves, options) {
  const opts = options || {};
  const issues = [];
  const list = (curves || []).filter(function (c) { return c && Array.isArray(c.points) && c.points.length >= 3; });
  const apexes = [];

  list.forEach(function (curve, index) {
    const pts = curve.points.map(function (p) { return [Number(p[0]), Number(p[1])]; });
    const xs = pts.map(function (p) { return p[0]; });
    const span = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    if (span <= 0) return;

    // apex: highest point (y grows downwards)
    let apex = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[apex][1]) apex = i;
    apexes.push({ index, x: pts[apex][0], y: pts[apex][1] });

    // apex angle, measured ±8% of the span around the peak
    const w = span * (opts.apexWindow == null ? 0.08 : opts.apexWindow);
    const left = pts.filter(function (p) { return p[0] <= pts[apex][0] - w; }).pop();
    const right = pts.find(function (p) { return p[0] >= pts[apex][0] + w; });
    if (left && right) {
      const v1 = [left[0] - pts[apex][0], left[1] - pts[apex][1]];
      const v2 = [right[0] - pts[apex][0], right[1] - pts[apex][1]];
      const n1 = Math.hypot(v1[0], v1[1]) || 1;
      const n2 = Math.hypot(v2[0], v2[1]) || 1;
      const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)));
      const angle = (Math.acos(cos) * 180) / Math.PI;
      if (angle < (opts.sharpAngle == null ? 100 : opts.sharpAngle)) {
        issues.push({
          index,
          kind: "peak-sharp",
          value: Math.round(angle),
          message: "曲线#" + index + " 峰顶过尖：顶角 " + Math.round(angle) + "°（平滑峰通常 >110°），峰区需要更多控制点",
        });
      }
    }

    // biggest turn between consecutive segments: a kink shows up as a large angle
    let worst = 0;
    let worstAt = null;
    // The apex is a legitimate turn (it is what a peak is); judge it with the
    // apex angle, not as a kink.
    const apexGuard = span * 0.12;
    for (let i = 1; i < pts.length - 1; i++) {
      if (Math.abs(pts[i][0] - pts[apex][0]) < apexGuard) continue;
      const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
      const b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
      const na = Math.hypot(a[0], a[1]) || 1;
      const nb = Math.hypot(b[0], b[1]) || 1;
      const cos = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (na * nb)));
      const turn = (Math.acos(cos) * 180) / Math.PI;
      if (turn > worst) { worst = turn; worstAt = pts[i]; }
    }
    if (worst > (opts.kinkAngle == null ? 28 : opts.kinkAngle)) {
      issues.push({
        index,
        kind: "kink",
        value: Math.round(worst),
        message: "曲线#" + index + " 在 x≈" + Math.round((worstAt[0] / 1000) * 100) + "% 处有 " + Math.round(worst) + "° 折角（应平滑过渡）",
      });
    }
  });

  // all peaks should sit on the same vertical line in a ridge family
  if (apexes.length >= 4) {
    const xs = apexes.map(function (a) { return a.x; }).sort(function (a, b) { return a - b; });
    const spread = xs[xs.length - 1] - xs[0];
    const pctSpread = (spread / 1000) * 100;
    if (pctSpread > (opts.maxPeakSpreadPct == null ? 4 : opts.maxPeakSpreadPct)) {
      issues.push({
        kind: "peak-misaligned",
        value: Number(pctSpread.toFixed(1)),
        message: "各曲线的峰心横向散布 " + pctSpread.toFixed(1) + "%（同一族的峰应共用一个 x）",
      });
    }
  }
  return issues;
}

/** Drop elements that do not sit on ink, and exact duplicates. */
export function pruneUnsupported(model, evaluation, options) {
  const opts = options || {};
  const minRatio = opts.minRatio == null ? 0.35 : opts.minRatio;
  const bad = new Set();
  for (const item of evaluation.support || []) if (item.ratio < minRatio) bad.add(item.index);
  // Frames and axis lines are structural: a few pixels of error is far better
  // than a drawing with no border, so they need to be much worse to be dropped.
  for (const item of evaluation.support || []) {
    if (!bad.has(item.index)) continue;
    const el = model.elements[item.index];
    if (!el) continue;
    const isStructural = el.kind === "line" || el.kind === "polyline";
    if (isStructural && item.ratio >= 0.12) bad.delete(item.index);
  }
  const seen = new Set();
  const kept = [];
  const removed = [];
  (model.elements || []).forEach(function (el, index) {
    if (bad.has(index)) { removed.push({ index, kind: el && el.kind, why: "no-ink" }); return; }
    const key = JSON.stringify([el.kind, el.cx, el.cy, el.r, el.rx, el.ry, el.x1, el.y1, el.x2, el.y2, el.tex,el.box,el.role,
      (el.points || []).map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; })]);
    if (seen.has(key)) { removed.push({ index, kind: el && el.kind, why: "duplicate" }); return; }
    seen.add(key);
    kept.push(el);
  });
  return { model: Object.assign({}, model, { elements: kept }), removed: removed };
}

/** Crop a raster to a normalised box (0..1000). */
export function cropRaster(raster, box, padRatio) {
  const pad = padRatio == null ? 0.1 : padRatio;
  const x0 = Math.max(0, Math.floor(((box[0] - box[2] * pad) / 1000) * raster.w));
  const y0 = Math.max(0, Math.floor(((box[1] - box[3] * pad) / 1000) * raster.h));
  const x1 = Math.min(raster.w - 1, Math.ceil(((box[0] + box[2] * (1 + pad)) / 1000) * raster.w));
  const y1 = Math.min(raster.h - 1, Math.ceil(((box[1] + box[3] * (1 + pad)) / 1000) * raster.h));
  const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * raster.w + x0) * 3;
    rgb.set(raster.rgb.subarray(src, src + w * 3), y * w * 3);
  }
  return { w, h, rgb };
}

/** Ink recall/precision between the source raster and a rendered PNG data URL. */
export function compareInk(sourceRaster, renderedDataUrl, options) {
  const opts = options || {};
  const rendered = decodePng(renderedDataUrl);
  const srcMask = inkMask(sourceRaster, opts.threshold == null ? 210 : opts.threshold);
  const outMask = inkMask(rendered, opts.threshold == null ? 210 : opts.threshold);
  const srcField = distanceField(srcMask, sourceRaster.w, sourceRaster.h);
  const outField = distanceField(outMask, rendered.w, rendered.h);
  const tol = opts.tolerancePx == null ? 6 : opts.tolerancePx;

  // Per-cell recall: an average hides a missing region (a peak, a legend, a
  // whole panel) behind the parts that happen to be covered.
  const cells = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const weights = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let srcInk = 0, covered = 0;
  for (let y = 0; y < sourceRaster.h; y++) {
    for (let x = 0; x < sourceRaster.w; x++) {
      if (!srcMask[y * sourceRaster.w + x]) continue;
      srcInk++;
      const ox = Math.min(rendered.w - 1, Math.round((x / sourceRaster.w) * rendered.w));
      const oy = Math.min(rendered.h - 1, Math.round((y / sourceRaster.h) * rendered.h));
      const gy = Math.min(2, Math.floor((y / sourceRaster.h) * 3));
      const gx = Math.min(2, Math.floor((x / sourceRaster.w) * 3));
      weights[gy][gx]++;
      if (outField[oy * rendered.w + ox] <= tol) { covered++; cells[gy][gx]++; }
    }
  }
  let outInk = 0, matched = 0;
  for (let y = 0; y < rendered.h; y += 2) {
    for (let x = 0; x < rendered.w; x += 2) {
      if (!outMask[y * rendered.w + x]) continue;
      outInk++;
      const sx = Math.min(sourceRaster.w - 1, Math.round((x / rendered.w) * sourceRaster.w));
      const sy = Math.min(sourceRaster.h - 1, Math.round((y / rendered.h) * sourceRaster.h));
      if (srcField[sy * sourceRaster.w + sx] <= tol) matched++;
    }
  }
  const cellRecall = cells.map(function (row, gy) {
    return row.map(function (hit, gx) {
      return weights[gy][gx] >= srcInk * 0.01 ? hit / weights[gy][gx] : 1;
    });
  });
  let minCell = 1;
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) minCell = Math.min(minCell, cellRecall[gy][gx]);
  return {
    recall: srcInk ? covered / srcInk : 0,
    precision: outInk ? matched / outInk : 0,
    cellRecall,
    minCell,
    sourceInk: srcInk,
    renderedInk: outInk,
  };
}
