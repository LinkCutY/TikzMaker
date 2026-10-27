import { FAMILIES, fitFamily, familyExpression, chooseFamily, familyTikz } from "../server/family.mjs";
import { fitAdaptive } from "../server/spline.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

const truth = [0.15, 0.62, 0.32, 0.68, 0.05, 0.05];
const clean = [];
for (let i = 0; i <= 8; i++) { const x = i / 8; clean.push([x, FAMILIES.tanhPlateau.eval(x, truth)]); }
const noisy = clean.map(([x, y], i) => [x, y + (i % 2 ? 0.012 : -0.012)]);

console.log("family fit");
const pf = fitFamily(clean, "tanhPlateau");
ok("clean plateau fits", pf.ok && pf.rmse < 0.01, pf && pf.rmse);
ok("six parameters", pf.k === 6, pf.k);
ok("pgfmath expression only", /exp\(/.test(familyExpression("tanhPlateau", pf.params, "x")));
const dipTruth = [0.95, 0.85, 0.5, 0.09, 2.4];
const dipPts = [];
for (let i = 0; i <= 8; i++) { const x = i / 8; dipPts.push([x, FAMILIES.genDip.eval(x, dipTruth)]); }
const df = fitFamily(dipPts, "genDip");
ok("dip fits and recovers the centre", df.ok && Math.abs(df.params[2] - dipTruth[2]) < 0.05, df.params[2]);

console.log("model choice");
const spline = fitAdaptive(noisy, { tolerance: 0.008, maxK: 10 });
const choice = chooseFamily(noisy, { tolerance: 0.02, spline: { params: spline.params, rmse: spline.rmse } });
ok("a compact family wins when the spline cannot meet the tolerance", !!choice && choice.family === "tanhPlateau", choice && choice.family);
const adequateSpline = chooseFamily(noisy, { tolerance: 0.02, spline: { params: 3, rmse: 0.001 } });
ok("an adequate simpler spline is preferred", adequateSpline === null, adequateSpline && adequateSpline.family);
ok("the choice is emitted as a function plot", choice ? /plot\[domain=/.test(familyTikz(choice, [0, 1], { style: "draw=black" })) : false);
const mapped = familyTikz(
  { family: "gauss", params: [100, 600, 500, 150] },
  [0, 12],
  { style: "draw=black", inputExpression: "(1000*\\x/12)", outputScale: -0.004, outputOffset: 4 },
);
ok("image coordinates are mapped into TikZ coordinates", mapped.includes("1000*\\x/12") && mapped.includes("4+(-0.004*"), mapped);
const extremeDip = familyTikz(
  { family: "genDip", params: [690.0185, 210.1922, 610.3427, 192.6511, 11.9038] },
  [0.84, 11.82],
  { style: "draw=black", inputExpression: "(1000*\\x/12)", outputScale: -0.0043, outputOffset: 4.2883 },
);
ok("high-power dip is saturated for TeX", extremeDip.includes("min(2,abs") && extremeDip.includes("^8"), extremeDip);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
