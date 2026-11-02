import assert from 'node:assert/strict';
import {fitSplineEvidence} from '../server/scene-fit.mjs';
import {prepareRobustEvidence,robustWeight} from '../server/robust-fit.mjs';
const truth=x=>30+40*x-20*x*x;
const clean=Array.from({length:480},(_,i)=>{const x=i/479;return [x,truth(x)+.2*Math.sin(i*2.4)];});
const noisy=clean.map(([x,y],i)=>[x,y+(i%5===0?30:0)]);
const error=(fit,f=truth)=>Math.sqrt(Array.from({length:201},(_,i)=>(fit.value(i/200)-f(i/200))**2).reduce((a,b)=>a+b)/201);
const options={ridge:1e-8,widthPx:1,domainWidthPx:600};
const ls=fitSplineEvidence(noisy,4,{...options,loss:'linear'}),robust=fitSplineEvidence(noisy,4,options);
assert.ok(error(robust)<.8&&error(robust)<error(ls)*.2,'outliers must not shift the entire curve');
assert.ok(robust.robustDiagnostics.ransac.accepted>0&&robust.robustDiagnostics.downweighted>60);
assert.ok(error(fitSplineEvidence(clean,4,options))<.1,'clean evidence must retain its accuracy');
assert.ok(error(fitSplineEvidence(noisy,4,{...options,loss:'soft-l1'}))<1);
// UV conversion must not change the physical noise threshold or fit.
const normalized=fitSplineEvidence(noisy.map(([x,y])=>[x,y/300]),4,{...options,unitScale:300});
assert.ok(Math.abs(robust.value(.4)-normalized.value(.4)*300)<.02);
// Gaps are missing observations, not zero-valued points. No regular resampling.
const dashes=noisy.filter((_,i)=>i%24<10);
assert.ok(error(fitSplineEvidence(dashes,4,options))<1);
// Endpoints and appended verified relations must remain protected.
const anchored=fitSplineEvidence(noisy,4,{...options,endpoints:{start:30,end:50}});
assert.ok(Math.abs(anchored.value(0)-30)<1e-7&&Math.abs(anchored.value(1)-50)<1e-7);
const relation=[...clean,[.5,70]],weights=[...clean.map(()=>1),5000];
const protectedFit=fitSplineEvidence(relation,8,{...options,weights,robustCount:clean.length});
const unprotected=fitSplineEvidence(relation,8,{...options,weights});
assert.ok(Math.abs(protectedFit.value(.5)-70)<Math.abs(unprotected.value(.5)-70));
assert.equal(protectedFit.robustDiagnostics.protectedObservations,1);
// A real sharp V is represented by a repeated knot and an explicit extremum.
const v=x=>25+90*Math.abs(x-.5),valley=clean.map(([x],i)=>[x,v(x)+.1*Math.sin(i)]);
const structured=fitSplineEvidence(valley,7,{...options,interior:[.5,.5,.5],structure:{events:[{t:.5,y:25,tolerance:.3,kind:'minimum',smooth:false}],intervals:[{lo:0,hi:.5,sign:-1},{lo:.5,hi:1,sign:1}]}});
assert.ok(structured&&error(structured,v)<.5,'RANSAC must not erase a real constrained corner');
// Fixed seed and an explicit deadline make initialization reproducible/bounded.
const a=prepareRobustEvidence(noisy,options),b=prepareRobustEvidence(noisy,options);
assert.deepEqual(a,b);assert.ok(a.report.trials<=24*96);
const timeout=prepareRobustEvidence(noisy,{...options,deadline:Date.now()-1});
assert.ok(timeout.report.timedOut&&timeout.initialWeights.every(w=>w===1));
const degenerate=prepareRobustEvidence(Array.from({length:50},(_,i)=>[.5,i]),options);
assert.equal(degenerate.report.accepted,0);assert.ok(degenerate.initialWeights.every(w=>w===1));
assert.equal(robustWeight(0),1);assert.ok(robustWeight(20)<robustWeight(2));
console.log(JSON.stringify({lsErrorPx:error(ls),robustErrorPx:error(robust),diagnostics:robust.robustDiagnostics}));
console.log('robust fit passed: outliers, clean data, soft-L1, coordinate scaling, dash gaps, protected endpoints/crossing, sharp valley, reproducibility and deadlines');
