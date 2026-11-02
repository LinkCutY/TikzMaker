import assert from 'node:assert/strict';
import { fitSplineEvidence,refineScene,compactSceneCurves } from '../server/scene-fit.mjs';
import { validateScene } from '../server/scene.mjs';
const data=Array.from({length:350},(_,i)=>{const x=i/349;return[x,40+20*x-12*x*x+(i%3-1)*.2];});
const fit=fitSplineEvidence(data,4,{ridge:1e-8});
assert.ok(fit.rmse<.25);
assert.equal(fit.coeff.length,4);
assert.ok(Math.abs(fit.value(.4)-(40+8-12*.16))<.1);
const w=400,h=200,rgb=new Uint8Array(w*h*3).fill(255);
for(let x=20;x<380;x++){const y=Math.round(120-60*(1-Math.exp(-(x-20)/90)));for(let dy=-1;dy<=1;dy++)rgb.set([30,100,210],((y+dy)*w+x)*3);}
const scene={objects:[{id:'c',kind:'path',role:'data',connection:'smooth',points:[[50,650],[300,500],[600,430],[947,420]],
  endpointAnchors:{start:{at:[50,600]},end:{at:[947,(120-60*(1-Math.exp(-(378.8-20)/90)))*5]}},style:{stroke:'#1e64d2',width:2}}]};
const refined=refineScene(scene,{w,h,rgb});
assert.ok(validateScene(refined).ok);
assert.equal(refined.objects[0].fit?.method,'adaptive-constrained-cubic');
assert.ok(refined.objects[0].fitDiagnostics.robust.ransac.accepted>0,'production fit must consume the RANSAC initializer');
assert.ok(refined.objects[0].fit.parameters<=16);
assert.ok(refined.objects[0].fit.rmsePx<2);
assert.ok(refined.objects[0].segments.length<=13);
assert.equal(refined.objects[0].points,undefined,'image residual terms never become output vertices');
const dense={objects:[{id:'semantic-landmarks',kind:'path',connection:'smooth',points:Array.from({length:30},(_,i)=>[i/29*1000,300+100*(i/29)**2]),style:{stroke:'#123456'}}]};
const compact=compactSceneCurves(dense,400);
assert.ok(validateScene(compact).ok);
assert.ok(compact.objects[0].points.length<=dense.objects[0].points.length);
assert.ok(compact.objects[0].pointBudget.maxErrorPx<=1.5);
assert.equal(compact.objects[0].connection,'smooth');
console.log('bounded regression and shape-preserving landmark reduction passed');
