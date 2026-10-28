/** Low-dimensional image likelihood. It optimises <=10 B-spline coefficients,
 * never follows contours, creates per-column points or emits raster samples. */
import { monotoneCubics, sceneCurveBudgetOptions } from './scene.mjs';
import { analyzeCurveBudget } from './curve-budget.mjs';
import { fitPrintedMarkers } from './plot-observations.mjs';
import { fitHollowMarkers } from './marker-fit.mjs';
import { groundSceneAxes } from './scene-anchors.mjs';

const rgb=h=>/^#[0-9a-f]{6}$/i.test(h||'')?[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)):null;
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const cubic=(a,b,c,d,t)=>(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;
function priorCurve(o,x){
  const i=o.points.findIndex((p,j)=>j&&x<=p[0]);if(i<1)return o.points.at(-1)[1];
  const a=o.points[i-1],s=o._segments[i-1];let lo=0,hi=1;
  for(let j=0;j<20;j++){const t=(lo+hi)/2;if(cubic(a[0],s[0][0],s[1][0],s[2][0],t)<x)lo=t;else hi=t;}
  const t=(lo+hi)/2;
  return cubic(a[1],s[0][1],s[1][1],s[2][1],t);
}
function knotsFor(k){return [0,0,0,0,...Array.from({length:k-4},(_,i)=>(i+1)/(k-3)),1,1,1,1];}
function basis(x,knots,k){
  const t=Math.max(0,Math.min(1-1e-12,x));
  let b=Array.from({length:knots.length-1},(_,i)=>knots[i]<=t&&t<knots[i+1]?1:0);
  for(let p=1;p<=3;p++)b=Array.from({length:b.length-1},(_,i)=>{
    const a=knots[i+p]-knots[i],c=knots[i+p+1]-knots[i+1];
    return (a?(t-knots[i])/a*b[i]:0)+(c?(knots[i+p+1]-t)/c*b[i+1]:0);
  });return b.slice(0,k);
}
function solve(A,b){
  const n=b.length,m=A.map((row,i)=>[...row,b[i]]);
  for(let j=0;j<n;j++){
    let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[pivot][j]))pivot=i;
    if(Math.abs(m[pivot][j])<1e-10)return null;
    [m[j],m[pivot]]=[m[pivot],m[j]];const d=m[j][j];for(let c=j;c<=n;c++)m[j][c]/=d;
    for(let i=0;i<n;i++)if(i!==j){const q=m[i][j];for(let c=j;c<=n;c++)m[i][c]-=q*m[j][c];}
  }return m.map(row=>row[n]);
}

