import assert from 'node:assert/strict';
import http from 'node:http';
import {encodePng} from '../server/pngwrite.mjs';
import {squarePlan,meanValuePlan,flowPlan} from './fixtures/text-composition.mjs';
process.env.AI_LOG='0';
const {runGeneration}=await import('../server/ai.mjs');
const square=String.raw`\documentclass[tikz,border=8pt]{standalone}
\begin{document}
\begin{tikzpicture}
\draw (0,0) rectangle (2,2);
\end{tikzpicture}
\end{document}`;
let calls=[],scenario='pass',reviews=0,generations=0;
const provider=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;
  const body=JSON.parse(raw);calls.push(body);
  let content=square;
  if(scenario==='image'){
    assert.ok(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
    content=JSON.stringify({canvas:{width:32,height:32,unit:'px'},type:'diagram',objects:[{id:'box',kind:'rect',box:[4,4,24,24],style:{stroke:'#000000'}}]});
  }else{
    assert.ok(body.messages.every(m=>typeof m.content==='string'),'text mode must never send an undefined reference image');
    if(body.messages[0].content.includes('Return ONLY JSON, not TikZ')){
      generations++;
      let plan=structuredClone(scenario==='mean-value'?meanValuePlan:scenario==='flow'?flowPlan:squarePlan);
      if(scenario==='construction-repair'&&generations===1)plan.objects[0].size=-2;
      if(scenario==='qualification-loop'&&generations<=3)plan.objects[0].size=-2;
      if(scenario==='cannot-delete'){
        if(generations===1)plan.objects[0].size=-2;
        else {plan.requirements=[{id:'replacement',text:'a circle',objects:['circle']}];plan.objects=[{id:'circle',kind:'circle',at:[0,0],radius:1}];}
      }
      content=JSON.stringify(plan);
    }
    if(body.messages[0].content.includes('TikZ figure reviewer')){
      reviews++;
      assert.ok(body.messages[1].content.includes('User request:'));
      content=scenario==='review-error'&&reviews===1?'unusable review':JSON.stringify({verdict:(scenario==='repair'&&reviews===1)||(scenario==='qualification-loop'&&[1,3].includes(reviews))?'revise':'pass',score:90,issues:[],instructions:'Keep equal side lengths'});
    }
    if(scenario==='upstream-error'||scenario==='preserve-qualified'&&generations>1){res.writeHead(401,{'content-type':'application/json'});res.end('{"error":{"message":"test key rejected"}}');return;}
  }
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
async function run(name,opts={}){
  scenario=name;calls=[];reviews=0;generations=0;const events=[],controller=new AbortController();
  for await(const e of runGeneration({mode:'text',prompt:'画一个正方形',apiKey:'local-mock',baseUrl:'http://127.0.0.1:'+provider.address().port,
    model:'local-mock',budgetMs:120000,maxAttempts:2,refinementPasses:0,signal:controller.signal,canvasMode:true,reviewer:true,engine:'xelatex',...opts})){
    events.push(e);
    if(name==='cannot-delete'&&events.filter(e=>e.id==='composition'&&e.status==='fail').length>=2)controller.abort();
  }
  const done=events.findLast(e=>e.type==='done');assert.ok(done);assert.equal(events.at(-1).type,'end');return {done,events,calls:[...calls]};
}
try{
  const pass=await run('pass');assert.equal(pass.done.ok,true,JSON.stringify(pass.done));assert.equal(pass.calls.length,2);assert.ok(pass.done.code.includes('rectangle (2,2)'));
  const noReview=await run('pass',{reviewer:false,canvasMode:false});assert.equal(noReview.done.ok,true);assert.equal(noReview.calls.length,1);
  const repair=await run('repair');assert.equal(repair.done.ok,true);assert.equal(repair.done.rounds,2);assert.ok(repair.calls[2].messages[1].content.includes('Keep equal side lengths'));
  assert.ok(repair.calls[2].messages[1].content.includes('Previous construction to repair'));assert.ok(repair.done.checks.composition.requirements.length);
  const cr=await run('construction-repair',{reviewer:false});assert.equal(cr.done.ok,true);assert.equal(cr.done.rounds,2);
  const deletion=await run('cannot-delete',{reviewer:false});assert.equal(deletion.done.ok,false);assert.equal(deletion.done.reason,'CANCELLED');assert.match(deletion.done.errors[0].message,/restore original requirement/);
  const looping=await run('qualification-loop',{maxAttempts:1,refinementPasses:1});assert.equal(looping.done.ok,true);assert.equal(looping.done.rounds,7);assert.equal(looping.done.attempts,4);assert.deepEqual(looping.done.refinement,{target:1,completed:1,qualified:true,complete:true});
  const kept=await run('preserve-qualified',{refinementPasses:2});assert.equal(kept.done.ok,true);assert.ok(kept.done.code.includes('rectangle'));assert.equal(kept.done.refinement.complete,false);assert.equal(kept.done.stopReason,'BAD_KEY');
  const budget=await run('pass',{budgetMs:1});assert.equal(budget.done.reason,'TIME_BUDGET');assert.equal(budget.calls.length,0);
  const mv=await run('mean-value',{prompt:'生成拉格朗日中值定理示意图'});assert.equal(mv.done.ok,true,JSON.stringify(mv.done.errors));assert.equal(mv.done.checks.mathematics.ok,true);
  const flow=await run('flow',{prompt:'输入到处理再到输出的流程图'});assert.equal(flow.done.ok,true,JSON.stringify(flow.done.errors));
  const edit=await run('pass',{mode:'edit',current:square,reviewer:false});assert.ok(edit.calls[0].messages[1].content.includes(square));assert.equal(edit.done.ok,true);
  const unavailable=await run('review-error');assert.equal(unavailable.done.ok,true);assert.equal(unavailable.done.rounds,2,'invalid review must rework instead of stopping');
  const rejected=await run('upstream-error');assert.equal(rejected.done.reason,'BAD_KEY');assert.ok(rejected.events.some(e=>e.id==='generate'&&e.status==='fail'));
  const image='data:image/png;base64,'+encodePng({w:32,h:32,rgb:new Uint8Array(32*32*3).fill(255)}).toString('base64');
  const pictured=await run('image',{mode:'image',image,representation:'figure',pipeline:'scene',reviewer:false});
  assert.equal(pictured.done.ok,true);assert.equal(pictured.done.pipeline,'scene-v1');assert.equal(pictured.done.scene.type,'diagram');
  console.log('text generation passed: square -> real TeX compile -> text review -> done; review off, repair, edit, upstream/review errors; image scene routing unchanged. Local mock provider only.');
}finally{await new Promise(resolve=>provider.close(resolve));}
