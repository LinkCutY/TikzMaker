import assert from "node:assert/strict";
import { primitivesToTikz } from "../server/primitives.mjs";
import { evaluateRelations } from "../server/curve-relations.mjs";
import { acceptance } from "../server/policy.mjs";

// The final TikZ must stay within the sparse-control budget and never fall back
// to a dense coordinates list.
const model = {
  type: "plot",
  elements: [],
  curves: [
    { id: "curve-1", color: "#917fa4", dash: "solid", continuous: true, points: [[80, 200], [300, 200], [500, 200], [700, 200], [920, 200]] },
    { id: "curve-2", color: "#9d835f", dash: "dotted", continuous: true, points: [[80, 800], [300, 800], [500, 800], [700, 800], [920, 800]] },
  ],
};
const result = primitivesToTikz(model, { aspect: 0.4, imageWidthPx: 1000 });
assert.ok(!result.code.includes("coordinates {"), "no dense coordinate list is emitted");
for (const curve of model.curves) assert.ok(curve.points.length <= 12, "curve stays within 12 control points");

// A high whole-image score cannot override a hard relation failure.
const relation = evaluateRelations({
  series: model.curves,
  relations: [{ kind: "vertical-order", at: { kind: "minimum", seriesId: "curve-1" }, aboveSeriesId: "curve-2", belowSeriesId: "curve-1", marginPx: 20, confidence: 0.95 }],
});
const visualGate = acceptance({ figureClass: "plot", recall: 0.9, plots: 2, score: 95, pass: true });
assert.equal(visualGate.ok, true, "soft whole-image gate alone would pass");
assert.equal(relation.ok, false, "relation gate catches the error");
assert.equal(visualGate.ok && relation.ok, false, "high soft score cannot carry a relation failure");
console.log("plot acceptance tests passed");