import {compileExpr} from './expr';
import {buildDocument} from './generate';
import {bounds, defaultStyle, type Element, type Pt, type Style} from './types';

// A bounded construction graph, distinct from a list of independently guessed
// drawing coordinates. Dependencies are resolved before emitting any TikZ.
type Spec = Record<string, any>;
const fail=(message:string):never=>{throw new Error('COMPOSITION: '+message);};
const number=(v:unknown):number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=10000?v:fail('expected finite number within ±10000');
const positive=(v:unknown)=>{const n=number(v);return n>0?n:fail('length must be positive');};
const pair=(v:any):Pt=>Array.isArray(v)&&v.length===2?{x:number(v[0]),y:number(v[1])}:fail('expected [x,y]');
const add=(a:Pt,b:Pt):Pt=>({x:a.x+b.x,y:a.y+b.y});
const sub=(a:Pt,b:Pt):Pt=>({x:a.x-b.x,y:a.y-b.y});
const norm=(p:Pt)=>Math.hypot(p.x,p.y);
const colour=(v:unknown)=>typeof v==='string'&&/^(?:[a-z]+(?:!\d+(?:![a-z]+)?)?|#[0-9a-fA-F]{6})$/.test(v)?v:fail('invalid colour');
function style(s:Spec={}):Style{
  const out=defaultStyle();
  if(s.color!==undefined)out.color=colour(s.color);
  if(s.fill!==undefined&&s.fill!==null)out.fill=colour(s.fill);
  if(s.arrow!==undefined){if(!['none','->','<-','<->'].includes(s.arrow))fail('invalid arrow');out.arrow=s.arrow;}
  if(s.dashed===true)out.dashed=true;if(s.dotted===true)out.dotted=true;
  if(s.thickness!==undefined){if(!['normal','thin','thick','very thick'].includes(s.thickness))fail('invalid thickness');out.thickness=s.thickness;}
  return out;
}
function label(v:unknown){
  if(typeof v!=='string'||v.length>1000||/\\(?:input|include|write|read|openout|special|catcode|csname|def|newcommand|begin|end|usepackage)\b/.test(v))fail('invalid label');
  return v as string;
}

export function compileComposition(input:unknown){
  const plan=input as Spec;
  if(!plan||plan.version!==1||!Array.isArray(plan.objects)||!plan.objects.length||plan.objects.length>120)fail('version=1 and 1..120 objects required');
  if(!Array.isArray(plan.requirements)||!plan.requirements.length||plan.requirements.length>80)fail('requirements required');
  if(!Array.isArray(plan.constraints)||plan.constraints.length>100)fail('constraints array required');
  const specs=new Map<string,Spec>(),elements=new Map<string,Element>(),points=new Map<string,Pt>(),active=new Set<string>();
  const violations:string[]=[];
  for(const o of plan.objects){
    if(!o||typeof o.id!=='string'||! /^[A-Za-z][\w-]{0,63}$/.test(o.id)||specs.has(o.id))fail('unique simple object ids required');
    specs.set(o.id,o);
  }
  const requirementIds=new Set<string>();
  for(const r of plan.requirements){
    if(!r||typeof r.id!=='string'||requirementIds.has(r.id)||typeof r.text!=='string'||!r.text.trim()||!Array.isArray(r.objects)||!r.objects.length||r.objects.some((id:unknown)=>typeof id!=='string'||!specs.has(id)))fail('each requirement needs unique id, text, and existing object ids');
    requirementIds.add(r.id);
  }
  const at=(v:any):Pt=>{
    if(Array.isArray(v))return pair(v);
    if(v&&typeof v==='object'){
      if(typeof v.on==='string'){const x=number(v.x);return {x,y:curve(v.on).f(x)};}
      if(typeof v.project==='string'){const p=at(v.project),value=v.value===undefined?0:number(v.value);if(v.axis==='x')return {x:p.x,y:value};if(v.axis==='y')return {x:value,y:p.y};return fail('projection axis must be x or y');}
      if(typeof v.ref==='string'){
        const b=extent(v.ref),anchor=v.anchor||'center';
        if(!['center','north','south','east','west','north east','north west','south east','south west'].includes(anchor))fail('invalid anchor '+anchor);
        return {x:anchor.includes('east')?b.x1:anchor.includes('west')?b.x0:(b.x0+b.x1)/2,y:anchor.includes('north')?b.y1:anchor.includes('south')?b.y0:(b.y0+b.y1)/2};
      }
    }
    if(typeof v==='string'){resolve(v);const p=points.get(v);if(p)return p;const e=elements.get(v);if(e?.kind==='rect')return {x:(e.from.x+e.to.x)/2,y:(e.from.y+e.to.y)/2};if(e?.kind==='circle'||e?.kind==='ellipse')return e.center;if(e?.kind==='node')return e.at;}
    return fail('point reference required: '+JSON.stringify(v)+'; for a function use {on:"functionId",x:number}; for layout use {ref:"objectId",anchor:"north"}; do not use a whole curve as a mathematical point');
  };
  // Layout references use an object's geometric extent, never masquerade as a
  // mathematical point on the curve. Curve extents are bounded sampled estimates.
  const extent=(id:string):{x0:number;y0:number;x1:number;y1:number}=>{
    resolve(id);const e=elements.get(id),p=points.get(id);
    if(p)return {x0:p.x,y0:p.y,x1:p.x,y1:p.y};
    if(!e)return fail('layout object not found: '+id);
    if(e.kind==='plot'){const {f}=curve(id),ys=Array.from({length:257},(_,i)=>f(e.xMin+(e.xMax-e.xMin)*i/256));return {x0:e.xMin,y0:Math.min(...ys),x1:e.xMax,y1:Math.max(...ys)};}
    return bounds(e);
  };
  const layoutAt=(v:any):Pt=>{
    if(typeof v!=='string')return at(v);
    const b=extent(v);return {x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2};
  };
  const line=(id:string)=>{resolve(id);const e=elements.get(id);return e?.kind==='line'?e:fail('line reference required: '+id);};
  const curve=(id:string)=>{
    resolve(id);const e=elements.get(id);if(e?.kind!=='plot')return fail('function reference required: '+id);
    const c=compileExpr(e.expr);if(!c.ok)return fail(c.error||'invalid function');
    return {e,f:(x:number)=>{if(x<e.xMin||x>e.xMax)fail('point outside function domain: '+id);return number(c.fn(x));}};
  };
  const derivative=(id:string,x:number)=>{
    const {e,f}=curve(id),h=Math.max(1e-6,(e.xMax-e.xMin)*1e-5);
    if(x-h<e.xMin||x+h>e.xMax)fail('tangent needs an interior differentiable point');
    const l=(f(x)-f(x-h))/h,r=(f(x+h)-f(x))/h;
    if(Math.abs(l-r)>.01*Math.max(1,Math.abs(l),Math.abs(r)))fail('derivative is not stable at requested point');
    return number((l+r)/2);
  };
  const border=(id:any,target:Pt)=>{
    const center=at(id),d=sub(target,center);if(norm(d)<1e-8)fail('connector endpoints coincide');
    const e=typeof id==='string'?elements.get(id):undefined;
    if(e?.kind==='rect'){const t=1/Math.max(Math.abs(d.x)/(Math.abs(e.to.x-e.from.x)/2),Math.abs(d.y)/(Math.abs(e.to.y-e.from.y)/2));return add(center,{x:t*d.x,y:t*d.y});}
    if(e?.kind==='circle'&&!points.has(id)){const t=e.radius/norm(d);return add(center,{x:t*d.x,y:t*d.y});}
    if(e?.kind==='ellipse'){const t=1/Math.hypot(d.x/e.rx,d.y/e.ry);return add(center,{x:t*d.x,y:t*d.y});}
    return center;
  };
  function resolve(id:string):void{
    if(elements.has(id)||points.has(id))return;
    const o=specs.get(id);if(!o)fail('unknown object '+id);if(active.has(id))fail('cyclic dependency at '+id);active.add(id);
    const base={id,name:id,style:style(o!.style)},s=o!;
    let e:Element|undefined;
    if(s.kind==='point'){
      let p:Pt;
      if(s.on!==undefined)p={x:number(s.x),y:curve(s.on).f(number(s.x))};
      else if(s.midpoint!==undefined){if(!Array.isArray(s.midpoint)||s.midpoint.length!==2)fail('midpoint needs two references');const a=at(s.midpoint[0]),b=at(s.midpoint[1]);p={x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
      else if(s.intersection!==undefined){if(!Array.isArray(s.intersection)||s.intersection.length!==2)fail('intersection needs two lines');const a=line(s.intersection[0]),b=line(s.intersection[1]),u=sub(a.to,a.from),v=sub(b.to,b.from),w=sub(b.from,a.from),cross=u.x*v.y-u.y*v.x;if(Math.abs(cross)<1e-8*norm(u)*norm(v))fail('lines do not have a stable intersection');const t=(w.x*v.y-w.y*v.x)/cross;p=add(a.from,{x:t*u.x,y:t*u.y});}
      else if(s.meanValue!==undefined){
        const {curve:id,a,b}=s.meanValue,{f}=curve(id),lo=number(a),hi=number(b);if(hi<=lo)fail('mean value interval must increase');
        const m=(f(hi)-f(lo))/(hi-lo),delta=(hi-lo)/512;
        let root:number|undefined,prev=lo+delta,fp=derivative(id,prev)-m;
        for(let i=2;i<512;i++){let next=lo+i*delta,fn=derivative(id,next)-m;if(Math.abs(fp)<1e-7){root=prev;break;}if(fp*fn<0){let l=prev,r=next;for(let j=0;j<45;j++){const mid=(l+r)/2,fm=derivative(id,mid)-m;if(fp*fm<=0)r=mid;else{l=mid;fp=fm;}}root=(l+r)/2;break;}prev=next;fp=fn;}
        if(root===undefined)fail('no numerically verified mean-value witness; choose another interval/function');p={x:root!,y:f(root!)};
      }else p=at(s.at);
      if(s.offset)p=add(p,pair(s.offset));points.set(id,p);
      if(s.visible!==false){
        if(s.radius!==undefined&&s.radiusPt!==undefined)violations.push(id+': specify radius (cm) OR radiusPt (TeX pt), not both');
        const radius=s.radiusPt!==undefined?positive(s.radiusPt)*2.54/72.27:s.radius===undefined?.045:positive(s.radius);
        if(radius>.3)violations.push(id+': point marker radius is '+radius.toFixed(3)+' cm, too large for a point. Use radiusPt (typically 1.5..3), radius in cm (typically 0.04..0.1), or kind=circle for a large disk.');
        e={...base,kind:'circle',center:p,radius,style:{...base.style,fill:base.style.color}};
      }
    }else if(s.kind==='rect'||s.kind==='square'){
      const p=at(s.at),w=positive(s.kind==='square'?s.size:s.width),h=positive(s.kind==='square'?s.size:s.height);
      e={...base,kind:'rect',from:{x:p.x-w/2,y:p.y-h/2},to:{x:p.x+w/2,y:p.y+h/2},rounded:0};
    }else if(s.kind==='circle')e={...base,kind:'circle',center:at(s.at),radius:positive(s.radius)};
    else if(s.kind==='ellipse')e={...base,kind:'ellipse',center:at(s.at),rx:positive(s.rx),ry:positive(s.ry)};
    else if(s.kind==='bezier')e={...base,kind:'bezier',p0:at(s.from),c1:at(s.c1),c2:at(s.c2),p1:at(s.to)};
    else if(s.kind==='label')e={...base,kind:'node',at:add(at(s.at),s.offset?pair(s.offset):{x:0,y:0}),text:label(s.text),fontSize:s.fontSize===undefined?10:positive(s.fontSize),anchor:'center',boxed:false,rounded:0};
    else if(s.kind==='function'){
      if(typeof s.expr!=='string'||s.expr.length>500)fail('function expression required');const c=compileExpr(s.expr);if(!c.ok)fail(c.error||'invalid expression');
      const [a,b]=[number(s.domain?.[0]),number(s.domain?.[1])];if(b<=a)fail('function domain must increase');
      for(let i=0;i<=128;i++)number(c.fn(a+(b-a)*i/128));
      e={...base,kind:'plot',expr:s.expr,xMin:a,xMax:b,samples:160,offset:{x:0,y:0}};
    }else if(['segment','connector','parallel','perpendicular','tangent'].includes(s.kind)){
      let from:Pt,to:Pt;
      if(s.kind==='segment'){from=at(s.from);to=at(s.to);}
      else if(s.kind==='connector'){const a=at(s.from),b=at(s.to);from=border(s.from,b);to=border(s.to,a);if((to.x-from.x)*(b.x-a.x)+(to.y-from.y)*(b.y-a.y)<=0)fail('connected boxes overlap; separate their layout');}
      else{
        const p=at(s.through);let d:Pt;
        if(s.kind==='tangent'){const {f}=curve(s.curve);if(Math.abs(p.y-f(p.x))>.002)fail('tangent point must lie on curve');d={x:1,y:derivative(s.curve,p.x)};}
        else{const l=line(s.line);d=sub(l.to,l.from);if(s.kind==='perpendicular')d={x:-d.y,y:d.x};}
        const k=positive(s.length)/norm(d)/2;from=add(p,{x:-d.x*k,y:-d.y*k});to=add(p,{x:d.x*k,y:d.y*k});
      }
      if(norm(sub(to,from))<.001)fail('zero length line '+id);e={...base,kind:'line',from,to};
    }else if(s.kind==='polygon'||s.kind==='polyline'){
      if(!Array.isArray(s.points)||s.points.length<(s.kind==='polygon'?3:2)||s.points.length>80)fail('path requires 2/3..80 points');e={...base,kind:'poly',points:s.points.map(at),closed:s.kind==='polygon'};
    }else fail('unsupported construction '+s.kind);
    if(e)elements.set(id,e);active.delete(id);
  }
  for(const id of specs.keys())resolve(id);
  for(const r of plan.requirements)if(!r.objects.some((id:string)=>elements.has(id)))fail('requirement has no visible object: '+r.id);
  const checks=[];
  for(const c of plan.constraints){
    try{
    let ok=false;
    if(['parallel','perpendicular','equalLength'].includes(c.kind)){
      const a=line(c.a),b=line(c.b),u=sub(a.to,a.from),v=sub(b.to,b.from),n=norm(u)*norm(v);
      ok=c.kind==='parallel'?Math.abs(u.x*v.y-u.y*v.x)/n<.002:c.kind==='perpendicular'?Math.abs(u.x*v.x+u.y*v.y)/n<.002:Math.abs(norm(u)-norm(v))<.002*Math.max(1,norm(u),norm(v));
    }else if(c.kind==='onCurve'){const p=at(c.point);ok=Math.abs(p.y-curve(c.curve).f(p.x))<.002;}
    else if(c.kind==='leftOf'||c.kind==='above'){const a=layoutAt(c.a),b=layoutAt(c.b);ok=c.kind==='leftOf'?a.x<b.x-.001:a.y>b.y+.001;}
    else fail('unsupported constraint '+c.kind);
    checks.push({...c,ok});if(!ok)violations.push('unsatisfied constraint '+JSON.stringify(c));
    }catch(err){violations.push(String((err as Error).message));}
  }
  if(violations.length)fail(violations.join('\n'));
  // Preserve declared paint order, irrespective of dependency evaluation order.
  const figure={elements:plan.objects.flatMap((o:Spec)=>elements.has(o.id)?[elements.get(o.id)!]:[])};
  if(!figure.elements.length)fail('no visible objects');
  return {code:buildDocument(figure),figure,requirements:plan.requirements,constraints:checks};
}
