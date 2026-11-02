/** Low-dimensional image likelihood. It optimises <=16 B-spline coefficients,
 * never follows contours, creates per-column points or emits raster samples. */
import { monotoneCubics, sceneCurveBudgetOptions } from './scene.mjs';
import { analyzeCurveBudget } from './curve-budget.mjs';
import { fitPrintedMarkers } from './plot-observations.mjs';
import { fitHollowMarkers } from './marker-fit.mjs';
import { groundSceneAxes } from './scene-anchors.mjs';
import { attachPlotFrames, refreshPlotCoordinates } from './plot-frame.mjs';
import { structuralExtrema } from './curve-structure.mjs';
import { roughnessMatrix, shapeConstraints, constrainedCoefficients } from './spline-constraints.mjs';
import { fitStrokePattern, geometryLookup, dashVisibility, measureExtremum, inkLikelihood } from './stroke-evidence.mjs';
import { measureEndpoint } from './endpoint-evidence.mjs';
import { legendEvidenceBoxes } from './legend-evidence.mjs';
import { groundReferenceLines } from './reference-evidence.mjs';
import { checkDiagramConnections } from './diagram-scene.mjs';
import { verifyCrossings } from './crossing-evidence.mjs';
import { prepareRobustEvidence, robustWeight, adaptiveResidualScale } from './robust-fit.mjs';

