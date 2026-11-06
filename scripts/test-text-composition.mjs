import assert from 'node:assert/strict';
import {compileComposition,validateTextFigure} from '../server/text-validation.mjs';
import {preserveRequirements} from '../server/text-composition.mjs';
import {squarePlan,flowPlan,meanValuePlan} from './fixtures/text-composition.mjs';
const square=await compileComposition(squarePlan);assert.match(square.code,/rectangle \(2,2\)/);
const flow=await compileComposition(flowPlan),edge=flow.figure.elements.find(e=>e.id==='e1');assert.deepEqual(edge.from,{x:1,y:0});assert.deepEqual(edge.to,{x:3,y:0});assert.equal(edge.style.arrow,'->');
const moved=structuredClone(flowPlan);moved.objects.find(o=>o.id==='process').at=[5,2];const m=await compileComposition(moved);const e=m.figure.elements.find(e=>e.id==='e1');assert.ok(e.from.y>0&&e.to.y>0,'connections follow relocated boxes');
const mv=await compileComposition(meanValuePlan),xi=mv.figure.elements.find(e=>e.id==='xi');assert.ok(Math.abs(xi.center.x-2.95)<1e-6);
assert.equal((await validateTextFigure(mv.code,'拉格朗日中值定理',true)).ok,true);
const cubic=structuredClone(meanValuePlan);cubic.objects[0].expr='x^3';cubic.objects[0].domain=[0,2];cubic.objects[1].x=0;cubic.objects[2].x=2;cubic.objects[4].meanValue={curve:'f',a:0,b:2};const c=await compileComposition(cubic);assert.ok(Math.abs(c.figure.elements.find(e=>e.id==='xi').center.x-Math.sqrt(4/3))<1e-5);
const geometric={version:1,requirements:[{id:'r',text:'垂直平分线',objects:['bisector']}],objects:[{id:'a',kind:'point',at:[0,0]},{id:'b',kind:'point',at:[4,2]},{id:'base',kind:'segment',from:'a',to:'b'},{id:'mid',kind:'point',midpoint:['a','b']},{id:'bisector',kind:'perpendicular',line:'base',through:'mid',length:3}],constraints:[{kind:'perpendicular',a:'base',b:'bisector'}]};
await compileComposition(geometric);
for(const mutate of [p=>p.objects[4].through='missing',p=>p.objects[3].midpoint=['mid','b'],p=>p.constraints=[{kind:'parallel',a:'base',b:'bisector'}]]){const p=structuredClone(geometric);mutate(p);await assert.rejects(()=>compileComposition(p),/COMPOSITION/);}
assert.throws(()=>preserveRequirements({...squarePlan,requirements:[]},squarePlan.requirements),/restore/);
console.log('semantic construction passed: square, attached flow arrows, relocation, perpendicular bisector, computed MVT quadratic/cubic, invalid/cyclic refs and conflicting relations rejected');
