import assert from "node:assert/strict";
import { selectControlPoints, budgetSeries, validatePlotModel, normalizePlotInput } from "../server/curve-landmarks.mjs";

// A single central dip must survive a 20 -> 12 reduction.
const dip = Array.from({ length: 20 }, (_, i) => [i * 50, i === 10 ? 20 : 500]);
dip[9] = [450, 240]; dip[11] = [550, 240];
const reduced = selectControlPoints({ points: dip, landmarks: [{ kind: "minimum", point: [500, 20], confidence: 0.98 }] });
assert.ok(reduced.points.length <= 12, "budget does not exceed 12");
assert.ok(reduced.points.some((p) => p[1] < 30), "the single central minimum survives");
assert.ok(reduced.points.some((p) => Math.abs(p[0] - 450) < 40), "left shoulder survives");
assert.ok(reduced.points.some((p) => Math.abs(p[0] - 550) < 40), "right shoulder survives");
assert.deepEqual(reduced.points[0], [0, 500], "left endpoint survives");
assert.deepEqual(reduced.points.at(-1), [950, 500], "right endpoint survives");
assert.ok(reduced.preservedKinds.includes("minimum"), "minimum landmark is preserved");

// Referenced landmark points must enter the final control set even if absent from the raw list.
const landmarkOnly = selectControlPoints({ points: [[0, 0], [1000, 0]], landmarks: [{ kind: "maximum", point: [500, -10], confidence: 0.9 }] });
assert.ok(landmarkOnly.points.some((p) => Math.abs(p[0] - 500) < 6), "landmark point is injected");

// Old plot JSON (no landmarks/relations) stays valid.
const legacy = validatePlotModel({ curves: [{ name: "x", color: "#000000", dash: "solid", continuous: true, points: [[0, 0], [500, 100], [1000, 0]] }] });
assert.equal(legacy.ok, true);

// New protocol errors are caught.
const bad = validatePlotModel({
  curves: [{ id: "curve-1", points: [[0, 0], [10, 10]] }],
  relations: [{ kind: "vertical-order", aboveSeriesId: "curve-1", belowSeriesId: "missing" }],
});
assert.equal(bad.ok, false);
assert.ok(bad.errors.some((e) => e.includes("missing")), "unknown seriesId is reported");

const budgeted = budgetSeries([{ id: "curve-1", points: dip, landmarks: [{ kind: "minimum", point: [500, 20], confidence: 0.98 }] }]);
assert.ok(budgeted[0].points.length <= 12);
assert.ok(budgeted[0].preservedKinds.includes("minimum"));
console.log("curve landmarks tests passed");