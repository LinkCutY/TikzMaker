import { SCENE_PROMPT, validateScene, compileScene, sceneFromPixels, sceneToPixels } from './scene.mjs';
import { decodePng } from './trace.mjs';
import { logAttempt } from './ailog.mjs';
import { refineScene, compactSceneCurves } from './scene-fit.mjs';
import { reconstructPanels } from './scene-panels.mjs';
import { checkSceneGeometry } from './scene-geometry-check.mjs';

function modelFeedbackScene(scene,width,height){
  const pixels=sceneToPixels(scene,width,height);
  // Derived UV/fit diagnostics must not masquerade as source-pixel geometry
  // in the next model response. Keep only the public semantic object protocol.
  const derived=['fit','fitDiagnostics','plotCoordinates','frameId','frameAnchor','endpointAnchors','sourceEndpoints','referenceMeasurement','pointBudget'];
  for(const o of pixels.objects)for(const key of derived)delete o[key];
  for(const key of ['plotFrames','coordinateAnchors','coordinateReport','geometryReport','sourceSize','budgetRegions','partition'])delete pixels[key];
  return pixels;
}

/** Class-independent workflow, with a single geometry owner and deadline.
 * Services are the SAME project's provider, compiler and image reviewer used by
 * the desktop app. Repair replaces an entire validated scene transactionally. */
