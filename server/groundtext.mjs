/**
 * Text grounding: match the strings a model read to the ink it actually
 * occupies, and find legend entries.
 *
 * Per-label nearest-neighbour search fights with itself when labels are small
 * and close (two labels grab the same blob). This module treats it as a global
 * assignment: find every text block once, then match strings to blocks.
 */

const lum = (r, i) => (r.rgb[i] * 299 + r.rgb[i + 1] * 587 + r.rgb[i + 2] * 114) / 1000;

/** Connected dark components. */
export function inkBlocks(raster, threshold) {
  const thr = threshold == null ? 180 : threshold;
  const w = raster.w, h = raster.h;
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || lum(raster, s * 3) >= thr) continue;
    stack.length = 0; stack.push(s); seen[s] = 1;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && lum(raster, q * 3) < thr) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n >= 4) out.push({ x0, y0, x1, y1, n });
  }
  return out;
}

/** Group components into text rows: same line, small horizontal gap. */
export function textBlocks(raster, options) {
  const opts = options || {};
  const w = raster.w, h = raster.h;
  const maxHeight = h * (opts.maxHeightRatio == null ? 0.25 : opts.maxHeightRatio);
  const parts = inkBlocks(raster, opts.threshold).filter((b) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    return bh <= maxHeight && bw <= w * 0.9 && bw * bh <= w * h * 0.05;
  });
  const rows = [];
  for (const b of parts.slice().sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0)) {
    let placed = false;
    for (const row of rows) {
      const overlap = Math.min(row.y1, b.y1) - Math.max(row.y0, b.y0);
      const minH = Math.min(row.y1 - row.y0, b.y1 - b.y0) + 1;
      const gap = b.x0 - row.x1;
      // Merge across a letter gap (a couple of glyphs of the same label) but not
      // across the wide gap that separates two tick labels.
      const allowGap = Math.max(6, Math.max(row.y1 - row.y0, b.y1 - b.y0) * 1.0);
      if (overlap >= minH * 0.5 && gap <= allowGap) {
        row.x0 = Math.min(row.x0, b.x0); row.x1 = Math.max(row.x1, b.x1);
        row.y0 = Math.min(row.y0, b.y0); row.y1 = Math.max(row.y1, b.y1);
        row.n += b.n;
        placed = true;
        break;
      }
    }
    if (!placed) rows.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, n: b.n });
  }
  // Split each row into words: "−9 −6 −3 3 6 9" on one axis row is SIX labels,
  // and matching them to one block would put five of them in the wrong place.
  const words = [];
  for (const row of rows) {
    const rowH = row.y1 - row.y0 + 1;
    const gapMin = Math.max(4, Math.round(rowH * 0.7));
    const cols = [];
    for (let x = row.x0; x <= row.x1; x++) {
      let hit = 0;
      for (let y = row.y0; y <= row.y1; y++) if (lum(raster, (y * w + x) * 3) < 180) hit++;
      cols.push(hit);
    }
    let start = 0;
    let gap = 0;
    for (let i = 0; i <= cols.length; i++) {
      const empty = i === cols.length || cols[i] === 0;
      if (empty && i < cols.length) { gap++; continue; }
      if (gap >= gapMin || i === cols.length) {
        const end = i - gap;
        if (end > start) {
          let x0 = row.x0 + start, x1 = row.x0 + end - 1;
          if (x1 >= x0) {
            let y0 = row.y1, y1 = row.y0;
            for (let x = x0; x <= x1; x++) {
              for (let y = row.y0; y <= row.y1; y++) {
                if (lum(raster, (y * w + x) * 3) >= 180) continue;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
              }
            }
            if (y1 >= y0) {
              words.push({
                x: (x0 + x1 + 1) / 2, y: (y0 + y1 + 1) / 2,
                w: x1 - x0 + 1, h: y1 - y0 + 1, n: row.n, row: rows.indexOf(row),
              });
            }
          }
        }
        start = i + 1;
        gap = 0;
      }
    }
  }
  // A coloured dotted curve is a string of same-size dots that a connected-
  // component pass cannot tell from glyphs. Colour can: text is grey/black
  // (chroma ~0), a coloured data line is not. Drop the coloured blocks.
  const keep = [];
  for (const word of words) {
    const cx = Math.round(word.x), cy = Math.round(word.y);
    let chromaSum = 0, n = 0;
    for (let y = Math.max(0, cy - 4); y <= Math.min(raster.h - 1, cy + 4); y++) {
      for (let x = Math.max(0, cx - 4); x <= Math.min(raster.w - 1, cx + 4); x++) {
        const i = (y * raster.w + x) * 3;
        if (lum(raster, i) >= 200) continue;
        chromaSum += Math.max(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]) - Math.min(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]);
        n++;
      }
    }
    if (n && chromaSum / n >= 35) continue; // coloured data, not text
    keep.push(word);
  }
  return keep;
}

