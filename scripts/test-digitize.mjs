import assert from 'node:assert/strict';
import { monotoneSegments, boundedFit, digitizePlot } from '../server/digitize.mjs';
import { detectFrame } from '../server/verify.mjs';
const fit = monotoneSegments([[0, 0], [1, 0], [2, 1], [3, 1], [4, 0], [5, 0]]);
for (const s of fit.segments) for (let j = 0; j <= 100; j++) {
  const t = j / 100, y = (1 - t) ** 3 * s.p1[1] + 3 * (1 - t) ** 2 * t * s.c1[1] + 3 * (1 - t) * t * t * s.c2[1] + t ** 3 * s.p2[1];
  assert(y >= Math.min(s.p1[1], s.p2[1]) - 1e-10 && y <= Math.max(s.p1[1], s.p2[1]) + 1e-10, 'no spurious extremum');
}
const gaussian = (x, [a, c, w]) => a * Math.exp(-(((x - c) / w) ** 2));
const data = Array.from({length: 100}, (_, i) => [i / 10, gaussian(i / 10, [7, 5.1, 1.3])]);
const recovered = boundedFit(data, gaussian, [6, 4.8, 1.5], [[1, 10], [3, 7], [0.5, 3]]);
assert(recovered.rmse < 0.01, 'recover parameters from samples');
const blank = {w: 200, h: 100, rgb: new Uint8Array(200 * 100 * 3).fill(255)};
assert.equal(digitizePlot(blank, {elements: []}, {hasBox: true, bounds: {x0: 1,y0:1,x1:199,y1:99}}).applied, false, 'blank is not a plot');
assert.equal(digitizePlot(blank, {elements: []}, {hasBox: false}).applied, false, 'no measured frame: retain semantic fallback');
assert.equal(monotoneSegments([[1, 2], [1, 3]]), null, 'duplicate x does not divide by zero');
const axes = {w:200,h:100,rgb:new Uint8Array(200*100*3).fill(255)};
for(let y=10;y<95;y++)for(let x=10;x<13;x++)axes.rgb.fill(0,(y*200+x)*3,(y*200+x)*3+3);
for(let y=92;y<95;y++)for(let x=10;x<195;x++)axes.rgb.fill(0,(y*200+x)*3,(y*200+x)*3+3);
assert.equal(detectFrame(axes).hasBox,false,'thick L-shaped axes are not a closed frame');
for(let y=10;y<13;y++)for(let x=10;x<195;x++)axes.rgb.fill(0,(y*200+x)*3,(y*200+x)*3+3);
for(let y=10;y<95;y++)for(let x=192;x<195;x++)axes.rgb.fill(0,(y*200+x)*3,(y*200+x)*3+3);
assert.equal(detectFrame(axes).hasBox,true,'four separated frame edges are a box');
console.log('PASS: monotonicity, no overshoot, parameter recovery, blank/unknown fallback, degenerate points');
