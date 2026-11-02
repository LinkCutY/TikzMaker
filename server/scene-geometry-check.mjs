/** Independent final-vector checks. These evaluate mathematical geometry only. */
import { monotoneCubics } from './scene.mjs';
import { plotDataValue, toPlot } from './plot-frame.mjs';
import { clipCubics, linearCubics, stepPoints } from './curve-clip.mjs';
import { vectorCrossings } from './vector-crossings.mjs';
import { checkDiagramConnections } from './diagram-scene.mjs';
const cubic=(a,b,c,d,t)=>(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;
function geometry(o){
  if(o.connection==='bezier')return {start:o.start,segments:o.segments};
  if(o.connection==='smooth')return {start:o.points[0],segments:monotoneCubics(o.points)};
  if(['linear','step'].includes(o.connection)&&o.points?.length>1)return {start:o.points[0],segments:linearCubics(stepPoints(o))};
  return null;
}
function atX(g,x){
  let a=g.start;
  for(const s of g.segments){
    if(x>=a[0]-1e-7&&x<=s[2][0]+1e-7){
      let lo=0,hi=1;for(let j=0;j<40;j++){const t=(lo+hi)/2;if(cubic(a[0],s[0][0],s[1][0],s[2][0],t)<x)lo=t;else hi=t;}
      return cubic(a[1],s[0][1],s[1][1],s[2][1],(lo+hi)/2);
    }a=s[2];
  }return NaN;
}
export function checkSceneGeometry(scene,raster){
  const issues=[],series=[],crossings=[],frames=new Map((scene.plotFrames||[]).map(f=>[f.id,f]));
  const sourceGeometry=g=>({start:[g.start[0]*raster.w/1000,g.start[1]*raster.h/1000],segments:g.segments.map(s=>s.map(p=>[p[0]*raster.w/1000,p[1]*raster.h/1000]))});
  // Clipping is a display safeguard. It does not certify the underlying data.
  for(const o of scene.objects){
    const frame=frames.get(o.frameId),g=geometry(o);
    if(!frame||!g||o.closed||o.style?.arrow||['axis','tick','grid','annotation','reference'].includes(o.role))continue;
    const px=sourceGeometry(g),[x,y,w,h]=frame.box,tolerance=Math.max(1,(o.style?.width??1)/2);
    if(clipCubics(px.start,px.segments,[x-tolerance,y-tolerance,w+2*tolerance,h+2*tolerance]).clipped)
      issues.push({id:o.id,kind:'data-outside-plot',frameId:frame.id});
  }
  for(const o of scene.objects){
    if(o.kind!=='path'||!o.fitDiagnostics)continue;
    const g=geometry(o);if(!g)continue;
    const start=g.start,end=g.segments.at(-1)[2],frame=frames.get(o.frameId),endpoints=[];
    for(const [key,p] of [['start',start],['end',end]]){
      const measured=o.sourceEndpoints?.[key];
      if(measured){
        const errorPx=Math.abs(p[1]*raster.h/1000-measured.y);
        if(errorPx>measured.tolerancePx+.05)issues.push({id:o.id,kind:'source-endpoint-drift',endpoint:key,errorPx});
      }
      const a=o.endpointAnchors?.[key]?.at;
      const error=a?Math.hypot((p[0]-a[0])*raster.w/1000,(p[1]-a[1])*raster.h/1000):null;
      if(error!=null&&error>.05)issues.push({id:o.id,kind:'endpoint-anchor-drift',endpoint:key,errorPx:error});
      const uv=frame?toPlot([p[0]*raster.w/1000,p[1]*raster.h/1000],frame):null;
      endpoints.push({kind:key,uv,data:uv?[plotDataValue(uv[0],frame.x),plotDataValue(uv[1],frame.y)]:null,errorPx:error});
    }
    for(const event of o.fitDiagnostics.structure||[]){
      const x=start[0]+event.t*(end[0]-start[0]),y=atX(g,x)*raster.h/1000;
      const error=Math.abs(y-event.yPx),delta=Math.min((end[0]-start[0])*.005,2*1000/raster.w);
      const a=atX(g,Math.max(start[0],x-delta))*raster.h/1000,b=atX(g,Math.min(end[0],x+delta))*raster.h/1000;
      const wrong=event.kind==='maximum'?y+.05<Math.max(a,b):y-.05>Math.min(a,b);
      if(!Number.isFinite(y)||error>(event.tolerancePx||3)+.05||wrong)issues.push({id:o.id,kind:'structural-extremum-drift',event:event.kind,t:event.t,errorPx:error});
    }
    series.push({id:o.id,frameId:o.frameId,endpoints,structureCount:o.fitDiagnostics.structure?.length||0,
      strokeVerified:o.fitDiagnostics.stroke?.reliable===true,fitStatus:o.fitDiagnostics.status});
  }
  // Endpoints explicitly grounded to the same measured tick must coincide.
  const anchors=new Map();
  for(const o of scene.objects)for(const [end,a] of Object.entries(o.endpointAnchors||{})){
    const key=a.axisId+':'+a.tickId,p=end==='start'?(o.start||o.points?.[0]):(o.segments?.at(-1)?.[2]||o.points?.at(-1));
    if(!p)continue;
    const first=anchors.get(key);if(first){const gap=Math.hypot((first.p[0]-p[0])*raster.w/1000,(first.p[1]-p[1])*raster.h/1000);
      if(gap>.05)issues.push({id:o.id,with:first.id,kind:'shared-endpoint-separated',errorPx:gap});
    }else anchors.set(key,{id:o.id,p});
  }
  for(const relation of scene.relations||[]){
    const objects=relation.seriesIds.map(id=>scene.objects.find(o=>o.id===id)),curves=objects.map(o=>o?geometry(o):null);
    if(curves.some(g=>!g)){issues.push({kind:'crossing-not-verifiable',seriesIds:relation.seriesIds});continue;}
    const expected=[relation.at[0]*raster.w/1000,relation.at[1]*raster.h/1000];
    const frame=objects[0].frameId===objects[1].frameId?frames.get(objects[0].frameId):null;
    const span=frame?Math.hypot(frame.box[2],frame.box[3]):Math.hypot(raster.w,raster.h);
    const radius=Math.max(2,...objects.map(o=>2*(o.style?.width??1)),span*.025);
    const result=vectorCrossings(...curves.map(sourceGeometry),expected,radius);
    crossings.push({seriesIds:relation.seriesIds,expectedPx:expected,tolerancePx:radius,...result});
    if(!result.found.length)issues.push({kind:result.unresolved?'source-crossing-unresolved':'source-crossing-missing',seriesIds:relation.seriesIds,at:relation.at});
    if(result.found.length&&(relation.leftAbove||relation.rightAbove)){
      const center=result.found.slice().sort((a,b)=>Math.hypot(a[0]-expected[0],a[1]-expected[1])-Math.hypot(b[0]-expected[0],b[1]-expected[1]))[0][0]*1000/raster.w;
      for(const [side,sign] of [['leftAbove',-1],['rightAbove',1]]){
        if(!relation[side])continue;
        const x=center+sign*Math.max(3,span*.015)*1000/raster.w;
        const ys=curves.map(g=>atX(g,x)*raster.h/1000),index=relation.seriesIds.indexOf(relation[side]);
        if(!ys.every(Number.isFinite)||index<0)issues.push({kind:'crossing-order-unverifiable',seriesIds:relation.seriesIds,side});
        else if(ys[index]>=ys[1-index]-.25)issues.push({kind:'crossing-order-mismatch',seriesIds:relation.seriesIds,side,expectedAbove:relation[side]});
      }
    }
  }
  const diagram=checkDiagramConnections(scene);issues.push(...diagram.issues);
  return {ok:issues.length===0,issues,series,crossings,diagram};
}