/** Global assignment of strings to text blocks (greedy on the best pair). */
/** Consecutive words of one row are also candidate blocks ("1st supermode"). */
export function mergeRuns(words, maxWords) {
  const limit = maxWords == null ? 4 : maxWords;
  const out = [];
  const byRow = new Map();
  for (const word of words) {
    const key = word.row == null ? -1 : word.row;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(word);
  }
  for (const [rowKey, list] of byRow) {
    const sorted = list.slice().sort(function (a, b) { return a.x - b.x; });
    for (let i = 0; i < sorted.length; i++) {
      for (let len = 1; len <= limit && i + len <= sorted.length; len++) {
        const run = sorted.slice(i, i + len);
        const x0 = Math.min.apply(null, run.map(function (r) { return r.x - r.w / 2; }));
        const x1 = Math.max.apply(null, run.map(function (r) { return r.x + r.w / 2; }));
        const y0 = Math.min.apply(null, run.map(function (r) { return r.y - r.h / 2; }));
        const y1 = Math.max.apply(null, run.map(function (r) { return r.y + r.h / 2; }));
        out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, n: 0, row: rowKey, words: len, from: i });
      }
    }
  }
  return out;
}

export function matchLabels(labels, blocks, options) {
  const opts = options || {};
  const W = opts.w || 1000;
  const H = opts.h || 1000;
  const diag = Math.hypot(W, H) * 0.5;
  const pairs = [];
  (labels || []).forEach((label, li) => {
    const box = label.box || [];
    const chars = Math.max(2, String(label.tex || '').replace(/\$[^$]*\$/g, 'xx').length);
    // Everything in pixels: the model's box is normalised, the blocks are not.
    const bwPx = Math.max(3, ((box[2] || 10) / 1000) * W);
    const bhPx = Math.max(3, ((box[3] || 10) / 1000) * H);
    const cx = ((box[0] || 0) + (box[2] || 0) / 2) / 1000 * W;
    const cy = ((box[1] || 0) + (box[3] || 0) / 2) / 1000 * H;
    (blocks || []).forEach((block, bi) => {
      // The model's box size is a better prior than a character count: it saw the
      // glyphs, it just placed them roughly.
      const wPen = Math.abs(Math.log((block.w + 1) / (bwPx + 1)));
      const hPen = Math.abs(Math.log((block.h + 1) / (bhPx + 1)));
      // The model box is the prior: it is roughly right, so distance is a mild
      // penalty and the width/height ratios do the discriminating.
      // block.x/y are the block CENTRE (textBlocks returns the middle), same as cx/cy.
      const bx = block.x;
      const by = block.y;
      const dist = Math.hypot(bx - cx, by - cy);
      const dPen = dist / diag;
      // A candidate must be on the same line as the model box: a fragment from a
      // different row (the "z)" of γ(z)) must not win just by scoring slightly lower.
      const vGap = Math.abs(by - cy);
      const sameRow = vGap <= Math.max(14, bhPx * 0.9);
      pairs.push({ li, bi, dist, vGap, sameRow, score: wPen * 1.5 + hPen + dPen * 2.5 });
    });
  });
  // Prefer multi-word runs only when they score better; a single word that
  // already fits must not be rejected because a run happens to exist.
  // A string with no ink block anywhere near its box is not on the page: the
  // vision model invents legend entries. Reject by DISTANCE (a size mismatch is
  // normal, a 120 px gap is not), then let the greedy pass assign the rest.
  // Size and shape dominate; the vertical gap is only a mild prior (the model's
  // box for a label can be off by a whole line without being the wrong string).
  pairs.sort((a, b) => a.score - b.score);
  const usable = pairs;
  const usedL = new Set(), usedB = new Set();
  const usedWords = new Set();
  const result = [];
  for (const p of usable) {
    if (usedL.has(p.li) || usedB.has(p.bi)) continue;
    const block = blocks[p.bi];
    if (block && block.words) {
      let clash = false;
      for (let k = 0; k < block.words; k++) if (usedWords.has(block.row + ":" + (block.from + k))) clash = true;
      if (clash) continue;
      for (let k = 0; k < block.words; k++) usedWords.add(block.row + ":" + (block.from + k));
    }
    // Only act when the pairing is unambiguous: a wrong move is worse than a
    // rough one, because the node lands on someone else's glyphs.
    if (p.score > (opts.maxScore == null ? 0.9 : opts.maxScore)) continue;
    usedL.add(p.li); usedB.add(p.bi);
    result.push({ labelIndex: p.li, blockIndex: p.bi, score: p.score });
  }
  return { matches: result, unmatched: (labels || []).map((_, i) => i).filter((i) => !usedL.has(i)) };
}
/**
 * Legend entries: a short isolated horizontal stroke with a label to its right.
 * Returns [{ x0, y0, x1, y1, color }] in pixels inside the given frame.
 */
