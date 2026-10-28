import assert from 'node:assert/strict';
import { primitivesToTikz } from '../server/primitives.mjs';
import { parseBodySafe, buildDocument } from '../src/lib/figure/bridge';

const points=Array.from({length:11},(_,i)=>[170+i*70,i%2?650+i*10:280-i*10]);
const output=primitivesToTikz({type:'plot',elements:[],curves:[{id:'red',connection:'linear',dataKind:'discrete',
  expectedPointCount:11,points,color:'#ef3025',marker:{shape:'circle',radiusPx:7}}]}, {aspect:390/360,imageWidthPx:360});
const parsed=parseBodySafe(output.code);
assert.ok(parsed);
const originalCircles=parsed.elements.filter(el=>el.kind==='circle');
assert.equal(originalCircles.length,11,'canvas sees eleven editable markers');
const path=parsed.elements.find(el=>el.kind==='poly');
assert.ok(path && path.kind==='poly');
assert.equal(path.points.length,11);
assert.ok(!path.smooth && !path.path,'canvas does not smooth the straight path');
const rebuilt=buildDocument(parsed);
const reopened=parseBodySafe(rebuilt);
assert.ok(reopened);
assert.equal(reopened.elements.filter(el=>el.kind==='circle').length,11);
assert.equal(reopened.elements.find(el=>el.kind==='poly')?.kind,'poly');
const response=await fetch((process.env.TEST_SERVER || 'http://127.0.0.1:8792')+'/api/compile',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:rebuilt,engine:'xelatex'})});
const compile=await response.json();
assert.equal(compile.ok,true,JSON.stringify(compile.errors || compile.error));
console.log('series canvas/save/reopen and project XeLaTeX compilation passed (11 markers, 10 straight edges)');
