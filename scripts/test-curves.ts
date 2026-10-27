import { extractCurves } from "../server/curves.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

/** Build a raster of white with dark horizontal bars at given [y0, y1] ranges. */
function raster(w, h, bars) {
  const rgb = new Uint8Array(w * h * 3).fill(255);
  for (const [y0, y1] of bars) {
    for (let y = y0; y <= y1; y++) for (let x = 5; x < w - 5; x++) {
      const i = (y * w + x) * 3;
      rgb[i] = 40; rgb[i + 1] = 60; rgb[i + 2] = 120;
    }
  }
  return { w, h, rgb };
}

console.log("separation");
const two = raster(60, 24, [[4, 5], [16, 17]]);
const r1 = extractCurves(two, { minSpanPx: 10, minPoints: 5 });
ok("two bars -> two tracks", r1.tracks.length === 2, r1.stats);
ok("tracks stay single-valued", r1.tracks.every((t) => new Set(t.points.map((p) => p[0])).size === t.points.length));
ok("width measured as 2px", Math.abs(r1.stats.avgWidthPx - 2) < 0.6, r1.stats.avgWidthPx);
ok("y sits on the bar centres (4.5, 16.5)", r1.tracks.map((t) => t.points[0][1]).sort((a, b) => a - b).join(",") === "4.5,16.5", r1.tracks.map((t) => t.points[0][1]));

console.log("merged run splitting");
const thick = raster(60, 40, [[10, 19]]);
const r2 = extractCurves(thick, { maxRunPx: 5, maxSplitRunPx: 14, splitWidthPx: 2.2, minSpanPx: 10, minPoints: 5 });
ok("10px run is split into ~5 curves", r2.tracks.length >= 4 && r2.tracks.length <= 6, r2.stats);
ok("split runs counted", r2.stats.runsSplit > 0, r2.stats);

const block = raster(60, 60, [[15, 52]]);
const r3 = extractCurves(block, { maxSplitRunPx: 14, minSpanPx: 10, minPoints: 5 });
ok("solid block is skipped, not striped", r3.tracks.length === 0, r3.stats);

console.log("noise and gaps");
const speck = raster(60, 30, [[10, 10]]);
for (let x = 20; x < 24; x++) { const i = (10 * 60 + x) * 3; speck.rgb[i] = 255; speck.rgb[i + 1] = 255; speck.rgb[i + 2] = 255; }
const r4 = extractCurves(speck, { minSpanPx: 25, minPoints: 8, maxMiss: 2 });
ok("a 4px gap is bridged", r4.tracks.length === 1 && r4.tracks[0].points.length > 30, r4.stats);

const short = raster(60, 30, [[10, 10]]);
for (let x = 12; x < 60; x++) { const i = (10 * 60 + x) * 3; short.rgb[i] = 255; short.rgb[i + 1] = 255; short.rgb[i + 2] = 255; }
const r5 = extractCurves(short, { minSpanPx: 25 });
ok("short fragments dropped", r5.tracks.length === 0, r5.stats);

console.log("colour");
const coloured = raster(60, 24, [[8, 9]]);
ok("colour sampled from the ink", (() => {
  const t = extractCurves(coloured, { minSpanPx: 10, minPoints: 5 }).tracks[0];
  return t && Math.round(t.color[0]) < 100 && t.color[2] > 100;
})());

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
