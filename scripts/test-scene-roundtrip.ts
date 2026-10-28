import assert from 'node:assert/strict';
import { compileScene,sceneFromPixels } from '../server/scene.mjs';
import { parseBodySafe,buildDocument } from '../src/lib/figure/bridge';
const scene=sceneFromPixels({canvas:{width:600,height:300,unit:'px'},objects:[
 {id:'area',kind:'path',connection:'bezier',start:[10,100],segments:[[[60,10],[130,10],[200,100]]],closed:true,style:{fill:'#aaddff',stroke:'#000000'}},
 {id:'ylabel',kind:'text',at:[250,150],fontSize:16,text:'Value',font:'sans',bold:true,rotate:90},
]},600,300);
const built=compileScene(scene,{width:600,height:300});
const parsed=parseBodySafe(built.code)!;
assert.ok(parsed);
let area=parsed.elements.find(e=>e.kind==='poly');assert.ok(area?.kind==='poly'&&area.closed&&area.style.fill==='#aaddff'&&area.path?.length===1);
const label=parsed.elements.find(e=>e.kind==='node');assert.ok(label?.kind==='node');
assert.equal(label.rotate,90);assert.equal(label.bold,true);assert.equal(label.fontFamily,'sans');
const code=buildDocument(parsed),again=parseBodySafe(code)!;
area=again.elements.find(e=>e.kind==='poly');assert.ok(area?.kind==='poly'&&area.closed&&area.style.fill==='#aaddff');
assert.equal(again.elements.find(e=>e.kind==='node')?.rotate,90);
const res=await fetch((process.env.TEST_SERVER||'http://127.0.0.1:8792')+'/api/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:code,engine:'xelatex'})});
const output=await res.json();assert.ok(output.ok,JSON.stringify(output.errors));
console.log('scene canvas roundtrip: filled cubic region and rotated sans bold text survive save/reopen and project compilation');
