import assert from 'node:assert/strict';
import { normalizeSeries, compileSeriesGeometry, evaluateGeometry, validateSeriesGeometry } from '../server/series-geometry.mjs';
import { primitivesToTikz } from '../server/primitives.mjs';
import { budgetSeries } from '../server/curve-landmarks.mjs';

const points = Array.from({ length: 11 }, (_, i) => [170+i*70, i%2 ? 650+i*10 : 280-i*10]);
const red = normalizeSeries({ id:'red', connection:'linear', dataKind:'discrete', color:'#ef3025', expectedPointCount:11,
  points, marker:{ shape:'circle', radiusPx:7, filled:true } });
const geometry = compileSeriesGeometry(red);
assert.equal(geometry.kind, 'polyline');
assert.deepEqual(geometry.vertices, points);
const result = primitivesToTikz({ type:'plot', elements:[], curves:[{ ...red, geometry }] }, { aspect:390/360, imageWidthPx:360 });
assert.equal((result.code.match(/ -- /g) || []).length, 10, 'ten straight connections');
assert.equal((result.code.match(/ circle /g) || []).length, 11, 'eleven markers');
assert.ok(!result.code.includes('.. controls') && !result.code.includes('sin('), 'corners never smoothed');
assert.equal(result.stats.kinds.marker, 11);
assert.ok(validateSeriesGeometry([{ ...red, geometry }]).ok);
assert.equal(evaluateGeometry(geometry, (points[0][0]+points[1][0])/2), (points[0][1]+points[1][1])/2);

const scatter = normalizeSeries({ connection:'none', points:Array.from({length:20},(_,i)=>[i*20, i%3*50]), marker:{shape:'square'} });
assert.equal(budgetSeries([scatter])[0].points.length, 20, 'visible observations are not decimated to 12');
const scatterOut = primitivesToTikz({ curves:[scatter] });
assert.equal(scatterOut.stats.kinds.marker, 20);
assert.ok(!scatterOut.code.includes('.. controls'));
assert.throws(() => normalizeSeries({ ...red, points:points.slice(1) }), /OBSERVATION_COUNT/);
assert.throws(() => normalizeSeries({ connection:'linear', points:Array.from({length:81},(_,i)=>[i,i]) }), /OBSERVATION_BUDGET/);
const step = compileSeriesGeometry(normalizeSeries({connection:'step',points:[[0,100],[500,500],[1000,200]]}));
assert.equal(evaluateGeometry(step,250), 100);
assert.equal(evaluateGeometry(step,750), 500);
const smooth = compileSeriesGeometry({ points:[[0,500],[250,200],[500,100],[750,200],[1000,500]], connection:'smooth' });
assert.ok(['family','bezier'].includes(smooth.kind), 'smooth input keeps a smooth representation');
assert.ok(Number.isFinite(evaluateGeometry(smooth,500)));
console.log('series geometry: line+markers, scatter, step, smooth and observation budgets passed');