// Euclidean projection onto ordered coefficients. For a cubic B-spline,
// ordered coefficients imply a derivative of one sign over the WHOLE domain.
function ordered(values,direction,fixed={}){
  const last=values.length-1,begin=fixed[0]!=null?1:0,end=fixed[last]!=null?last:values.length;
  const blocks=[];
  for(const value of values.slice(begin,end)){
    blocks.push({sum:value*direction,n:1});
    while(blocks.length>1){
      const b=blocks.at(-1),a=blocks.at(-2);
      if(a.sum/a.n<=b.sum/b.n)break;
      blocks.splice(-2,2,{sum:a.sum+b.sum,n:a.n+b.n});
    }
  }
  const lo=fixed[0]!=null?direction*fixed[0]:-Infinity,hi=fixed[last]!=null?direction*fixed[last]:Infinity;
  if(lo>hi)return null;
  const middle=blocks.flatMap(b=>Array(b.n).fill(direction*Math.max(lo,Math.min(hi,b.sum/b.n))));
  return [...(begin?[fixed[0]]:[]),...middle,...(end===last?[fixed[last]]:[])];
}
function solveOrdered(A,b,direction,start,fixed){
  const lipschitz=Math.max(...A.map(row=>row.reduce((s,v)=>s+Math.abs(v),0)));
  if(!(lipschitz>0))return null;
  let x=ordered(start||b.map(()=>0),direction,fixed);if(!x)return null;
  let z=x.slice(),t=1;
  for(let iteration=0;iteration<600;iteration++){
    const next=ordered(z.map((v,i)=>v-(A[i].reduce((s,a,j)=>s+a*z[j],0)-b[i])/lipschitz),direction,fixed);
    const move=Math.max(...next.map((v,i)=>Math.abs(v-x[i]))),nt=(1+Math.sqrt(1+4*t*t))/2;
    z=next.map((v,i)=>v+(t-1)/nt*(v-x[i]));x=next;t=nt;
    if(move<1e-7)break;
  }
  return x;
}
export function fitSplineEvidence(evidence,k,{ridge=.002,interior,monotone=0,weights,endpoints={}}={}){
  const fixed={};
  if(Number.isFinite(endpoints.start))fixed[0]=endpoints.start;
  if(Number.isFinite(endpoints.end))fixed[k-1]=endpoints.end;
  const knots=interior?[0,0,0,0,...interior,1,1,1,1]:knotsFor(k),rows=evidence.map(([x])=>basis(x,knots,k));let coeff=null;
  for(let iteration=0;iteration<4;iteration++){
    const A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);
    for(let n=0;n<rows.length;n++){
      const row=rows[n],y=evidence[n][1];
      const residual=coeff?Math.abs(row.reduce((s,v,i)=>s+v*coeff[i],0)-y):0;
      const weight=(weights?.[n]??1)*(residual>4?4/residual:1);
      for(let i=0;i<k;i++){b[i]+=weight*row[i]*y;for(let j=0;j<k;j++)A[i][j]+=weight*row[i]*row[j];}
    }
    for(let i=0;i<k;i++)A[i][i]+=1e-7;
    for(let i=0;i<k-2;i++)for(let a=0;a<3;a++)for(let c=0;c<3;c++)A[i+a][i+c]+=ridge*evidence.length*[1,-2,1][a]*[1,-2,1][c];
    // Clamped B-spline endpoint coefficients equal f(0), f(1). Eliminate them
    // exactly instead of a soft loss penalty that can drift during regression.
    for(const [index,value] of Object.entries(fixed)){
      const j=Number(index);
      for(let i=0;i<k;i++)if(i!==j){b[i]-=A[i][j]*value;A[i][j]=A[j][i]=0;}
      A[j][j]=1;b[j]=value;
    }
    const unconstrained=solve(A,b);if(!unconstrained)return null;
    coeff=monotone?solveOrdered(A,b,monotone,coeff||unconstrained,fixed):unconstrained;if(!coeff)return null;
  }
  const value=x=>basis(x,knots,k).reduce((s,v,i)=>s+v*coeff[i],0);
  const rmse=Math.sqrt(evidence.reduce((s,[x,y])=>s+(value(x)-y)**2,0)/evidence.length);
  return {k,knots,coeff,value,rmse};
}

/** Convert each polynomial interval exactly, including repeated knots (knees).
 * Central finite differences blend left/right slopes at C0 joins and round a
 * real sharp onset. Four function values determine the cubic instead. */
function splineGeometry(fit,lo,hi,height){
  const breaks=[...new Set(fit.knots)],pt=t=>[lo+t*(hi-lo),fit.value(t)/height*1000],segments=[];
  for(let i=1;i<breaks.length;i++){
    const a=breaks[i-1],b=breaks[i],p=pt(a),q=pt(b),u=pt(a+(b-a)/3),v=pt(a+2*(b-a)/3);
    const r=27*u[1]-8*p[1]-q[1],s=27*v[1]-p[1]-8*q[1],dx=(q[0]-p[0])/3;
    segments.push([[p[0]+dx,(2*r-s)/18],[q[0]-dx,(2*s-r)/18],q]);
  }
  return {start:pt(0),segments};
}

function monotoneDirection(o,height){
  if(o.shape?.monotone==='increasing')return 1; // image y, not axis data values
  if(o.shape?.monotone==='decreasing')return -1;
  if(o.shape?.monotone==='none')return 0;
  const dy=o.points.at(-1)[1]-o.points[0][1],sign=Math.sign(dy);
  if(Math.abs(dy)*height/1000<3)return 0;
  let reverse=0;
  for(let i=1;i<o.points.length;i++)reverse+=Math.max(0,-sign*(o.points[i][1]-o.points[i-1][1]))*height/1000;
  return reverse<=Math.max(2,Math.abs(dy)*height/1000*.025)?sign:0;
}

