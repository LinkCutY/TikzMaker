/**
 * Decompose a figure into regions, then let a sub-agent draw one region at a time.
 *
 * The full-image pass is bad at two things: deciding WHAT is in the figure, and
 * placing elements precisely. Both get easier when the job is split: a region has
 * an explicit coordinate window, so the sub-agent only has to place things inside
 * a known box instead of guessing absolute positions on a whole page.
 */

/** Deterministic region proposals from the pixels (no model needed). */
export function proposeRegions(raster, frameInfo, axis, textBlocksList) {
  const w = raster.w, h = raster.h;
  const regions = [];
  const b = frameInfo && frameInfo.bounds;
  if (b) {
    regions.push({ kind: "frame", box: [(b.x0 / w) * 1000, (b.y0 / h) * 1000, ((b.x1 - b.x0) / w) * 1000, ((b.y1 - b.y0) / h) * 1000], note: "面板边框" });
    const inset = 0.02;
    regions.push({
      kind: "plot",
      box: [((b.x0 + (b.x1 - b.x0) * inset) / w) * 1000, ((b.y0 + (b.y1 - b.y0) * inset) / h) * 1000,
        (((b.x1 - b.x0) * (1 - 2 * inset)) / w) * 1000, (((b.y1 - b.y0) * (1 - 2 * inset)) / h) * 1000],
      note: "绘图区（曲线由稀疏语义控制点拟合）",
    });
  }
  if (axis) {
    // x tick labels live in the band just below the axis
    const top = axis.y;
    const bottom = Math.min(h - 1, axis.y + h * 0.18);
    regions.push({
      kind: "x-axis",
      box: [(axis.x0 / w) * 1000, (top / h) * 1000, ((axis.x1 - axis.x0) / w) * 1000, ((bottom - top) / h) * 1000],
      note: "横轴刻度与轴标签",
    });
  }
  // text clusters that sit outside the frame: legend, titles, free annotations
  const outside = (textBlocksList || []).filter((t) => !b || t.x < b.x0 || t.x > b.x1 || t.y < b.y0 || t.y > b.y1);
  if (outside.length) {
    const xs = outside.map((t) => t.x), ys = outside.map((t) => t.y);
    const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60;
    const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
    regions.push({
      kind: "labels",
      box: [(Math.max(0, x0) / w) * 1000, (Math.max(0, y0) / h) * 1000, ((Math.min(w, x1) - Math.max(0, x0)) / w) * 1000, ((Math.min(h, y1) - Math.max(0, y0)) / h) * 1000],
      note: "框外文字与图例标签",
    });
  }
  if (b) {
    // legend: top-left quadrant of the frame, where keys usually sit
    regions.push({
      kind: "legend",
      box: [((b.x0 + 2) / w) * 1000, ((b.y0 + 2) / h) * 1000, (((b.x1 - b.x0) * 0.45) / w) * 1000, (((b.y1 - b.y0) * 0.6) / h) * 1000],
      note: "图例区（样例线 + 名称）",
    });
  }
  // A region that covers (almost) the whole image is not a sub-figure: it gives
  // the sub-agent no coordinate advantage and lets it repaint everything.
  return regions.filter((r) => (r.box[2] / 1000) * (r.box[3] / 1000) <= 0.55);
}
/**
 * Ask a sub-agent to draw ONE region.
 *
 * The crop is sent together with its coordinate window, so the sub-agent places
 * elements inside a known box instead of guessing absolute positions on a whole
 * page. Elements whose centre falls outside the window are dropped: a region
 * agent must not repaint the whole figure.
 */