const rgb=h=>/^#[0-9a-f]{6}$/i.test(h||'')?[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)):null;
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const cubic=(a,b,c,d,t)=>(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;
function functionProxy(o){
  const points=o.points||(o.start&&o.segments?[o.start,...o.segments.map(s=>s[2])]:[]);
  if(points.length<2||points.some((p,i)=>i&&p[0]<=points[i-1][0]))return null;
  const segments=o.segments||monotoneCubics(points);
  if(segments.some((s,i)=>s[0][0]<points[i][0]-1e-8||s[1][0]<s[0][0]-1e-8||s[2][0]<s[1][0]-1e-8))return null;
  return {...o,points,_segments:segments};
}
function priorCurve(o,x){
  if(x<=o.points[0][0])return o.points[0][1];
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
export function fitSplineEvidence(evidence,k,{ridge=.002,interior,monotone=0,weights,endpoints={},structure=null,unitScale=1,deadline=Infinity,robustCount=evidence.length,
  loss='huber',widthPx=1,domainWidthPx=1000,ransac=true,robustProfile=null}={}){
  if(!evidence.length||evidence.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))return null;
  if(!['linear','huber','soft-l1'].includes(loss))throw Error('Unknown robust loss: '+loss);
  robustCount=Math.max(0,Math.min(evidence.length,Math.floor(robustCount)));
  const profile=robustProfile||prepareRobustEvidence(evidence.slice(0,robustCount),{unitScale,widthPx,domainWidthPx,
    breaks:structure?.events?.map(e=>e.t)||[],deadline,ransac:ransac&&loss!=='linear'});
  if(profile.sigmaPx.length!==robustCount||profile.initialWeights.length!==robustCount)throw Error('Robust profile length mismatch');
  const noiseFloor=Math.max(.5,widthPx/2);
  let robustDiagnostics={loss,iterations:0,scaleMultiplier:1,downweighted:0,protectedObservations:evidence.length-robustCount,ransac:profile.report};
  const fixed={};
  if(Number.isFinite(endpoints.start))fixed[0]=endpoints.start;
  if(Number.isFinite(endpoints.end))fixed[k-1]=endpoints.end;
  const knots=interior?[0,0,0,0,...interior,1,1,1,1]:knotsFor(k),rows=evidence.map(([x])=>basis(x,knots,k));let coeff=null;
  if(knots.length!==k+4||knots.some((v,i)=>!Number.isFinite(v)||(i&&v<knots[i-1])))return null;
  const roughness=roughnessMatrix(knots,k),constraints=shapeConstraints(knots,k,structure);
  for(const [index,value] of Object.entries(fixed))constraints.eq.push({row:Array.from({length:k},(_,i)=>i===Number(index)?1:0),rhs:value});
  for(let iteration=0;iteration<(loss==='linear'?1:8);iteration++){
    if(Date.now()>deadline)return null;
    const A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);
    const residuals=coeff?rows.slice(0,robustCount).map((row,n)=>(row.reduce((s,v,i)=>s+v*coeff[i],0)-evidence[n][1])*unitScale):[];
    const scale=adaptiveResidualScale(residuals,profile.sigmaPx);let downweighted=0;
    for(let n=0;n<rows.length;n++){
      const row=rows[n],y=evidence[n][1];
      const ordinary=n<robustCount&&loss!=='linear';
      const reweight=ordinary?(coeff?robustWeight(residuals[n]/(profile.sigmaPx[n]*scale),loss):profile.initialWeights[n]):1;
      if(reweight<.5)downweighted++;
      // Verified crossings appended after robustCount keep their full weight;
      // endpoint and shape equalities/inequalities remain in the same solver.
      const precision=ordinary?(noiseFloor/profile.sigmaPx[n])**2:1;
      const weight=(weights?.[n]??1)*reweight*precision;
      for(let i=0;i<k;i++){b[i]+=weight*row[i]*y;for(let j=0;j<k;j++)A[i][j]+=weight*row[i]*row[j];}
    }
    for(let i=0;i<k;i++)A[i][i]+=1e-7;
    for(let i=0;i<k;i++)for(let j=0;j<k;j++)A[i][j]+=ridge*evidence.length*roughness[i][j];
    // Clamped B-spline endpoint coefficients equal f(0), f(1). Eliminate them
    // exactly instead of a soft loss penalty that can drift during regression.
    for(const [index,value] of Object.entries(fixed)){
      const j=Number(index);
      for(let i=0;i<k;i++)if(i!==j){b[i]-=A[i][j]*value;A[i][j]=A[j][i]=0;}
      A[j][j]=1;b[j]=value;
    }
    const unconstrained=solve(A,b);if(!unconstrained)return null;
    const previous=coeff;
    coeff=structure?constrainedCoefficients(A,b,constraints.eq,constraints.ineq,solve):monotone?solveOrdered(A,b,monotone,coeff||unconstrained,fixed):unconstrained;if(!coeff)return null;
    robustDiagnostics={...robustDiagnostics,iterations:iteration+1,scaleMultiplier:scale,downweighted,
      sigmaRangePx:robustCount?[Math.min(...profile.sigmaPx)*scale,Math.max(...profile.sigmaPx)*scale]:[]};
    if(previous&&iteration>=2&&Math.max(...coeff.map((v,i)=>Math.abs(v-previous[i])))*unitScale<.01)break;
  }
  const value=x=>basis(x,knots,k).reduce((s,v,i)=>s+v*coeff[i],0);
  const rmse=Math.sqrt(evidence.reduce((s,[x,y])=>s+(value(x)-y)**2,0)/evidence.length);
  return {k,knots,coeff,value,rmse,robustDiagnostics};
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

function fittedExtrema(fit){
  const g=splineGeometry(fit,0,1,1000),events=[],candidates=[];let p=g.start;
  for(const s of g.segments){
    const y=[p[1],...s.map(q=>q[1])],a=-y[0]+3*y[1]-3*y[2]+y[3],b=3*y[0]-6*y[1]+3*y[2],c=3*(y[1]-y[0]),roots=[];
    if(Math.abs(a)<1e-10){if(Math.abs(b)>1e-10)roots.push(-c/(2*b));}
    else {const d=4*b*b-12*a*c;if(d>=0)roots.push((-2*b-Math.sqrt(d))/(6*a),(-2*b+Math.sqrt(d))/(6*a));}
    for(const u of roots)if(u>0&&u<1)candidates.push(p[0]+u*(s[2][0]-p[0]));
    candidates.push(s[2][0]);p=s[2];
  }
  const ts=candidates.filter(t=>t>1e-7&&t<1-1e-7).sort((a,b)=>a-b).filter((t,i,a)=>!i||t-a[i-1]>1e-7);
  for(let i=0;i<ts.length;i++){
    const t=ts[i],d=Math.min(.001,(t-(ts[i-1]??0))/3,((ts[i+1]??1)-t)/3),y=fit.value(t);
    const left=y-fit.value(t-d),right=fit.value(t+d)-y;
    // Include knot extrema; exclude stationary inflections and flat shoulders.
    if(left*right>=0||Math.min(Math.abs(left),Math.abs(right))<1e-9)continue;
    events.push({t,kind:left>0?'maximum':'minimum',yPx:y,tolerancePx:2,observation:{source:'image-supported-spline',inferred:true}});
  }return events;
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

function fitSmooth(raster,o,objects,frame,deadline=Infinity,legendBoxes=null,relations=[]){
  // Fit only the measured plot domain. Model endpoints beyond the axes create
  // unobserved tails and previously discarded otherwise useful candidates.
  if(frame){
    const a=Math.max(o.points[0][0],frame.box[0]/raster.w*1000),b=Math.min(o.points.at(-1)[0],(frame.box[0]+frame.box[2])/raster.w*1000);
    if(b>a&&(a>o.points[0][0]||b<o.points.at(-1)[0])){
      const original={...o,_segments:o._segments||monotoneCubics(o.points)};
      const points=[[a,priorCurve(original,a)],...o.points.filter(p=>p[0]>a&&p[0]<b),[b,priorCurve(original,b)]];
      o={...o,points,_segments:monotoneCubics(points),...(o.fit?{fit:{...o.fit,priorPoints:points}}:{})};
    }
  }
  const reject=(reason,details={})=>({...o,fitDiagnostics:{status:'kept-model',reason,requiresReview:true,...details}});
  if(Date.now()>deadline)return reject('fit-time-budget');
  const color=rgb(o.style.stroke);if(!color||o.closed)return reject('unsupported-colour-or-closed-path');
  const gray=Math.max(...color)-Math.min(...color)<35;
  if(gray&&(Math.min(...color)<45||Math.max(...color)>200)&&o.role!=='data'&&!objects.some(q=>q.kind==='legend'&&q.entries.some(e=>e.seriesId===o.id)))return reject('axis-like-grey');
  const lo=o.points[0][0],hi=o.points.at(-1)[0];if(hi-lo<80)return reject('domain-too-short');
  const competitors=objects.filter(other=>{
    const points=other.points||(other.start&&other.segments?[other.start,...other.segments.map(s=>s[2])]:[]);
    return other.id!==o.id&&other.kind==='path'&&['smooth','bezier'].includes(other.connection)&&!other.closed&&other.frameId===o.frameId&&points.length>=2&&rgb(other.style?.stroke)&&distance(color,rgb(other.style.stroke))<45&&Math.min(hi,Math.max(...points.map(p=>p[0])))-Math.max(lo,Math.min(...points.map(p=>p[0])))>20;
  });
  if(competitors.length>8)return reject('dense-same-colour-family-needs-shared-template',{competitors:competitors.length});
  const {w,h}=raster,prior={...o,_segments:o._segments||monotoneCubics(o.points)},data=[];
  const minY=Math.min(...o.points.map(p=>p[1]))*h/1000,maxY=Math.max(...o.points.map(p=>p[1]))*h/1000;
  const palette=objects.filter(q=>q.kind==='path'&&q.id!==o.id&&q.frameId===o.frameId&&!['axis','tick','grid','reference','annotation'].includes(q.role))
    .map(q=>rgb(q.style?.stroke)).filter(c=>c&&distance(color,c)>=45);
  const excluded=legendBoxes?.map(b=>b.slice())||objects.filter(q=>q.kind==='legend').map(q=>{
    const x=q.at[0]/1000*w,y=q.at[1]/1000*h,fs=q.fontSize??12;
    return [x-4,y-fs,(q.swatchWidth??25)+12+Math.max(...q.entries.map(e=>e.text.length))*fs*.6,(q.rowHeight??fs*1.65)*q.entries.length+fs];
  });
  for(const q of objects.filter(q=>q.kind==='text')){
    const fs=q.fontSize||12,x=q.at[0]*w/1000,y=q.at[1]*h/1000;
    excluded.push([x-fs*q.text.length*.3,y-fs*.65,fs*q.text.length*.6,fs*1.3]);
  }
  const excludedLines=objects.filter(q=>q.kind==='path'&&['axis','tick','grid','reference'].includes(q.role)&&q.connection==='linear'&&q.points?.length===2)
    .map(q=>({points:q.points.map(p=>[p[0]*w/1000,p[1]*h/1000]),radius:(q.style.width||1)/2+1}));
  const hypotheses=[o,...competitors].map(q=>{
    const proxy=functionProxy(q);if(!proxy)return null;
    const points=proxy.points,a=points[0][0]*w/1000,b=points.at(-1)[0]*w/1000;
    const value=t=>priorCurve(proxy,(a+t*(b-a))*1000/w)*h/1000;
    const pattern=fitStrokePattern(raster,color,value,a,b,{dashed:['dashed','dotted'].includes(q.style.dash),dotted:q.style.dash==='dotted',width:q.style.width||1,excluded});
    return {id:q.id,lookup:geometryLookup(value,a,b),pattern};
  }).filter(Boolean);
  const dashed=['dashed','dotted'].includes(o.style.dash),own=hypotheses.find(q=>q.id===o.id);
  let ambiguous=0;
  for(let y=Math.max(0,Math.floor(minY-h*.28));y<=Math.min(h-1,maxY+h*.28);y++)for(let x=Math.max(0,Math.ceil(lo*w/1000));x<=Math.min(w-1,hi*w/1000);x++){
    if((x&255)===0&&(y&31)===0&&Date.now()>deadline)return reject('fit-time-budget');
    const j=(y*w+x)*3,p=raster.rgb.subarray(j,j+3),c=[p[0]-p[1],p[2]-p[1]],n=Math.hypot(...c);
    // Match antialiased ink against competing palette colours. A strict hue
    // angle discarded most blue evidence when the model guessed a nearby RGB.
    const ink=inkLikelihood(raster,color,x,y)??0;
    if(gray?distance(color,p)>24:n<25||ink<.3||palette.some(q=>(inkLikelihood(raster,q,x,y)??0)>ink*1.02))continue;
    if(excluded.some(([a,b,c,d])=>x>=a&&x<=a+c&&y>=b&&y<=b+d))continue;
    if(excludedLines.some(({points:[a,b],radius})=>{
      const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
      const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/length)):0;
      return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<=radius;
    }))continue;
    if(frame){const [a,b,fw,fh]=frame.box;if(x<a||x>a+fw||y<b||y>b+fh)continue;}
    const nx=x/w*1000;
    // For an isolated chromatic series the prior is what we want to CORRECT.
    // Hard rejection around it discarded real steep transitions when the model
    // guessed their location incorrectly. Grey evidence still needs this guard.
    if(gray&&Math.abs(y-priorCurve(prior,nx)*h/1000)>Math.max(25,h*.28))continue;
    let ownership=1;
    if(hypotheses.length>1){
      const sigma=Math.max(4,h*.025),scores=hypotheses.map(q=>{
        const p=q.lookup(x);if(!p)return 0;
        return Math.exp(-(((y-p.y)/sigma)**2)/2)*(dashVisibility(p.s,q.pattern)?1:.15);
      }),sum=scores.reduce((s,v)=>s+v,0),index=hypotheses.findIndex(q=>q.id===o.id);
      ownership=sum>1e-12?scores[index]/sum:0;
      if(ownership<.65){ambiguous++;continue;}
    }
    data.push([(nx-lo)/(hi-lo),y,ownership*ink]);
  }
  if(data.length<35)return reject('insufficient-colour-evidence',{terms:data.length});
  // Bounded quadrature per broad interval, NOT per-column curve extraction.
  // Never turn these image residual terms into vertices or output landmarks.
  const groups=Array.from({length:24},()=>[]);for(const p of data)groups[residualBin(p[0])].push(p);
  const evidence=groups.flatMap(g=>g.length<=90?g:Array.from({length:90},(_,i)=>g[Math.floor((i+.5)*g.length/90)]));
  const coverage=new Set(evidence.map(([x])=>Math.min(19,Math.floor(x*20))));
  if(coverage.size<(dashed?6:16))return reject('incomplete-domain-evidence',{coveredBins:coverage.size,totalBins:20});
  // Hold out whole dashes when identified. For solid strokes use narrow spatial
  // stripes: a broad held-out block can hide the entire steep transition.
  const validationStripe=Math.max(2,(hi-lo)*w/1000/160);
  const heldOut=([t])=>{
    const p=own?.lookup((lo+t*(hi-lo))*w/1000),pattern=own?.pattern;
    return dashed&&pattern?.reliable&&p?Math.floor((p.s+pattern.phase)/pattern.period)%4===1:
      Math.floor(t*(hi-lo)*w/1000/validationStripe)%4===1;
  };
  const train=evidence.filter(p=>!heldOut(p)),test=evidence.filter(heldOut);
  if(train.length<25||test.length<12)return reject('insufficient-held-out-evidence');
  const before=fitMetrics(test,x=>priorCurve(prior,lo+x*(hi-lo))*h/1000);
  const weights=balancedWeights(train).map((v,i)=>v*(train[i][2]??1)),monotone=monotoneDirection(o,h);
  // Coarse robust image statistics propose low-dimensional hypotheses only.
  // They are never emitted as traced points; validation still selects the fit.
  const median=a=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
  const summaries=Array.from({length:24},(_,i)=>{
    const terms=train.filter(([t])=>residualBin(t)===i);
    return terms.length>=4?{t:median(terms.map(p=>p[0])),y:median(terms.map(p=>p[1]))}:null;
  });
  const observed=summaries.filter(Boolean),spanY=observed.length?observed.at(-1).y-observed[0].y:0,directionY=Math.sign(spanY);
  const significantMoves=observed.slice(1).map((p,i)=>p.y-observed[i].y).filter(d=>Math.abs(d)>Math.max(2,o.style.width||1));
  const evidenceMonotone=observed.length>=16&&Math.abs(spanY)>6&&significantMoves.length>=2&&
    significantMoves.every(d=>Math.sign(d)===directionY)?directionY:0;
  const endpoints={};
  if(o.endpointAnchors?.start)endpoints.start=o.endpointAnchors.start.at[1]*h/1000;
  if(o.endpointAnchors?.end)endpoints.end=o.endpointAnchors.end.at[1]*h/1000;
  for(const [key,measurement] of Object.entries(o.sourceEndpoints||{}))if(endpoints[key]==null)endpoints[key]=measurement.y;
  const fits=[];
  const sourcePoints=o.fit?.priorPoints||o.points;
  const events=structuralExtrema(sourcePoints.map(p=>[p[0],p[1]*h/1000]),Math.max(2,(o.style.width||1)*1.5)).map(e=>{
    const i=e.index,a=sourcePoints[i-1],b=sourcePoints[i],c=sourcePoints[i+1];
    const left=Math.atan2((b[1]-a[1])*h,(b[0]-a[0])*w),right=Math.atan2((c[1]-b[1])*h,(c[0]-b[0])*w);
    const smooth=Math.abs(right-left)<Math.PI/3,px=p=>[p[0]*w/1000,p[1]*h/1000];
    const estimate=smooth&&!dashed&&!competitors.length?measureExtremum(raster,color,px(a),px(b),px(c),{width:o.style.width||1,excluded}):null;
    const measurement=estimate&&estimate.sigmaX<=1.5&&estimate.sigmaY<=3?estimate:null;
    const x=measurement?measurement.x*1000/w:e.x,y=measurement?.y??e.y;
    return {...e,x,y,t:(x-lo)/(hi-lo),tolerance:measurement?Math.max(2,2*measurement.sigmaY):Math.max(3,(o.style.width||1)*2),smooth,
      observation:measurement?{source:measurement.source,confidence:measurement.score,covariancePx:[[measurement.sigmaX**2,0],[0,measurement.sigmaY**2]]}: {source:'model-landmark',inferred:true}};
  }).filter(e=>e.t>1e-5&&e.t<1-1e-5);
  const boundaries=[{t:0,y:sourcePoints[0][1]*h/1000},...events,{t:1,y:sourcePoints.at(-1)[1]*h/1000}];
  const intervals=events.length?boundaries.slice(1).map((b,i)=>({lo:boundaries[i].t,hi:b.t,sign:Math.sign(b.y-boundaries[i].y)})):
    monotone?[{lo:0,hi:1,sign:monotone}]:[];
  const structuralKnots=events.flatMap(e=>Array(e.smooth?1:3).fill(e.t));
  const yBottom=frame?frame.box[1]+frame.box[3]:h,yScale=frame?.box[3]||h;
  const toY=y=>(yBottom-y)/yScale,fromY=v=>yBottom-v*yScale;
  const normalizedStructure={events:events.map(e=>({...e,y:toY(e.y),tolerance:e.tolerance/yScale})),intervals:intervals.map(s=>({...s,sign:-s.sign}))};
  const normalizedEndpoints=Object.fromEntries(Object.entries(endpoints).map(([key,y])=>[key,toY(y)]));
  // One crossing gets eight ordinary evidence windows of influence. Both
  // series consume the SAME image coordinate, rather than separate guesses.
  const crossings=relations.filter(r=>r.kind==='crossing'&&r.seriesIds.includes(o.id)&&r.at[0]>lo&&r.at[0]<hi)
    .map(r=>({t:(r.at[0]-lo)/(hi-lo),y:r.at[1]*h/1000,ids:r.seriesIds,confidence:1/(1+((r.uncertaintyPx||1)/Math.max(1,o.style.width||1))**2)}));
  const crossingWeight=train.length/24*8;
  const training=[...train.map(([t,y])=>[t,toY(y)]),...crossings.map(r=>[r.t,toY(r.y)])];
  const trainingWeights=[...weights,...crossings.map(r=>crossingWeight*r.confidence)];
  // Training data only: no validation stripes/dashes enter RANSAC or scale
  // estimation. Reuse one bounded initializer across all knot candidates.
  const robustProfile=prepareRobustEvidence(training.slice(0,train.length),{unitScale:yScale,widthPx:o.style.width||1,
    domainWidthPx:(hi-lo)*w/1000,breaks:events.map(e=>e.t),deadline:Math.min(deadline,Date.now()+600)});
  // A model coordinate is never promoted to a measured hard constraint.
  const unsupportedEndpoints=[];
  for(const [key,t] of [['start',0],['end',1]]){
    if(endpoints[key]!=null)continue;
    const local=train.filter(p=>Math.abs(p[0]-t)<=.025);
    const nearest=local.length?Math.min(...local.map(p=>Math.abs(p[0]-t)))*(hi-lo)*w/1000:Infinity;
    const uniqueX=new Set(local.map(p=>Math.round(p[0]*(hi-lo)*w/1000))).size;
    if(nearest<=3&&uniqueX>=4)continue;
    unsupportedEndpoints.push({endpoint:key,source:'insufficient-source-evidence',nearestEvidencePx:Number.isFinite(nearest)?nearest:null});
  }
  function candidate(interior,relaxed=false,ridge=1e-8){
    if(Date.now()>deadline)return null;
    interior=interior.slice().sort((a,b)=>a-b);const k=interior.length+4;if(k>16)return null;
    const fit=fitSplineEvidence(training,k,{ridge,interior,weights:trainingWeights,robustCount:train.length,robustProfile,widthPx:o.style.width||1,
      endpoints:normalizedEndpoints,structure:relaxed?{events:normalizedStructure.events.filter(e=>e.observation?.source==='finite-quadratic-window'),intervals:evidenceMonotone?[{lo:0,hi:1,sign:-evidenceMonotone}]:[]}:normalizedStructure,unitScale:yScale,deadline});
    if(!fit)return null;
    const uvValue=fit.value,value=t=>fromY(uvValue(t));
    const crossingError=crossings.length?Math.max(...crossings.map(r=>Math.abs(value(r.t)-r.y))):0;
    const R=roughnessMatrix(fit.knots,k),bending=fit.coeff.reduce((sum,c,i)=>sum+c*R[i].reduce((s,v,j)=>s+v*fit.coeff[j],0),0);
    const crossingLoss=crossings.reduce((s,r)=>s+r.confidence*(value(r.t)-r.y)**2,0)/Math.max(1,crossings.length);
    return {...fit,uvValue,value,metrics:fitMetrics(test,value),crossingError,crossingLoss,bending:Math.max(0,bending),ridge,interior,relaxed};
  }
  // Nonuniform knot candidates capture endpoint boundary layers and knees.
  // Parameter count stays fixed; knots are mathematical templates, not pixels.
  // Reserve an early source-driven hypothesis so bad model topology cannot
  // consume the entire budget before a competing structure is considered.
  if(before.rmse>4){
    const f=candidate([.15,.35,.6,.85],true);if(f)fits.push(f);
  }
  // A true flat-to-rising knee needs a repeated knot, not more smooth knots.
  // Rank broad training windows by change in slope and search a bounded set
  // of C0 hypotheses. No particular year, colour or curve family is assumed.
  const turns=summaries.map((p,i)=>{
    const a=summaries[i-1],b=summaries[i+1];
    return p&&a&&b?{t:p.t,score:Math.abs((b.y-p.y)/(b.t-p.t)-(p.y-a.y)/(p.t-a.t))}:null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,2);
  if(before.rmse>4)for(const turn of turns)for(const shift of [-1/48,0,1/48]){
    const t=Math.max(.005,Math.min(.995,turn.t+shift));
    const interior=[t,t,t,...[.15,.4,.7].map(u=>t+(1-t)*u),t*.5];
    const f=candidate(interior,true);if(f)fits.push(f);
  }
  for(const k of [4,6,8,10])for(const power of k===4?[1]:[.35,1,3]){
    const interior=[...structuralKnots,...Array.from({length:Math.max(0,k-4-structuralKnots.length)},(_,i)=>((i+1)/(Math.max(0,k-4-structuralKnots.length)+1))**power).filter(t=>!events.some(e=>Math.abs(e.t-t)<.015))];
    const f=candidate(interior);if(f)fits.push(f);
  }
  // Model-read extrema are hypotheses, not measured equalities. If they
  // contradict source evidence, compare a source-driven candidate rather than
  // forbidding a missing dip/recovery forever. Verified endpoint anchors remain.
  if(before.rmse>4&&(!fits.length||Math.min(...fits.map(f=>f.metrics.rmse))>3)){
    for(const k of [6,10,14])for(const power of [.35,1,3]){
      const f=candidate(Array.from({length:k-4},(_,i)=>((i+1)/(k-3))**power),true);if(f)fits.push(f);
    }
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
    if(structuralKnots.some(u=>Math.abs(u-t)<.01))continue;
    const interior=[...structuralKnots,t,t,t,...[.25,.5,.75].map(u=>t<=.5?t+(1-t)*u*u:t*(1-u*u))];
    const f=candidate(interior);if(f)fits.push(f);
  }
  const loss=f=>f.metrics.rmse**2+.5*f.metrics.worst**2+.12*f.k+8*f.crossingLoss;
  // Refine only intervals with independent evidence and validation improvement.
  let adaptive=fits.slice().sort((a,b)=>loss(a)-loss(b))[0];
  for(let iteration=0;adaptive&&adaptive.k<16&&iteration<6;iteration++){
    const bins=Array.from({length:24},()=>({sum:0,n:0}));
    for(const [t,y] of train){const b=bins[residualBin(t)];b.sum+=(adaptive.value(t)-y)**2;b.n++;}
    const ranked=bins.map((b,i)=>({...b,t:(i+.5)/24,error:b.n>=5?b.sum/b.n:0})).sort((a,b)=>b.error-a.error);
    let next=null;
    for(const b of ranked.slice(0,3)){
      if(b.error<2.25||adaptive.interior.some(t=>Math.abs(t-b.t)<.02))continue;
      const f=candidate([...adaptive.interior,b.t],adaptive.relaxed);
      if(f&&loss(f)<loss(adaptive)*.98&&f.metrics.worst<=adaptive.metrics.worst*1.05&&(!next||loss(f)<loss(next)))next=f;
    }
    if(!next)break;fits.push(next);adaptive=next;
  }
  fits.sort((a,b)=>loss(a)-loss(b));
  // Cross-validate smoothing on the best supported knot arrangements. Near-
  // equivalent image fits should prefer lower bending energy, not extra wiggles.
  for(const seed of fits.slice(0,2))for(const ridge of [1e-7,1e-6,1e-5]){
    const f=candidate(seed.interior,seed.relaxed,ridge);if(f)fits.push(f);
  }
  fits.sort((a,b)=>loss(a)-loss(b));
  const least= fits[0];
  if(least){
    const equivalent=fits.filter(f=>f.metrics.rmse<=least.metrics.rmse+.2&&f.metrics.worst<=least.metrics.worst+.3&&f.crossingError<=least.crossingError+.3);
    equivalent.sort((a,b)=>a.bending-b.bending);
    if(equivalent.length){const smooth=equivalent[0];fits.splice(fits.indexOf(smooth),1);fits.unshift(smooth);}
  }
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
    const improved=fits.find(f=>f.metrics.rmse<=Math.max(8,tolerance*2)&&f.metrics.worst<=Math.max(16,tolerance*3)&&
      f.metrics.rmse<before.rmse*.6&&f.metrics.worst<before.worst*.8);
    if(improved){best=improved;provisional=true;}
  }
  const diagnostics={terms:evidence.length,monotone:events.length?'piecewise':monotone,structure:events.map(e=>({t:e.t,kind:e.kind,yPx:e.y,tolerancePx:e.tolerance,observation:e.observation})),
    robust:best?.robustDiagnostics??{loss:'huber',ransac:robustProfile.report},
    crossings:{count:crossings.length,weightPerWindow:8,maxErrorPx:best?.crossingError??null},
    candidateSummary:fits.slice(0,8).map(f=>({parameters:f.k,relaxed:f.relaxed,ridge:f.ridge,bending:f.bending,...f.metrics})),
    worstResidualTerms:best?test.map(([t,y])=>({t,y,errorPx:Math.abs(best.value(t)-y)})).sort((a,b)=>b.errorPx-a.errorPx).slice(0,5):[],
    ownership:{competitors:competitors.map(q=>q.id),ambiguousTerms:ambiguous},unsupportedEndpoints,evidenceMonotone,validation:{kind:dashed&&own?.pattern?.reliable?'whole-dashes':'spatial-stripes',stripePx:validationStripe},frameId:frame?.id,before,best:best?{...best.metrics,parameters:best.k}:null};
  if(!crossings.length&&before.rmse<=tolerance&&before.worst<=Math.max(4,tolerance*1.5)&&own?.pattern?.reliable&&
      (!best||best.metrics.rmse>=before.rmse*.85))return {...o,fitDiagnostics:{...diagnostics,status:'verified',requiresReview:unsupportedEndpoints.length>0,stroke:own.pattern}};
  if(!best||!provisional&&(best.metrics.rmse>tolerance||best.metrics.worst>Math.max(4,tolerance*1.5)))return reject('local-or-global-error-too-large',diagnostics);
  if(best.metrics.rmse>=before.rmse*.85||best.metrics.worst>Math.max(tolerance,before.worst))return reject('no-reliable-improvement',diagnostics);
  const pattern=fitStrokePattern(raster,color,best.value,lo*w/1000,hi*w/1000,{dashed,dotted:o.style.dash==='dotted',width:o.style.width||1,excluded});
  if(!pattern.reliable||unsupportedEndpoints.length)provisional=true;
  if(best.crossingError>Math.max(2,(o.style.width||1)))provisional=true;
  // No credible evidence at the endpoint: do not replace this curve with
  // unconstrained extrapolation. Leave the uncertainty visible for model repair.
  if(unsupportedEndpoints.length)return reject('endpoint-evidence-unresolved',{...diagnostics,stroke:pattern});
  if(own?.pattern?.reliable&&pattern.loss>own.pattern.loss+.08)return reject('stroke-likelihood-regressed',{...diagnostics,stroke:pattern});
  const geometry=splineGeometry(best,lo,hi,h);
  if(best.relaxed){
    diagnostics.modelStructure=diagnostics.structure;diagnostics.structure=fittedExtrema(best);diagnostics.priorShapeRejected=true;
    diagnostics.unresolvedStructure=diagnostics.modelStructure.filter(e=>!diagnostics.structure.some(q=>q.kind===e.kind&&Math.abs(q.t-e.t)<=.06));
    // A low error over visible ink cannot disprove a turn hidden by overlap.
    // Keep the improved preview, but request source review of removed events.
    if(diagnostics.unresolvedStructure.length)provisional=true;
  }
  if([geometry.start,...geometry.segments.flat()].flat().some(v=>!Number.isFinite(v)||v< -50||v>1050))return reject('fitted-geometry-out-of-bounds',diagnostics);
  const dashOn=o.style.dash==='dotted'?0:Math.max(.1,pattern.on-(o.style.width||1));
  const style=dashed&&pattern.reliable?{...o.style,dashOn,dashOff:pattern.period-dashOn,
    dashPhase:((pattern.phase-(o.style.width||1)/2)%pattern.period+pattern.period)%pattern.period}:o.style;
  return {...o,connection:'bezier',...geometry,points:undefined,style,
    fitDiagnostics:{status:provisional?'provisional':'fitted',requiresReview:provisional,...diagnostics,stroke:pattern},
    fit:{method:'adaptive-constrained-cubic',coordinateSpace:frame?'plot-uv':'image-uv',frameId:frame?.id,
      coefficients:best.coeff,knots:best.knots,domainU:frame?[(lo*w/1000-frame.box[0])/frame.box[2],(hi*w/1000-frame.box[0])/frame.box[2]]:[lo/1000,hi/1000],
      parameters:best.k,rmsePx:best.metrics.rmse,worstBinRmsePx:best.metrics.worst,beforeRmsePx:before.rmse,monotone,
      endpointConstraintsPx:endpoints,priorPoints:sourcePoints,stroke:pattern}};
}

