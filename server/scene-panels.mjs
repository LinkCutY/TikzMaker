import { encodePng } from './pngwrite.mjs';
import { SCENE_PROMPT,sceneFromPixels,sceneToPixels,validateScene } from './scene.mjs';
import { refineScene, compactSceneCurves } from './scene-fit.mjs';
import { refreshPlotCoordinates } from './plot-frame.mjs';

/** Planner rectangles must partition content, not overlap/cut away a panel.
 * Coverage is only a check; source pixels are never emitted as geometry. */
export function validateRegions(regions,raster){
  const errors=[];
  if(!Array.isArray(regions)||regions.length<2||regions.length>8)return {ok:false,errors:['need 2..8 independent regions']};
  for(const [i,r] of regions.entries()){
    const b=r.box;
    if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]<0||b[1]<0||b[2]<25||b[3]<20||b[0]+b[2]>raster.w+1||b[1]+b[3]>raster.h+1)errors.push('invalid region '+i);
  }
  if(errors.length)return {ok:false,errors};
  for(let i=0;i<regions.length;i++)for(let j=0;j<i;j++){
    const a=regions[i].box,b=regions[j].box;
    const overlap=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
    if(overlap>Math.min(a[2]*a[3],b[2]*b[3])*.005)errors.push('overlapping region ownership');
  }
  let total=0,covered=0;
  for(let y=0;y<raster.h;y+=2)for(let x=0;x<raster.w;x+=2){
    const k=(y*raster.w+x)*3;if(Math.min(...raster.rgb.subarray(k,k+3))>220)continue;
    total++;if(regions.some(r=>x>=r.box[0]&&x<r.box[0]+r.box[2]&&y>=r.box[1]&&y<r.box[1]+r.box[3]))covered++;
  }
  const coverage=total?covered/total:0;if(coverage<.98)errors.push('regions omit source content');
  return {ok:errors.length===0,errors,coverage};
}
export function combineRegions(parts,raster){
  const objects=[],relations=[],limitations=[],plotFrames=[],coordinateAnchors=[],coordinateReports=[];
  for(const [i,part] of parts.entries()){
    const [x,y,w,h]=part.box,local=sceneToPixels(part.scene,w,h);
    const p=q=>[q[0]+x,q[1]+y];
    for(const r of local.relations||[])relations.push({...r,at:p(r.at),seriesIds:r.seriesIds.map(id=>'panel-'+i+'-'+id),
      ...(r.leftAbove?{leftAbove:'panel-'+i+'-'+r.leftAbove}:{}),...(r.rightAbove?{rightAbove:'panel-'+i+'-'+r.rightAbove}:{})});
    for(const f of part.scene.plotFrames||[])plotFrames.push({...f,id:'panel-'+i+'-'+f.id,box:[f.box[0]+x,f.box[1]+y,f.box[2],f.box[3]],axisIds:f.axisIds.map(id=>'panel-'+i+'-'+id)});
    if(part.scene.coordinateReport)coordinateReports.push(part.scene.coordinateReport);
    for(const r of part.scene.coordinateAnchors||[]){
      const normalOffset=r.direction==='x'?y:x,alongOffset=r.direction==='x'?x:y;
      const line=q=>({...q,normal:q.normal+normalOffset,lo:q.lo+alongOffset,hi:q.hi+alongOffset});
      coordinateAnchors.push({...r,axisId:'panel-'+i+'-'+r.axisId,before:line(r.before),after:line(r.after),ticks:r.ticks.map(t=>({...t,tickId:'panel-'+i+'-'+t.tickId,labelId:'panel-'+i+'-'+t.labelId,pixel:t.pixel+alongOffset,beforePixel:t.beforePixel+alongOffset}))});
    }
    for(const o of local.objects){
      o.id='panel-'+i+'-'+o.id;
      if(o.diagramEdge)o.diagramEdge={from:{...o.diagramEdge.from,id:'panel-'+i+'-'+o.diagramEdge.from.id},to:{...o.diagramEdge.to,id:'panel-'+i+'-'+o.diagramEdge.to.id}};
      if(o.frameId)o.frameId='panel-'+i+'-'+o.frameId;
      if(o.frameAnchor)o.frameAnchor={...o.frameAnchor,axisId:'panel-'+i+'-'+o.frameAnchor.axisId};
      if(o.endpointAnchors)for(const anchor of Object.values(o.endpointAnchors)){
        if(anchor.at)anchor.at=p(anchor.at);
        if(anchor.axisId)anchor.axisId='panel-'+i+'-'+anchor.axisId;
        if(anchor.tickId)anchor.tickId='panel-'+i+'-'+anchor.tickId;
      }
      if(o.fit){
        o.fit={...o.fit,frameId:o.frameId};
        if(o.fit.priorPoints)o.fit.priorPoints=o.fit.priorPoints.map(q=>[(x+q[0]*w/1000)/raster.w*1000,(y+q[1]*h/1000)/raster.h*1000]);
        if(o.fit.endpointConstraintsPx)o.fit.endpointConstraintsPx=Object.fromEntries(Object.entries(o.fit.endpointConstraintsPx).map(([key,value])=>[key,value+y]));
      }
      if(o.sourceEndpoints)for(const measured of Object.values(o.sourceEndpoints))measured.y+=y;
      if(o.fitDiagnostics){
        o.fitDiagnostics={...o.fitDiagnostics,frameId:o.frameId};
        if(o.fitDiagnostics.structure)o.fitDiagnostics.structure=o.fitDiagnostics.structure.map(e=>({...e,yPx:e.yPx+y}));
        if(o.fitDiagnostics.ownership)o.fitDiagnostics.ownership={...o.fitDiagnostics.ownership,competitors:o.fitDiagnostics.ownership.competitors.map(id=>'panel-'+i+'-'+id)};
      }
      if(o.kind==='legend')o.entries=o.entries.map(e=>({...e,seriesId:'panel-'+i+'-'+e.seriesId}));
      if(o.at)o.at=p(o.at);if(o.start)o.start=p(o.start);if(o.points)o.points=o.points.map(p);if(o.segments)o.segments=o.segments.map(s=>s.map(p));if(o.marker?.points)o.marker.points=o.marker.points.map(p);
      if(o.upper)o.upper=o.upper.map(p);if(o.lower)o.lower=o.lower.map(p);
      if(o.box)o.box=[o.box[0]+x,o.box[1]+y,o.box[2],o.box[3]];
      o.panelId='panel-'+i;objects.push(o);
    }
    if(part.scene.fidelity==='approximate')limitations.push(...(part.scene.limitations||['approximate region '+i]));
  }
  const combined=sceneFromPixels({canvas:{width:raster.w,height:raster.h,unit:'px'},type:'mixed',summary:parts.length+' independent content regions',fidelity:limitations.length?'approximate':'reconstruction',limitations,objects,relations},raster.w,raster.h);
  combined.budgetRegions=Object.fromEntries(parts.map((part,i)=>['panel-'+i,{width:part.box[2],height:part.box[3]}]));
  combined.plotFrames=plotFrames;combined.coordinateAnchors=coordinateAnchors;
  combined.coordinateReport={ok:coordinateReports.every(r=>r.ok),panels:coordinateReports};
  return refreshPlotCoordinates(combined,raster);
}
function crop(raster,box){
  const [x,y,w,h]=box,rgb=new Uint8Array(w*h*3);
  for(let row=0;row<h;row++)rgb.set(raster.rgb.subarray(((y+row)*raster.w+x)*3,((y+row)*raster.w+x+w)*3),row*w*3);
  return {w,h,rgb};
}
export async function reconstructPanels(opts,raster,services){
  const plan=await services.chat({...opts,temperature:0,thinking:'disabled',maxTokens:1300,timeoutMs:25000,messages:[{role:'user',content:[
    {type:'text',text:`Identify INDEPENDENT panels in this ${raster.w} x ${raster.h} source-pixel image. Return ONLY {"regions":[{"kind":"panel|shared-legend|caption","box":[left,top,width,height]}]}. Rectangles must be nonoverlapping, within image, and collectively contain ALL labels, data, frames and legends. Split only independent panels, not curves/axes within one plot. Shared full-width legend/title bands get separate regions, not duplicated. Use exact source pixels, integer sizes. For one plot or a connected diagram return {"regions":[]}. At most 8 rectangles. Do not cut through any label or data.`},
    {type:'image_url',image_url:{url:opts.image}}
  ]}]});
  const regions=services.parseJsonObject(plan.text).regions;
  const check=validateRegions(regions,raster);if(!check.ok)return null;
  const parts=[];let cursor=0;
  await Promise.all(Array.from({length:2},async()=>{
    while(cursor<regions.length){
      const i=cursor++,r=regions[i],box=r.box.map(Math.round),local=crop(raster,box);
      const image='data:image/png;base64,'+encodePng(local).toString('base64');
      const prompt=SCENE_PROMPT+`\nThis is a ${local.w} x ${local.h} source-pixel ${r.kind} crop. All coordinates are LOCAL to this crop. The rest of the original image is reconstructed separately. Preserve ALL content visible here, without inventing content outside it. Shared legend-only crops use ordinary sample paths/markers plus text, not references to nonexistent series. Labels may refer to unseen panels; transcribe them unchanged.`;
      const out=await services.chat({...opts,temperature:0,thinking:'disabled',maxTokens:11000,timeoutMs:65000,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:image}}]}]});
      if(out.finishReason==='length')throw new Error('Panel response truncated');
      const v=validateScene(compactSceneCurves(sceneFromPixels(services.parseJsonObject(out.text),local.w,local.h),local.h));if(!v.ok)throw new Error(v.errors.slice(0,3).join('; '));
      parts[i]={box,scene:refineScene(v.scene,local)};
    }
  }));
  const combined=combineRegions(parts,raster),v=validateScene(combined);if(!v.ok)throw new Error(v.errors.slice(0,3).join('; '));
  return {...combined,partition:{regions,coverage:check.coverage}};
}
