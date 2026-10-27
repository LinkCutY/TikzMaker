import assert from "node:assert/strict";
import { fitJointSeries, candidatesForSeries } from "../server/joint-fit.mjs";

// Pixel coordinates: y grows downward. A flat upper series and a lower series
// that dips at the centre must jointly select an assignment that respects order.
const above = { id: "curve-1", points: [[0, 180], [250, 180], [500, 180], [750, 180], [1000, 180]] };
const below = { id: "curve-2", points: [[0, 780], [250, 780], [500, 780], [750, 780], [1000, 780]], landmarks: [{ kind: "minimum", point: [500, 780], confidence: 0.96 }] };

const good = fitJointSeries(
  [above, below],
  [{ kind: "vertical-order", at: { kind: "minimum", seriesId: "curve-2" }, aboveSeriesId: "curve-1", belowSeriesId: "curve-2", marginPx: 20, confidence: 0.95 }],
  {},
);
assert.equal(good.ok, true, "valid vertical-order survives joint selection");
assert.equal(good.relation.failures.length, 0);

// Reversing the relation turns the same low-residual candidates into a hard failure.
const reversed = fitJointSeries(
  [above, below],
  [{ kind: "vertical-order", at: { kind: "minimum", seriesId: "curve-1" }, aboveSeriesId: "curve-2", belowSeriesId: "curve-1", marginPx: 20, confidence: 0.95 }],
  {},
);
assert.equal(reversed.ok, false, "a high-confidence wrong order is rejected, not silently kept");
assert.ok(reversed.relation.failures.length > 0);

// Every series still exposes a compact model (never a raw point list).
for (const series of [above, below]) {
  const candidates = candidatesForSeries(series);
  assert.ok(candidates.length >= 2, "each series has real candidate models");
  assert.ok(candidates.every((c) => typeof c.evalPixel === "function"));
}

// Axis contact is part of the joint loss.
const yCal = { ok: true, rmse: 0.01, toValue: (py) => (1000 - py) / 1000, toPixel: (v) => 1000 - v * 1000 };
const contact = fitJointSeries(
  [below],
  [{ kind: "axis-contact", seriesId: "curve-2", axis: "y", value: 0.22, at: { kind: "minimum" }, confidence: 0.9 }],
  { yCalibration: yCal, coordinateSpace: "data" },
);
assert.ok(Number.isFinite(contact.loss), "joint loss is finite with axis contact");
console.log("joint fit tests passed");