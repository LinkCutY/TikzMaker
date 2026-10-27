import assert from "node:assert/strict";
import { evaluateRelations, relationFeedback, checkContinuity } from "../server/curve-relations.mjs";

// Data space: below = smaller function value.
const yCal = { ok: true, rmse: 0.01, toValue: (py) => (1000 - py) / 1000, toPixel: (v) => 1000 - v * 1000 };
const above = { id: "curve-1", points: [[0, 200], [1000, 200]] };
const below = { id: "curve-2", points: [[0, 800], [500, 800], [1000, 800]] };

const good = evaluateRelations({
  series: [above, below],
  relations: [{ kind: "vertical-order", at: { kind: "minimum", seriesId: "curve-2" }, aboveSeriesId: "curve-1", belowSeriesId: "curve-2", marginValue: 0.1, confidence: 0.95 }],
  yCalibration: yCal,
  coordinateSpace: "data",
});
assert.equal(good.ok, true, "lower data value passes vertical-order");
assert.equal(good.space, "data");

const bad = evaluateRelations({
  series: [above, below],
  relations: [{ kind: "vertical-order", at: { kind: "minimum", seriesId: "curve-1" }, aboveSeriesId: "curve-2", belowSeriesId: "curve-1", marginValue: 0.1, confidence: 0.95 }],
  yCalibration: yCal,
  coordinateSpace: "data",
});
assert.equal(bad.ok, false, "reversed order is rejected");
assert.ok(relationFeedback(bad).startsWith("curve relation failed"));

// Pixel space: below = larger image y.
const pixel = evaluateRelations({
  series: [above, below],
  relations: [{ kind: "vertical-order", at: { kind: "minimum", seriesId: "curve-2" }, aboveSeriesId: "curve-1", belowSeriesId: "curve-2", marginPx: 10, confidence: 0.9 }],
});
assert.equal(pixel.ok, true);

// Axis contact.
const contact = evaluateRelations({
  series: [below],
  relations: [{ kind: "axis-contact", seriesId: "curve-2", axis: "y", value: 0.2, at: { kind: "minimum" }, tolerance: 0.02, confidence: 0.9 }],
  yCalibration: yCal,
  coordinateSpace: "data",
});
assert.equal(contact.ok, true, "0.2 maps from pixel y 800");

// Continuity: a steep peak is not a gap; a real x-gap is.
const steep = { continuous: true, points: [[0, 0], [250, 900], [500, 100], [750, 900], [1000, 0]] };
assert.equal(checkContinuity(steep).ok, true, "steep continuous curve is not split");
const gap = { continuous: true, points: [[0, 0], [100, 0], [900, 0], [1000, 0]] };
assert.equal(checkContinuity(gap).ok, false, "wide x-gap is reported");
console.log("curve relations tests passed");