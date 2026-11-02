import assert from 'node:assert/strict';
import {sceneFromPixels,sceneToPixels,validateScene,compileScene} from '../server/scene.mjs';
import {checkDiagramConnections} from '../server/diagram-scene.mjs';
import {refineScene} from '../server/scene-fit.mjs';
import {combineRegions} from '../server/scene-panels.mjs';
export const diagramFixture={canvas:{width:600,height:300,unit:'px'},type:'diagram',objects:[
  {id:'boxA',kind:'rect',box:[20,100,100,60],style:{stroke:'#000000',fill:'none',width:.7},z:0},
  {id:'boxB',kind:'rect',box:[380,30,100,60],style:{stroke:'#000000',fill:'none',width:.7},z:0},
  {id:'boxC',kind:'ellipse',box:[380,200,100,60],style:{stroke:'#000000',fill:'none',width:.7},z:0},
  {id:'a',kind:'vertex',at:[100,140],radiusPx:2},
  {id:'b',kind:'vertex',at:[400,70],radiusPx:2},
  {id:'c',kind:'vertex',at:[400,230],radiusPx:2},
  {id:'ab',kind:'edge',from:{id:'a'},to:{id:'b'},style:{stroke:'#000000',width:2}},
  {id:'ac',kind:'edge',from:{id:'a'},to:{id:'c'},style:{stroke:'#000000',width:1,dash:'dashed'}},
  {id:'transition',kind:'edge',from:{id:'boxB',anchor:'south'},to:{id:'boxC',anchor:'north'},style:{stroke:'#000000',dash:'dotted',arrow:'end'}},
  {id:'auto',kind:'edge',from:{id:'boxA'},to:{id:'boxB'},style:{stroke:'#444444',width:.5}},
  {id:'bend',kind:'edge',from:{id:'b'},to:{id:'c'},controls:[[560,40],[560,250]],style:{stroke:'#000000',arrow:'end'}},
  {id:'mathA',kind:'text',at:[55,120],text:"$X'_U$",fontSize:16},
  {id:'mathB',kind:'text',at:[430,45],text:'$Y_2^W$',fontSize:16},
  {id:'state',kind:'text',at:[300,20],text:'$G_{\\ell+1}$',fontSize:18},
]};
const scene=sceneFromPixels(diagramFixture,600,300);
assert.ok(validateScene(scene).ok);assert.ok(checkDiagramConnections(scene).ok);
assert.equal(checkDiagramConnections(scene).vertices,3);assert.equal(checkDiagramConnections(scene).edges,5);
const edge=scene.objects.find(o=>o.id==='ab');assert.deepEqual(edge.points[0],scene.objects.find(o=>o.id==='a').points[0]);
const compiled=compileScene(scene,{width:600,height:300});
assert.ok(compiled.code.includes('dash pattern'));assert.ok(compiled.code.includes('Stealth'));assert.ok(compiled.code.includes("X'_U"));
assert.ok(checkDiagramConnections(sceneFromPixels(sceneToPixels(scene,600,300),600,300)).ok);
assert.deepEqual(refineScene(scene,{w:600,h:300}).objects,scene.objects,'diagrams must bypass image curve regression');
const broken=structuredClone(diagramFixture);broken.objects.find(o=>o.id==='ab').to.id='missing';assert.throws(()=>sceneFromPixels(broken,600,300),/endpoint/);
const detached=structuredClone(scene);detached.objects.find(o=>o.id==='ab').points[1][0]+=10;assert.equal(checkDiagramConnections(detached).ok,false);
const combined=combineRegions([{box:[0,0,600,300],scene},{box:[600,0,600,300],scene}],{w:1200,h:300});
assert.ok(checkDiagramConnections(combined).ok,'panel merge must namespace node references and preserve anchors');
assert.equal(checkDiagramConnections(combined).edges,10);
const ports=structuredClone(diagramFixture);ports.objects.find(o=>o.id==='auto').from={id:'boxA',port:[1,.8]};
assert.ok(checkDiagramConnections(sceneFromPixels(ports,600,300)).ok);
ports.objects.find(o=>o.id==='auto').from.port=[2,.8];assert.throws(()=>sceneFromPixels(ports,600,300),/port/);
console.log('diagram semantic checks passed: anchored points/boxes, curved edges, line styles, labels, missing references, detached endpoints');
