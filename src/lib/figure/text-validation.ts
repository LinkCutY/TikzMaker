import {parseBodySafe} from './bridge';
import {compileExpr} from './expr';
import type {Figure, Pt} from './types';
export {compileComposition} from './composition';

const distance=(a:Pt,b:Pt)=>Math.hypot(a.x-b.x,a.y-b.y);
/** Numerical witness check on the ACTUAL drawable objects, not a model's
 * assertion that its diagram satisfies a theorem. This is not a proof of the
 * continuity/differentiability hypotheses for arbitrary expressions. */
export function meanValueWitness(fig:Figure){
  const plots=fig.elements.filter(e=>e.kind==='plot'),lines=fig.elements.filter(e=>e.kind==='line');
  const markers=fig.elements.filter(e=>e.kind==='circle').map(e=>e.center);
  const diagnostics:unknown[]=[];
  for(const curve of plots){
    const compiled=compileExpr(curve.expr);if(!compiled.ok)continue;
    const f=(x:number)=>compiled.fn(x-curve.offset.x)+curve.offset.y;
    for(const chord of lines){
      const [a,b]=[chord.from,chord.to].sort((a,b)=>a.x-b.x),span=b.x-a.x;
      if(span<=1e-5||a.x<curve.xMin+curve.offset.x-1e-5||b.x>curve.xMax+curve.offset.x+1e-5)continue;
      const tol=Math.max(.003,Math.hypot(span,b.y-a.y)*.002);
      if(Math.abs(a.y-f(a.x))>tol||Math.abs(b.y-f(b.x))>tol)continue;
      if(Array.from({length:129},(_,i)=>f(a.x+span*i/128)).some(v=>!Number.isFinite(v)))continue;
      const m=(b.y-a.y)/span,h=span*1e-5;
      for(const p of markers){
        if(p.x<=a.x+h||p.x>=b.x-h||Math.abs(p.y-f(p.x))>tol)continue;
        const left=(f(p.x)-f(p.x-h))/h,right=(f(p.x+h)-f(p.x))/h,slope=(left+right)/2;
        const eps=.005*Math.max(1,Math.abs(m));
        diagnostics.push({curve:curve.name,a:a.x,b:b.x,xi:p.x,secantSlope:m,derivative:slope});
        if(!Number.isFinite(slope)||Math.abs(left-right)>eps||Math.abs(slope-m)>eps)continue;
        for(const tangent of lines){
          if(tangent===chord)continue;
          const u=tangent.from,v=tangent.to,dx=v.x-u.x,dy=v.y-u.y;
          if(Math.abs(dx)<h||Math.abs(dy/dx-m)>eps)continue;
          const normal=Math.abs(dx*(p.y-u.y)-dy*(p.x-u.x))/distance(u,v);
          const t=((p.x-u.x)*dx+(p.y-u.y)*dy)/(dx*dx+dy*dy);
          if(normal<=tol&&t>=-tol&&t<=1+tol)return {ok:true,witness:{a:a.x,b:b.x,xi:p.x,secantSlope:m,derivative:slope},diagnostics};
        }
      }
    }
  }
  return {ok:false,diagnostics,message:'中值定理关系未成立：需要曲线上两端点的弦、区间内标记点 ξ，以及经过该点且斜率等于割线斜率的切线。请计算 f′(ξ)=(f(b)-f(a))/(b-a)，不可只标注公式。'};
}

export function validateTextFigure(source:string,request:string,canvasMode=true){
  const figure=parseBodySafe(source),issues:{code:string;message:string}[]=[];
  if(canvasMode){
    if(!figure)issues.push({code:'CANVAS_EMPTY',message:'画布不能解析此文档'});
    for(const message of figure?.parseErrors||[])issues.push({code:'CANVAS_PARSE',message});
    for(const e of figure?.elements||[])if(e.kind==='plot'&&e.exprError)issues.push({code:'CANVAS_EXPRESSION',message:e.exprError});
  }
  const needsMeanValue=/拉格朗日.*中值|lagrange.*mean.?value|mean.?value.*theorem/i.test(request);
  const mathematics=needsMeanValue?(figure?meanValueWitness(figure):{ok:false,message:'无法读取用于中值定理校验的曲线与直线'}):null;
  if(mathematics&&!mathematics.ok)issues.push({code:'MATH_RELATION',message:mathematics.message||'中值定理关系未核实'});
  return {ok:!issues.length,issues,mathematics,elementCount:figure?.elements.length||0};
}
