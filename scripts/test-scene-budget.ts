import { pathBudget, analyzeCurveBudget, cornerCount, validateScene, KEYPOINT_SPACING } from "../server/scene.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

const line = [[0, 100], [500, 100]];
const arc = Array.from({ length: 21 }, (_, i) => { const t = i / 20; return [t * 1000, 500 + 300 * Math.sin(Math.PI * t)]; });
const longArc = Array.from({ length: 41 }, (_, i) => { const t = i / 40; return [t * 1000, 500 + 400 * Math.sin(2 * Math.PI * t)]; });
const zig = [[0, 0], [100, 300], [200, 0], [300, 300], [400, 0]];
const gentle = [[0, 0], [100, 20], [200, 40], [300, 60]];

console.log("dynamic key-point budget");
console.log("  spacing =", KEYPOINT_SPACING);
ok("a straight line only needs endpoints", pathBudget(line) === 2, pathBudget(line));
ok("more bending receives more support", pathBudget(longArc) > pathBudget(arc), [pathBudget(arc), pathBudget(longArc)]);
const detail = analyzeCurveBudget(arc);
ok("span allocation counts each anchor once", detail.required === 2 + detail.features + detail.spans.reduce((n, s) => n + Math.max(0, Math.ceil(s.length / KEYPOINT_SPACING * Math.sqrt(Math.min(1, s.turn / (Math.PI / 2)))) - 1), 0), detail);
ok("image resizing does not change budget", pathBudget(arc, { width: 400, height: 200 }) === pathBudget(arc, { width: 1600, height: 800 }));
ok("sharp corners are counted", cornerCount(zig) === 3, cornerCount(zig));
ok("gentle bends are not corners", cornerCount(gentle) === 0, cornerCount(gentle));
ok("straight spans between corners need no extra points", pathBudget(zig) === 5, pathBudget(zig));
ok("collinear subdivision does not buy points", pathBudget(gentle) === 2, pathBudget(gentle));

console.log("the validator uses it");
const scene = (points, connection) => ({ objects: [{ kind: "path", connection, points }] });
ok("semantic landmarks within budget pass", validateScene(scene(zig, "smooth")).ok, validateScene(scene(zig, "smooth")).errors);
const tooMany = Array.from({ length: pathBudget(line) + 5 }, (_, i) => [i * 10, 100]);
ok("exceeding a heuristic target is not a protocol error", validateScene(scene(tooMany, "smooth")).ok);
const overHardCap = Array.from({length:49}, (_, i) => [i*10,100]);
const bad = validateScene(scene(overHardCap, "smooth"));
ok("the absolute sparse-geometry cap is enforced", !bad.ok, bad.errors);
ok("the message names the budget and the count", /max \d+, got \d+/.test(bad.errors.join(" ")), bad.errors);
ok("visible linear observations have a separate budget", validateScene(scene(tooMany, "linear")).ok);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
