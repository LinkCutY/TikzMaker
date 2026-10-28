import assert from 'node:assert/strict';
import { fitAnalyticImage } from '../server/analytic-image-fit.mjs';
import { evaluateGeometry } from '../server/series-geometry.mjs';
const raster={w:400,h:400,rgb:new Uint8Array(400*400*3).fill(255)};
for(let x=5;x<395;x++) {
  const u=x/400*1000,y=Math.round((120+600*Math.exp(-(((u-500)/100)**2)))/1000*400);
  for(let dy=-1;dy<=1;dy++)raster.rgb.set([160,128,64],((y+dy)*400+x)*3);
}
const series={id:'dip',connection:'smooth',marker:{shape:'none'},color:'#a08040',points:[[0,120],[500,240],[1000,120]],
  geometry:{kind:'family',fit:{family:'gauss',params:[120,120,500,100]},domain:[0,1000]}};
const fit=fitAnalyticImage(raster,series);
assert.ok(fit.imageFit,'a wrong sparse reading is corrected by low-parameter image residual');
assert.ok(fit.imageFit.parameters<=6);
assert.ok(fit.imageFit.rmsePx<2);
assert.ok(Math.abs(evaluateGeometry(fit.geometry,500)-720)<6);
assert.equal(fit.geometry.kind,'family');
assert.ok(!fit.geometry.vertices && !fit.geometry.paths,'no pixel-derived path leaves the fitter');
assert.deepEqual(fit.points,series.points,'semantic landmarks are not replaced by a dense traced list');
assert.equal(fitAnalyticImage(raster,{...series,connection:'linear'}).geometry,series.geometry,'a discrete line is never smoothed by image fitting');
console.log('analytic image residual fits <=6 function parameters without emitting pixel paths');