export function detectLegend(raster, bounds, options) {
  const opts = options || {};
  if (!bounds) return [];
  const w = raster.w, h = raster.h;
  const x0 = Math.max(0, Math.round(bounds.x0)), x1 = Math.min(w - 1, Math.round(bounds.x1));
  const y0 = Math.max(0, Math.round(bounds.y0)), y1 = Math.min(h - 1, Math.round(bounds.y1));
  const lum = (i) => (raster.rgb[i] * 299 + raster.rgb[i + 1] * 587 + raster.rgb[i + 2] * 114) / 1000;
  const chroma = (i) => Math.max(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]) - Math.min(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]);
  // collect coloured horizontal runs
  const runs = [];
  for (let y = y0 + 2; y < y1 - 1; y++) {
    let start = -1;
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      const i = (y * w + x) * 3;
      const colored = chroma(i) > 25 && lum(i) < 240;
      if (colored && start < 0) start = x;
      if ((!colored || x === x1 - 2) && start >= 0) {
        const len = x - start;
        // Short strokes are kept too: two of them side by side form a dotted
        // sample stroke (the legend of a dotted curve in the source figure).
        if (len >= 6 && len <= 90) runs.push({ y, x0: start, x1: x - 1, len });
        start = -1;
      }
    }
  }
  // merge runs on consecutive rows into bands (a stroke is 2-8 px thick)
  const bands = [];
  for (const run of runs) {
    const band = bands.find((b) => Math.abs(b.x0 - run.x0) <= 4 && Math.abs(b.x1 - run.x1) <= 6 && run.y - b.y1 <= 1);
    if (band) { band.y1 = run.y; band.x1 = Math.max(band.x1, run.x1); band.x0 = Math.min(band.x0, run.x0); }
    else bands.push({ x0: run.x0, x1: run.x1, y0: run.y, y1: run.y });
  }
  // Two neighbouring short strokes on the same row = one dotted sample stroke.
  const merged = [];
  for (const band of bands.slice().sort((a, b) => a.x0 - b.x0)) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.y0 - band.y0) <= 3 && Math.abs(prev.y1 - band.y1) <= 3
      && band.x0 - prev.x1 > 0 && band.x0 - prev.x1 <= 8 && (prev.x1 - prev.x0) < 16 && (band.x1 - band.x0) < 16) {
      prev.x1 = band.x1;
      prev.dottedPair = true;
      continue;
    }
    merged.push(Object.assign({}, band));
  }
  const blocks = textBlocks(raster, { threshold: 180 });
  const out = [];
  for (const band of merged) {
    const thick = band.y1 - band.y0 + 1;
    const len = band.x1 - band.x0 + 1;
    // Thick dots can merge into one short band: allow a taller band when it is
    // short (a legend sample stroke), but never a full-width curve.
    if (thick < 1 || len < 15) continue;
    if (thick > 9 && !(thick <= 16 && len <= 45)) continue;
    if (band.x1 > x0 + (x1 - x0) * (opts.maxXFraction == null ? 0.55 : opts.maxXFraction)) continue; // sample strokes sit at the left
    // isolated: whiteness above and below
    // Isolated = no real ink within a few pixels above or below (the soft
    // antialiased edge of the stroke itself must not count as ink).
    let clean = true;
    for (let dy = 3; dy <= 6 && clean; dy++) {
      for (let x = band.x0; x <= band.x1; x++) {
        const ya = band.y0 - dy, yb = band.y1 + dy;
        if (ya >= 0 && lum((ya * w + x) * 3) < 205) { clean = false; break; }
        if (yb < h && lum((yb * w + x) * 3) < 205) { clean = false; break; }
      }
    }
    if (!clean && opts.requireIsolation !== false) continue;
    const cy = (band.y0 + band.y1) / 2;
    // t.x is the block's left edge. A legend label can be a long string, so the
    // gap allowance is generous (the swatch sits ~5..80 px left of the text).
    const label = blocks
      .filter((t) => t.x - t.w / 2 - band.x1 >= -4 && t.x - t.w / 2 - band.x1 <= 80 && Math.abs(cy - t.y) <= t.h / 2 + 12)
      .sort((a, b) => (a.x - a.w / 2 - band.x1) - (b.x - b.w / 2 - band.x1))[0];
    if (!label && opts.requireLabel !== false) continue;
    // colour: median of the band's core rows
    const px = [];
    for (let y = band.y0; y <= band.y1; y++) for (let x = band.x0; x <= band.x1; x++) {
      const i = (y * w + x) * 3;
      if (lum(i) < 240) px.push([raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]]);
    }
    if (!px.length) continue;
    const med = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1];
    // dashes: gaps inside the band at its centre row
    let gaps = 0;
    for (let x = band.x0; x <= band.x1; x++) {
      const i = (Math.round(cy) * w + x) * 3;
      if (lum(i) >= 240) gaps++;
    }
    out.push({
      x0: band.x0, y0: band.y0, x1: band.x1, y1: band.y1,
      color: [med(0), med(1), med(2)],
      dashed: band.dottedPair || gaps > (len * 0.12),
      label: label ? { x: label.x, y: label.y, w: label.w, h: label.h } : null,
    });
  }
  return out;
}