export function refineScene(scene,raster){
  if(scene.type==='diagram')return {...scene,diagramReport:checkDiagramConnections(scene)};
  const deadline=Date.now()+15000;
  scene=attachPlotFrames(groundSceneAxes(scene,raster),raster);
  scene=verifyCrossings(scene,raster,Math.min(deadline,Date.now()+3500));
  const frames=new Map((scene.plotFrames||[]).map(f=>[f.id,f]));
  const objects=scene.objects.map(o=>structuredClone(o));
  groundReferenceLines(objects,raster,frames);
  const legendBoxes=legendEvidenceBoxes(raster,objects);
  // Recompute internal measurements from this source, never trust model fields.
  for(const o of objects)delete o.sourceEndpoints;
  const eligible=objects.filter(o=>o.kind==='path'&&['smooth','bezier'].includes(o.connection)&&!o.closed&&!o.style?.arrow&&
    !['axis','tick','grid','reference','annotation'].includes(o.role)&&frames.has(o.frameId)&&rgb(o.style?.stroke));
  const point=(o,end)=>{
    const p=end==='start'?(o.start||o.points?.[0]):(o.segments?.at(-1)?.[2]||o.points?.at(-1)),f=frames.get(o.frameId);
    return p&&f?[Math.max(f.box[0]/raster.w*1000,Math.min((f.box[0]+f.box[2])/raster.w*1000,p[0])),p[1]]:p;
  };
  const endpointDeadline=Math.min(deadline,Date.now()+3500),cache=new Map();
  for(const o of eligible)for(const end of ['start','end']){
    if(Date.now()>endpointDeadline)break;
    const p=point(o,end);if(!p)continue;
    const shared=eligible.filter(q=>{const a=point(q,end);return a&&q.frameId===o.frameId&&Math.hypot((p[0]-a[0])*raster.w/1000,(p[1]-a[1])*raster.h/1000)<=2;});
    const own=measureEndpoint(raster,[rgb(o.style.stroke)],{x:p[0]*raster.w/1000,direction:end==='start'?1:-1,
      box:frames.get(o.frameId).box,width:o.style.width||1,deadline:Math.min(endpointDeadline,Date.now()+300)});
    if(own){o.sourceEndpoints={...o.sourceEndpoints,[end]:own};continue;}
    const key=end+':'+shared.map(q=>q.id).sort().join('|');
    if(!cache.has(key)){
      const colors=shared.map(q=>rgb(q.style.stroke));
      cache.set(key,measureEndpoint(raster,colors,{x:p[0]*raster.w/1000,direction:end==='start'?1:-1,
        box:frames.get(o.frameId).box,width:Math.max(...shared.map(q=>q.style.width||1)),deadline:Math.min(endpointDeadline,Date.now()+600)}));
    }
    const measurement=cache.get(key);
    if(measurement)o.sourceEndpoints={...o.sourceEndpoints,[end]:measurement};
  }
  const refined=objects.map(o=>{
    if(o.kind!=='path'||o.style?.arrow||['axis','tick','grid','reference','annotation','edge','node','container'].includes(o.role))return o;
    // Only an isolated horizontal ring series has unambiguous projection
    // ownership. Other hollow shapes stay model-read until independently fitted.
    if(o.marker?.filled===false&&o.marker?.shape==='circle'&&o.connection==='linear'&&o.points?.length===2&&Math.abs(o.points[0][1]-o.points[1][1])<10){
      const color=rgb(o.style.stroke),shared=objects.some(s=>s.id!==o.id&&s.kind==='path'&&s.points?.length&&Math.max(...s.points.map(p=>p[0]))-Math.min(...s.points.map(p=>p[0]))>150&&s.marker?.shape&&s.marker.shape!=='none'&&rgb(s.style?.stroke)&&color&&distance(color,rgb(s.style.stroke))<50);
      if(!shared){
        const excluded=objects.filter(s=>s.kind==='legend').map(s=>s.box?s.box.map((v,i)=>v*(i%2?raster.h:raster.w)/1000):[s.at[0]*raster.w/1000-5,s.at[1]*raster.h/1000-(s.fontSize||12),200,(s.rowHeight||18)*(s.entries.length+1)]);
        const fit=fitHollowMarkers(raster,o,excluded);if(fit.fit)return fit;
      }
    }
    if((scene.type==='plot'||o.frameId||o.role==='data'||objects.some(q=>q.kind==='legend'&&q.entries.some(e=>e.seriesId===o.id)))&&
      (o.connection==='smooth'||o.connection==='bezier')&&!o.closed&&!o.marker?.points&&(!o.marker||o.marker.shape==='none')){
      const proxy=functionProxy(o);
      if(proxy){
        const fit=fitSmooth(raster,proxy,objects,frames.get(o.frameId),Math.min(deadline,Date.now()+2500),legendBoxes,scene.relations||[]);
        if(['fitted','provisional'].includes(fit.fitDiagnostics?.status)){delete fit._segments;return fit;}
        if(fit.fitDiagnostics)return {...o,fitDiagnostics:fit.fitDiagnostics};
      }
      return {...o,fitDiagnostics:{status:'kept-model',requiresReview:true,reason:'parametric-curve-needs-separate-fit'}};
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
  });
  // Simultaneous updates keep same-colour ownership independent of object order.
  // Two bounded reassignment passes; no pixel tracks or ever-growing vertices.
  let current=refined;
  for(let round=0;round<2;round++){
    let changed=false;
    const next=current.map(o=>{
      if(!o.fitDiagnostics?.ownership?.competitors?.length||!['smooth','bezier'].includes(o.connection))return o;
      const proxy=functionProxy(o);if(!proxy)return o;
      const fit=fitSmooth(raster,proxy,current,frames.get(o.frameId),Math.min(deadline,Date.now()+1500),legendBoxes,scene.relations||[]);
      if(['fitted','provisional'].includes(fit.fitDiagnostics?.status)){changed=true;delete fit._segments;return fit;}
      return o;
    });current=next;if(!changed)break;
  }
  // Do not force a rejected fit through crossings with local Hermite patches:
  // those joins can create high curvature and additional unsupported turns.
  return refreshPlotCoordinates({...scene,objects:current},raster);
}
