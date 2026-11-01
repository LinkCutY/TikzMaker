/** Finite-parameter stroke likelihood. Samples are quadrature of an EXISTING
 * vector hypothesis, never extracted image paths or exported vertices. */
const clamp=x=>Math.max(0,Math.min(1,x));
export function inkLikelihood(raster,color,x,y){
  x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=raster.w||y>=raster.h)return null;
  const k=(y*raster.w+x)*3,d=color.map(v=>255-v),p=d.map((_,i)=>255-raster.rgb[k+i]);
  const norm=d.reduce((s,v)=>s+v*v,0);if(norm<1)return null;
  const alpha=clamp(p.reduce((s,v,i)=>s+v*d[i],0)/norm);
  const residual=Math.hypot(...p.map((v,i)=>v-alpha*d[i]));
  return alpha*Math.exp(-residual*residual/(2*35**2));
}
export function curveQuadrature(value,x0,x1,n=256){
  let arc=0;const samples=[];
  for(let i=0;i<=n;i++){
    const t=i/n,x=x0+t*(x1-x0),y=value(t),prev=samples.at(-1);
    if(prev)arc+=Math.hypot(x-prev.x,y-prev.y);
    samples.push({t,x,y,s:arc});
  }return samples;
}
export function dashVisibility(s,pattern){
  if(!pattern?.reliable||!(pattern.period>0))return 1;
  const phase=((s+pattern.phase)%pattern.period+pattern.period)%pattern.period;
  return phase<pattern.on?1:0;
}
export function fitStrokePattern(raster,color,value,x0,x1,{dashed=false,dotted=false,width=1,excluded=[]}={}){
  const estimate=curveQuadrature(value,x0,x1,64).at(-1).s;
  // Quadrature density follows stroke width and arc length, not image columns.
  // Bound work while avoiding aliasing thin dots on long curves.
  const count=Math.max(256,Math.min(2048,Math.ceil(estimate/Math.max(.5,width*.4))));
  const samples=curveQuadrature(value,x0,x1,count),observations=[];
  for(let i=0;i<samples.length;i++){
    const p=samples[i];if(excluded.some(([x,y,w,h])=>p.x>=x&&p.x<=x+w&&p.y>=y&&p.y<=y+h))continue;
    const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)],len=Math.hypot(b.x-a.x,b.y-a.y)||1;
    const nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;
    const core=[-.3,0,.3].map(d=>inkLikelihood(raster,color,p.x+d*width*nx,p.y+d*width*ny)).filter(v=>v!=null);
    if(!core.length)continue;
    const background=[-1,1].map(d=>inkLikelihood(raster,color,p.x+d*(width+2)*nx,p.y+d*(width+2)*ny)).filter(v=>v!=null);
    // Unknown raster line width must not dilute a one-pixel dot into 1/3 ink.
    observations.push({...p,ink:Math.max(...core),background:background.length?background.reduce((s,v)=>s+v,0)/background.length:0});
  }
  if(observations.length<24)return {reliable:false,reason:'insufficient-stroke-windows',loss:1};
  const score=(period,on,phase,list)=>list.reduce((s,p)=>{
    const visible=period?((p.s+phase)%period)<on:true;
    return s+(p.ink-(visible?1:0))**2+.2*p.background**2;
  },0)/list.length;
  const solidLoss=score(0,0,0,observations);
  const coverage=observations.filter(p=>p.ink>.25).length/observations.length;
  if(!dashed)return {reliable:coverage>=.55&&solidLoss<.6,loss:solidLoss,coverage};
  // Hold out contiguous arc blocks, not adjacent source-pixel columns.
  const length=samples.at(-1).s,block=length/12;
  const train=observations.filter(p=>Math.floor(p.s/block)%3!==1),test=observations.filter(p=>Math.floor(p.s/block)%3===1);
  if(!train.length||!test.length)return {reliable:false,loss:solidLoss};
  let best=null;
  const low=Math.max(3,length/100),high=Math.min(length/3,Math.max(40,length/12));
  for(let period=low;period<=high;period+=Math.max(.5,(high-low)/64))for(const duty of dotted?[Math.min(.8,width/period)]:[.2,.35,.5,.65,.8])for(let i=0;i<16;i++){
    const on=period*duty,phase=period*i/16,loss=score(period,on,phase,train);
    if(!best||loss<best.trainLoss)best={period,on,phase,trainLoss:loss};
  }
  if(!best)return {reliable:false,loss:solidLoss};
  // A coarse search can lock onto 2x/3x the real period and miss intervening
  // dots. Explicitly compare subharmonics with their own phase, not the old one.
  const harmonicSeed=best;
  for(let divisor=2;divisor<=6;divisor++){
    const period=harmonicSeed.period/divisor;if(period<low)continue;
    for(const duty of dotted?[Math.min(.8,width/period)]:[.2,.35,.5,.65,.8])for(let j=0;j<32;j++){
      const on=period*duty,phase=period*j/32,loss=score(period,on,phase,train);
      if(loss<best.trainLoss)best={period,on,phase,trainLoss:loss};
    }
  }
  // Refine period and phase jointly; the coarse period grid drifts in phase
  // over many dashes even when its early cycles look convincing.
  let periodStep=Math.max(.5,(high-low)/64),phaseStep=best.period/16;
  for(let round=0;round<6;round++){
    const seed=best;
    for(const dp of [-.5,0,.5])for(const dq of [-.5,0,.5]){
      const period=seed.period+dp*periodStep;if(period<low||period>high)continue;
      const on=dotted?Math.min(period*.8,width):seed.on/seed.period*period;
      const phase=((seed.phase+dq*phaseStep)%period+period)%period,loss=score(period,on,phase,train);
      if(loss<best.trainLoss)best={period,on,phase,trainLoss:loss};
    }periodStep/=2;phaseStep/=2;
  }
  const loss=score(best.period,best.on,best.phase,test),flat=score(0,0,0,test);
  const on=test.filter(p=>((p.s+best.phase)%best.period)<best.on),off=test.filter(p=>((p.s+best.phase)%best.period)>=best.on);
  const mean=list=>list.length?list.reduce((s,p)=>s+p.ink,0)/list.length:0;
  const contrast=mean(on)-mean(off);
  const reliable=coverage>.06&&on.length>=4&&off.length>=4&&contrast>.15&&loss<.32&&loss<flat*.8&&length/best.period>=3;
  return {...best,reliable,loss,contrast,coverage,solidLoss:flat,coordinateSpace:'source-px-arc',samples:observations.length};
}

