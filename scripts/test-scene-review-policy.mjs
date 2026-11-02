import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
process.env.AI_LOG='0';
const {runSceneGeneration}=await import('../server/scene-workflow.mjs');
// Tiny in-memory PNG consumed only by the project's decoder; no model/network.
const chunk=(name,data)=>{const n=Buffer.alloc(4);n.writeUInt32BE(data.length);return Buffer.concat([n,Buffer.from(name),data,Buffer.alloc(4)]);};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(32);ihdr.writeUInt32BE(32,4);ihdr[8]=8;ihdr[9]=2;
const pixels=Buffer.alloc(32*97,255);for(let y=0;y<32;y++)pixels[y*97]=0;
const image='data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
async function run({reviewer,compiled=true,pass=true,approximate=false}){
  let reviews=0;const events=[];
  for await(const e of runSceneGeneration({image,budgetMs:30000,maxAttempts:1,reviewer},{
    chat:async()=>({text:JSON.stringify({canvas:{width:32,height:32,unit:'px'},type:'diagram',fidelity:approximate?'approximate':'reconstruction',objects:[{id:'box',kind:'rect',box:[4,4,24,24],style:{stroke:'#000000'}}]})}),
    parseJsonObject:JSON.parse,compileAndRender:async()=>({ok:compiled,errors:[]}),
    compareVision:async()=>{reviews++;return {pass,score:pass?90:40};}
  }))events.push(e);
  return {done:events.findLast(e=>e.type==='done'),reviews};
}
const off=await run({reviewer:false});assert.equal(off.done.ok,true);assert.equal(off.reviews,0);assert.equal(off.done.visual,null);
assert.equal((await run({reviewer:false,compiled:false})).done.ok,false);
assert.equal((await run({reviewer:false,approximate:true})).done.ok,false);
assert.equal((await run({reviewer:true,pass:false})).done.ok,false);
assert.equal((await run({reviewer:true})).done.ok,true);
console.log('scene review policy passed: explicit opt-out, compile/fidelity gates, requested review gates');
