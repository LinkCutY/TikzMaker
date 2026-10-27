/**
 * Atomic legend entries.
 *
 * A legend is a LIST OF OBJECTS, not a couple of loose strokes: every entry owns
 * its sample line, its label, the baseline they share and the series it belongs
 * to. Entries are created, moved and replaced as whole objects, so a stroke can
 * never survive its label (which is how "labels swapped" appeared).
 */

const isNum = (v) => Number.isFinite(Number(v));

/** Build one entry from a detected sample stroke and its label block. */
export function makeLegendEntry({ index, sample, label, seriesId }) {
  const y = sample && isNum(sample.y0) ? (Number(sample.y0) + Number(sample.y1)) / 2 : null;
  return {
    id: "legend-" + (index + 1),
    seriesId: seriesId || null,
    mode: label && label.mode === "text" ? "text" : "math",
    tex: label ? String(label.tex || label.text || "") : "",
    sample: sample
      ? {
          x0: Number(sample.x0), x1: Number(sample.x1),
          y0: Number(sample.y0), y1: Number(sample.y1),
          color: sample.color || "#000000",
          width: Number(sample.width) || 2,
          dash: sample.dash || (sample.dotted ? "dotted" : sample.dashed ? "dashed" : "solid"),
        }
      : null,
    label: label || null,
    baseline: y,
    confidence: sample && label ? 0.9 : 0.5,
  };
}

/**
 * Pair samples with labels on the SAME baseline. A label with no sample is not a
 * legend entry: the plan forbids inventing legend content from "there are curves".
 */
export function pairLegendEntries(samples, labels) {
  const entries = [];
  const usedLabels = new Set();
  (samples || []).forEach((sample, i) => {
    const y = (Number(sample.y0) + Number(sample.y1)) / 2;
    let best = -1, bestD = Infinity;
    (labels || []).forEach((label, j) => {
      if (usedLabels.has(j) || !isNum(label.y)) return;
      const dy = Math.abs(Number(label.y) - y);
      const labelLeft = Number(label.x) - (Number(label.w) || 0) / 2;
      const gap = labelLeft - Number(sample.x1);
      const maxGap = Math.max(80, (Number(label.w) || 20) * 2.5);
      // A legend label belongs to the sample immediately to its left. This avoids
      // pairing an unrelated tick or annotation that merely shares the same row.
      if (gap < -Math.max(8, (Number(label.w) || 0) * 0.15) || gap > maxGap) return;
      const score = dy + Math.max(0, gap) * 0.04;
      if (score < bestD) { bestD = score; best = j; }
    });
    const label = best >= 0 && Math.abs(Number(labels[best].y) - y) <= Math.max(14, (Number(labels[best].h) || 10) * 0.9) ? labels[best] : null;
    if (label) usedLabels.add(best);
    entries.push(makeLegendEntry({ index: i, sample, label }));
  });
  return entries.filter((e) => e.sample);
}

/** Bind each entry to a measured series by colour and dash. */
export function bindSeries(entries, series) {
  const toRgb = (hex) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  };
  return entries.map((entry) => {
    const a = toRgb(entry.sample && entry.sample.color);
    if (!a) return entry;
    let best = null, bestD = Infinity;
    for (const s of series || []) {
      const b = toRgb(s.color);
      if (!b) continue;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const dashBonus = (entry.sample.dash === (s.dash || "solid")) ? 0 : 60;
      if (d + dashBonus < bestD) { bestD = d + dashBonus; best = s; }
    }
    if (!best || bestD > 140) return entry;
    return Object.assign({}, entry, { seriesId: best.id, confidence: 0.95 });
  });
}

/** Structural checks. Returns human-readable problems, never throws. */
export function validateLegend(entries, options) {
  const opts = options || {};
  const problems = [];
  const ids = new Set();
  const seriesIds = new Set();
  for (const e of entries || []) {
    if (!e.id) problems.push("entry without id");
    if (ids.has(e.id)) problems.push("duplicate entry id " + e.id);
    ids.add(e.id);
    if (!e.sample) problems.push(e.id + " has no sample stroke");
    if (!String(e.tex || "").trim()) problems.push(e.id + " has no label text");
    if (!e.seriesId) problems.push(e.id + " is not bound to a series");
    else if (seriesIds.has(e.seriesId)) problems.push("series " + e.seriesId + " has two legend entries");
    else seriesIds.add(e.seriesId);
    if (opts.series && e.seriesId && !opts.series.some((s) => s.id === e.seriesId)) {
      problems.push(e.id + " points at unknown series " + e.seriesId);
    }
  }
  // A legend richer than the plot is invented content.
  if (opts.series && (entries || []).length > opts.series.length) {
    problems.push("more legend entries (" + entries.length + ") than series (" + opts.series.length + ")");
  }
  return problems;
}

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

/** "#rrggbb" is NOT a TikZ colour: emit the rgb model like every other generator. */
function colourSpec(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!m) return "black";
  return "{rgb,255:red," + parseInt(m[1], 16) + ";green," + parseInt(m[2], 16) + ";blue," + parseInt(m[3], 16) + "}";
}
const texOf = (entry) => (entry.mode === "text" ? entry.tex : "$" + String(entry.tex).replace(/^\$|\$$/g, "") + "$");

/**
 * Emit samples and labels from the SAME baseline, so moving an entry moves both.
 * Coordinates arrive normalised 0..1000 and are written in cm.
 */
export function emitLegendTikz(entries, geometry) {
  const g = geometry || {};
  const widthCm = g.widthCm || 12;
  const heightCm = g.heightCm || 4.2;
  const sizeCm = g.sizeCm || 0.62;
  const out = [];
  const X = (v) => (Number(v) / 1000) * widthCm;
  const Y = (v) => heightCm - (Number(v) / 1000) * heightCm;
  for (const e of entries || []) {
    const s = e.sample;
    if (!s) continue;
    const y = Y(e.baseline == null ? (s.y0 + s.y1) / 2 : e.baseline);
    const style = [
      "draw=" + colourSpec(s.color),
      "line width=" + fmt(((Number(s.width) || 2) / (g.widthPx || 909)) * widthCm * 28.4527) + "pt",
      "line cap=round",
      s.dash && s.dash !== "solid" ? s.dash : "",
    ].filter(Boolean).join(", ");
    out.push("  \\draw[" + style + "] (" + fmt(X(s.x0)) + "," + fmt(y) + ") -- (" + fmt(X(s.x1)) + "," + fmt(y) + ");");
    if (String(e.tex || "").trim()) {
      const gap = (Number(g.gapCm) || 0.18);
      out.push("  \\node[anchor=west] at (" + fmt(X(s.x1) + gap) + "," + fmt(y) + ") {" + texOf(e) + "};");
    }
  }
  return out.join("\n");
}
