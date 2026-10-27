import { alignRidgePeaks } from "../server/plotcurve.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}
const ridge = (apexX, baselineY) => ({ points: [[50, baselineY], [300, baselineY - 10], [apexX, 100], [600, baselineY - 10], [950, baselineY]] });

console.log("ridge family");
const curves = [ridge(480, 700), ridge(520, 640), ridge(500, 580), ridge(540, 520), ridge(460, 460)];
const r1 = alignRidgePeaks(curves);
const apexes = r1.curves.map((c) => c.points.reduce((a, p) => (p[1] < a[1] ? p : a))[0]);
ok("all apexes end up on the same x", new Set(apexes.map((x) => Math.round(x))).size === 1, apexes);
ok("reports how many moved", r1.aligned >= 4, r1.aligned); // the curve already at the median stays put
ok("spread was measured", r1.spread === 80, r1.spread);

console.log("guards");
const scattered = [ridge(100, 700), ridge(500, 640), ridge(900, 580), ridge(300, 520)];
ok("too far apart = not a family (no move)", alignRidgePeaks(scattered).aligned === 0);
const flat = [{ points: [[0, 500], [500, 500], [1000, 500]] }, { points: [[0, 400], [500, 400], [1000, 400]] }, { points: [[0, 300], [500, 300], [1000, 300]] }, { points: [[0, 200], [500, 200], [1000, 200]] }];
ok("flat lines are left alone", alignRidgePeaks(flat).aligned === 0);
ok("fewer than 4 curves untouched", alignRidgePeaks([ridge(480, 700), ridge(520, 640)]).aligned === 0);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
