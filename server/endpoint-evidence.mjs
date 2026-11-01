/** Two-parameter local stroke template. Searches intercept and slope, not a
 * raster contour; only one endpoint and its uncertainty are returned. */
import { inkLikelihood } from './stroke-evidence.mjs';

export function measureEndpoint(raster,colors,{x,direction,box,width=1,deadline=Infinity}){
  const extent=Math.max(8,Math.min(20,box[2]*.045));
  const score=(y,slope,parity=null)=>{
    let sum=0,count=0,hits=0;
    for(let i=0;i<16;i++){
      if(parity!=null&&i%2!==parity)continue;
      const dx=2+(extent-2)*(i+.5)/16,px=x+direction*dx,py=y+slope*dx;
      if(py<box[1]||py>box[1]+box[3]||px<box[0]||px>box[0]+box[2])continue;
      const likelihood=(xx,yy)=>Math.max(...colors.map(c=>inkLikelihood(raster,c,xx,yy)??0));
      const ink=Math.max(...[-.3,0,.3].map(d=>likelihood(px,py+d*width)));
      const bg=(likelihood(px,py+width+2)+likelihood(px,py-width-2))/2;
      sum+=ink-.3*bg;hits+=ink>.3?1:0;count++;
    }
    return {score:count?sum/count:0,coverage:count?hits/count:0,count};
  };
  let fits=[];
  // Resolution-independent bounded parameter search, followed by local refinement.
  for(let j=0;j<=96;j++){
    if(Date.now()>deadline)return null;
    const y=box[1]+box[3]*j/96;
    for(const slope of [-4,-2,-1,-.5,-.25,0,.25,.5,1,2,4])fits.push({y,slope,...score(y,slope,0)});
  }
  fits.sort((a,b)=>b.score-a.score);
  const seeds=[];
  for(const f of fits)if(seeds.every(q=>Math.abs(q.y-f.y)>2)){
    seeds.push(f);if(seeds.length===5)break;
  }
  const refined=[];
  for(const seed of seeds)for(let j=-4;j<=4;j++)for(let k=-4;k<=4;k++){
    if(Date.now()>deadline)return null;
    const y=seed.y+j*box[3]/384,slope=seed.slope+k*.125;
    if(y<box[1]||y>box[1]+box[3])continue;
    refined.push({y,slope,...score(y,slope,0)});
  }
  refined.sort((a,b)=>b.score-a.score);const best=refined[0];if(!best)return null;
  const heldOut=score(best.y,best.slope,1),runner=refined.find(q=>Math.abs(q.y-best.y)>Math.max(4,width*2));
  if(best.count<6||heldOut.count<6||best.score<.4||heldOut.score<.4||heldOut.coverage<.75||runner&&runner.score>best.score-.06)return null;
  const plausible=refined.filter(q=>q.score>best.score-.04);
  const weights=plausible.map(q=>Math.exp((q.score-best.score)/.02)),sum=weights.reduce((a,b)=>a+b,0);
  const y=plausible.reduce((s,q,i)=>s+weights[i]*q.y,0)/sum,slope=plausible.reduce((s,q,i)=>s+weights[i]*q.slope,0)/sum;
  const tolerancePx=Math.max(1.5,width,...plausible.map(q=>Math.abs(q.y-y)));
  if(tolerancePx>4)return null;
  const averaged=score(y,slope,1);if(averaged.score<.4||averaged.coverage<.75)return null;
  return {y,slope,tolerancePx,score:averaged.score,source:colors.length>1?'shared-endpoint-line-template':'endpoint-line-template'};
}
