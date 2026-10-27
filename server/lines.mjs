/**
 * Line-first tracer, implemented to the spec:
 *   1. scan left->right, flag pixels that differ from the background
 *   2. walk outward from a flagged pixel over coloured pixels, record the track
 *   3. merge tracks whose endpoints are within a threshold
 *   4. drop tracks shorter than a threshold (noise)
 *   5. fit each surviving track (interpolation for now)
 * Deliberately separate from trace.mjs so the existing pipeline is untouched.
 */
import { skeletonize, traceSkeleton } from "./trace.mjs";
import { cjkPreamble, safeNodeText } from "./textext.mjs";

const BG_TOLERANCE = 0.12; // fraction of 255

/** Bilinear upscale: adjacent curves <2px apart get a white gap back. */
export function upscaleRaster(raster, s) {
  const { w, h, rgb } = raster;
  const W = Math.round(w * s);
  const H = Math.round(h * s);
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / s - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / s - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const p00 = rgb[(y0 * w + x0) * 3 + c], p10 = rgb[(y0 * w + x1) * 3 + c];
        const p01 = rgb[(y1 * w + x0) * 3 + c], p11 = rgb[(y1 * w + x1) * 3 + c];
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[(y * W + x) * 3 + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return { w: W, h: H, rgb: out };
}

export function traceStrokes(raster, options = {}) {
  const scale = options.upscale ?? 1;
  if (scale > 1) {
    const big = upscaleRaster(raster, scale);
    const inner = traceStrokes(big, {
      ...options,
      upscale: 1,
      mergeDist: (options.mergeDist ?? 4) * scale,
      minLength: (options.minLength ?? 14) * scale,
    });
    for (const t of inner.tracks) t.points = t.points.map(([x, y]) => [x / scale, y / scale]);
    return inner;
  }
  const { w, h, rgb } = raster;
  const tol = (options.tolerance ?? BG_TOLERANCE) * 255;
  const bg = options.background || [255, 255, 255];

  // 1. flag pixels that differ from the background
  const ink = new Uint8Array(w * h);
  let inkCount = 0;
  for (let i = 0; i < w * h; i++) {
    const d =
      Math.abs(rgb[i * 3] - bg[0]) + Math.abs(rgb[i * 3 + 1] - bg[1]) + Math.abs(rgb[i * 3 + 2] - bg[2]);
    if (d / 3 > tol) {
      ink[i] = 1;
      inkCount++;
    }
  }

  // 2. components, then walk each one with a skeleton (the "expand and record" step)
  const seen = new Uint8Array(w * h);
  const tracks = [];
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % w;
      const y = (i - x) / w;
      const push = (n, ok) => {
        if (ok && ink[n] && !seen[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      };
      push(i - 1, x > 0);
      push(i + 1, x < w - 1);
      push(i - w, y > 0);
      push(i + w, y < h - 1);
    }
    if (queue.length < 4) continue;
    const mask = new Uint8Array(w * h);
    let r = 0, g = 0, b = 0;
    for (const i of queue) {
      mask[i] = 1;
      r += rgb[i * 3];
      g += rgb[i * 3 + 1];
      b += rgb[i * 3 + 2];
    }
    const skel = skeletonize(mask, w, h);
    for (const path of traceSkeleton(skel, w, h)) {
      if (path.length < 4) continue;
      tracks.push({ points: path, color: [r / queue.length, g / queue.length, b / queue.length] });
    }
  }

  // 3. merge tracks whose endpoints are within the threshold
  const mergeDist = options.mergeDist ?? 4;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < tracks.length; i++) {
      for (let j = 0; j < tracks.length; j++) {
        if (i === j) continue;
        const A = tracks[i].points;
        const B = tracks[j].points;
        const combo = [
          [A[A.length - 1], B[0], false],
          [A[A.length - 1], B[B.length - 1], true],
          [A[0], B[0], true],
          [A[0], B[B.length - 1], false],
        ];
        for (const [pa, pb, flip] of combo) {
          const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
          if (d > mergeDist) continue;
          const tail = flip ? B.slice().reverse() : B;
          // Reject joins that would create a kink: two fragments only belong
          // together if the direction is preserved across the seam.
          const kink = (() => {
            const ka = Math.min(10, A.length - 1);
            const kb = Math.min(10, tail.length - 1);
            if (ka < 1 || kb < 1) return 1;
            const ax = A[A.length - 1][0] - A[A.length - 1 - ka][0];
            const ay = A[A.length - 1][1] - A[A.length - 1 - ka][1];
            const bx = tail[kb][0] - tail[0][0];
            const by = tail[kb][1] - tail[0][1];
            const n1 = Math.hypot(ax, ay) || 1;
            const n2 = Math.hypot(bx, by) || 1;
            return (ax * bx + ay * by) / (n1 * n2);
          })();
          if (kink < 0.26) continue; // only a near-reversal (>75 deg) is a different curve
          tracks[i] = { points: A.concat(tail.slice(1)), color: tracks[i].color };
          tracks.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // 3b. strokes inside an OCR label box are text, not curves
  const boxes = (options.labels || []).filter((l) => Array.isArray(l.box) && l.box.length === 4).map((l) => l.box);
  const inBox = (x, y) => boxes.some((b) => x >= b[0] * w / 1000 && x <= (b[0] + b[2]) * w / 1000 && y >= b[1] * h / 1000 && y <= (b[1] + b[3]) * h / 1000);
  const geometry = boxes.length ? tracks.filter((t) => t.points.filter((p) => inBox(p[0], p[1])).length < t.points.length * 0.6) : tracks;
  const textTracks = tracks.length - geometry.length;

  // 4. drop tracks shorter than the threshold
  const minLen = options.minLength ?? 14;
  const lengthOf = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const kept = geometry.filter((t) => lengthOf(t.points) >= minLen);
  const dropped = geometry.length - kept.length;

  return { tracks: kept, stats: { ink: inkCount, components: tracks.length + dropped, tracks: tracks.length,
      textTracks, kept: kept.length, dropped, mergeDist, minLength: minLen } };
}

/** Ramer-Douglas-Peucker on [x, y] points; both ends are always kept. */
export function simplifyTrack(points, tolerance) {
  const pts = points || [];
  if (pts.length < 3 || !(tolerance > 0)) return pts;
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const range = stack.pop();
    const a = range[0];
    const b = range[1];
    if (b - a < 2) continue;
    const x1 = pts[a][0];
    const y1 = pts[a][1];
    const dx = pts[b][0] - x1;
    const dy = pts[b][1] - y1;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0];
      const py = pts[i][1];
      let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = x1 + t * dx - px;
      const ey = y1 + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > worst) { worst = d; index = i; }
    }
    if (index > 0 && worst > tol2) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Evenly pick at most n points, always including both ends. */
export function subsample(points, n) {
  const pts = points || [];
  if (n <= 0 || pts.length <= n) return pts;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (n - 1))]);
  return out;
}