/**
 * Detect a legend swatch in the small window immediately left of an already
 * transcribed label. This is more reliable than global run finding for pale
 * antialiased strokes, while remaining a local legend-object detector rather
 * than a curve or pixel tracer.
 */
export function detectLegendNearLabels(raster, bounds, labels, options) {
  const opts = options || {};
  if (!bounds) return [];
  const w = raster.w, h = raster.h;
  const lumAt = (x, y) => {
    const i = (y * w + x) * 3;
    return (raster.rgb[i] * 299 + raster.rgb[i + 1] * 587 + raster.rgb[i + 2] * 114) / 1000;
  };
  const chromaAt = (x, y) => {
    const i = (y * w + x) * 3;
    return Math.max(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]) - Math.min(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]);
  };
  const out = [];
  for (const label of labels || []) {
    const box = Array.isArray(label && label.box) ? label.box.map(Number) : null;
    if (!box || box.some((v) => !Number.isFinite(v))) continue;
    const left = (box[0] / 1000) * w;
    const top = (box[1] / 1000) * h;
    const bw = (box[2] / 1000) * w, bh = (box[3] / 1000) * h;
    const cx = left + bw / 2, cy = top + bh / 2;
    const text = String(label.tex || "").replace(/\$/g, "").trim();
    if (!text || /^-?\d+(\.\d+)?$/.test(text)) continue;
    if (cx > bounds.x0 + (bounds.x1 - bounds.x0) * (opts.maxLabelFraction || 0.42)) continue;
    if (cy < bounds.y0 || cy > bounds.y1) continue;
    const sx0 = Math.max(Math.round(bounds.x0 + 2), Math.round(left - Math.max(95, bw * 1.3)));
    const sx1 = Math.min(Math.round(left - 3), Math.round(bounds.x1));
    const sy0 = Math.max(Math.round(bounds.y0), Math.round(cy - Math.max(9, bh * 0.7)));
    const sy1 = Math.min(Math.round(bounds.y1), Math.round(cy + Math.max(9, bh * 0.7)));
    if (sx1 - sx0 < 10) continue;
    const pixels = [];
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
      if (chromaAt(x, y) > 18 && lumAt(x, y) < 245) pixels.push([x, y]);
    }
    if (pixels.length < 10) continue;
    // Prefer the rightmost compact coloured component: it is the sample nearest
    // the label, whereas any plot curve lies farther away.
    const columns = new Map();
    for (const [x, y] of pixels) {
      const col = columns.get(x) || [];
      col.push(y); columns.set(x, col);
    }
    const xs = [...columns.keys()].sort((a, b) => a - b);
    const groups = [];
    for (const x of xs) {
      const last = groups.at(-1);
      if (last && x - last.at(-1) <= 9) last.push(x);
      else groups.push([x]);
    }
    const group = groups.filter((g) => g.at(-1) - g[0] + 1 >= 14 && g.at(-1) - g[0] + 1 <= 95).at(-1);
    if (!group) continue;
    const gx0 = group[0], gx1 = group.at(-1);
    const core = pixels.filter(([x]) => x >= gx0 && x <= gx1);
    const ys = core.map((p) => p[1]);
    const gy0 = Math.min(...ys), gy1 = Math.max(...ys);
    if (gy1 - gy0 > Math.max(18, bh)) continue;
    const hitColumns = new Set(core.map((p) => p[0])).size;
    const occupancy = hitColumns / Math.max(1, gx1 - gx0 + 1);
    const rgb = [0, 1, 2].map((k) => {
      const values = core.map(([x, y]) => raster.rgb[(y * w + x) * 3 + k]).sort((a, b) => a - b);
      return values[values.length >> 1];
    });
    out.push({
      x0: gx0, x1: gx1, y0: gy0, y1: gy1,
      color: rgb, dotted: occupancy < 0.72, dashed: occupancy < 0.72,
      label: { x: cx, y: cy, w: bw, h: bh, tex: label.tex },
    });
  }
  return out;
}
/** Dotted legend swatches: a short row of small coloured dots plus a label. */
export function detectDottedLegend(raster, bounds, options) {
  const opts = options || {};
  if (!bounds) return [];
  const w = raster.w, h = raster.h;
  const x0 = Math.max(0, Math.round(bounds.x0)), x1 = Math.min(w - 1, Math.round(bounds.x1));
  const y0 = Math.max(0, Math.round(bounds.y0)), y1 = Math.min(h - 1, Math.round(bounds.y1));
  const lum = (i) => (raster.rgb[i] * 299 + raster.rgb[i + 1] * 587 + raster.rgb[i + 2] * 114) / 1000;
  const chroma = (i) => Math.max(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]) - Math.min(raster.rgb[i], raster.rgb[i + 1], raster.rgb[i + 2]);
  const left = x0 + 2, right = x0 + (x1 - x0) * 0.55;
  const seen = new Uint8Array(w * h);
  const dots = [];
  const stack = [];
  for (let y = y0 + 2; y < y1; y++) {
    for (let x = left; x < right; x++) {
      const p = y * w + x;
      if (seen[p]) continue;
      const i = p * 3;
      if (!(chroma(i) > 25 && lum(i) < 240)) continue;
      stack.length = 0; stack.push(p); seen[p] = 1;
      let bx0 = x, bx1 = x, by0 = y, by1 = y, n = 0;
      while (stack.length) {
        const q = stack.pop();
        const qx = q % w, qy = (q - qx) / w;
        n++;
        if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx;
        if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < left || ny < y0 || nx >= right || ny >= y1) continue;
          const np = ny * w + nx;
          if (seen[np]) continue;
          const ni = np * 3;
          if (chroma(ni) > 25 && lum(ni) < 240) { seen[np] = 1; stack.push(np); }
        }
      }
      // Two fat dots merge into one ~24x12 blob (~290 px): do not cap at 200.
      if (n >= 3 && n <= 800) dots.push({ x0: bx0, x1: bx1, y0: by0, y1: by1, n });
    }
  }
  const blocks = textBlocks(raster, { threshold: 180 });
  const rows = [];
  for (const dot of dots) {
    const row = rows.find((r2) => Math.abs(r2.cy - (dot.y0 + dot.y1) / 2) <= 6);
    if (row) { row.items.push(dot); row.cy = (row.cy * (row.items.length - 1) + (dot.y0 + dot.y1) / 2) / row.items.length; }
    else rows.push({ cy: (dot.y0 + dot.y1) / 2, items: [dot] });
  }
  const out = [];
  // Legend samples are COMPACT clusters; a dotted curve is a long run with wide
  // spacing. Chain dots by adjacency (gap <= 12 px) and judge each chain, instead
  // of grouping by row (which merged a legend dot with a curve dot 400 px away).
  // Cluster by 2D proximity, NOT by x-order: the curve's dots interleave with
  // the legend dots in x, so a left-to-right chain split the pair apart.
  const sorted = dots.slice().sort((a, b) => a.x0 - b.x0);
  const usedDot = new Set();
  const chains = [];
  for (let i = 0; i < sorted.length; i++) {
    if (usedDot.has(i)) continue;
    const cluster = [sorted[i]];
    usedDot.add(i);
    let grew = true;
    while (grew) {
      grew = false;
      const last = cluster[cluster.length - 1];
      for (let j = 0; j < sorted.length; j++) {
        if (usedDot.has(j)) continue;
        const d = sorted[j];
        const gap = d.x0 - last.x1;
        const dy = Math.abs((d.y0 + d.y1) / 2 - ((last.y0 + last.y1) / 2));
        if (gap >= 1 && gap <= 12 && dy <= 4) { cluster.push(d); usedDot.add(j); grew = true; break; }
      }
    }
    chains.push(cluster);
  }
  const emit = (x0, y0, x1, y1, chainDots, label) => {
    const pick = (k) => {
      const v = chainDots.map((d) => {
        const i = (Math.round((d.y0 + d.y1) / 2) * w + Math.round((d.x0 + d.x1) / 2)) * 3;
        return raster.rgb[i + k];
      }).sort((a, b) => a - b);
      return v[v.length >> 1];
    };
    out.push({
      x0, y0, x1, y1,
      color: [pick(0), pick(1), pick(2)], dashed: true, dotted: true,
      label: { x: label.x, y: label.y, w: label.w, h: label.h },
    });
  };
  for (const chain of chains) {
    if (chain.length < 2 || chain.length > 8) continue;
    const first = chain[0], last = chain[chain.length - 1];
    const span = last.x1 - first.x0 + 1;
    if (span < 18 || span > 90) continue;
    const cy = chain.reduce((s, d) => s + (d.y0 + d.y1) / 2, 0) / chain.length;
    const near = blocks.filter((t) => t.x - last.x1 >= -2 && t.x - last.x1 <= 90);
    const label = near
      .filter((t) => cy >= t.y - 26 && cy <= t.y + t.h + 26)
      .sort((p, q) => (p.x - last.x1) - (q.x - last.x1))[0];
    if (!label) continue;
    emit(first.x0 - 2, Math.round(cy) - 3, last.x1 + 2, Math.round(cy) + 3, chain, label);
  }
  // A pair of fat dots can also merge into ONE blob: treat a short wide blob whose
  // centre row has gaps as a dotted sample too.
  for (const d of sorted) {
    const wide = d.x1 - d.x0 + 1, thick = d.y1 - d.y0 + 1;
    if (wide < 18 || wide > 45 || thick > 16) continue;
    const cy = Math.round((d.y0 + d.y1) / 2);
    let gaps = 0;
    for (let x = d.x0; x <= d.x1; x++) if (lum((cy * w + x) * 3) >= 235) gaps++;
    if (gaps < 3) continue;
    const label = blocks
      .filter((t) => t.x - d.x1 >= -2 && t.x - d.x1 <= 90 && cy >= t.y - 26 && cy <= t.y + t.h + 26)
      .sort((p, q) => (p.x - d.x1) - (q.x - d.x1))[0];
    if (!label) continue;
    if (out.some((e) => Math.abs(e.x0 - d.x0) < 20 && Math.abs(e.y0 - cy) < 20)) continue;
    emit(d.x0 - 2, cy - 3, d.x1 + 2, cy + 3, [d], label);
  }
  return out;
}