export async function* runSceneGeneration(opts,services){
  const started=Date.now(),remaining=()=>opts.budgetMs-(Date.now()-started);
  const controller=new AbortController(),abort=()=>controller.abort();
  const timer=setTimeout(abort,opts.budgetMs);opts.signal?.addEventListener('abort',abort,{once:true});
  if(opts.signal?.aborted)abort();
  const raster=decodePng(opts.image),versions=[];let best=null,feedback='',lastError=null;
  const maxRounds=Math.max(1,Math.min(6,opts.maxAttempts || 2));
  yield {type:'budget',limitMs:opts.budgetMs};
  try{
    for(let round=1;round<=maxRounds;round++){
      if(remaining()<10000||controller.signal.aborted)break;
      const id=round===1?'understand':'repair';
      yield {type:'step',id,label:round===1?'识别图形结构与对象':'按评审修复场景',status:'running',detail:'保留折线、曲面区域、图例、独立坐标系和面板布局'};
      let scene,built;
      try{
        if(round>1 && remaining()>70000 && (raster.w/raster.h>1.7 || raster.w>900)){
          yield {type:'step',id:'partition',label:'检查面板与共享图例分区',status:'running'};
          try{
            scene=await reconstructPanels({...opts,signal:controller.signal},raster,services);
            yield {type:'step',id:'partition',status:'ok',detail:scene?scene.partition.regions.length+' 个内容分区 · 独立识别后按原位置合成':'保持单一场景'};
          }catch(e){yield {type:'step',id:'partition',status:'fail',detail:e.message.slice(0,140)};}
        }
        let protocolError='';
        for(let trial=0;!scene && trial<2;trial++){
          const content=[{type:'text',text:SCENE_PROMPT+`\nThe input is ${raster.w} by ${raster.h} pixels. All fontSize and stroke widths are in those source pixels.\n`+
            (feedback?'Previous actual-render review: '+feedback+'\n':'')+(protocolError?'Protocol error in your last response: '+protocolError+'\n':'')},
            {type:'image_url',image_url:{url:opts.image}}];
          if(best?.scene && round>1)content.push({type:'text',text:'Previous scene in source pixels (preserve correct objects and IDs; return complete corrected scene): '+JSON.stringify(modelFeedbackScene(best.scene,raster.w,raster.h))});
          const response=await services.chat({...opts,signal:controller.signal,temperature:0,thinking:'disabled',maxTokens:14000,timeoutMs:Math.min(110000,remaining()),messages:[{role:'user',content}]});
          try{
            if(response.finishReason==='length')throw new Error('Response truncated: reduce verbosity, use atomic legends and compact objects; do not drop content');
            const validated=validateScene(compactSceneCurves(sceneFromPixels(services.parseJsonObject(response.text),raster.w,raster.h),raster.h));
            if(!validated.ok)throw new Error(validated.errors.slice(0,8).join('; '));
            scene=validated.scene;break;
          }catch(e){protocolError=e.message;if(trial===1||remaining()<45000)throw e;}
        }
        // Read topology independently: drafting all points in one response can
        // erase a crossing and then incorrectly report no relations at all.
        if(!scene.partition&&scene.type==='plot'&&remaining()>35000){
          const paths=scene.objects.filter(o=>o.kind==='path'&&['smooth','bezier','linear','step'].includes(o.connection)&&!o.style?.arrow&&!['axis','tick','grid','reference','annotation'].includes(o.role));
          if(paths.length>=2){
            yield {type:'step',id:'crossing-read',label:'独立核对交点与曲线次序',status:'running'};
            try{
              const out=await services.chat({...opts,signal:controller.signal,temperature:0,thinking:'disabled',maxTokens:3500,timeoutMs:Math.min(20000,remaining()-15000),messages:[{role:'user',content:[
                {type:'text',text:`Inspect ONLY curve intersections in this SOURCE image (${raster.w} by ${raster.h} pixels). Match series IDs using colours AND dash styles. Do not trust draft geometry. Return JSON {"relations":[{"kind":"crossing","seriesIds":["idA","idB"],"at":[pixelX,pixelY],"leftAbove":"idA","rightAbove":"idB"}],"limitations":[]}. "Above" means visually higher. Read both sides independently; omit order fields if uncertain. Exclude coincident baseline stretches, shared starts, tangencies and mere close approaches. Include solid-solid, dotted-solid and dotted-dotted crossings where evidenced. All at coordinates are IMAGE PIXELS (top-left origin, y DOWN), never axis data values. Series: `+JSON.stringify(paths.map(o=>({id:o.id,style:o.style})))},
                {type:'image_url',image_url:{url:opts.image}}]}]});
              const parsed=services.parseJsonObject(out.text);
              if(out.finishReason==='length'||!Array.isArray(parsed.relations))throw new Error('Invalid crossing response');
              const ids=new Set(paths.map(o=>o.id)),relations=parsed.relations;
              if(relations.length>120||relations.some(r=>r?.kind!=='crossing'||!Array.isArray(r.seriesIds)||r.seriesIds.length!==2||r.seriesIds[0]===r.seriesIds[1]||r.seriesIds.some(id=>!ids.has(id))||!Array.isArray(r.at)||r.at.length!==2||!r.at.every(Number.isFinite)||r.at[0]<0||r.at[0]>raster.w||r.at[1]<0||r.at[1]>raster.h||['leftAbove','rightAbove'].some(k=>r[k]!=null&&!r.seriesIds.includes(r[k]))))throw new Error('Invalid crossing coordinates or series IDs');
              const found=relations.map(r=>({...r,source:'independent-model-read',at:[r.at[0]/raster.w*1000,r.at[1]/raster.h*1000]}));
              // An empty second read cannot silently delete an earlier crossing.
              scene.relations=[...found,...(scene.relations||[]).filter(r=>!found.some(q=>q.seriesIds.every(id=>r.seriesIds.includes(id))&&Math.hypot((q.at[0]-r.at[0])*raster.w/1000,(q.at[1]-r.at[1])*raster.h/1000)<8))];
              yield {type:'step',id:'crossing-read',status:'ok',detail:found.length+' 个交点单独识别'};
            }catch(e){
              scene.limitations=[...(scene.limitations||[]),'Independent crossing review unavailable: '+e.message];
              yield {type:'step',id:'crossing-read',status:'fail',detail:e.message.slice(0,140)};
            }
          }
        }
        if(!scene.partition)scene=refineScene(scene,raster);
        if(scene.relationEvidence)yield {type:'step',id:'crossing-evidence',label:'原图局部交点证据核验',status:scene.relationEvidence.rejected.length?'fail':'ok',
          detail:scene.relationEvidence.accepted+' 个通过核验 · '+scene.relationEvidence.rejected.length+' 个未证实，不作为拟合约束'};
        scene.geometryReport=checkSceneGeometry(scene,raster);
        yield {type:'step',id:'geometry-check',label:'端点、峰谷、交点与边界校验',status:scene.geometryReport.ok?'ok':'fail',
          detail:scene.geometryReport.ok?'最终曲线与结构约束一致':JSON.stringify(scene.geometryReport.issues.slice(0,2))};
        if(scene.coordinateAnchors?.length)yield {type:'step',id:'coordinate-anchors',label:'原图坐标轴与刻度定位',status:'ok',
          detail:scene.coordinateAnchors.length+' 条轴按原图直线校正 · 曲线、刻度统一使用原图像素坐标'};
        if(scene.coordinateReport)yield {type:'step',id:'plot-frame',label:'绘图区坐标与刻度映射',status:scene.coordinateReport.ok?'ok':'fail',
          detail:(scene.plotFrames?.length||0)+' 个共享坐标系 · '+(scene.coordinateReport.ok?'曲线统一使用绘图区坐标':'未取得完整可靠的坐标标定，需要复核')};
        const fitted=scene.objects.filter(o=>o.fitDiagnostics?.status==='fitted');
        const provisional=scene.objects.filter(o=>o.fitDiagnostics?.status==='provisional');
        const kept=scene.objects.filter(o=>o.fitDiagnostics?.status==='kept-model');
        const verified=scene.objects.filter(o=>o.fitDiagnostics?.status==='verified');
        if(fitted.length||provisional.length||kept.length||verified.length)yield {type:'step',id:'curve-fit',label:'约束曲线拟合与局部误差检查',status:scene.objects.some(o=>o.fitDiagnostics?.requiresReview)?'fail':'ok',
          detail:fitted.length+' 条已校正 · '+verified.length+' 条原几何通过证据核对 · '+provisional.length+' 条采用改善候选，局部仍需修正 · '+kept.length+' 条保留模型几何'+(kept.length?'（'+kept.slice(0,2).map(o=>o.id+': '+o.fitDiagnostics.reason).join('; ')+'）':'')};
        built=compileScene(scene,{width:raster.w,height:raster.h});
        yield {type:'step',id,status:'ok',detail:scene.type+' · '+scene.objects.length+' 个语义对象'};
        yield {type:'understanding',...built.stats,items:[]};
        yield {type:'code',code:built.code};
      }catch(e){lastError=e.message;yield {type:'step',id,status:'fail',detail:e.message.slice(0,160)};break;}
      yield {type:'step',id:'compile',label:'编译并检查实际输出',status:'running'};
      const compiled=await services.compileAndRender(built.code,opts.engine||'xelatex',controller.signal,Math.max(1,Math.min(40000,remaining())));
      yield {type:'step',id:'compile',status:compiled.ok?'ok':'fail',detail:compiled.ok?'通过':compiled.errors?.map(e=>e.message).join('; ').slice(0,140)};
      let visual=null;
      if(compiled.ok && remaining()>5000 && opts.reviewer!==false){
        yield {type:'step',id:'visual',label:'模型核对原图与项目渲染',status:'running'};
        try{visual=await services.compareVision({...opts,source:built.code,image:opts.image,renderedImage:compiled.png,signal:controller.signal});}
        catch(e){lastError=e.message;}
        yield {type:'step',id:'visual',status:visual?.pass?'ok':'fail',detail:visual?visual.score+' 分 · '+(visual.issues?.[0]?.message||'结构与视觉检查通过'):'未取得有效评审：'+(lastError||'预算不足')};
      }
      const fitIssues=scene.objects.filter(o=>o.fitDiagnostics?.requiresReview||
        o.fitDiagnostics?.status==='kept-model'&&o.fitDiagnostics.before?.rmse>4).map(o=>
          o.id+': curve coordinates still need local correction; '+JSON.stringify({status:o.fitDiagnostics.status,reason:o.fitDiagnostics.reason,
            before:o.fitDiagnostics.before,best:o.fitDiagnostics.best,unsupportedEndpoints:o.fitDiagnostics.unsupportedEndpoints,
            unresolvedStructure:o.fitDiagnostics.unresolvedStructure,worstResidualTerms:o.fitDiagnostics.worstResidualTerms}));
      const coordinateIssues=scene.coordinateReport?.ok===false?['Plot coordinate calibration is incomplete or inconsistent.']:[];
      const geometryIssues=(scene.geometryReport?.issues||[]).map(issue=>'Final geometry constraint failed: '+JSON.stringify(issue));
      const limitations=[...(Array.isArray(scene.limitations)?scene.limitations:[]),...fitIssues,...coordinateIssues,...geometryIssues];
      const ok=Boolean(compiled.ok&&visual?.pass&&scene.fidelity!=='approximate'&&!fitIssues.length&&!coordinateIssues.length&&!geometryIssues.length);
      const residuals=scene.objects.map(o=>o.fitDiagnostics).filter(d=>d?.before).map(d=>
        d.status==='kept-model'?d.before.rmse:d.best?.rmse??d.before.rmse);
      const coordinatePenalty=residuals.length?Math.min(99,residuals.reduce((a,b)=>a+b,0)/residuals.length)*.001:0;
      const relationFailures=(scene.geometryReport?.issues||[]).filter(i=>i.kind.includes('crossing')).length;
      const rank=(ok?10000:compiled.ok?1000:0)+(visual?.score||0)-coordinatePenalty-Math.min(180,30*relationFailures);
      const candidate={scene,built,compiled,visual,round,ok,rank,limitations};
      versions.push({round,score:visual?.score??null,compiled:compiled.ok,ok,rank,kind:round===1?'initial':'repair'});
      if(!best||rank>best.rank)best=candidate;
      if(ok)break;
      feedback=JSON.stringify({compileErrors:compiled.errors,issues:visual?.issues,limitations,coordinateAnchors:scene.coordinateAnchors,coordinateReport:scene.coordinateReport,geometryReport:scene.geometryReport,
        sourceEndpoints:scene.objects.filter(o=>o.sourceEndpoints).map(o=>({id:o.id,coordinateSpace:'source-px',ends:o.sourceEndpoints})),
        instructions:visual?.instructions,coordinateRule:'Use SOURCE PIXEL coordinates, keep measured tick positions. Correct curve landmarks against the image, not guessed axis fractions. Improved candidates with local residuals must be refined, not rolled back to the old coordinates.'}).slice(0,10000);
    }
    if(best){
      const logId=await logAttempt({code:best.built.code,mode:'image-scene',model:opts.model,attempt:best.round,compile:best.compiled,durationMs:Date.now()-started,reconstruction:{scene:best.scene,versions}});
      if(logId)yield {type:'log',logId};
      if(best.round!==versions.at(-1)?.round)yield {type:'step',id:'rollback',label:'保留更好的完整场景',status:'ok',detail:'第 '+best.round+' 轮'};
      yield {type:'done',ok:best.ok,code:best.built.code,scene:best.scene,model:opts.model,representation:'figure',pipeline:'scene-v1',
        reason:best.ok?undefined:!best.compiled.ok?'COMPILE_FAILED':!best.visual?'REVIEW_UNAVAILABLE':best.scene.fidelity==='approximate'||best.scene.coordinateReport?.ok===false||best.scene.geometryReport?.ok===false||best.limitations.some(s=>s.includes('curve coordinates still need'))?'APPROXIMATION_REQUIRED':'REVIEW_REJECTED',
        errors:best.compiled.errors||[],visual:best.visual,limitations:best.limitations,versions,rounds:versions.length,attempts:versions.length,
        provenance:{source:'model-semantic-scene',traced:false,fitted:true},understanding:{...best.built.stats,items:[]},trace:best.built.stats,
        durationMs:Date.now()-started};
    }else yield {type:'done',ok:false,code:'',pipeline:'scene-v1',reason:controller.signal.aborted?'TIME_BUDGET':'SCENE_REJECTED',errors:[{message:lastError||'未能得到有效场景'}],versions,durationMs:Date.now()-started};
  }finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);}
  yield {type:'end'};
}
