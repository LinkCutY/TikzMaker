/** Plot coordinates are [0,1], y UP. Scene coordinates remain page layout,
 * y DOWN. Only this boundary owns the conversion; no per-series y scaling. */
export const toPlot = (p, f) => [(p[0]-f.box[0])/f.box[2], 1-(p[1]-f.box[1])/f.box[3]];
export const fromPlot = (p, f) => [f.box[0]+p[0]*f.box[2], f.box[1]+(1-p[1])*f.box[3]];
export function tickNumber(text) {
  const s=String(text??'').replace(/\$/g,'').replace(/−/g,'-').replace(/\s/g,'');
  if(/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s))return Number(s);
  const p=s.match(/^10\^\{?([-+]?\d+)\}?$/);return p?10**Number(p[1]):NaN;
}
function calibration(ticks,lo,span,reverse=false) {
  const data=ticks.map(t=>[reverse?1-(t.pixel-lo)/span:(t.pixel-lo)/span,tickNumber(t.value)]).filter(p=>p.every(Number.isFinite));
  if(data.length<2)return {ok:false,reason:'fewer-than-two-numeric-ticks'};
  function fit(log){
    if(log&&data.some(p=>p[1]<=0))return null;
    const ys=data.map(p=>log?Math.log(p[1]):p[1]),mx=data.reduce((s,p)=>s+p[0],0)/data.length,my=ys.reduce((s,y)=>s+y,0)/data.length;
    const xx=data.reduce((s,p)=>s+(p[0]-mx)**2,0);if(xx<1e-10)return null;
    const a=data.reduce((s,p,i)=>s+(p[0]-mx)*(ys[i]-my),0)/xx,b=my-a*mx;if(Math.abs(a)<1e-12)return null;
    const errorPx=Math.max(...data.map((p,i)=>Math.abs((ys[i]-b)/a-p[0])*span));
    return {ok:errorPx<=2,kind:log?'log':'linear',a,b,errorPx,tickCount:data.length,verified:data.length>=3};
  }
  const linear=fit(false),log=data.length>=3?fit(true):null;
  return log?.ok&&(!linear?.ok||log.errorPx+.5<linear.errorPx)?log:linear||{ok:false,reason:'degenerate-ticks'};
}
export const plotDataValue=(u,map)=>map?.ok?(map.kind==='log'?Math.exp(map.a*u+map.b):map.a*u+map.b):null;

export function attachPlotFrames(scene,raster) {
  const reports=scene.coordinateAnchors||[],frames=[];
  for(const x of reports.filter(r=>r.direction==='x')){
    const matches=reports.filter(r=>r.direction==='y'&&Math.abs(r.after.normal-x.after.lo)<=8&&Math.abs(x.after.normal-r.after.hi)<=8);
    if(matches.length!==1)continue;
    const y=matches[0],box=[x.after.lo,y.after.lo,x.after.hi-x.after.lo,y.after.hi-y.after.lo];
    if(box[2]<=0||box[3]<=0)continue;
    frames.push({id:'frame-'+x.axisId+'-'+y.axisId,coordinateSpace:'source-px',box,
      axisIds:[x.axisId,y.axisId],x:calibration(x.ticks,box[0],box[2]),y:calibration(y.ticks,box[1],box[3],true)});
  }
  const objects=scene.objects.map(o=>{
    const copy={...o};delete copy.frameId;delete copy.plotCoordinates;
    if(!['path','band','rect','ellipse'].includes(o.kind))return copy;
    const points=o.points||(o.start&&o.segments?[o.start,...o.segments.map(s=>s[2])]:
      o.upper?[...o.upper,...o.lower]:o.box?[o.box.slice(0,2),[o.box[0]+o.box[2],o.box[1]+o.box[3]]]:[])||[];
    if(!points.length)return copy;
    const px=points.map(p=>[p[0]*raster.w/1000,p[1]*raster.h/1000]);
    const candidates=frames.filter(f=>{
      const uv=px.map(p=>toPlot(p,f));
      // An erroneous tail outside the axes must not lose its frame ownership.
      const lo=Math.min(...uv.map(q=>q[0])),hi=Math.max(...uv.map(q=>q[0]));
      const overlap=Math.max(0,Math.min(1,hi)-Math.max(0,lo));
      // Ownership uses the majority of the geometric domain, not landmark
      // count. Sparse dotted paths must obey the same rule as dense solids.
      return (hi-lo<1e-8?lo>=-.03&&lo<=1.03:overlap/(hi-lo)>.5)&&uv.filter(q=>q[1]>=-.08&&q[1]<=1.08).length>uv.length/2;
    });
    if(candidates.length!==1)return copy;
    const f=candidates[0];copy.frameId=f.id;
    // Derived observations for diagnostics only. Compiler geometry has one owner.
    copy.plotCoordinates={space:'plot-uv',frameId:f.id,points:px.map(p=>toPlot(p,f)),source:'derived-from-scene'};
    return copy;
  });
  const legendIds=new Set(objects.filter(o=>o.kind==='legend').flatMap(o=>o.entries.map(e=>e.seriesId)));
  const dataObjects=objects.filter(o=>o.role==='data'||legendIds.has(o.id)||scene.type==='plot'&&o.kind==='path'&&['smooth','bezier'].includes(o.connection)&&!o.style?.arrow&&!['axis','reference','grid','annotation'].includes(o.role));
  const uncalibrated=dataObjects.filter(o=>{const f=frames.find(f=>f.id===o.frameId);return !f||!f.x.ok||!f.y.ok;}).map(o=>o.id);
  return {...scene,objects,plotFrames:frames,coordinateReport:{ok:scene.type!=='plot'&&frames.length===0||frames.length>0&&!uncalibrated.length,
    uncalibratedSeries:uncalibrated,reason:frames.length?'calibrated-frames':'no-unambiguous-axis-pair'}};
}

export function refreshPlotCoordinates(scene,raster){
  const frames=new Map((scene.plotFrames||[]).map(f=>[f.id,f]));
  return {...scene,objects:scene.objects.map(o=>{
    const f=frames.get(o.frameId);if(!f)return o;
    const point=p=>toPlot([p[0]*raster.w/1000,p[1]*raster.h/1000],f);
    return {...o,plotCoordinates:{space:'plot-uv',frameId:f.id,source:'derived-from-final-geometry',
      ...(o.points?{points:o.points.map(point)}:{}),...(o.start?{start:point(o.start),segments:o.segments.map(s=>s.map(point))}:{}),
      ...(o.upper?{upper:o.upper.map(point),lower:o.lower.map(point)}:{}),
      ...(o.box?{corners:[point(o.box.slice(0,2)),point([o.box[0]+o.box[2],o.box[1]+o.box[3]])]}:{}),
      ...(o.marker?.points?{observations:o.marker.points.map(point)}:{})}};
  })};
}
