/** Verify proposed crossings with two local straight-stroke templates.
 * Only a fixed number of parameters and quadrature samples; no contour trace. */
import {inkLikelihood} from './stroke-evidence.mjs';
const rgb=c=>/^#[0-9a-f]{6}$/i.test(c||'')?[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)):null;
export function verifyCrossings(scene,raster,deadline=Infinity){
  const accepted=[],rejected=[],objects=new Map(scene.objects.map(o=>[o.id,o]));
  for(const r of scene.relations||[]){
    const pair=r.seriesIds.map(id=>objects.get(id)),colors=pair.map(o=>rgb(o?.style?.stroke));
    const frame=scene.plotFrames?.find(f=>f.id===pair[0]?.frameId&&f.id===pair[1]?.frameId);
    if(!frame||colors.some(c=>!c)||Math.hypot(...colors[0].map((v,i)=>v-colors[1][i]))<40){rejected.push({...r,reason:'ambiguous-series-or-frame'});continue;}
    const expected=[r.at[0]*raster.w/1000,r.at[1]*raster.h/1000],radius=Math.max(8,Math.min(20,frame.box[2]*.08));
    const length=Math.max(8,Math.min(16,frame.box[2]*.055));let best=null;
    const line=(x,y,c,o,seedAngle=null)=>{
      const dotted=['dashed','dotted'].includes(o.style?.dash),threshold=dotted?.1:.35;let bestLine=null;
      for(let angle=seedAngle==null?-80:seedAngle-5;angle<=(seedAngle==null?80:seedAngle+5);angle+=seedAngle==null?5:1){
        const a=angle*Math.PI/180,dx=Math.cos(a),dy=Math.sin(a),hits=[0,0];let sum=0;
        for(let side=0;side<2;side++)for(let j=0;j<6;j++){
          const t=(side?1:-1)*(3+(length-3)*j/5),px=x+t*dx,py=y+t*dy;
          const ink=Math.max(...[-.5,0,.5].map(n=>inkLikelihood(raster,c,px-n*dy,py+n*dx)??0));
          sum+=ink;if(ink>.25)hits[side]++;
        }
        const score=sum/12;
        if(hits.every(n=>n>=(dotted?1:4))&&score>=threshold&&(!bestLine||score>bestLine.score))bestLine={angle,score};
      }return bestLine;
    };
    for(let ix=-4;ix<=4;ix++){
      if(Date.now()>deadline)break;
      for(let iy=-4;iy<=4;iy++){
        const x=expected[0]+ix*radius/4,y=expected[1]+iy*radius/4;
        if(x<frame.box[0]+length||x>frame.box[0]+frame.box[2]-length||y<frame.box[1]+3||y>frame.box[1]+frame.box[3]-3)continue;
        const a=line(x,y,colors[0],pair[0]),b=line(x,y,colors[1],pair[1]);
        if(!a||!b||Math.abs(a.angle-b.angle)<10)continue;
        const score=Math.min(a.score,b.score)-.001*Math.hypot(x-expected[0],y-expected[1]);
        if(!best||score>best.score)best={x,y,a,b,score};
      }
    }
    if(!best){rejected.push({...r,reason:Date.now()>deadline?'verification-budget':'no-two-sided-source-crossing'});continue;}
    // Refine the spatial location and both directions together. Subpixel
    // precision is not certainty: shallow intersection angles amplify error.
    let step=radius/8;
    for(let round=0;round<3&&Date.now()<deadline;round++){
      const seed=best;
      for(const dx of [-step,0,step])for(const dy of [-step,0,step]){
        const x=seed.x+dx,y=seed.y+dy;
        if(Math.hypot(x-expected[0],y-expected[1])>radius*1.42)continue;
        const a=line(x,y,colors[0],pair[0],seed.a.angle),b=line(x,y,colors[1],pair[1],seed.b.angle);
        if(!a||!b||Math.abs(a.angle-b.angle)<5)continue;
        const score=Math.min(a.score,b.score)-.001*Math.hypot(x-expected[0],y-expected[1]);
        if(score>best.score)best={x,y,a,b,score};
      }step/=2;
    }
    const width=Math.max(...pair.map(o=>o.style?.width||1)),angle=Math.abs(best.a.angle-best.b.angle)*Math.PI/180;
    const uncertaintyPx=Math.max(.5,width/(2*Math.max(.05,Math.abs(Math.sin(angle)))));
    if(uncertaintyPx>length*.65){rejected.push({...r,reason:'ill-conditioned-crossing-position'});continue;}
    const refined={...r,at:[best.x/raster.w*1000,best.y/raster.h*1000],source:'two-stroke-image-template',
      leftAbove:r.seriesIds[best.a.angle>best.b.angle?0:1],rightAbove:r.seriesIds[best.a.angle>best.b.angle?1:0],evidenceScore:best.score,
      tangentAngles:[best.a.angle,best.b.angle],windowPx:length,uncertaintyPx};
    const duplicate=accepted.find(q=>q.seriesIds.every(id=>r.seriesIds.includes(id))&&Math.hypot((q.at[0]-refined.at[0])*raster.w/1000,(q.at[1]-refined.at[1])*raster.h/1000)<radius);
    if(!duplicate)accepted.push(refined);else if(refined.evidenceScore>duplicate.evidenceScore)Object.assign(duplicate,refined);
  }
  return {...scene,relations:accepted,relationEvidence:{accepted:accepted.length,rejected}};
}
