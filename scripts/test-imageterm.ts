import { regionInk, rasterizeSegments, imageDistance, refineWithImage } from "../server/imageterm.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

// A 200x200 raster with one smooth stroke at y = 120 px.
const W = 200, H = 200;
const rgb = new Uint8Array(W * H * 3).fill(255);
const drawPixel = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  rgb[i] = 20; rgb[i + 1] = 20; rgb[i + 2] = 20;
};
for (let x = 20; x <= 180; x++) {
  const y = 120 - 18 * Math.sin((Math.PI * (x - 20)) / 160);
  for (let d = -1; d <= 1; d++) drawPixel(x, Math.round(y) + d);
}
const raster = { w: W, h: H, rgb };

console.log("ink extraction");
const ink = regionInk(raster, [0, 0, 1000, 1000], 200);
ok("finds the stroke", ink.mask.some((v) => v === 1));
ok("bbox covers the drawing", ink.x0 <= 20 && ink.x1 >= 180);

console.log("distance");
// Peak of a symmetric cubic arch: y(0.5) = 0.25*y0 + 0.75*yc, so yc = 480 matches
// the ink arch that rises 18 px from the 120 px baseline.
const exact = [
  { a: 0, b: 1, p0: [100, 600], p1: [360, 480], p2: [640, 480], p3: [900, 600] },
];
const exactMask = rasterizeSegments(exact, ink, { widthPx: W, heightPx: H, radius: 2 });
const dExact = imageDistance(exactMask, ink);
ok("a matching curve scores low", dExact < 0.25, dExact);   // 2 px tolerance band

console.log("image term refines a biased fit");
// The same shape pushed 14 px (35 units) down: the sparse fit alone would keep it.
const biased = exact.map((s) => ({
  ...s,
  p0: [s.p0[0], s.p0[1] + 35], p1: [s.p1[0], s.p1[1] + 35],
  p2: [s.p2[0], s.p2[1] + 35], p3: [s.p3[0], s.p3[1] + 35],
}));
const before = imageDistance(rasterizeSegments(biased, ink, { widthPx: W, heightPx: H, radius: 2 }), ink);
const refined = refineWithImage(biased, ink, { widthPx: W, heightPx: H, passes: 3, radius: 2, step: 20 });
ok("the image term lowers the distance", refined.after < before, [before, refined.after]);
ok("it reports improvement", refined.improved === true);
ok("the curve moves back toward the ink", refined.segments[0].p0[1] < biased[0].p0[1], [biased[0].p0[1], refined.segments[0].p0[1]]);
ok("the output stays a bezier chain", refined.segments.every((s) => Array.isArray(s.p0) && Array.isArray(s.p1) && Array.isArray(s.p2) && Array.isArray(s.p3)));

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
