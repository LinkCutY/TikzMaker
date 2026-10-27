/**
 * Curve reconstruction from a few control points.
 *
 * A vision model cannot enumerate 40 curves pixel by pixel, but it can read
 * "this curve starts at 1, dips to 0.3 around z=-6, comes back". So the plot
 * contract asks for 4-10 control points per curve and we fit a smooth cubic
 * chain through them (Catmull-Rom). Result: the right number of curves, in the
 * right place, thin and editable.
 */

const fmt = (v) => String(Math.round(v * 1000) / 1000);

/** Catmull-Rom through the points, expressed as cubic Bezier segments. */
export function catmullRom(points) {
  const pts = (points || []).filter(function (p) {
    return Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));
  }).map(function (p) { return [Number(p[0]), Number(p[1])]; });
  if (pts.length < 2) return null;
  pts.sort(function (a, b) { return a[0] - b[0]; });
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    segs.push({
      p1,
      c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    });
  }
  return { start: pts[0], segments: segs, points: pts };
}

/**
 * A ridge family is one colour (sometimes a gradient). When most curves agree
 * and a handful disagree, the outliers are read errors, not design.
 */
export function snapRidgeColours(curves, options) {
  const opts = options || {};
  const list = (curves || []).filter(function (c) { return c && Array.isArray(c.points) && c.points.length >= 2; });
  if (list.length < 4) return { curves: curves, snapped: 0 };
  const hex = function (c) {
    const raw = (c.style && c.style.stroke) || c.color;
    return typeof raw === "string" && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null;
  };
  const counts = new Map();
  for (const c of list) {
    const h = hex(c);
    if (h) counts.set(h, (counts.get(h) || 0) + 1);
  }
  if (!counts.size) return { curves: curves, snapped: 0 };
  const ranked = [...counts.entries()].sort(function (a, b) { return b[1] - a[1]; });
  const [dominant, hits] = ranked[0];
  if (hits < list.length * (opts.share == null ? 0.7 : opts.share)) return { curves: curves, snapped: 0 };
  let snapped = 0;
  const out = list.map(function (c) {
    const h = hex(c);
    if (!h || h === dominant) return c;
    snapped++;
    return Object.assign({}, c, { style: Object.assign({}, c.style, { stroke: dominant }), color: dominant });
  });
  return { curves: out, snapped, dominant };
}

/**
 * Ridge families share one peak centre.
 *
 * The model estimates each curve separately, so every apex lands a few percent
 * to the left or right of the others and the family comes out as a zig-zag. If
 * the curves clearly form a ridge (many curves, each with a peak well above its
 * ends), translate each curve so the apexes line up.
 */
export function alignRidgePeaks(curves, options) {
  const opts = options || {};
  const list = (curves || []).filter(function (c) { return c && Array.isArray(c.points) && c.points.length >= 3; });
  if (list.length < (opts.minCurves == null ? 4 : opts.minCurves)) return { curves: curves, aligned: 0, spread: 0 };

  const apexes = list.map(function (c) {
    let apex = c.points[0];
    for (const p of c.points) if (Number(p[1]) < Number(apex[1])) apex = p;
    const first = c.points[0];
    const last = c.points[c.points.length - 1];
    const base = (Number(first[1]) + Number(last[1])) / 2;
    return { apexX: Number(apex[0]), height: base - Number(apex[1]) };
  });

  const peaked = apexes.filter(function (a) { return a.height > 40; }); // a real bump, not noise
  if (peaked.length < Math.max(3, list.length * 0.6)) return { curves: curves, aligned: 0, spread: 0 };

  const xs = peaked.map(function (a) { return a.apexX; }).sort(function (a, b) { return a - b; });
  const median = xs[Math.floor(xs.length / 2)];
  const spread = xs[xs.length - 1] - xs[0];
  if (spread > (opts.maxSpread == null ? 220 : opts.maxSpread)) {
    return { curves: curves, aligned: 0, spread, reason: "peaks too far apart to be one family" };
  }

  let moved = 0;
  const out = list.map(function (c) {
    let apex = c.points[0];
    for (const p of c.points) if (Number(p[1]) < Number(apex[1])) apex = p;
    const dx = median - Number(apex[0]);
    if (!dx) return c;
    moved++;
    return Object.assign({}, c, {
      points: c.points.map(function (p) { return [Number(p[0]) + dx, p[1]]; }),
    });
  });
  // keep any curve that was filtered out of the analysis
  const rest = (curves || []).filter(function (c) { return !list.includes(c); });
  return { curves: out.concat(rest), aligned: moved, spread, median };
}

/** Sample a curve for verification (linear between control points is enough). */
export function sampleCurve(points, perSegment) {
  const per = perSegment == null ? 6 : perSegment;
  const pts = (points || []).filter(function (p) {
    return Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));
  }).map(function (p) { return [Number(p[0]), Number(p[1])]; });
  if (pts.length < 2) return pts;
  pts.sort(function (a, b) { return a[0] - b[0]; });
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
