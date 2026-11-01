/** Exact subdivision of existing cubic vectors at rectangular plot boundaries.
 * No raster access and no sampled approximation is emitted. */
const value=(p,t)=>(1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3];
export function splitCubic(c,t){
  const mix=(a,b)=>a.map((v,i)=>v+(b[i]-v)*t),a=mix(c[0],c[1]),b=mix(c[1],c[2]),d=mix(c[2],c[3]),e=mix(a,b),f=mix(b,d),g=mix(e,f);
  return [[c[0],a,e,g],[g,f,d,c[3]]];
}
function roots(p,bound){
  const a=-p[0]+3*p[1]-3*p[2]+p[3],b=3*p[0]-6*p[1]+3*p[2],c=3*(p[1]-p[0]),critical=[];
  if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12)critical.push(-c/(2*b));}
  else {const d=4*b*b-12*a*c;if(d>=0)critical.push((-2*b-Math.sqrt(d))/(6*a),(-2*b+Math.sqrt(d))/(6*a));}
  const cuts=[0,...critical.filter(t=>t>0&&t<1).sort((a,b)=>a-b),1],out=[];
  for(const t of cuts)if(Math.abs(value(p,t)-bound)<1e-8)out.push(t);
  for(let i=1;i<cuts.length;i++){
    let lo=cuts[i-1],hi=cuts[i],sign=value(p,lo)-bound;
    if(sign*(value(p,hi)-bound)>=0)continue;
    for(let j=0;j<45;j++){const mid=(lo+hi)/2;if(sign*(value(p,mid)-bound)<=0)hi=mid;else lo=mid;}
    out.push((lo+hi)/2);
  }return out;
}
// Bounded quadrature of vector arc length, used only to preserve dash phase.
function arcLength(c,scale){
  let total=0;
  const nodes=[-.9061798459,-.5384693101,0,.5384693101,.9061798459],weights=[.2369268851,.4786286705,.5688888889,.4786286705,.2369268851];
  for(let j=0;j<4;j++)for(let i=0;i<5;i++){
    const t=(j+(nodes[i]+1)/2)/4;
    const d=[0,1].map(k=>3*((1-t)**2*(c[1][k]-c[0][k])+2*(1-t)*t*(c[2][k]-c[1][k])+t*t*(c[3][k]-c[2][k]))*scale[k]);
    total+=weights[i]*Math.hypot(...d)/8;
  }return total;
}
export function clipCubics(start,segments,box,scale=[1,1]){
  const [x,y,w,h]=box,inside=p=>p[0]>=x-1e-8&&p[0]<=x+w+1e-8&&p[1]>=y-1e-8&&p[1]<=y+h+1e-8;
  const paths=[];let previous=start,current=null,clipped=false,offset=0;
  for(const segment of segments){
    const c=[previous,...segment];previous=segment[2];
    const candidates=[0,1,...roots(c.map(p=>p[0]),x),...roots(c.map(p=>p[0]),x+w),...roots(c.map(p=>p[1]),y),...roots(c.map(p=>p[1]),y+h)].sort((a,b)=>a-b);
    const cuts=candidates.filter((t,i)=>!i||t-candidates[i-1]>1e-9);
    for(let i=1;i<cuts.length;i++){
      const a=cuts[i-1],b=cuts[i],t=(a+b)/2;
      let part=b<1?splitCubic(c,b)[0]:c;if(a>0)part=splitCubic(part,a/b)[1];
      const length=arcLength(part,scale);
      if(!inside([value(c.map(p=>p[0]),t),value(c.map(p=>p[1]),t)])){current=null;clipped=true;offset+=length;continue;}
      if(!current){current={start:part[0],segments:[],offset};paths.push(current);}current.segments.push(part.slice(1));offset+=length;
    }
  }return {paths,clipped};
}

/** Elevation of straight edges to cubics is exact, including vertical steps. */
export function linearCubics(points){
  return points.slice(1).map((b,i)=>{const a=points[i];return [a.map((v,k)=>v+(b[k]-v)/3),a.map((v,k)=>v+2*(b[k]-v)/3),b];});
}
export function stepPoints(o){
  return o.connection==='step'?o.points.flatMap((b,i)=>i?[o.stepPosition==='pre'?[o.points[i-1][0],b[1]]:[b[0],o.points[i-1][1]],b]:[b]):o.points;
}