const residualBin=x=>Math.min(23,Math.max(0,Math.floor(x*24)));
function balancedWeights(data){
  const counts=Array(24).fill(0);for(const [x] of data)counts[residualBin(x)]++;
  const bins=counts.filter(Boolean).length;
  return data.map(([x])=>data.length/(bins*counts[residualBin(x)]));
}
function fitMetrics(data,value){
  const bins=Array.from({length:24},()=>({n:0,sum:0}));
  for(const [x,y] of data){const b=bins[residualBin(x)];b.n++;b.sum+=(value(x)-y)**2;}
  const errors=bins.filter(b=>b.n).map(b=>Math.sqrt(b.sum/b.n));
  return {rmse:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/errors.length),worst:Math.max(...errors)};
}

function splitControls(c,t){
  const mix=(a,b)=>a+(b-a)*t;
  const a=mix(c[0],c[1]),b=mix(c[1],c[2]),d=mix(c[2],c[3]);
  const e=mix(a,b),f=mix(b,d),g=mix(e,f);
  return [[c[0],a,e,g],[g,f,d,c[3]]];
}

/** Uniform error bound between two shape-preserving cubic interpolants.
 * Restrict both cubics to each original interval. Their difference lies in
 * the convex hull of its four Bernstein coefficients. No raster samples and
 * no unchecked gaps between sample points are involved. */
function reductionError(original,originalSegments,candidate,height,limit){
  const segments=monotoneCubics(candidate);let bound=0,j=0;
  for(let i=0;i<originalSegments.length;i++){
    const a=original[i][0],b=original[i+1][0];
    while(j<segments.length-1&&a>=candidate[j+1][0])j++;
    const x=candidate[j][0],width=candidate[j+1][0]-x;
    const u=Math.max(0,Math.min(1,(a-x)/width)),v=Math.max(0,Math.min(1,(b-x)/width));
    let controls=[candidate[j][1],...segments[j].map(p=>p[1])];
    if(v<1)controls=splitControls(controls,v)[0];
    if(u>0)controls=splitControls(controls,u/v)[1];
    const reference=[original[i][1],...originalSegments[i].map(p=>p[1])];
    for(let k=0;k<4;k++)bound=Math.max(bound,Math.abs(reference[k]-controls[k])*height/1000);
    if(bound>limit)return bound;
  }
  return bound;
}

function reduceLandmarks(points,options,height){
  if(!Array.isArray(points)||points.length<2||points.length>80||points.some((p,i)=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||(i&&p[0]<=points[i-1][0])))return null;
  const analysis=analyzeCurveBudget(points,options),target=analysis.budget,tolerancePx=1.5;
  const protectedIndices=new Set([0,points.length-1,...analysis.mandatoryIndices]);
  const originalSegments=monotoneCubics(points);
  let indices=points.map((_,i)=>i),error=0;
  while(indices.length>target){
    let best=null;
    for(let j=1;j<indices.length-1;j++){
      if(protectedIndices.has(indices[j]))continue;
      const next=indices.filter((_,i)=>i!==j);
      const bound=reductionError(points,originalSegments,next.map(i=>points[i]),height,tolerancePx);
      if(bound<=tolerancePx&&(!best||bound<best.error))best={indices:next,error:bound};
      if(best?.error<1e-9)break;
    }
    if(!best)break;
    indices=best.indices;error=best.error;
  }
  return {points:indices.map(i=>points[i]),report:{target,estimated:analysis.required,actual:indices.length,
    input:points.length,maxErrorPx:error,tolerancePx,status:indices.length<=target?'target-met':'retained-for-shape'}};
}

export function compactSceneCurves(scene,height){
  return {...scene,objects:(scene.objects||[]).map(o=>{
    const options=sceneCurveBudgetOptions(scene,o);
    if(o.kind==='band'){
      const upper=reduceLandmarks(o.upper,options,height),lower=reduceLandmarks(o.lower,options,height);
      return {...o,upper:upper?.points||o.upper,lower:lower?.points||o.lower,pointBudget:{upper:upper?.report,lower:lower?.report}};
    }
    if(o.kind!=='path'||o.connection!=='smooth')return o;
    const reduced=reduceLandmarks(o.points,options,height);if(!reduced)return o;
    const marker=o.marker?.shape&&o.marker.shape!=='none'?{...o.marker,points:o.marker.points||o.points}:o.marker;
    return {...o,points:reduced.points,marker,pointBudget:reduced.report};
  })};
}