/** The longest horizontal ink run: the bottom axis (or the frame's bottom edge). */
export function findAxis(raster, threshold) {
  const thr = threshold == null ? 180 : threshold;
  const w = raster.w, h = raster.h;
  let best = { y: 0, x0: 0, x1: -1, len: 0 };
  for (let y = 0; y < h; y++) {
    let run = 0, start = 0;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && lum(raster, (y * w + x) * 3) < thr;
      if (dark) { if (!run) start = x; run++; continue; }
      if (run > best.len) best = { y, x0: start, x1: x - 1, len: run };
      run = 0;
    }
  }
  return best.len > w * 0.3 ? best : null;
}

/** Tick marks under an axis: x positions of the short strokes. */
export function tickPositions(raster, axis, options) {
  if (!axis) return [];
  const opts = options || {};
  const thr = opts.threshold == null ? 180 : opts.threshold;
  const w = raster.w, h = raster.h;
  const band = opts.band == null ? 10 : opts.band;
  const scan = function (dir) {
    const hits = [];
    for (let x = axis.x0 + 2; x <= axis.x1 - 2; x++) {
      let n = 0;
      for (let dy = 2; dy <= band; dy++) {
        const y = axis.y + dir * dy;
        if (y < 0 || y >= h) continue;
        if (lum(raster, (y * w + x) * 3) < thr) n++;
      }
      hits.push(n);
    }
    const centers = [];
    let run = 0, start = 0;
    for (let i = 0; i <= hits.length; i++) {
      const on = i < hits.length && hits[i] >= 2;
      if (on) { if (!run) start = i; run++; continue; }
      if (run >= 1 && run <= 10) centers.push(axis.x0 + 2 + start + (run - 1) / 2);
      run = 0;
    }
    return centers;
  };
  const below = scan(1);
  const above = scan(-1);
  return below.length >= above.length ? below : above;
}

