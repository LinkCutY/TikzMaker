/** Preserve source-verified crossings even when a whole-curve fit is rejected.
 * Two local Hermite cubics meet at the measured point and tangent. Outer
 * geometry is retained exactly. This is a provisional vector correction. */
import {monotoneCubics} from './scene.mjs';
import {clipCubics} from './curve-clip.mjs';
export function preserveCrossings(objects,relations,raster){
  const map=new Map(objects.map(o=>[o.id,o]));
  for(const r of relations||[]){
    if(r.source!=='two-stroke-image-template'||!r.tangentAngles)continue;
    if(r.seriesIds.every(id=>map.get(id)?.fitDiagnostics?.status==='fitted'&&map.get(id).fitDiagnostics.crossings?.maxErrorPx<=2))continue;
    const updates=[];
    for(let i=0;i<2;i++){
      const o=map.get(r.seriesIds[i]);
      if(!o||!['smooth','bezier'].includes(o.connection)||o.closed||o.style?.arrow)break;
      const start=o.start||o.points[0],segments=o.segments||monotoneCubics(o.points),end=segments.at(-1)[2];
      let p=start,monotone=true;
      for(const s of segments){if(!(p[0]<=s[0][0]&&s[0][0]<=s[1][0]&&s[1][0]<=s[2][0]))monotone=false;p=s[2];}
      if(!monotone)break;
      const x=r.at[0],radius=Math.min((r.windowPx||12)*2*1000/raster.w,(x-start[0])*.8,(end[0]-x)*.8);
      if(radius<=2*1000/raster.w)break;
      const left=x-radius,right=x+radius;
      const before=clipCubics(start,segments,[start[0]-1,-100000,left-start[0]+1,200000]).paths;
      const after=clipCubics(start,segments,[right,-100000,end[0]-right+1,200000]).paths;
      if(before.length!==1||after.length!==1)break;
      const a=before[0].segments.at(-1),b=after[0].segments[0],l=a[2],u=after[0].start;
      const slope=(a,b)=>(b[1]-a[1])/Math.max(1e-9,b[0]-a[0]);
      const ml=slope(a[1],l),mr=slope(u,b[0]),mc=Math.tan(r.tangentAngles[i]*Math.PI/180)*raster.w/raster.h;
      const core=radius*.5,lc=[x-core,r.at[1]-mc*core],rc=[x+core,r.at[1]+mc*core];
      const hermite=(a,b,ma,mb)=>{const d=(b[0]-a[0])/3;return [[a[0]+d,a[1]+ma*d],[b[0]-d,b[1]-mb*d],b];};
      const middle=[hermite(l,lc,ml,mc),hermite(lc,r.at,mc,mc),hermite(r.at,rc,mc,mc),hermite(rc,u,mc,mr)];
      const result=[...before[0].segments,...middle,...after[0].segments];
      if(result.length>24)break;
      updates.push({...o,connection:'bezier',start:before[0].start,segments:result,points:undefined,
        fit:undefined,fitDiagnostics:{...o.fitDiagnostics,status:'provisional',requiresReview:true,reason:'source-crossing-local-repair',
          structure:[],previousStructure:o.fitDiagnostics?.structure,localCrossingRepair:true}});
    }
    if(updates.length===2)for(const o of updates)map.set(o.id,o);
  }
  return objects.map(o=>map.get(o.id));
}
