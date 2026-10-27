/**
 * Measurement grid overlay.
 *
 * Vision models are poor at absolute coordinates but good at relative reading:
 * put a labelled 10x10 grid on the image and "the curve crosses the -3 gridline
 * at y≈0.45" becomes a reading task instead of a guess. The grid is red so it
 * cannot be confused with the figure's own grey/black lines.
 */

const DIGITS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "-": ["000", "000", "111", "000", "000"],
  ".": ["000", "000", "000", "000", "010"],
};

function put(raster, x, y, color) {
  if (x < 0 || y < 0 || x >= raster.w || y >= raster.h) return;
  const i = (y * raster.w + x) * 3;
  raster.rgb[i] = color[0];
  raster.rgb[i + 1] = color[1];
  raster.rgb[i + 2] = color[2];
}

function blend(raster, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= raster.w || y >= raster.h) return;
  const i = (y * raster.w + x) * 3;
  for (let c = 0; c < 3; c++) raster.rgb[i + c] = Math.round(raster.rgb[i + c] * (1 - alpha) + color[c] * alpha);
}

function text(raster, x0, y0, value, color, scale) {
  const s = scale || 1;
  let cx = x0;
  for (const ch of String(value)) {
    const glyph = DIGITS[ch];
    if (!glyph) { cx += 4 * s; continue; }
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] !== "1") continue;
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(raster, cx + col * s + dx, y0 + row * s + dy, color);
      }
    }
    cx += 4 * s;
  }
}

/**
 * Copy the raster and draw a labelled 10x10 grid over it.
 * Labels run 0..1000 on the top and left edges, matching the coordinate space
 * we ask the model to answer in.
 */
export function withGrid(source, options) {
  const opts = options || {};
  const raster = { w: source.w, h: source.h, rgb: new Uint8Array(source.rgb) };
  const RED = [220, 40, 40];
  const GRID = [250, 150, 150];
  const WHITE = [255, 255, 255];
  const scale = Math.max(1, Math.round(Math.min(raster.w, raster.h) / 260));

  for (let step = 0; step <= 10; step++) {
    const x = Math.min(raster.w - 1, Math.round((step / 10) * (raster.w - 1)));
    const y = Math.min(raster.h - 1, Math.round((step / 10) * (raster.h - 1)));
    for (let yy = 0; yy < raster.h; yy++) if (yy % 3 !== 2) blend(raster, x, yy, GRID, 0.45);
    for (let xx = 0; xx < raster.w; xx++) if (xx % 3 !== 2) blend(raster, xx, y, GRID, 0.45);
  }

  const label = (value, cx, cy) => {
    const s = String(value);
    const wpx = s.length * 4 * scale;
    const hpx = 5 * scale;
    const x = Math.max(0, Math.min(raster.w - wpx, cx - Math.floor(wpx / 2)));
    const y = Math.max(0, Math.min(raster.h - hpx, cy));
    // halo first, then the glyphs, so labels stay readable over any content
    for (let dy = -1; dy <= hpx; dy++) for (let dx = -1; dx <= wpx; dx++) {
      if (dy >= 0 && dy < hpx && dx >= 0 && dx < wpx) continue;
      put(raster, x + dx, y + dy, WHITE);
    }
    text(raster, x, y, s, RED, scale);
  };

  for (let step = 0; step <= 10; step++) {
    const x = Math.round((step / 10) * (raster.w - 1));
    const y = Math.round((step / 10) * (raster.h - 1));
    label(String(step * 100), x, 2);                       // top edge
    label(String(step * 100), 2, Math.max(2, y - 2 * scale)); // left edge
  }
  return raster;
}