/** Numeric tick strings, in the order the model listed them. */
export function numericLabels(labels) {
  const clean = (tex) => String(tex || "").replace(/\$/g, "").replace(/\u2212/g, "-").trim();
  return (labels || []).map((label, index) => ({ label, index }))
    .filter((x) => /^-?\d+(\.\d+)?$/.test(clean(x.label.tex)));
}

/** Pair axis tick strings with the tick row found in the ink. */
export function pairNumericRow(numeric, blocks, options) {
  const opts = options || {};
  const tol = opts.rowTolerance == null ? 8 : opts.rowTolerance;
  if (!numeric.length || !blocks.length) return { matches: [], row: null };
  const rows = [];
  for (const b of blocks) {
    const row = rows.find((r) => Math.abs(r.y - b.y) <= tol);
    if (row) { row.items.push(b); row.y = (row.y * (row.items.length - 1) + b.y) / row.items.length; }
    else rows.push({ y: b.y, items: [b] });
  }
  const usable = rows.filter((r) => r.items.length >= 2 && r.items.length <= numeric.length);
  if (!usable.length) return { matches: [], row: null };
  let best = null;
  for (const row of usable) {
    const near = numeric.slice().map((item) => {
      const box = item.label.box || [0, 0, 10, 10];
      const cy = (box[1] || 0) + (box[3] || 0) / 2;
      return { item, dy: Math.abs(cy - (row.y / (opts.h || 326)) * 1000) };
    }).sort((a, b) => a.dy - b.dy).slice(0, row.items.length);
    const cost = near.reduce((s, n) => s + n.dy, 0) / near.length;
    if (!best || cost < best.cost) best = { row, near, cost };
  }
  if (!best) return { matches: [], row: null };
  const sortedBlocks = best.row.items.slice().sort((a, b) => a.x - b.x);
  const sortedLabels = best.near.slice().sort((a, b) => ((a.item.label.box || [0])[0] || 0) - ((b.item.label.box || [0])[0] || 0));
  const matches = sortedLabels.map((entry, k) => ({ labelIndex: entry.item.index, block: sortedBlocks[k], score: entry.dy }));
  return { matches, row: { y: best.row.y, count: best.row.items.length } };
}

