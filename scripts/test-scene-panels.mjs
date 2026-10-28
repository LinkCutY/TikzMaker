import assert from 'node:assert/strict';
import { validateRegions,combineRegions } from '../server/scene-panels.mjs';
import { validateScene,sceneFromPixels } from '../server/scene.mjs';
const w=400,h=200,rgb=new Uint8Array(w*h*3).fill(255);
for(let y=50;y<180;y++)for(let x=10;x<390;x++)rgb.set([100,100,100],(y*w+x)*3);
const raster={w,h,rgb};
assert.ok(validateRegions([{box:[0,0,200,200]},{box:[200,0,200,200]}],raster).ok);
assert.equal(validateRegions([{box:[0,0,220,200]},{box:[200,0,200,200]}],raster).ok,false);
assert.equal(validateRegions([{box:[0,0,40,200]},{box:[200,0,40,200]}],raster).ok,false);
const part=sceneFromPixels({canvas:{width:200,height:200,unit:'px'},objects:[
 {id:'s',kind:'path',connection:'linear',points:[[10,100],[180,40]],style:{stroke:'#123456'}},
 {id:'l',kind:'legend',at:[10,150],entries:[{seriesId:'s',text:'S'}]}
]},200,200);
const combined=combineRegions([{box:[0,0,200,200],scene:part},{box:[200,0,200,200],scene:part}],raster);
assert.ok(validateScene(combined).ok);
assert.equal(combined.objects[0].points[0][0],25);
assert.equal(combined.objects[2].points[0][0],525);
assert.equal(combined.objects[3].entries[0].seriesId,'panel-1-s');
console.log('panel transforms: coverage, disjoint ownership, local coordinates and legend references passed');
