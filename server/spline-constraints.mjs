/** Fixed-dimensional spline mathematics. No raster access. */
export function derivativeBasis(x,knots,k,order=0){
  const t=Math.max(0,Math.min(1-1e-12,x)),memo=new Map();
  function B(i,p,d){
    const key=i+','+p+','+d;if(memo.has(key))return memo.get(key);
    let v=0;
    if(d>p)v=0;
    else if(!p)v=knots[i]<=t&&t<knots[i+1]?1:0;
    else {const a=knots[i+p]-knots[i],b=knots[i+p+1]-knots[i+1];
      v=d?(a?p/a*B(i,p-1,d-1):0)-(b?p/b*B(i+1,p-1,d-1):0):
        (a?(t-knots[i])/a*B(i,p-1,0):0)+(b?(knots[i+p+1]-t)/b*B(i+1,p-1,0):0);
    }memo.set(key,v);return v;
  }
  return Array.from({length:k},(_,i)=>B(i,3,order));
}
export function roughnessMatrix(knots,k){
  const R=Array.from({length:k},()=>Array(k).fill(0)),breaks=[...new Set(knots)];
  for(let j=1;j<breaks.length;j++){
    const a=breaks[j-1],b=breaks[j],half=(b-a)/2,mid=(a+b)/2;if(half<=0)continue;
    // Exact Gaussian quadrature for products of piecewise-linear f'' bases.
    for(const x of [mid-half/Math.sqrt(3),mid+half/Math.sqrt(3)]){
      const row=derivativeBasis(x,knots,k,2);
      for(let p=0;p<k;p++)for(let q=0;q<k;q++)R[p][q]+=half*row[p]*row[q];
    }
  }return R;
}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function independent(rows,n){
  const basis=[],kept=[];
  for(const constraint of rows){
    const v=[...constraint.row,constraint.rhs];
    for(const b of basis){const q=v[b.pivot];for(let j=0;j<=n;j++)v[j]-=q*b.v[j];}
    const pivot=v.slice(0,n).findIndex(x=>Math.abs(x)>1e-8);
    if(pivot<0){if(Math.abs(v[n])>1e-6)return null;continue;}
    const d=v[pivot];for(let j=0;j<=n;j++)v[j]/=d;
    basis.push({pivot,v});kept.push(constraint);
  }return kept;
}
export function constrainedCoefficients(A,b,equalities,inequalities,solve){
  const n=b.length,eq=independent(equalities,n);if(!eq)return null;
  const m=eq.length,K=Array.from({length:n+m},(_,i)=>Array.from({length:n+m},(_,j)=>
    i<n&&j<n?A[i][j]:i<n?-eq[j-n].row[i]:j<n?eq[i-n].row[j]:0));
  const initial=solve(K,[...b,...eq.map(r=>r.rhs)]);if(!initial)return null;
  const x=initial.slice(0,n),terms=[];
  for(const constraint of inequalities){
    const solution=solve(K,[...constraint.row,...Array(m).fill(0)]);if(!solution)return null;
    const z=solution.slice(0,n),denominator=dot(constraint.row,z);
    if(denominator<1e-12){if(dot(constraint.row,x)<constraint.rhs-1e-7)return null;continue;}
    terms.push({...constraint,z,denominator,lambda:0});
  }
  // Projected coordinate descent on the convex QP dual. Equality-preserving
  // directions tolerate redundant derivative inequalities at shared knots.
  for(let iteration=0;iteration<800;iteration++){
    let move=0;
    for(const r of terms){
      const next=Math.max(0,r.lambda+(r.rhs-dot(r.row,x))/r.denominator),delta=next-r.lambda;
      for(let j=0;j<n;j++){const d=delta*r.z[j];x[j]+=d;move=Math.max(move,Math.abs(d));}r.lambda=next;
    }
    if(move<1e-9&&terms.every(r=>dot(r.row,x)>=r.rhs-1e-7)&&eq.every(r=>Math.abs(dot(r.row,x)-r.rhs)<1e-6))return x;
  }return null;
}
export function shapeConstraints(knots,k,structure){
  const eq=[],ineq=[],breaks=[...new Set(knots)],events=structure?.events||[];
  for(const bound of structure?.endpointBounds||[]){
    const row=derivativeBasis(bound.t,knots,k);
    ineq.push({row,rhs:bound.lo},{row:row.map(v=>-v),rhs:-bound.hi});
  }
  for(const e of events){
    const row=derivativeBasis(e.t,knots,k),tol=e.tolerance;
    ineq.push({row,rhs:e.y-tol},{row:row.map(x=>-x),rhs:-e.y-tol});
    if(e.smooth)eq.push({row:derivativeBasis(e.t,knots,k,1),rhs:0});
  }
  for(let i=1;i<breaks.length;i++){
    const a=breaks[i-1],b=breaks[i],mid=(a+b)/2;
    const interval=structure?.intervals?.find(s=>mid>=s.lo&&mid<=s.hi);if(!interval?.sign)continue;
    const delta=Math.min(1e-9,(b-a)*1e-5),p=derivativeBasis(a+delta,knots,k,1),q=derivativeBasis(b-delta,knots,k,1),m=derivativeBasis(mid,knots,k,1);
    // Nonnegative Bernstein derivative controls guarantee monotonicity on
    // the entire polynomial span, not only at sampled positions.
    for(const row of [p,m.map((v,j)=>2*v-(p[j]+q[j])/2),q]){
      const signed=row.map(v=>v*interval.sign),norm=Math.max(...signed.map(Math.abs));
      if(norm>1e-12)ineq.push({row:signed.map(v=>v/norm),rhs:0});
    }
  }return {eq,ineq};
}
