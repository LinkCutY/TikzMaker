/** Budgets for MODEL-SUPPLIED semantic landmarks, never raster/contour samples.
 * Canonical coordinates are 0..1000 per axis. Measure lengths in an isotropic
 * metric with image diagonal = 1000, so resizing does not buy extra points.
 *
 * N = 2 + n + sum_j max(0, ceil(S_j / p * sqrt(min(1, Theta_j / theta0))) - 1)
 * j runs between mandatory landmarks; their turns are already paid for by n.
 * Straight spans need no interior support, even when long. This is a soft
 * reduction target, not a validation limit or a request for uniform samples.
 * Preserve additional points when needed for shape, up to maxPoints.
 */
export const CURVE_BUDGET = Object.freeze({
  maxPoints: 48, spacing: 40, noiseTolerance: 2,
  cornerDegrees: 60, turnNoiseDegrees: 3, inflectionDegrees: 15,
  referenceTurn: Math.PI / 2, maxInputPoints: 2048,
});
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const distance=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const rad=d=>d*Math.PI/180;

function chordDistance(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;
  const t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}

// Only remove redundant model landmarks for complexity measurement. No image
// data is read, and these simplified points are NOT substituted into output.
function simplify(points,epsilon){
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),pending=[[0,points.length-1]];
  while(pending.length){
    const [lo,hi]=pending.pop();let worst=-1,error=epsilon;
    for(let i=lo+1;i<hi;i++){
      const d=chordDistance(points[i].p,points[lo].p,points[hi].p);
      if(d>error){error=d;worst=i;}
    }
    if(worst>=0){keep.add(worst);pending.push([lo,worst],[worst,hi]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}

export function analyzeCurveBudget(points,options={}){
  options ||= {};
  const empty={budget:2,required:2,exceeded:false,features:0,length:0,extra:0,mandatoryIndices:[],spans:[]};
  if(!Array.isArray(points)||!points.every(validPoint))return {...empty,invalid:true};
  if(points.length>CURVE_BUDGET.maxInputPoints)return {...empty,budget:CURVE_BUDGET.maxPoints,required:points.length,exceeded:true};
  const width=Number.isFinite(options.width)&&options.width>0?options.width:1000;
  const height=Number.isFinite(options.height)&&options.height>0?options.height:1000;
  // A trusted panel crop keeps its own diagonal after global scene composition.
  const diagonal=Number.isFinite(options.referenceDiagonal)&&options.referenceDiagonal>0?options.referenceDiagonal:Math.hypot(width,height);
  const epsilon=Number.isFinite(options.noiseTolerance)&&options.noiseTolerance>0?options.noiseTolerance:CURVE_BUDGET.noiseTolerance;
  const spacing=Number.isFinite(options.spacing)&&options.spacing>0?options.spacing:CURVE_BUDGET.spacing;
  const metric=points.map((p,index)=>({p:[p[0]*width/diagonal,p[1]*height/diagonal],index}))
    .filter((v,i,all)=>!i||distance(v.p,all[i-1].p)>1e-9);
  const clean=simplify(metric,epsilon),m=clean.length;
  if(m<2)return empty;
  const turns=Array(m).fill(0),arc=Array(m).fill(0),keys=new Set([0,m-1]);
  for(let i=1;i<m;i++)arc[i]=arc[i-1]+distance(clean[i-1].p,clean[i].p);
  for(let i=1;i<m-1;i++){
    const [a,b,c]=[clean[i-1].p,clean[i].p,clean[i+1].p];
    const u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];
    turns[i]=Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]);
    const extremum=u[1]*v[1]<0&&Math.min(Math.abs(u[1]),Math.abs(v[1]))>=epsilon;
    if(extremum||Math.abs(turns[i])>=rad(CURVE_BUDGET.cornerDegrees))keys.add(i);
  }
  // A meaningful inflection is a change in the SIGN of turning, with enough
  // accumulated turning on BOTH sides. A local peak is not an inflection.
  const runs=[];
  for(let i=1;i<m-1;i++){
    if(Math.abs(turns[i])<rad(CURVE_BUDGET.turnNoiseDegrees))continue;
    const sign=Math.sign(turns[i]),last=runs.at(-1);
    if(last?.sign===sign){last.end=i;last.angle+=Math.abs(turns[i]);}
    else runs.push({sign,start:i,end:i,angle:Math.abs(turns[i])});
  }
  for(let i=1;i<runs.length;i++){
    const a=runs[i-1],b=runs[i];
    if(Math.min(a.angle,b.angle)<rad(CURVE_BUDGET.inflectionDegrees))continue;
    const target=(arc[a.end]+arc[b.start])/2;
    let nearest=a.end;
    for(let j=a.end+1;j<=b.start;j++)if(Math.abs(arc[j]-target)<Math.abs(arc[nearest]-target))nearest=j;
    keys.add(nearest);
  }
  const anchors=[...keys].sort((a,b)=>a-b),spans=[];let extra=0;
  for(let j=1;j<anchors.length;j++){
    const lo=anchors[j-1],hi=anchors[j],length=arc[hi]-arc[lo];
    let turn=0;for(let i=lo+1;i<hi;i++)turn+=Math.abs(turns[i]);
    const interior=Math.max(0,Math.ceil(length/spacing*Math.sqrt(Math.min(1,turn/CURVE_BUDGET.referenceTurn)))-1);
    spans.push({length,turn,extra:interior});extra+=interior;
  }
  const required=anchors.length+extra;
  return {budget:Math.min(CURVE_BUDGET.maxPoints,required),required,exceeded:required>CURVE_BUDGET.maxPoints,
    features:anchors.length-2,length:arc.at(-1),extra,spans,mandatoryIndices:anchors.map(i=>clean[i].index)};
}

export const pathBudget=(points,options)=>analyzeCurveBudget(points,options).budget;

export const CURVE_BUDGET_PROMPT=`Smooth geometry has an adaptive budget, not a fixed 12-point quota. Supply the FEWEST semantic landmarks that preserve endpoints, significant extrema, sharp corners, plateau edges and stable changes of concavity. The server measures noise-filtered length and turning in an aspect-correct metric (image diagonal = 1000), reserves structural landmarks, then adds support only inside curved spans. Straight spans need only their endpoints. Never fill a quota with uniform samples or tiny jitter. Maximum ${CURVE_BUDGET.maxPoints} smooth landmarks per piece; if essential structure exceeds this, split at meaningful boundaries and report limitations rather than deleting features. Visible discrete observations and markers have their own budget and must not be thinned as smooth controls.`;
