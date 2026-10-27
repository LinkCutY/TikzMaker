import { calibrate, buildTicks, tickTikz } from "../server/axis.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

const pairs = [
  { px: 116, value: -9 }, { px: 236, value: -6 }, { px: 360, value: -3 },
  { px: 604, value: 3 }, { px: 726, value: 6 }, { px: 849, value: 9 },
];

console.log("calibration");
const c = calibrate(pairs);
ok("solves the linear map", c.ok, c.reason);
ok("residual is sub-pixel", c.rmse < 1, c.rmse);
ok("maps a tick back to its value", Math.abs(c.toValue(116) + 9) < 0.05, c.toValue(116));
ok("maps zero to the middle", Math.abs(c.toPixel(0) - (116 + 849) / 2) < 6, c.toPixel(0));
ok("keeps every tick", c.inliers === 6 && c.dropped === 0, [c.inliers, c.dropped]);

console.log("outlier rejection");
const cd = calibrate(pairs.concat([{ px: 500, value: 40 }]));
ok("drops the misread label", cd.dropped === 1, cd.dropped);
ok("keeps the map intact", Math.abs(cd.toValue(849) - 9) < 0.2, cd.toValue(849));

console.log("tick objects");
const built = buildTicks(pairs, { y: 202, x0: 62, x1: 900 }, { tickLengthPx: 5 });
ok("one object per tick", built.ticks.length === 6, built.ticks.length);
ok("each has value, position, stroke and label", built.ticks.every((x) => Number.isFinite(x.value) && x.stroke && x.label));
ok("ticks straddle the axis", built.ticks.every((x) => x.stroke.y1 < 202 && x.stroke.y2 > 202));
ok("needs two ticks", calibrate([{ px: 100, value: 1 }]).ok === false);

console.log("emission");
const tikz = tickTikz(built.ticks, { widthPx: 909, heightPx: 326, widthCm: 12, heightCm: 4.2 });
ok("six tick strokes", (tikz.match(/\\draw/g) || []).length === 6, (tikz.match(/\\draw/g) || []).length);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;