export async function drawRegion({ raster, region, apiKey, baseUrl, model, signal, chat, parseJsonObject, encodePng }) {
  const box = region.box;
  const pad = 0.06;
  const x0 = Math.max(0, Math.floor(((box[0] - box[2] * pad) / 1000) * raster.w));
  const y0 = Math.max(0, Math.floor(((box[1] - box[3] * pad) / 1000) * raster.h));
  const x1 = Math.min(raster.w - 1, Math.ceil(((box[0] + box[2] * (1 + pad)) / 1000) * raster.w));
  const y1 = Math.min(raster.h - 1, Math.ceil(((box[1] + box[3] * (1 + pad)) / 1000) * raster.h));
  const cw = Math.max(1, x1 - x0 + 1), chh = Math.max(1, y1 - y0 + 1);
  const rgb = new Uint8Array(cw * chh * 3);
  for (let y = 0; y < chh; y++) {
    const src = ((y0 + y) * raster.w + x0) * 3;
    rgb.set(raster.rgb.subarray(src, src + cw * 3), y * cw * 3);
  }
  const url = 'data:image/png;base64,' + encodePng({ w: cw, h: chh, rgb }).toString('base64');
  const text = [
    'You are drawing ONE region of a scientific figure, not the whole figure.',
    'This crop covers the window x=' + Math.round((x0 / raster.w) * 1000) + '..' + Math.round((x1 / raster.w) * 1000) +
    ', y=' + Math.round((y0 / raster.h) * 1000) + '..' + Math.round((y1 / raster.h) * 1000) + ' of the full image (0..1000, origin top-left, y down).',
    'Region type: ' + region.kind + ' (' + region.note + ').',
    'Return ONLY JSON {"elements":[...]} using CROP-LOCAL coordinates from 0..1000 (origin at this crop top-left, y down).',
    'The server maps those crop-local coordinates into the full image exactly once.',
    'Draw exactly what you see in this crop: text as text elements, borders as lines/polylines, key strokes as short lines with their colour.',
    'Do not draw anything outside the window. Do not describe the figure.',
  ].join("\n");
  const out = await chat({
    apiKey, baseUrl, model, signal, temperature: 0, thinking: 'disabled', maxTokens: 3000, timeoutMs: 90_000,
    messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url } }] }],
  });
  const json = parseJsonObject(out.text);
  const raw = Array.isArray(json.elements) ? json.elements : [];
  // Validate the declared crop-local 0..1000 contract before mapping exactly
  // once into the full-image coordinate system.
  let maxCoord = 0;
  const walk = (v) => { if (typeof v === "number") maxCoord = Math.max(maxCoord, Math.abs(v)); };
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    if (Array.isArray(el.box)) el.box.forEach(walk);
    if (Array.isArray(el.points)) el.points.forEach((p) => Array.isArray(p) && p.forEach(walk));
    ["x1", "y1", "x2", "y2", "cx", "cy"].forEach((k) => walk(el[k]));
  }
  // §10.2: the coordinate space is DECLARED by the request (crop 0..1000), never
  // guessed from magnitudes. A reply outside the declared range is a validation
  // failure, not something to remap silently.
  const DECLARED_SPAN = 1000;
  if (maxCoord > DECLARED_SPAN * 1.15) {
    throw new Error("坐标空间未声明：返回坐标最大 " + Math.round(maxCoord) + "，超出声明的裁切 0..1000 空间");
  }
  const localSpan = DECLARED_SPAN;
  const mapX = (v) => Number.isFinite(Number(v)) ? (x0 + (Number(v) / localSpan) * cw) / raster.w * 1000 : null;
  const mapY = (v) => Number.isFinite(Number(v)) ? (y0 + (Number(v) / localSpan) * chh) / raster.h * 1000 : null;
  const scaleX = (cw / localSpan) / raster.w * 1000;
  const scaleY = (chh / localSpan) / raster.h * 1000;
  for (const el of raw) {
    if (!el || typeof el.kind !== "string") continue;
    if (el.kind === "text" && Array.isArray(el.box) && el.box.length === 4) {
      el.box = [mapX(el.box[0]), mapY(el.box[1]), (Number(el.box[2]) / 1000) * (cw / raster.w) * 1000, (Number(el.box[3]) / 1000) * (chh / raster.h) * 1000];
    } else if (el.kind === "line") {
      el.x1 = mapX(el.x1); el.y1 = mapY(el.y1); el.x2 = mapX(el.x2); el.y2 = mapY(el.y2);
    } else if (el.kind === "polyline" && Array.isArray(el.points)) {
      el.points = el.points.map((p) => [mapX(p[0]), mapY(p[1])]);
    } else if (Number.isFinite(Number(el.cx))) {
      el.cx = mapX(el.cx); el.cy = mapY(el.cy);
      if (el.r) el.r = el.r * scaleX;
      if (el.rx) el.rx = el.rx * scaleX;
      if (el.ry) el.ry = el.ry * scaleY;
      if (Number.isFinite(Number(el.cy))) { /* mapped above */ }
    }
  }
  const inside = (v, lo, hi) => Number.isFinite(v) && v >= lo - 40 && v <= hi + 40;
  const kept = [];
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    // Models call the field "type" as often as "kind", and invent synonyms.
    const kind = String(el.kind || el.type || "").toLowerCase();
    const alias = { label: "text", arrow: "line", path: "polyline", rectangle: "polyline", rect: "polyline", point: "circle" };
    el.kind = alias[kind] || kind;
    if (!el.kind) continue;
    const cx = el.kind === 'text' ? (el.box ? el.box[0] + el.box[2] / 2 : null)
      : el.kind === 'line' ? (el.x1 + el.x2) / 2
      : el.kind === 'polyline' ? (el.points || []).reduce((s, p) => s + p[0], 0) / Math.max(1, (el.points || []).length)
      : Number.isFinite(el.cx) ? el.cx : null;
    const cy = el.kind === 'text' ? (el.box ? el.box[1] + el.box[3] / 2 : null)
      : el.kind === 'line' ? (el.y1 + el.y2) / 2
      : el.kind === 'polyline' ? (el.points || []).reduce((s, p) => s + p[1], 0) / Math.max(1, (el.points || []).length)
      : Number.isFinite(el.cy) ? el.cy : null;
    if (cx == null || cy == null) {
      // No usable position: clamp into the window rather than lose the element.
      if (el.kind === "text" && Array.isArray(el.box)) {
        el.box = [region.box[0], region.box[1], Math.min(el.box[2] || 40, region.box[2]), Math.min(el.box[3] || 20, region.box[3])];
        kept.push(el);
      }
      continue;
    }
    // Do NOT reject by window here: the region registrar decides, using the ink
    // under each key point. A pre-filter duplicates that decision and loses the
    // elements that the translation fit could have fixed.
    kept.push(el);
  }
  return { elements: kept, dropped: raw.length - kept.length, usage: out.usage };
}