/** Assign strings to blocks by rank within a row. */
export function assignByRow(labels, blocks, options) {
  const opts = options || {};
  const H = opts.h || 1000;
  if (!labels.length || !blocks.length) return { matches: [], rest: labels.map((_, i) => i) };
  const rows = [];
  for (const b of blocks) {
    const row = rows.find((r) => Math.abs(r.y - b.y) <= Math.max(4, Math.min(r.h, b.h) * 0.6));
    if (row) { row.items.push(b); row.y = (row.y * (row.items.length - 1) + b.y) / row.items.length; row.h = Math.max(row.h, b.h); }
    else rows.push({ y: b.y, h: b.h, items: [b] });
  }
  const matches = [];
  const placed = new Set();
  for (const row of rows) {
    const near = [];
    labels.forEach((label, i) => {
      if (placed.has(i)) return;
      const box = label.box || [0, 0, 10, 10];
      const cy = ((box[1] || 0) + (box[3] || 0) / 2) / 1000 * H;
      if (Math.abs(cy - row.y) <= Math.max(6, row.h * 2.2)) near.push(i);
    });
    if (near.length !== row.items.length || near.length < 2) continue;
    const ls = near.slice().sort((a, b) => (labels[a].box[0] || 0) - (labels[b].box[0] || 0));
    const bs = row.items.slice().sort((a, b) => a.x - b.x);
    ls.forEach((li, k) => { placed.add(li); matches.push({ labelIndex: li, blockIndex: blocks.indexOf(bs[k]), score: 0 }); });
  }
  return { matches, rest: labels.map((_, i) => i).filter((i) => !placed.has(i)) };
}
