import assert from 'node:assert/strict';
import http from 'node:http';
import {encodePng} from '../server/pngwrite.mjs';
process.env.AI_LOG='0';
const {runGeneration}=await import('../server/ai.mjs');
const square=String.raw`\documentclass[tikz,border=8pt]{standalone}
\begin{document}
\begin{tikzpicture}
\draw (0,0) rectangle (2,2);
\end{tikzpicture}
\end{document}`;
let calls=[],scenario='pass',reviews=0;
const provider=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;
  const body=JSON.parse(raw);calls.push(body);
  let content=square;
  if(scenario==='image'){
    assert.ok(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
    content=JSON.stringify({canvas:{width:32,height:32,unit:'px'},type:'diagram',objects:[{id:'box',kind:'rect',box:[4,4,24,24],style:{stroke:'#000000'}}]});
  }else{
    assert.ok(body.messages.every(m=>typeof m.content==='string'),'text mode must never send an undefined reference image');
    if(body.messages[0].content.includes('TikZ figure reviewer')){
      reviews++;
      assert.ok(body.messages[1].content.includes('画一个正方形'));
      content=scenario==='review-error'?'unusable review':JSON.stringify({verdict:scenario==='repair'&&reviews===1?'revise':'pass',score:90,issues:[],instructions:'Keep equal side lengths'});
    }
    if(scenario==='upstream-error'){res.writeHead(401,{'content-type':'application/json'});res.end('{"error":{"message":"test key rejected"}}');return;}
  }
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
async function run(name,opts={}){
  scenario=name;calls=[];reviews=0;const events=[];
  for await(const e of runGeneration({mode:'text',prompt:'画一个正方形',apiKey:'local-mock',baseUrl:'http://127.0.0.1:'+provider.address().port,
    model:'local-mock',budgetMs:120000,maxAttempts:2,canvasMode:true,reviewer:true,engine:'xelatex',...opts}))events.push(e);
  const done=events.findLast(e=>e.type==='done');assert.ok(done);assert.equal(events.at(-1).type,'end');return {done,events,calls:[...calls]};
}
try{
  const pass=await run('pass');assert.equal(pass.done.ok,true,JSON.stringify(pass.done));assert.equal(pass.calls.length,2);assert.ok(pass.done.code.includes('rectangle (2,2)'));
  const noReview=await run('pass',{reviewer:false,canvasMode:false});assert.equal(noReview.done.ok,true);assert.equal(noReview.calls.length,1);
  const repair=await run('repair');assert.equal(repair.done.ok,true);assert.equal(repair.done.rounds,2);assert.ok(repair.calls[2].messages[1].content.includes('Keep equal side lengths'));
  const edit=await run('pass',{mode:'edit',current:square,reviewer:false});assert.ok(edit.calls[0].messages[1].content.includes(square));assert.equal(edit.done.ok,true);
  const unavailable=await run('review-error');assert.equal(unavailable.done.ok,false);assert.equal(unavailable.done.reason,'REVIEW_UNAVAILABLE');
  const rejected=await run('upstream-error');assert.equal(rejected.done.reason,'BAD_KEY');assert.ok(rejected.events.some(e=>e.id==='generate'&&e.status==='fail'));
  const image='data:image/png;base64,'+encodePng({w:32,h:32,rgb:new Uint8Array(32*32*3).fill(255)}).toString('base64');
  const pictured=await run('image',{mode:'image',image,representation:'figure',pipeline:'scene',reviewer:false});
  assert.equal(pictured.done.ok,true);assert.equal(pictured.done.pipeline,'scene-v1');assert.equal(pictured.done.scene.type,'diagram');
  console.log('text generation passed: square -> real TeX compile -> text review -> done; review off, repair, edit, upstream/review errors; image scene routing unchanged. Local mock provider only.');
}finally{await new Promise(resolve=>provider.close(resolve));}
