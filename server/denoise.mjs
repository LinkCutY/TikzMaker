/**
 * Cheap denoising for traced images.
 *
 * Scanned figures and screenshots arrive with JPEG ringing and isolated dark
 * pixels. VTracer faithfully turns every one of them into a tiny filled path,
 * which is what noise dots around a curve look like in the output. A 3x3
 * median removes them without touching stroke edges.
 */

/** Copy the raster and apply a median filter with the given radius (1 = 3x3). */
export function medianFilter(source, radius) {
  const r = Math.max(1, Math.min(3, Math.round(radius == null ? 1 : radius)));
  const w = source.w, h = source.h, rgb = source.rgb;
  const out = new Uint8Array(rgb.length);
  const window = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        window.length = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            window.push(rgb[(yy * w + xx) * 3 + c]);
          }
        }
        window.sort(function (a, b) { return a - b; });
        out[(y * w + x) * 3 + c] = window[window.length >> 1];
      }
    }
  }
  return { w: w, h: h, rgb: out };
}

/** Count confetti: connected dark components smaller than minPx. */
export function countSpecks(source, minPx, threshold) {
  const thr = threshold == null ? 200 : threshold;
  const w = source.w, h = source.h, rgb = source.rgb;
  const size = Math.max(1, minPx == null ? 12 : minPx);
  const seen = new Uint8Array(w * h);
  const dark = function (i) {
    return (rgb[i * 3] * 299 + rgb[i * 3 + 1] * 587 + rgb[i * 3 + 2] * 114) / 1000 < thr;
  };
  let specks = 0;
  let speckPixels = 0;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !dark(start)) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let pixels = 0;
    while (stack.length) {
      const p = stack.pop();
      pixels++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (!seen[n] && dark(n)) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    if (pixels < size) { specks++; speckPixels += pixels; }
  }
  return { specks: specks, speckPixels: speckPixels, total: w * h };
}
/** Whiten every connected dark component smaller than minPx. */
export function removeSpecks(source, minPx, threshold) {
  const thr = threshold == null ? 235 : threshold;
  const w = source.w, h = source.h;
  const rgb = Uint8Array.from(source.rgb);
  const size = Math.max(1, minPx == null ? 10 : minPx);
  const seen = new Uint8Array(w * h);
  const dark = function (i) {
    return (rgb[i * 3] * 299 + rgb[i * 3 + 1] * 587 + rgb[i * 3 + 2] * 114) / 1000 < thr;
  };
  const stack = [];
  let removed = 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !dark(start)) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const pixels = [];
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (!seen[n] && dark(n)) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    if (pixels.length >= size) continue;
    removed++;
    for (const p of pixels) { rgb[p * 3] = 255; rgb[p * 3 + 1] = 255; rgb[p * 3 + 2] = 255; }
  }
  return { w: w, h: h, rgb: rgb, removed: removed };
}
/**
 * Whiten rectangular regions (normalised 0..1000) before tracing.
 *
 * The frame and the labels are drawn as real TikZ lines and nodes, so leaving
 * their pixels in the residual only produces grey blobs on top of them.
 */
export function eraseRegions(source, regions, options) {
  const opts = options || {};
  const pad = opts.pad == null ? 3 : opts.pad;
  const w = source.w, h = source.h;
  const rgb = Uint8Array.from(source.rgb);
  let wiped = 0;
  for (const region of regions || []) {
    const box = region && region.box;
    if (!Array.isArray(box) || box.length !== 4) continue;
    // Grow by half the box height as well: label boxes from a model are loose,
    // and a leftover glyph row shows up as a grey ghost under the real text.
    const grow = Math.round((box[3] / 1000) * h * 0.5) + pad;
    const x0 = Math.max(0, Math.floor(box[0] / 1000 * w) - grow);
    const y0 = Math.max(0, Math.floor(box[1] / 1000 * h) - grow);
    const x1 = Math.min(w - 1, Math.ceil((box[0] + box[2]) / 1000 * w) + grow);
    const y1 = Math.min(h - 1, Math.ceil((box[1] + box[3]) / 1000 * h) + grow);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 3;
        rgb[i] = 255; rgb[i + 1] = 255; rgb[i + 2] = 255;
        wiped++;
      }
    }
  }
  return { w: w, h: h, rgb: rgb, wiped: wiped };
}

/** Thin bands along the detected frame edges, in the same normalised space. */
export function frameBands(bounds, raster, thicknessPx) {
  if (!bounds) return [];
  const t = thicknessPx == null ? 4 : thicknessPx;
  const w = raster.w, h = raster.h;
  const nx = (v) => v / w * 1000;
  const ny = (v) => v / h * 1000;
  const tw = t / w * 1000;
  const th = t / h * 1000;
  return [
    { box: [nx(bounds.x0) - tw, ny(bounds.y0) - th, nx(bounds.x1) - nx(bounds.x0) + 2 * tw, 2 * th] },
    { box: [nx(bounds.x0) - tw, ny(bounds.y1) - th, nx(bounds.x1) - nx(bounds.x0) + 2 * tw, 2 * th] },
    { box: [nx(bounds.x0) - tw, ny(bounds.y0) - th, 2 * tw, ny(bounds.y1) - ny(bounds.y0) + 2 * th] },
    { box: [nx(bounds.x1) - tw, ny(bounds.y0) - th, 2 * tw, ny(bounds.y1) - ny(bounds.y0) + 2 * th] },
  ];
}