function fitSmooth(raster,o,objects){
  const reject=(reason,details={})=>({...o,fitDiagnostics:{status:'kept-model',reason,...details}});
  const color=rgb(o.style.stroke);if(!color||o.closed)return reject('unsupported-colour-or-closed-path');
  const gray=Math.max(...color)-Math.min(...color)<35;
  if(gray&&(Math.min(...color)<45||Math.max(...color)>200))return reject('axis-like-grey');
  const lo=o.points[0][0],hi=o.points.at(-1)[0];if(hi-lo<80)return reject('domain-too-short');
  const conflict=objects.some(other=>{
    const points=other.points||(other.start&&other.segments?[other.start,...other.segments.map(s=>s[2])]:[]);
    return other.id!==o.id&&other.kind==='path'&&points.length>=2&&rgb(other.style?.stroke)&&distance(color,rgb(other.style.stroke))<45&&Math.min(hi,Math.max(...points.map(p=>p[0])))-Math.max(lo,Math.min(...points.map(p=>p[0])))>20;
  });
  if(conflict)return reject('ambiguous-same-colour-series');
  const {w,h}=raster,prior={...o,_segments:o._segments||monotoneCubics(o.points)},data=[];
  const minY=Math.min(...o.points.map(p=>p[1]))*h/1000,maxY=Math.max(...o.points.map(p=>p[1]))*h/1000;
  const direction=[color[0]-color[1],color[2]-color[1]],norm=Math.hypot(...direction);
  const excluded=objects.filter(q=>q.kind==='legend').map(q=>{
    const x=q.at[0]/1000*w,y=q.at[1]/1000*h,fs=q.fontSize??12;
    return [x-4,y-fs,(q.swatchWidth??25)+12+Math.max(...q.entries.map(e=>e.text.length))*fs*.6,(q.rowHeight??fs*1.65)*q.entries.length+fs];
  });
  for(let y=Math.max(0,Math.floor(minY-h*.28));y<=Math.min(h-1,maxY+h*.28);y++)for(let x=Math.max(0,Math.ceil(lo*w/1000));x<=Math.min(w-1,hi*w/1000);x++){
    const j=(y*w+x)*3,p=raster.rgb.subarray(j,j+3),c=[p[0]-p[1],p[2]-p[1]],n=Math.hypot(...c);
    if(gray ? distance(color,p)>24 : n<35||(c[0]*direction[0]+c[1]*direction[1])/(n*norm)<.99)continue;
    if(excluded.some(([a,b,c,d])=>x>=a&&x<=a+c&&y>=b&&y<=b+d))continue;
    const nx=x/w*1000;
    // For an isolated chromatic series the prior is what we want to CORRECT.
    // Hard rejection around it discarded real steep transitions when the model
    // guessed their location incorrectly. Grey evidence still needs this guard.
    if(gray&&Math.abs(y-priorCurve(prior,nx)*h/1000)>Math.max(25,h*.28))continue;
    data.push([(nx-lo)/(hi-lo),y]);
  }
  if(data.length<35)return reject('insufficient-colour-evidence',{terms:data.length});
  // Bounded quadrature per broad interval, NOT per-column curve extraction.
  // Never turn these image residual terms into vertices or output landmarks.
  const groups=Array.from({length:24},()=>[]);for(const p of data)groups[residualBin(p[0])].push(p);
  const evidence=groups.flatMap(g=>g.length<=90?g:Array.from({length:90},(_,i)=>g[Math.floor((i+.5)*g.length/90)]));
  const coverage=new Set(evidence.map(([x])=>Math.min(19,Math.floor(x*20))));if(coverage.size<16)return reject('incomplete-domain-evidence',{coveredBins:coverage.size,totalBins:20});
  // Hold out source columns, not adjacent antialiasing pixels from one stroke.
  const heldOut=([x])=>Math.round((lo+x*(hi-lo))*w/1000)%5===0;
  const train=evidence.filter(p=>!heldOut(p)),test=evidence.filter(heldOut);
  if(train.length<25||test.length<12)return reject('insufficient-held-out-evidence');
  const before=fitMetrics(test,x=>priorCurve(prior,lo+x*(hi-lo))*h/1000);
  const weights=balancedWeights(train),monotone=monotoneDirection(o,h);
  const endpoints={};
  if(o.endpointAnchors?.start)endpoints.start=o.endpointAnchors.start.at[1]*h/1000;
  if(o.endpointAnchors?.end)endpoints.end=o.endpointAnchors.end.at[1]*h/1000;
  const fits=[];
  // Nonuniform knot candidates capture endpoint boundary layers and knees.
  // Parameter count stays fixed; knots are mathematical templates, not pixels.
  for(const k of [4,6,8,10])for(const power of k===4?[1]:[.35,1,3]){
    const interior=Array.from({length:k-4},(_,i)=>((i+1)/(k-3))**power);
    const f=fitSplineEvidence(train,k,{ridge:0.00002,interior,weights,monotone,endpoints});
    if(f)fits.push({...f,metrics:fitMetrics(test,f.value)});
  }
  // A flat-to-changing transition can be a genuine C0 knee. A triple knot
  // permits that without forcing every curve into a sigmoid or exponential.
  // Explore bounded offsets around MODEL-proposed knees, not pixel contours.
  const knees=[];
  for(let i=1;i<o.points.length-1;i++){
    const a=Math.abs(o.points[i][1]-o.points[i-1][1])*h/1000,b=Math.abs(o.points[i+1][1]-o.points[i][1])*h/1000;
    if((a<=1&&b>=3)||(b<=1&&a>=3))knees.push((o.points[i][0]-lo)/(hi-lo));
  }
  for(const knee of knees.slice(0,2))for(const shift of [-.02,-.01,0,.01,.02]){
    const t=Math.max(.005,Math.min(.995,knee+shift));
    const interior=[t,t,t,...[.25,.5,.75].map(u=>t<=.5?t+(1-t)*u*u:t*(1-u*u))].sort((a,b)=>a-b);
    const f=fitSplineEvidence(train,10,{ridge:0.00002,interior,weights,monotone,endpoints});
    if(f)fits.push({...f,metrics:fitMetrics(test,f.value)});
  }
  const loss=f=>f.metrics.rmse**2+.5*f.metrics.worst**2+.12*f.k;
  fits.sort((a,b)=>loss(a)-loss(b));
  const tolerance=Math.max(2.5,(o.style.width??1)*1.5);
  // A low combined score must not hide a failed hard local-error gate when
  // another candidate satisfies all gates.
  let best=fits.find(f=>f.metrics.rmse<=tolerance&&f.metrics.worst<=Math.max(4,tolerance*1.5)&&
    f.metrics.rmse<before.rmse*.85&&f.metrics.worst<=Math.max(tolerance,before.worst))||fits[0];
  // Do not roll a much better bounded candidate back to a grossly wrong prior
  // just because one local window misses the strict acceptance threshold.
  // This candidate is explicitly provisional and cannot pass automatically.
  const strict=best&&best.metrics.rmse<=tolerance&&best.metrics.worst<=Math.max(4,tolerance*1.5)&&
    best.metrics.rmse<before.rmse*.85&&best.metrics.worst<=Math.max(tolerance,before.worst);
  let provisional=false;
  if(!strict){
    const improved=fits.find(f=>f.metrics.rmse<=tolerance&&f.metrics.worst<=Math.max(10,tolerance*2.5)&&
      f.metrics.rmse<before.rmse*.5&&f.metrics.worst<before.worst*.5);
    if(improved){best=improved;provisional=true;}
  }
  const diagnostics={terms:evidence.length,monotone,before,best:best?{...best.metrics,parameters:best.k}:null};
  if(!best||!provisional&&(best.metrics.rmse>tolerance||best.metrics.worst>Math.max(4,tolerance*1.5)))return reject('local-or-global-error-too-large',diagnostics);
  if(best.metrics.rmse>=before.rmse*.85||best.metrics.worst>Math.max(tolerance,before.worst))return reject('no-reliable-improvement',diagnostics);
  const geometry=splineGeometry(best,lo,hi,h);
  if([geometry.start,...geometry.segments.flat()].flat().some(v=>!Number.isFinite(v)||v< -50||v>1050))return reject('fitted-geometry-out-of-bounds',diagnostics);
  return {...o,connection:'bezier',...geometry,points:undefined,fitDiagnostics:{status:provisional?'provisional':'fitted',requiresReview:provisional,...diagnostics},fit:{method:'bounded-cubic-regression',coordinateSpace:'image-normalised',parameters:best.k,rmsePx:best.metrics.rmse,worstBinRmsePx:best.metrics.worst,beforeRmsePx:before.rmse,monotone,endpointConstraintsPx:endpoints,priorPoints:o.points}};
}

