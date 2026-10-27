/**
 * Where do the characters go? Models "draw" a curve by pasting hundreds of
 * sampled coordinates instead of writing plot[domain=...] — that is why a
 * single figure can reach 20k+ characters and get truncated.
 */

/** Count coordinate pairs inside plot ... coordinates { ... }. */
export function analyzeSource(code) {
  const src = String(code || "");
  let coords = 0;
  let plotBlocks = 0;
  for (const m of src.matchAll(/plot\s*(?:\[[^\]]*\])?\s*coordinates\s*\{([^}]*)\}/g)) {
    plotBlocks++;
    coords += (m[1].match(/\(\s*[-\d.]+\s*,\s*[-\d.]+\s*\)/g) || []).length;
  }
  const draws = (src.match(/\\draw\b/g) || []).length;
  const nodes = (src.match(/\\node\b/g) || []).length;
  const axisTicks = (src.match(/\\foreach/g) || []).length;
  const chars = src.length;
  const lines = src.split("\n").length;
  const coordChars = plotBlocks ? coords * 14 : 0;
  const biggest = coords > 120 ? "coordinates" : draws + nodes > 80 ? "elements" : "other";
  return { chars, lines, coords, plotBlocks, draws, nodes, axisTicks, coordShare: chars ? Math.min(1, coordChars / chars) : 0, biggest };
}

/** Whitespace/comments are pure tokens: strip them when a document gets big. */
export function compactSource(code) {
  const before = String(code || "").length;
  const out = [];
  for (const raw of String(code || "").split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trimEnd();
    if (!line.trim()) continue;                              // blank line
    if (/^\s*%\s*y\s*=/.test(line)) { out.push(line); continue; }  // plot hint
    if (/^\s*%/.test(line)) continue;                       // comment
    out.push(line);
  }
  const text = out.join("\n");
  return { code: text, before, after: text.length, changed: text.length !== before };
}

/** Perpendicular distance from p to segment ab (all in cm). */
function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Douglas–Peucker: keep the points that carry the shape, drop the rest.
 * Unlike uniform decimation this spends points where the curve bends, so a
 * 500-point sine collapses to a few dozen points with a bounded error.
 */
export function simplifyPoints(points, eps = 0.004) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    let worst = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDistance(points[i], points[a], points[b]);
      if (d > worst) {
        worst = d;
        idx = i;
      }
    }
    if (worst > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Keep at most `max` points per coordinates block. Evenly spaced, endpoints kept,
 * so the shape survives while the document shrinks.
 */
export function shrinkCoordinates(code, max = 120, eps = 0.004) {
  let before = 0;
  let after = 0;
  let maxError = 0;
  const out = String(code || "").replace(
    /(plot\s*(?:\[[^\]]*\])?\s*coordinates\s*\{)([^}]*)(\})/g,
    (whole, head, body, tail) => {
      const raw = body.match(/\(\s*[-\d.]+\s*,\s*[-\d.]+\s*\)/g) || [];
      before += raw.length;
      if (raw.length <= 40) {
        after += raw.length;
        return whole;
      }
      const nums = raw.map((s) => s.replace(/[()\s]/g, "").split(",").map(Number));
      // Shape-preserving first: keep only the points that matter.
      let kept = simplifyPoints(nums, eps);
      if (kept.length > max) {
        const step = kept.length / max;
        const thinned = [];
        for (let i = 0; i < max; i++) thinned.push(kept[Math.round(i * step)] ?? kept[kept.length - 1]);
        thinned[thinned.length - 1] = kept[kept.length - 1];
        kept = thinned;
      }
      // Report the worst deviation introduced by the simplification.
      for (const p of nums) {
        let best = Infinity;
        for (let i = 0; i < kept.length - 1; i++) best = Math.min(best, perpDistance(p, kept[i], kept[i + 1]));
        if (best > maxError) maxError = best;
      }
      after += kept.length;
      const text = kept.map(([x, y]) => `(${Number(x.toFixed(4))},${Number(y.toFixed(4))})`).join(" ");
      return head + text + tail;
    }
  );
  return { code: out, before, after, maxError, changed: before !== after };
}
