/** Locate an already-declared horizontal/vertical reference line by estimating
 * one offset. Fixed line quadrature only; no raster contour is constructed. */
import {inkLikelihood} from './stroke-evidence.mjs';
export function groundReferenceLines(objects,raster,frames){
  for(const o of objects){
    if(o.kind!=='path'||o.role!=='reference'||o.connection!=='linear'||o.points?.length!==2||!/^#[0-9a-f]{6}$/i.test(o.style?.stroke||''))continue;
    const frame=frames.get(o.frameId);if(!frame)continue;
    const p=o.points.map(q=>[q[0]*raster.w/1000,q[1]*raster.h/1000]),horizontal=Math.abs(p[0][1]-p[1][1])<1,vertical=Math.abs(p[0][0]-p[1][0])<1;
    if(!horizontal&&!vertical)continue;
    const d=horizontal?0:1,n=1-d,low=frame.box[n]+3,high=frame.box[n]+frame.box[n+2]-3;
    const color=[1,3,5].map(i=>parseInt(o.style.stroke.slice(i,i+2),16));
    const a=Math.max(frame.box[d]+3,Math.min(p[0][d],p[1][d])),b=Math.min(frame.box[d]+frame.box[d+2]-3,Math.max(p[0][d],p[1][d]));
    if(b-a<frame.box[d+2]*.5)continue;
    const score=offset=>{
      let sum=0;const blocks=new Set();
      for(let i=0;i<256;i++){
        const along=a+(b-a)*(i+.5)/256,v=inkLikelihood(raster,color,horizontal?along:offset,horizontal?offset:along)??0;
        sum+=v;if(v>.2)blocks.add(Math.floor(i/32));
      }return {offset,score:sum/256,blocks:blocks.size};
    };
    let fits=Array.from({length:257},(_,i)=>score(low+(high-low)*i/256)).sort((a,b)=>b.score-a.score);
    const seed=fits[0];fits.push(...Array.from({length:17},(_,i)=>score(seed.offset+(i-8)*(high-low)/2048)));
    fits.sort((a,b)=>b.score-a.score);const best=fits[0],other=fits.find(f=>Math.abs(f.offset-best.offset)>3);
    if(best.blocks<6||best.score<.08||other&&other.score>best.score*.85)continue;
    o.points=o.points.map(q=>{const copy=q.slice();copy[n]=best.offset/(n?raster.h:raster.w)*1000;return copy;});
    o.referenceMeasurement={source:'finite-line-template',offsetPx:best.offset,score:best.score};
  }
}
