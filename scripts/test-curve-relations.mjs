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

// Regression: the screenshot's 882000 penalty came from choosing the TOP as minimum.
const zigzag = { id:'red', connection:'linear', points:[[100,300],[200,650],[300,250],[400,700]] };
const zero = { id:'zero', points:[[100,500],[400,500]] };
const minimum = evaluateRelations({ series:[zigzag,zero], relations:[{kind:'vertical-order',
  at:{kind:'minimum',seriesId:'red'},aboveSeriesId:'zero',belowSeriesId:'red',marginPx:10}] });
assert.equal(minimum.ok,true);
assert.equal(minimum.checks[0].x,400);
assert.equal(minimum.checks[0].gap,200);
const anchored = evaluateRelations({ series:[zigzag,zero], relations:[{kind:'vertical-order',
  at:{kind:'maximum',seriesId:'red',interval:[150,350]},aboveSeriesId:'red',belowSeriesId:'zero',marginPx:10}] });
assert.equal(anchored.checks[0].x,300,'at.seriesId chooses the requested series, not always below');
const missing = evaluateRelations({series:[zero],relations:[{kind:'crossing',seriesId:'red',withSeriesId:'zero'}]});
assert.equal(missing.ok,false,'unknown relation references cannot silently pass');
const crossings = evaluateRelations({series:[zigzag,zero],relations:[{kind:'crossing',seriesId:'red',withSeriesId:'zero',count:3}]});
assert.equal(crossings.ok,true);
assert.equal(evaluateRelations({series:[zigzag,zero],relations:[{kind:'crossing',seriesId:'red',withSeriesId:'zero',count:1}]}).ok,false);
const fitted = {id:'fit',points:[[0,100],[500,100],[1000,100]],geometry:{kind:'polyline',vertices:[[0,800],[1000,800]],domain:[0,1000]}};
assert.equal(evaluateRelations({series:[fitted],yCalibration:yCal,relations:[{kind:'axis-contact',seriesId:'fit',value:0.2}]}).ok,true,'axis contact checks emitted geometry');
console.log('extrema orientation, location references, crossings and emitted-geometry checks passed');
