import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseBody } from '../src/lib/figure/parse';
import { buildDocument } from '../src/lib/figure/generate';
import { transformElement } from '../src/lib/figure/merge';
import { cropBounds, panelRegions } from '../src/lib/panels';
const input = process.env.TEST_SOURCE || '.probe-tests/live/digitize-project-bottom-v2/result.tex';
const source = await readFile(input, 'utf8');
const first = parseBody(source), rebuilt = buildDocument(first), second = parseBody(rebuilt);
assert(first.viewport && second.viewport);
assert.equal(first.elements.length, second.elements.length, 'no lost paths');
assert(first.elements.length > 0);
for (let i=0;i<first.elements.length;i++) {
  const a=first.elements[i],b=second.elements[i];
  assert.equal(a.kind,b.kind);
  assert.equal(a.style.fill,b.style.fill);
  assert.equal(a.style.color,b.style.color);
  assert.equal(a.style.dashPattern?.length,b.style.dashPattern?.length);
  a.style.dashPattern?.forEach((v,j)=>assert(Math.abs(v-b.style.dashPattern![j])<=0.00051));
  if(a.kind==='poly' && b.kind==='poly') {
    assert.equal(a.path?.length ?? 0,b.path?.length ?? 0);
    assert.equal(a.rings?.length ?? 0,b.rings?.length ?? 0);
  }
}
const dotted = first.elements.find(e=>e.style.dashPattern);
if (dotted) assert.deepEqual(transformElement(dotted,0.5,0,0).style.dashPattern,dotted.style.dashPattern!.map(v=>v/2));
assert.deepEqual(cropBounds({x:0,y:0,w:50,h:30},1,100,100),{x:0,y:0,w:54,h:34});
const regions=panelRegions([{x:10,y:10,w:40,h:30},{x:65,y:10,w:25,h:30},{x:10,y:55,w:40,h:30},{x:65,y:60,w:25,h:25}],100,100);
assert.equal(regions[0].x,0); assert.equal(regions[2].y+regions[2].h,100);
assert.equal(regions[0].x+regions[0].w,regions[1].x);
assert.equal(regions[0].y+regions[0].h,regions[2].y);
// Compile through the running workspace project; no private renderer or image inspection.
const response=await fetch((process.env.TEST_SERVER||'http://127.0.0.1:8792')+'/api/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:rebuilt,engine:'xelatex'})});
const result=await response.json();
assert(result.ok,JSON.stringify(result.errors));
await writeFile(input.replace(/\.tex$/,'.reopened.tex'),rebuilt);
console.log(JSON.stringify({passed:true,elements:second.elements.length,projectCompile:result.ok,width:result.width,height:result.height,dashPreserved:!!dotted}));
