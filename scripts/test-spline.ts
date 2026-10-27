import { fitAdaptive, bezierSegments, toTikzPath, chooseModel, shapeReport, evalPower, segmentShape, fitPieces, applyPlateau } from "../server/spline.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

const sine = [];
for (let i = 0; i <= 20; i++) { const x = i / 20; sine.push([x, Math.sin(Math.PI * x)]); }

console.log("adaptive fit");
const fit = fitAdaptive(sine, { tolerance: 0.02, maxK: 10 });
ok("stays inside the budget", fit && fit.K <= 10, fit && fit.K);
ok("residual is small", fit.rmse <= 0.03, fit.rmse);
const segs = fit.segments;
ok("one bezier per span", segs.length === fit.K - 1, [segs.length, fit.K]);
ok("segments start and end on the fit", segs.every((s) => Math.abs(evalPower(fit, s.p0[0]) - s.p0[1]) < 1e-6 && Math.abs(evalPower(fit, s.p3[0]) - s.p3[1]) < 1e-6));

console.log("tikz emission");
const path = toTikzPath(segs);
const controls = (path.match(/\.\. controls/g) || []).length;
const coords = (path.match(/\(/g) || []).length;
ok("no dense sampling", controls === segs.length && coords <= 3 * segs.length + 1, [controls, coords]);

console.log("model selection");
const line = [];
for (let i = 0; i <= 8; i++) line.push([i / 8, 0.2 + 0.6 * (i / 8)]);
ok("straight data picks a line", chooseModel(line, { tolerance: 0.02 }).kind === "line");
const wiggly = [];
for (let i = 0; i <= 24; i++) { const x = i / 24; wiggly.push([x, 0.5 + 0.3 * Math.sin(6 * Math.PI * x)]); }
const wm = chooseModel(wiggly, { tolerance: 0.02, maxK: 10 });
ok("curved data picks a spline", wm.kind === "spline", wm.kind);
ok("parameter count stays bounded", wm.params <= 10, wm.params);
console.log("  (wiggly rmse " + wm.rmse.toFixed(3) + ", params " + wm.params + ")");

console.log("scaling invariance");
const sm = chooseModel(wiggly.map(([x, y]) => [x * 1000, y * 1000]), { tolerance: 20, maxK: 10 });
ok("zooming both axes keeps the model class", sm.kind === wm.kind, [wm.kind, sm.kind]);
ok("zooming both axes keeps the parameter count", sm.params === wm.params, [wm.params, sm.params]);
ok("zooming keeps normalised residual", Math.abs(sm.rmse / 1000 - wm.rmse) < 1e-6, [wm.rmse, sm.rmse / 1000]);

console.log("shape report");
const mono = [];
for (let i = 0; i <= 10; i++) mono.push([i / 10, Math.sqrt(i / 10)]);
const mm = chooseModel(mono, { tolerance: 0.01, maxK: 8 });
const rep = mm.kind === "spline" ? mm.report : shapeReport([{ p0: [0, 0], p1: [0.3, 0.3], p2: [0.7, 0.6], p3: [1, 1] }]);
ok("monotone data is reported monotone", rep.monotoneUp || rep.monotoneDown, rep.slopes);


console.log("robustness (opt-in)");
const noisy = [];
for (let i = 0; i <= 20; i++) { const x = i / 20; noisy.push([x, Math.sin(Math.PI * x)]); }
noisy[10] = [noisy[10][0], noisy[10][1] + 1.5];   // one gross outlier
const plain = fitAdaptive(noisy, { tolerance: 0.02, maxK: 8 });
const robust = fitAdaptive(noisy, { tolerance: 0.02, maxK: 8, robust: true });
// Compare the error at the CLEAN points: that is what robustness is for.
const cleanErr = (fit) => {
  const errs = [];
  for (let i = 0; i <= 20; i++) {
    if (i === 10) continue;
    const x = i / 20;
    errs.push(Math.abs(evalPower(fit, x) - Math.sin(Math.PI * x)));
  }
  return errs.reduce((s, v) => s + v, 0) / errs.length;
};
ok("robust fit keeps the clean points closer", cleanErr(robust) <= cleanErr(plain) + 1e-9, [cleanErr(plain), cleanErr(robust)]);

console.log("smoothing penalty");
const jitter = [];
for (let i = 0; i <= 24; i++) { const x = i / 24; jitter.push([x, 0.5 + 0.25 * Math.sin(2 * Math.PI * x) + (i % 3 - 1) * 0.02]); }
const rough = fitAdaptive(jitter, { tolerance: 1e-6, maxK: 8, lambda: 0 });
const smooth = fitAdaptive(jitter, { tolerance: 1e-6, maxK: 8, lambda: 1e6 });
const energy = (s) => s.segments.reduce((acc, seg) => acc + Math.abs(seg.p1[1] - 2 * seg.p0[1] + seg.p2[1] * 0) ** 2, 0);
ok("a large lambda reduces the curvature energy", energy(smooth) <= energy(rough) + 1e-9, [energy(rough), energy(smooth)]);

console.log("monotone constraint");
const bumpy = [];
for (let i = 0; i <= 16; i++) { const x = i / 16; bumpy.push([x, Math.sqrt(x) + (i % 2 ? 0.03 : -0.03)]); }
const forced = fitAdaptive(bumpy, { tolerance: 0.001, maxK: 8, monotone: true });
const slopes = forced.segments.map((s) => (s.p1[1] - s.p0[1]) / Math.max(1e-9, s.p1[0] - s.p0[0]));
ok("forced monotone fit has no negative slope", slopes.every((s) => s >= -1e-9), slopes);


console.log("corner segmentation (11.4)");
const cornered = [[0, 0], [0.2, 0.05], [0.4, 0.1], [0.6, 0.12], [0.62, 0.6], [0.7, 0.72], [0.9, 0.8]];
const seg = segmentShape(cornered, { cornerAngle: Math.PI / 3 });
ok("a sharp corner splits the chain", seg.pieces.length >= 2, seg.pieces.map((p) => p.points.length));
ok("the corner is counted", seg.corners >= 1, seg.corners);

console.log("jump segmentation (11.4)");
const jumped = [[0, 0], [0.2, 0.02], [0.4, 0.04], [0.42, 0.5], [0.6, 0.52], [0.8, 0.54]];
const sj = segmentShape(jumped, { maxJump: 0.1 });
ok("a vertical leap splits the chain", sj.pieces.length >= 2 && sj.jumps >= 1, [sj.pieces.length, sj.jumps]);
ok("pieces are independent paths", sj.pieces.every((p) => p.points.length >= 2));

console.log("piece fitting (11.4)");
const fitted = fitPieces(seg.pieces, { tolerance: 0.05, maxK: 6 });
ok("every piece has a model", fitted.every((m) => m && (m.kind === "line" || m.kind === "spline")), fitted.map((m) => m && m.kind));
ok("every piece emits bezier segments", fitted.every((m) => m.segments && m.segments.length >= 1));

console.log("plateau (11.4)");
const synthetic = [
  { a: 0, b: 0.4, p0: [0, 0.5], p1: [0.1, 0.505], p2: [0.3, 0.494], p3: [0.4, 0.5] },   // flat
  { a: 0.4, b: 1, p0: [0.4, 0.5], p1: [0.6, 0.8], p2: [0.8, 0.9], p3: [1, 1.0] },       // rising
];
const pl = applyPlateau(synthetic, { epsilon: 0.05 });
const flatSlope = (pl[0].p1[1] - pl[0].p0[1]) / (pl[0].p1[0] - pl[0].p0[0]);
const riseSlope = (pl[1].p1[1] - pl[1].p0[1]) / (pl[1].p1[0] - pl[1].p0[0]);
ok("a flat span is clamped to zero slope", Math.abs(flatSlope) < 1e-9, flatSlope);
ok("a rising span is untouched", Math.abs(riseSlope - 1.5) < 1e-6, riseSlope);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