/** Fit a local quadratic template around ONE semantic extremum. Three model
 * parameters; constant quadrature count, no per-column output coordinates. */
export function measureExtremum(raster,color,a,b,c,{width=1,excluded=[]}={}){
  const radius=Math.min(20,(b[0]-a[0])*.65,(c[0]-b[0])*.65);
  if(radius<3)return null;
  const curvature=((a[1]-b[1])/(a[0]-b[0])**2+(c[1]-b[1])/(c[0]-b[0])**2)/2;
  if(!Number.isFinite(curvature)||Math.abs(curvature)<1e-6)return null;
  const fits=[];
  for(const dx of [-.3,-.15,0,.15,.3])for(const dy of [-8,-4,0,4,8])for(const scale of [.5,1,2]){
    const x0=b[0]+dx*radius,y0=b[1]+dy;let sum=0,n=0;
    for(let i=0;i<17;i++){
      const x=b[0]+radius*(2*i/16-1),y=y0+curvature*scale*(x-x0)**2;
      if(excluded.some(([u,v,w,h])=>x>=u&&x<=u+w&&y>=v&&y<=v+h))continue;
      const ink=inkLikelihood(raster,color,x,y);if(ink==null)continue;
      const background=[-1,1].map(s=>inkLikelihood(raster,color,x,y+s*(width+2))??0);
      sum+=ink-.25*(background[0]+background[1]);n++;
    }
    if(n>=10)fits.push({x:x0,y:y0,score:sum/n});
  }
  fits.sort((a,b)=>b.score-a.score);const best=fits[0];if(!best||best.score<.45)return null;
  const plausible=fits.filter(p=>p.score>=best.score-.08),variance=key=>plausible.reduce((s,p)=>s+(p[key]-best[key])**2,0)/plausible.length;
  // Flat windows legitimately have large horizontal uncertainty.
  return {...best,sigmaX:Math.max(1,Math.sqrt(variance('x'))),sigmaY:Math.max(1,Math.sqrt(variance('y'))),source:'finite-quadratic-window'};
}

export function geometryLookup(value,x0,x1){
  const samples=curveQuadrature(value,x0,x1);
  return x=>{
    if(x<x0||x>x1)return null;
    const t=(x-x0)/(x1-x0)*256,i=Math.min(255,Math.floor(t)),a=samples[i],b=samples[i+1],f=t-i;
    return {y:a.y+(b.y-a.y)*f,s:a.s+(b.s-a.s)*f};
  };
}
