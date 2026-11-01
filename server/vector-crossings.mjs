/** Bounded subdivision of existing vectors, never image tracing. Coordinates px.
 * Convex hull rejection supports vertical edges and non-function curves.
 * Ambiguous tangencies/overlaps exhaust to unresolved, never a false pass. */
import { splitCubic } from './curve-clip.mjs';
const bounds=c=>[Math.min(...c.map(p=>p[0])),Math.min(...c.map(p=>p[1])),Math.max(...c.map(p=>p[0])),Math.max(...c.map(p=>p[1]))];
const overlap=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
function chordCross(a,b){
  const u=sub(a[3],a[0]),v=sub(b[3],b[0]),w=sub(b[0],a[0]),d=cross(u,v);
  if(Math.abs(d)<1e-10*Math.max(1,Math.hypot(...u)*Math.hypot(...v)))return null;
  const t=cross(w,v)/d,s=cross(w,u)/d;
  return t>=0&&t<=1&&s>=0&&s<=1?a[0].map((x,i)=>x+t*u[i]):null;
}
export function vectorCrossings(a,b,expected,radius=12){
  const region=[expected[0]-radius,expected[1]-radius,expected[0]+radius,expected[1]+radius];
  const cubics=g=>{let p=g.start;return g.segments.map(s=>{const c=[p,...s];p=s[2];return c;}).filter(c=>overlap(bounds(c),region));};
  const stack=[],found=[];let unresolved=false,work=0;
  for(const c of cubics(a))for(const d of cubics(b))if(overlap(bounds(c),bounds(d)))stack.push([c,d,0]);
  while(stack.length&&work++<20000){
    const [c,d,depth]=stack.pop(),bc=bounds(c),bd=bounds(d);
    if(!overlap(bc,bd)||!overlap(bc,region)||!overlap(bd,region))continue;
    const sc=Math.hypot(bc[2]-bc[0],bc[3]-bc[1]),sd=Math.hypot(bd[2]-bd[0],bd[3]-bd[1]);
    if(Math.max(sc,sd)<.05){
      const p=chordCross(c,d);
      if(p&&Math.hypot(...sub(p,expected))<=radius){if(!found.some(q=>Math.hypot(...sub(q,p))<.1))found.push(p);}
      else unresolved=true;
      continue;
    }
    if(depth>=36){unresolved=true;continue;}
    if(sc>=sd)for(const part of splitCubic(c,.5))stack.push([part,d,depth+1]);
    else for(const part of splitCubic(d,.5))stack.push([c,part,depth+1]);
  }
  return {found,unresolved:unresolved||stack.length>0,work};
}
