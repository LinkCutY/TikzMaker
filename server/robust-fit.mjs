/** Robust likelihood and bounded LOCAL RANSAC initialization. Observations only
 * influence a fixed-size spline; no RANSAC sample is exported as a vertex. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function median(values){
  if(!values.length)return 0;
  const a=values.slice().sort((x,y)=>x-y),m=a.length>>1;
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
export function madScale(values,floor=.5){
  const c=median(values);return Math.max(floor,1.4826*median(values.map(v=>Math.abs(v-c))));
}
export function robustWeight(r,loss='huber',delta=1.5){
  const a=Math.abs(r)/delta;
  if(loss==='linear')return 1;
  if(loss==='soft-l1')return 1/Math.sqrt(1+a*a);
  if(loss!=='huber')throw Error('Unknown robust loss: '+loss);
  return a<=1?1:1/a;
}
// Quadratic hypotheses in local x, allowing smooth curvature rather than
// forcing every short segment into a line. Repeated/near-repeated x is invalid.
function interpolate(a,b,c){
  if(Math.min(Math.abs(a[0]-b[0]),Math.abs(b[0]-c[0]),Math.abs(c[0]-a[0]))<.08)return null;
  const d1=(b[1]-a[1])/(b[0]-a[0]),d2=(c[1]-b[1])/(c[0]-b[0]);
  const q=(d2-d1)/(c[0]-a[0]),l=d1-q*(a[0]+b[0]),v=a[1]-l*a[0]-q*a[0]**2;
  return x=>v+l*x+q*x*x;
}
function rng(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function refitQuadratic(points){
  const A=Array.from({length:3},()=>Array(4).fill(0));
  for(const p of points){const row=[1,p.x,p.x*p.x];for(let i=0;i<3;i++){for(let j=0;j<3;j++)A[i][j]+=row[i]*row[j];A[i][3]+=row[i]*p.y;}}
  for(let j=0;j<3;j++){
    let pivot=j;for(let i=j+1;i<3;i++)if(Math.abs(A[i][j])>Math.abs(A[pivot][j]))pivot=i;
    if(Math.abs(A[pivot][j])<1e-9)return null;
    [A[j],A[pivot]]=[A[pivot],A[j]];const d=A[j][j];for(let k=j;k<4;k++)A[j][k]/=d;
    for(let i=0;i<3;i++)if(i!==j){const q=A[i][j];for(let k=j;k<4;k++)A[i][k]-=q*A[j][k];}
  }
  return x=>A[0][3]+A[1][3]*x+A[2][3]*x*x;
}

export function prepareRobustEvidence(evidence,{unitScale=1,widthPx=1,domainWidthPx=1000,breaks=[],deadline=Infinity,ransac=true,seed=1717}={}){
  if(!(unitScale>0)||!Number.isFinite(unitScale))throw Error('unitScale must be positive');
  const floor=Math.max(.5,widthPx/2),n=evidence.length;
  const initialWeights=Array(n).fill(1),sigmaPx=Array(n).fill(floor),votes=Array.from({length:n},()=>[]);
  const report={enabled:ransac,windows:0,accepted:0,trials:0,downweighted:0,timedOut:false,seed};
  if(!ransac||n<12)return {initialWeights,sigmaPx,report};
  const random=rng(seed),cuts=[0,...breaks.filter(x=>x>0&&x<1),1].sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>1e-6);
  // At most 24 windows; no global consensus that could erase a short real turn.
  let windows=0;
  for(let c=1;c<cuts.length&&windows<24;c++){
    const left=cuts[c-1],right=cuts[c],parts=Math.max(1,Math.ceil((right-left)*8));
    for(let j=0;j<parts&&windows<24;j++,windows++){
      if(Date.now()>deadline){report.timedOut=true;break;}
      const lo=Math.max(left,left+(j-.3)*(right-left)/parts),hi=Math.min(right,left+(j+1.3)*(right-left)/parts),span=hi-lo;
      const all=evidence.map((p,i)=>({x:p[0],y:p[1]*unitScale,i})).filter(p=>p.x>=lo&&p.x<=hi);
      if(all.length<12||span*domainWidthPx<4)continue;
      const terms=(all.length<=120?all:Array.from({length:120},(_,i)=>all[Math.floor((i+.5)*all.length/120)]))
        .map(p=>({...p,x:(p.x-lo)/span}));
      report.windows++;
      // Measurement noise is source-pixel based; steep segments also carry x
      // localization uncertainty. Never learn scale from gross initial errors.
      const start=terms.filter(p=>p.x<.25),end=terms.filter(p=>p.x>.75);
      const slope=start.length&&end.length?(median(end.map(p=>p.y))-median(start.map(p=>p.y)))/(span*domainWidthPx*.75):0;
      const base=Math.hypot(floor,.5*slope),threshold=2.5*base;
      let best=null,limit=96;
      for(let trial=0;trial<limit;trial++){
        if(Date.now()>deadline){report.timedOut=true;break;}
        report.trials++;
        const pick=()=>terms[Math.floor(random()*terms.length)],a=pick(),b=pick(),d=pick();
        const model=interpolate([a.x,a.y],[b.x,b.y],[d.x,d.y]);if(!model)continue;
        const errors=terms.map(p=>p.y-model(p.x)),inliers=errors.map((e,i)=>Math.abs(e)<=threshold?i:-1).filter(i=>i>=0);
        const bins=new Set(inliers.map(i=>Math.min(3,Math.floor(terms[i].x*4))));
        // Distributed consensus is essential: one dense flat patch cannot
        // justify classifying the rest of the local curve as outliers.
        if(inliers.length<Math.max(9,terms.length*.6)||bins.size<4)continue;
        const cost=errors.reduce((s,e)=>s+Math.min(e*e,threshold*threshold),0);
        if(!best||cost<best.cost){
          best={model,inliers,errors,cost};
          const ratio=inliers.length/terms.length,required=ratio>=1?1:Math.ceil(Math.log(.01)/Math.log(1-ratio**3));
          limit=Math.min(limit,Math.max(trial+1,16,required));
        }
      }
      if(!best)continue;
      const polished=refitQuadratic(best.inliers.map(i=>terms[i]));
      if(polished){
        const errors=terms.map(p=>p.y-polished(p.x)),cost=errors.reduce((s,e)=>s+Math.min(e*e,threshold*threshold),0);
        if(cost<=best.cost){best.model=polished;best.errors=errors;}
      }
      report.accepted++;
      const sigma=clamp(madScale(best.inliers.map(i=>best.errors[i]),base),base,3*base);
      for(const p of all){const r=Math.abs(p.y-best.model((p.x-lo)/span));votes[p.i].push({weight:Math.max(.15,robustWeight(r/sigma)),sigma});}
    }
    if(report.timedOut)break;
  }
  for(let i=0;i<n;i++)if(votes[i].length){
    // Overlapping windows disagree at a sharp transition: retain the point if
    // either credible local model explains it. Weights are only an initializer.
    initialWeights[i]=Math.max(...votes[i].map(v=>v.weight));sigmaPx[i]=Math.max(...votes[i].map(v=>v.sigma));
  }
  report.downweighted=initialWeights.filter(w=>w<.5).length;
  return {initialWeights,sigmaPx,report};
}

export function adaptiveResidualScale(residuals,sigmaPx){
  if(!residuals.length)return 1;
  const normalized=residuals.map((r,i)=>r/Math.max(.5,sigmaPx[i]));
  // Fixed bounds prevent an incorrect candidate from declaring its systematic
  // mismatch to be arbitrarily large measurement noise.
  return clamp(madScale(normalized,1),1,3);
}
