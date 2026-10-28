import assert from "node:assert/strict";
import { mergeSparseCurveSegments, removePlotDuplicates } from "../server/ai.mjs";
import { primitivesToTikz } from "../server/primitives.mjs";

const fragments = [
  { name: "$V(z)$", color: "#9d835f", dash: "dotted", points: [[80, 100], [300, 105], [490, 500]] },
  { name: "$V(z)$", color: "#9d835f", dash: "dotted", points: [[492, 501], [700, 108], [920, 100]] },
  { name: "$\\gamma(z)$", color: "#917fa4", dash: "solid", points: [[80, 700], [350, 400], [650, 400], [920, 700]] },
];
const joined = mergeSparseCurveSegments(fragments);
assert.equal(joined.length, 2, "adjacent fragments of one semantic series should join");
assert.equal(joined[0].points.length, 6);

const overBudget = mergeSparseCurveSegments([{ color: "#123456", points: Array.from({ length: 20 }, (_, i) => [i * 10, i]) }]);
assert.equal(overBudget[0].points.length, 12, "model output is reduced to the hard semantic control-point budget");
assert.deepEqual(overBudget[0].points[0], [0, 0]);
assert.deepEqual(overBudget[0].points.at(-1), [190, 19]);

const overlapping = mergeSparseCurveSegments([
  { color: "#777777", dash: "solid", points: [[0, 10], [500, 20], [1000, 10]] },
  { color: "#777777", dash: "solid", points: [[0, 30], [500, 40], [1000, 30]] },
]);
assert.equal(overlapping.length, 2, "overlapping same-colour curves are separate series");

const raster = { w: 1000, h: 400 };
const frame = { hasBox: true, bounds: { x0: 50, y0: 20, x1: 950, y1: 350 } };
const elements = [
  { kind: "polyline", closed: true, points: [[50, 50], [950, 50], [950, 875], [50, 875]] },
  { kind: "line", x1: 50, y1: 875, x2: 950, y2: 875 },
  { kind: "polyline", points: [[100, 700], [500, 300], [900, 700]], style: { stroke: "#917fa4" } },
  { kind: "line", role: "legend", x1: 100, y1: 100, x2: 180, y2: 100 },
  { kind: "line", x1: 200, y1: 840, x2: 200, y2: 900 },
  { kind: "text", tex: "$V(z)$", box: [200, 70, 80, 40] },
];
const kept = removePlotDuplicates(elements, joined, frame, raster, { entries: [{}] }, { ticks: [{}] });
assert.deepEqual(kept.map((el) => el.role || el.kind), ["text"], "measured frame, fitted curves and atomic legend should own their representations");
const staleFrame=removePlotDuplicates([
  {kind:'polyline',closed:true,points:[[50,20],[950,20],[950,200],[50,200]],style:{stroke:'#333333'}},
  {kind:'line',x1:50,y1:200,x2:950,y2:200,style:{stroke:'#333333'}},
],joined,frame,raster,null,{ticks:[]});
assert.equal(staleFrame.length,0,'a model frame with the wrong height cannot coexist with the measured frame');

const steep = primitivesToTikz({
  type: "plot", elements: [], curves: [{ continuous: true, color: "#aa8844", dash: "dotted", points: [[100, 100], [300, 100], [450, 200], [500, 800], [550, 200], [700, 100], [900, 100]] }],
}, { aspect: 0.4, imageWidthPx: 1000 });
assert.equal((steep.code.match(/\\draw\[/g) || []).length, 1, "a steep continuous dip must remain one path");
assert.ok(!steep.items.some((item) => /分段拟合/.test(item)), "a steep continuous dip must not be mistaken for a gap");

const framedFamily = primitivesToTikz({
  type: "plot",
  elements: [{ kind: "polyline", role: "frame", closed: true, points: [[70, 70], [990, 70], [990, 800], [70, 800]] }],
  curves: [{ continuous: true, color: "#917fa4", points: [[80, 700], [300, 700], [430, 400], [550, 400], [680, 400], [810, 700], [900, 700]] }],
}, { aspect: 0.4, imageWidthPx: 1000 });
assert.match(framedFamily.code, /domain=0\.840[^:]*:11\.879/, "a full-width asymptotic family should extend to the measured frame");

console.log("plot workflow tests passed");
