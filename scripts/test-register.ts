import { fitSimilarity, applySimilarity, registerRegion, referenceFrame } from "../server/register.mjs";
import { decodePng } from "../server/trace.mjs";
import { readFile } from "node:fs/promises";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

console.log("similarity fit");
const global = [[100, 100], [900, 100], [100, 700], [900, 700]];
const local = global.map(([x, y]) => [(x - 50) / 2, (y - 20) / 2]);
const fit = fitSimilarity(local.map((p, i) => [p, global[i]]));
ok("recovers the scale", Math.abs(fit.s - 2) < 0.05, fit.s);
ok("recovers the translation", Math.abs(fit.tx - 50) < 2 && Math.abs(fit.ty - 20) < 2, [fit.tx, fit.ty]);
ok("residual is tiny", fit.residual < 1, fit.residual);

console.log("outlier rejection");
const withOutlier = local.map((p, i) => [p, global[i]]);
withOutlier.push([[500, 500], [50, 950]]);
const fit2 = fitSimilarity(withOutlier);
ok("keeps the fit", Math.abs(fit2.s - 2) < 0.05, fit2.s);
ok("drops the outlier", fit2.dropped >= 1, fit2.dropped);

console.log("apply");
const moved = applySimilarity({ kind: "line", x1: 0, y1: 0, x2: 100, y2: 100 }, { s: 2, tx: 50, ty: 20 });
ok("maps endpoints", moved.x1 === 50 && moved.y1 === 20 && moved.x2 === 250 && moved.y2 === 220, moved);

console.log("region registration");
const raster = decodePng("data:image/png;base64," + (await readFile(".probe-tests/fixtures/user.png")).toString("base64"));
const region = { kind: "legend", box: [70, 55, 300, 330] };
// the purple sample stroke of user.png sits at pixels x 95..129, y 60..66
const wellPlaced = [
  { kind: "line", x1: 104, y1: 193, x2: 142, y2: 193 },
  { kind: "text", box: [146, 180, 80, 25], tex: "gamma" },
];
const reg = registerRegion(raster, region, wellPlaced);
console.log("  ..    region verdict:", JSON.stringify({ ok: reg.ok, applied: reg.applied, residual: reg.residual && Math.round(reg.residual * 10) / 10, dropped: reg.dropped }));
ok("accepts a well-placed region", reg.ok === true && reg.dropped === 0, reg);
ok("residual is small", reg.residual < 3, reg.residual);
const shifted = [
  { kind: "line", x1: 124, y1: 213, x2: 162, y2: 213 },
  { kind: "text", box: [166, 200, 80, 25], tex: "gamma" },
];
const reg2 = registerRegion(raster, region, shifted);
ok("re-registers a shifted region or rejects it", reg2.ok === false || reg2.applied === true, reg2);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
