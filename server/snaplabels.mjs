/**
 * Snap text boxes onto real ink.
 *
 * Vision models read the string correctly but place its box loosely — often
 * over the edge of the picture. The glyph pixels are still there, so trust the
 * model for WHAT the text is and the raster for WHERE it is: find the ink
 * cluster nearest the proposed box and use its bounding box.
 */

/** Binarise and return connected components (8-connected) as bounding boxes. */
function inkComponents(raster, threshold) {
  const { w, h, rgb } = raster;
  const ink = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    const g = (rgb[p] * 299 + rgb[p + 1] * 587 + rgb[p + 2] * 114) / 1000;
    if (g < threshold) ink[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % w;
      const y = (i - x) / w;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (ink[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
        }
      }
    }
    if (n >= 6) out.push({ x0, y0, x1, y1, n });
  }
  return out;
}

/** Merge boxes that nearly touch: a CJK glyph is often two radicals. */
function groupBoxes(boxes, gap) {
  const list = boxes.map(function (b) { return Object.assign({}, b); });
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const near = a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1;
        if (!near) continue;

        a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
        a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1); a.n += b.n;
        list.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return list;
}

/**
 * Replace each text element's box with the nearest ink cluster.
 * elements: [{kind:"text", box:[x,y,w,h], tex}] with box normalised 0..1000.
 * Returns { elements, snapped, missed }.
 */
export function snapTextElements(raster, elements, options) {
  const opts = options || {};
  const threshold = opts.threshold == null ? 170 : opts.threshold;
  const gap = opts.gapPx == null ? 6 : opts.gapPx;
  const list = Array.isArray(elements) ? elements : [];
  const texts = list.filter(function (e) { return e && e.kind === "text" && Array.isArray(e.box) && e.box.length === 4; });
  if (!texts.length) return { elements: list, snapped: 0, missed: 0 };

  const { w, h } = raster;
  // Keep only glyph-sized clusters *before* grouping: a bbox merge would
  // otherwise swallow the label into the bounding box of the figure outline.
  const small = inkComponents(raster, threshold).filter(function (c) {
    return (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) <= w * h * 0.05;
  });
  const groups = groupBoxes(small, gap);
  if (!groups.length) return { elements: list, snapped: 0, missed: texts.length };

  let snapped = 0, missed = 0;
  const used = new Set();
  for (const el of texts) {
    // The model can place a box far outside 0..1000; clamp before measuring or
    // the distance is dominated by the out-of-range offset.
    const bx = Math.max(0, Math.min(1000, Number(el.box[0]) || 0));
    const by = Math.max(0, Math.min(1000, Number(el.box[1]) || 0));
    const bw = Math.max(0, Math.min(1000 - bx, Number(el.box[2]) || 0));
    const bh = Math.max(0, Math.min(1000 - by, Number(el.box[3]) || 0));
    const cx = ((bx + bw / 2) / 1000) * w;
    const cy = ((by + bh / 2) / 1000) * h;
    const reach = Math.min(w, h) * (opts.reachRatio == null ? 0.45 : opts.reachRatio);
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < groups.length; i++) {
      if (used.has(i)) continue;
      const g = groups[i];

      // Distance to the box, not to its centre: an approximate box still gets
      // snapped to the cluster it overlaps.
      const dx = Math.max(g.x0 - cx, 0, cx - g.x1);
      const dy = Math.max(g.y0 - cy, 0, cy - g.y1);
      const dist = Math.hypot(dx, dy);
      // Shape gate: a wide cluster must not be stolen by a narrow label (that is how
      // "A" ended up on the cluster of "f"). Bounds are loose on purpose: the model's
      // box is only a rough prior.

      // Prefer close clusters, and slightly prefer compact ones (glyphs).
      // Match the WIDTH too: two labels stacked a few pixels apart are otherwise
      // easy to swap, and "m = 1" must not land on the long "1st supermode" run.
      // A label cannot be more than twice as tall as the model thinks it is:
      // such a cluster has merged two lines and its centre is meaningless.
      const gh = g.y1 - g.y0 + 1;
      const bhPx = (bh / 1000) * h;
      if (bhPx > 0 && gh > bhPx * 1.6) continue;
      const chars = Math.max(2, String(el.tex || "").replace(/\$[^$]*\$/g, "xx").length);
      const expected = chars * Math.max(4, bh) * 0.55;
      const actual = g.x1 - g.x0 + 1;
      const widthPenalty = Math.abs(Math.log((actual + 1) / (Math.max(6, expected) + 1))) * h * 0.08;
      const score = dist + widthPenalty + Math.max(0, (g.x1 - g.x0) - (g.y1 - g.y0) * 2.5) * 0.2;
      if (dist <= reach && score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) { missed++; continue; }
    used.add(best);
    // A CJK glyph is several fragments; grow the chosen box to absorb the ones
    // that belong to the same character (but never the whole figure).
    const g = Object.assign({}, groups[best]);
    // (grown below)
    let growing = true;
    while (growing) {
      growing = false;
      for (let i = 0; i < groups.length; i++) {
        if (used.has(i)) continue;
        const o = groups[i];
        // Radicals of one character can sit ~20 px apart at this scale.
        const absorb = 20;
        const near = g.x0 - absorb <= o.x1 && o.x0 - absorb <= g.x1 && g.y0 - absorb <= o.y1 && o.y0 - absorb <= g.y1;
        if (!near) continue;
        // Only merge neighbours that share the row: a label is a horizontal run
        // of glyphs. Merging vertically inflates the box and moves its centre,
        // which is how "1st supermode" ended up below "m = 1".
        const rowOverlap = Math.min(g.y1, o.y1) - Math.max(g.y0, o.y0);
        if (rowOverlap < Math.min(g.y1 - g.y0, o.y1 - o.y0) * 0.5) continue;
        const x0 = Math.min(g.x0, o.x0), y0 = Math.min(g.y0, o.y0);
        const x1 = Math.max(g.x1, o.x1), y1 = Math.max(g.y1, o.y1);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > w * h * 0.03) continue; // would swallow the figure
        if (bh > 0 && (y1 - y0 + 1) > bh * 1.6) continue; // keep the label's own height
        g.x0 = x0; g.y0 = y0; g.x1 = x1; g.y1 = y1; g.n += o.n;
        used.add(i);
        growing = true;
      }
    }
    el.box = [
      Math.max(0, (g.x0 - 1) / w * 1000),
      Math.max(0, (g.y0 - 1) / h * 1000),
      Math.min(1000, (g.x1 - g.x0 + 3) / w * 1000),
      Math.min(1000, (g.y1 - g.y0 + 3) / h * 1000),
    ];
    snapped++;
  }
  return { elements: list, snapped, missed };
}