/**
 * Emit a standalone TikZ document from walked tracks.
 *
 * The mirror image of traceDocument(): every track becomes an open \draw with
 * an explicit line width (a real stroke), not a filled outline. Text arrives
 * from the model and is placed as \node, because glyph outlines traced from
 * pixels are unreadable.
 */
export function linesDocument(raster, tracks, options) {
  const opts = options || {};
  const { w, h } = raster;
  const widthCm = opts.targetWidthCm == null ? 12 : opts.targetWidthCm;
  const k = widthCm / w;
  const heightCm = h * k;
  const fmt = function (v) { return String(Math.round(v * 1000) / 1000); };
  const pt = function (p) { return "(" + fmt(p[0] * k) + "," + fmt((h - p[1]) * k) + ")"; };
  const labels = Array.isArray(opts.labels) ? opts.labels : [];
  const lineWidthPt = opts.lineWidthPt == null ? 0.4 : opts.lineWidthPt;
  // One cubic per skeleton pixel costs megabytes; reduce first, then fit.
  const simplifyPx = opts.simplifyPx == null ? 0.8 : opts.simplifyPx;
  const maxPoints = opts.maxPoints == null ? 40 : opts.maxPoints;

  const body = [];
  let emitted = 0;
  let totalPoints = 0;
  for (const track of tracks || []) {
    const raw = Array.isArray(track.points) ? track.points : [];
    if (raw.length < 2) continue;
    let reduced = simplifyPx > 0 ? simplifyTrack(raw, simplifyPx) : raw.slice();
    if (reduced.length > maxPoints) reduced = subsample(reduced, maxPoints);
    if (reduced.length < 2) continue;
    totalPoints += reduced.length;
    const curve = interpolate({ points: reduced, color: track.color }, opts.samples == null ? 0 : opts.samples);
    if (!curve || !curve.path || !curve.path.length) continue;
    const rgb = Array.isArray(track.color) ? track.color : [0, 0, 0];
    const r = Math.round(rgb[0]), g = Math.round(rgb[1]), b = Math.round(rgb[2]);
    const chain = [pt(curve.start)]
      .concat(curve.path.map(function (s) { return ".. controls " + pt(s.c1) + " and " + pt(s.c2) + " .. " + pt(s.p); }))
      .join(" ");
    // 1 px at 12 cm over W pixels is 0.75 pt; honour a measured width when present.
    const width = typeof track.widthPx === "number" && track.widthPx > 0
      ? Math.max(0.25, Math.min(1.4, track.widthPx * 0.75))
      : lineWidthPt;
    body.push("\\draw[draw={rgb,255:red," + r + ";green," + g + ";blue," + b + "},line width=" + Math.round(width * 100) / 100 + "pt,line cap=round,line join=round] " + chain + ";");
    emitted++;
  }

  const nodes = [];
  let placed = 0;
  for (const label of labels) {
    const box = label && Array.isArray(label.box) ? label.box.map(Number) : null;
    const tex = label && typeof label.tex === "string" ? label.tex.trim() : "";
    if (!box || box.length !== 4 || box.some(function (n) { return !Number.isFinite(n); }) || !tex) continue;
    const cx = ((box[0] + box[2] / 2) / 1000) * w * k;
    const cy = heightCm - ((box[1] + box[3] / 2) / 1000) * h * k;
    const heightCmLabel = (box[3] / 1000) * h * k;
    const size = Math.max(4, Math.min(18, heightCmLabel * 28.3465 * 0.75));
    // A tall, narrow box is a rotated axis label.
    const rotate = box[3] > box[2] * 2.5 ? ", rotate=90" : "";
    const safe = safeNodeText(tex);
    nodes.push("\\node[anchor=center, inner sep=0pt, font=\\fontsize{" + fmt(size) + "}{" + fmt(size * 1.2) + "}\\selectfont" + rotate + "] at (" + fmt(cx) + "," + fmt(cy) + ") {" + safe + "};");
    placed++;
  }

  const textBlob = labels.map(function (l) { return l && typeof l.tex === "string" ? l.tex : ""; }).join(" ");
  const head = [
    "\\documentclass[tikz,border=0pt]{standalone}",
  ].concat(cjkPreamble(textBlob)).concat([
    "\\begin{document}",
    "\\begin{tikzpicture}",
    "% @viewport 0 0 " + fmt(widthCm) + " " + fmt(heightCm),
    "\\useasboundingbox (0,0) rectangle (" + fmt(widthCm) + "," + fmt(heightCm) + ");",
  ]);
  const document = head.concat(body, nodes, ["\\end{tikzpicture}", "\\end{document}"]).join("\n");
  return {
    code: document,
    stats: { tracks: (tracks || []).length, curves: emitted, points: totalPoints, nodes: placed, bytes: document.length },
  };
}

/** Interpolate a track into a smooth cubic chain (temporary stand-in for a fitted formula). */
export function interpolate(track, samples = 0) {
  const pts = track.points;
  if (pts.length < 2) return null;
  const sub = samples > 0 && pts.length > samples
    ? Array.from({ length: samples }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (samples - 1))])
    : pts;
  const start = sub[0];
  const path = [];
  for (let i = 0; i < sub.length - 1; i++) {
    const p0 = sub[i - 1] ?? sub[i];
    const p1 = sub[i];
    const p2 = sub[i + 1];
    const p3 = sub[i + 2] ?? p2;
    path.push({
      c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p: p2,
    });
  }
  return { start, path };
}