export function refineScene(scene,raster){
  scene=groundSceneAxes(scene,raster);
  const objects=scene.objects.map(o=>structuredClone(o));
  const refined=objects.map(o=>{
    if(o.kind!=='path')return o;
    // Only an isolated horizontal ring series has unambiguous projection
    // ownership. Other hollow shapes stay model-read until independently fitted.
    if(o.marker?.filled===false&&o.marker?.shape==='circle'&&o.connection==='linear'&&o.points?.length===2&&Math.abs(o.points[0][1]-o.points[1][1])<10){
      const color=rgb(o.style.stroke),shared=objects.some(s=>s.id!==o.id&&s.kind==='path'&&s.points?.length&&Math.max(...s.points.map(p=>p[0]))-Math.min(...s.points.map(p=>p[0]))>150&&s.marker?.shape&&s.marker.shape!=='none'&&rgb(s.style?.stroke)&&color&&distance(color,rgb(s.style.stroke))<50);
      if(!shared){
        const excluded=objects.filter(s=>s.kind==='legend').map(s=>s.box?s.box.map((v,i)=>v*(i%2?raster.h:raster.w)/1000):[s.at[0]*raster.w/1000-5,s.at[1]*raster.h/1000-(s.fontSize||12),200,(s.rowHeight||18)*(s.entries.length+1)]);
        const fit=fitHollowMarkers(raster,o,excluded);if(fit.fit)return fit;
      }
    }
    if((o.connection==='smooth'||o.connection==='bezier')&&!o.closed&&!o.marker?.points&&(!o.marker||o.marker.shape==='none')){
      const proxy=o.connection==='bezier'?{...o,points:[o.start,...o.segments.map(s=>s[2])],_segments:o.segments}:o;
      if(proxy.points?.length>=2 && proxy.points.every((p,i)=>!i||p[0]>proxy.points[i-1][0])){
        const fit=fitSmooth(raster,proxy,objects);
        if(['fitted','provisional'].includes(fit.fitDiagnostics?.status)){delete fit._segments;return fit;}
        if(fit.fitDiagnostics)return {...o,fitDiagnostics:fit.fitDiagnostics};
      }
    }
    if(o.marker?.shape==='circle'&&o.marker.filled!==false&&['linear','none'].includes(o.connection)&&o.points?.length>=2){
      const color=rgb(o.style.stroke);if(!color)return o;
      const same=objects.some(s=>s!==o&&s.kind==='path'&&s.marker?.shape&&s.marker.shape!=='none'&&rgb(s.style?.stroke)&&distance(color,rgb(s.style.stroke))<90);
      if(same)return o;
      const xs=o.points.map(p=>p[0]),ys=o.points.map(p=>p[1]);
      const bounds={x0:Math.max(0,(Math.min(...xs)-60)/1000*raster.w),x1:Math.min(raster.w,(Math.max(...xs)+60)/1000*raster.w),y0:Math.max(0,(Math.min(...ys)-140)/1000*raster.h),y1:Math.min(raster.h,(Math.max(...ys)+140)/1000*raster.h)};
      const fitted=fitPrintedMarkers(raster,{...o,color:o.style.stroke},{bounds});
      if(fitted.markerFit)return {...o,points:fitted.points,marker:fitted.marker,expectedMarkers:fitted.points.length,fit:fitted.markerFit};
    }
    return o;
  });return {...scene,objects:refined};
}
