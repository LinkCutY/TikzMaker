/** Resumable real-model evaluation through the application's HTTP/SSE endpoint.
 * No renderer, model mocks, source-specific reconstruction or secrets in reports.
 * DATASET_DIR and TIKZ_AI_KEY_FILE (or TIKZ_AI_KEY) are required.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { decodePng } from '../server/trace.mjs';
const root = process.env.DATASET_DIR;
if (!root) throw new Error('DATASET_DIR is required');
const output = path.resolve(process.env.EVAL_OUTPUT || '.probe-tests/dataset/current');
const ids = process.env.EVAL_IDS?.split(',');
const names = (await readdir(root)).filter(n=>/\.png$/i.test(n) && (!ids || ids.includes(path.parse(n).name))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
const baseUrl=process.env.TIKZ_AI_BASE_URL || 'https://api.deepseek.com/v1', model=process.env.TIKZ_AI_MODEL || 'deepseek-flash';
const rounds=Number(process.env.EVAL_ROUNDS || 1), budgetMs=Number(process.env.EVAL_BUDGET_MS || 180000);
const pipeline=process.env.EVAL_PIPELINE || 'auto';
const sourceFiles=(await readdir('server')).filter(n=>n.endsWith('.mjs')).sort();
const hash=createHash('sha256');
for(const n of sourceFiles) hash.update(n).update(await readFile(path.join('server',n)));
const sourceHash=hash.digest('hex');
const manifest=[];
for(const name of names){const bytes=await readFile(path.join(root,name)); const r=decodePng('data:image/png;base64,'+bytes.toString('base64'));manifest.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),width:r.w,height:r.h});}
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'manifest.json'),JSON.stringify({sourceHash,model,baseUrl,pipeline,rounds,budgetMs,images:manifest},null,2));
if(process.env.EVAL_MANIFEST_ONLY==='1'){ console.log(JSON.stringify({output,images:manifest.length}));process.exit(0); }
const secret=process.env.TIKZ_AI_KEY || await readFile(process.env.TIKZ_AI_KEY_FILE,'utf8');
const apiKey=secret.match(/sk-[A-Za-z0-9_-]+/)?.[0];
if(!apiKey) throw new Error('API credential missing');
const reports=[];let cursor=0;
async function evaluate(item){
  const dir=path.join(output,path.parse(item.name).name);await mkdir(dir,{recursive:true});
  const reportPath=path.join(dir,'report.json');
  const configHash=createHash('sha256').update(JSON.stringify({sourceHash,item,model,baseUrl,rounds,budgetMs,pipeline})).digest('hex');
  if(process.env.EVAL_RESUME!=='0') try{const old=JSON.parse(await readFile(reportPath,'utf8'));if(old.configHash===configHash && old.finished){reports.push(old);console.log(JSON.stringify({image:item.name,cached:true,ok:old.ok,score:old.visual?.score}));return;}}catch{}
  const started=Date.now(),events=[];let done=null,error=null;
  try{
    const image='data:image/png;base64,'+(await readFile(path.join(root,item.name))).toString('base64');
    const response=await fetch((process.env.TEST_SERVER || 'http://127.0.0.1:8792')+'/api/ai/text2tikz',{
      method:'POST',headers:{'content-type':'application/json','x-ai-key':apiKey},
      body:JSON.stringify({mode:'image',image,representation:'figure',pipeline,baseUrl,model,canvasMode:true,engine:'xelatex',maxAttempts:rounds,budgetMs,reviewer:true}),
      signal:AbortSignal.timeout(budgetMs+15000)});
    if(!response.ok) throw new Error('HTTP '+response.status);
    const decoder=new TextDecoder();let pending='';
    for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});let end;
      while((end=pending.indexOf('\n\n'))>=0){const packet=pending.slice(0,end);pending=pending.slice(end+2);if(!packet.startsWith('data: '))continue;
        const event=JSON.parse(packet.slice(6));if(event.type==='done')done=event;else if(event.type!=='code') events.push(event);
      }
    }
    if(!done) throw new Error('Stream ended without a final result');
  }catch(e){error=String(e.message);}
  if(done?.code) await writeFile(path.join(dir,'result.tex'),done.code);
  if(done?.scene) await writeFile(path.join(dir,'scene.json'),JSON.stringify(done.scene,null,2));
  const report={...done,code:undefined,scene:undefined,ok:Boolean(done?.ok && done?.visual?.pass),finished:true,configHash,sourceHash,image:item.name,imageHash:item.sha256,model,pipeline,error,events,elapsedMs:Date.now()-started};
  await writeFile(reportPath,JSON.stringify(report,null,2));reports.push(report);
  console.log(JSON.stringify({image:item.name,ok:report.ok,score:report.visual?.score,reason:report.reason || error,elapsedMs:report.elapsedMs,issues:report.visual?.issues?.map(i=>i.message)}));
}
await Promise.all(Array.from({length:Math.min(3,Math.max(1,Number(process.env.EVAL_CONCURRENCY || 2)))},async()=>{while(cursor<manifest.length) await evaluate(manifest[cursor++]);}));
reports.sort((a,b)=>a.image.localeCompare(b.image,undefined,{numeric:true}));
const summary={sourceHash,model,pipeline,count:reports.length,passed:reports.filter(r=>r.ok).length,meanScore:reports.reduce((n,r)=>n+(r.visual?.score || 0),0)/reports.length,meanMs:reports.reduce((n,r)=>n+r.elapsedMs,0)/reports.length,results:reports.map(r=>({image:r.image,ok:r.ok,score:r.visual?.score ?? null,reason:r.reason || r.error,elapsedMs:r.elapsedMs}))};
await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
await writeFile(path.join(output,'summary.md'),`Real model: ${model}; pipeline: ${pipeline}; source: ${sourceHash}\n\n${summary.passed}/${summary.count} passed. Missing scores count as zero.\n\n| Image | Passed | Score | Seconds | Reason |\n|---|---|---|---|---|\n`+summary.results.map(r=>`| ${r.image} | ${r.ok} | ${r.score ?? '—'} | ${(r.elapsedMs/1000).toFixed(1)} | ${r.reason || ''} |`).join('\n'));
console.log(JSON.stringify(summary));
if(summary.passed!==summary.count)process.exitCode=1;
