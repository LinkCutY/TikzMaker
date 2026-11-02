/** Bounded point/straight-line templates, never raster contours or traced paths.
 * Pixel coordinates throughout. Evidence advises semantic recognition and vetoes
 * unsupported edges; it does not invent nodes or infer junctions at crossings. */
function ink(r,x,y){
  x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=r.w||y>=r.h)return 0;
  const i=3*(y*r.w+x);return 1-(r.rgb[i]+r.rgb[i+1]+r.rgb[i+2])/765;
}
function diskScore(r,x,y,radius){
  let inside=ink(r,x,y),outside=0;
  for(let k=0;k<12;k++){
    const a=k*Math.PI/6,c=Math.cos(a),s=Math.sin(a);
    inside+=ink(r,x+c*radius*.6,y+s*radius*.6);
    outside+=ink(r,x+c*(radius+2),y+s*(radius+2));
  }
  return inside/13-outside/12;
}
export function locateDiagramVertices(objects,raster){
  const fixed=structuredClone(objects),report=[];
  // Four side parameters per rectangle. No contour extraction; only evaluate
  // straight border hypotheses near the model's proposed box.
  for(const o of fixed.filter(o=>o.kind==='rect'&&o.box).slice(0,40)){
    let [x,y,w,h]=o.box;const reach=Math.min(24,Math.hypot(raster.w,raster.h)*.04);
    const fitPair=(v,size,a,b,vertical)=>{
      const sample=c=>{let sum=0;for(let k=0;k<40;k++){const t=a+(b-a)*(.1+.8*(k+.5)/40);sum+=vertical?ink(raster,c,t):ink(raster,t,c);}return sum/40;};
      let best={v,size,score:0};
      // Fit opposite borders jointly: independently maximizing each side can
      // snap both sides onto the same border when the draft box is displaced.
      for(let d=-reach;d<=reach;d+=1)for(let grow=-6;grow<=6;grow+=1){
        if(size+grow<size*.6)continue;
        const score=(sample(v+d)+sample(v+d+size+grow))/2-.05*Math.abs(d)/reach-.015*Math.abs(grow)/6;
        if(score>best.score)best={v:v+d,size:size+grow,score};
      }
      return best.score>.55?best:{v,size};
    };
    for(let pass=0;pass<2;pass++){
      const yp=fitPair(y,h,x,x+w,false);y=yp.v;h=yp.size;
      const xp=fitPair(x,w,y,y+h,true);x=xp.v;w=xp.size;
    }
    o.box=[x,y,w,h];
  }
  const nodes=fixed.filter(o=>o.role==='node'&&o.points?.length===1&&o.marker?.shape==='circle');
  for(const o of nodes.slice(0,40)){
    const p=o.points[0],radius=o.marker.radiusPx||2;
    const nearest=Math.min(...nodes.filter(n=>n!==o).map(n=>Math.hypot(n.points[0][0]-p[0],n.points[0][1]-p[1])));
    const reach=Math.min(24,Math.max(6,Math.hypot(raster.w,raster.h)*.03),nearest*.3);
    const score=(x,y,q)=>diskScore(raster,x,y,q)-.06*Math.hypot(x-p[0],y-p[1])/reach;
    let best={x:p[0],y:p[1],r:radius,score:score(...p,radius)};
    const radii=[.75,1,1.25].map(f=>Math.max(1,Math.min(8,radius*f)));
    for(let dy=-reach;dy<=reach;dy+=2)for(let dx=-reach;dx<=reach;dx+=2)for(const q of radii){
      const value=score(p[0]+dx,p[1]+dy,q);if(value>best.score)best={x:p[0]+dx,y:p[1]+dy,r:q,score:value};
    }
    const coarse={...best};
    for(let dy=-1;dy<=1;dy+=.5)for(let dx=-1;dx<=1;dx+=.5)for(const q of radii){
      const value=score(coarse.x+dx,coarse.y+dy,q);if(value>best.score)best={x:coarse.x+dx,y:coarse.y+dy,r:q,score:value};
    }
    const supported=best.score>.55;
    if(supported){o.points=[[best.x,best.y]];o.marker.radiusPx=best.r;}
    report.push({id:o.id,supported,at:o.points[0],contrast:+best.score.toFixed(3)});
  }
  return {objects:fixed,report};
}
export function straightEdgeEvidence(a,b,objects,raster){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  if(length<12)return {status:'unresolved',reason:'short edge'};
  // Interiors can contain text or hide connections; exclude them from proof.
  const boxes=objects.filter(o=>['rect','ellipse'].includes(o.kind)&&o.box).map(o=>o.box);
  const bins=Array.from({length:6},()=>[]),count=Math.min(256,Math.max(64,Math.ceil(length)));
  let total=0;
  for(let i=0;i<count;i++){
    const t=.06+.88*(i+.5)/count,x=a[0]+dx*t,y=a[1]+dy*t;
    if(boxes.some(([bx,by,w,h])=>x>bx-1&&x<bx+w+1&&y>by-1&&y<by+h+1))continue;
    let v=0;for(const offset of [-1,0,1])v=Math.max(v,ink(raster,x-dy/length*offset,y+dx/length*offset));
    bins[Math.min(5,Math.floor(i/count*6))].push(v>.25?1:0);total++;
  }
  const parts=bins.filter(b=>b.length>=3).map(b=>b.reduce((a,v)=>a+v,0)/b.length);
  if(total<24||parts.length<3)return {status:'unresolved',reason:'occluded or insufficient span'};
  const coverage=bins.flat().reduce((a,v)=>a+v,0)/total,minBin=Math.min(...parts);
  return {status:coverage>.18&&minBin>.07?'supported':'unsupported',coverage:+coverage.toFixed(3),minBin:+minBin.toFixed(3),suggestedStyle:coverage>.85?'solid':'interrupted'};
}
export function diagramLineCandidates(objects,raster){
  const nodes=objects.filter(o=>o.role==='node'&&o.points?.length===1).slice(0,24),candidates=[];
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const evidence=straightEdgeEvidence(nodes[i].points[0],nodes[j].points[0],objects,raster);
    if(evidence.status==='supported')candidates.push({from:nodes[i].id,to:nodes[j].id,...evidence});
  }
  return candidates;
}

/** A node may name a boxed group while the visible connection ends on its
 * border. Compare a finite set of ports on the facing side, holding the group
 * identity fixed. Never redirect to an unrelated group to obtain more ink. */
export function refineDiagramPorts(edge,objects,raster){
  if(edge.points?.length!==2)return edge;
  const before=straightEdgeEvidence(...edge.points,objects,raster);
  if(before.status!=='unsupported')return edge;
  const choices=(ref,p,other)=>{
    const target=objects.find(o=>o.id===ref.id);
    let box=target?.kind==='rect'?target:null;
    if(!box){
      const enclosing=objects.filter(o=>o.kind==='rect'&&o.box&&p[0]>=o.box[0]&&p[0]<=o.box[0]+o.box[2]&&p[1]>=o.box[1]&&p[1]<=o.box[1]+o.box[3]);
      if(enclosing.length===1)box=enclosing[0];
    }
    if(!box)return [{ref,p}];
    const [x,y,w,h]=box.box,c=[x+w/2,y+h/2],dx=other[0]-c[0],dy=other[1]-c[1];
    const horizontal=Math.abs(dx)/w>Math.abs(dy)/h,result=[{ref,p}];
    for(let k=1;k<20;k++){
      const port=horizontal?[dx>0?1:0,k/20]:[k/20,dy>0?1:0];
      result.push({ref:{id:box.id,port},p:[x+port[0]*w,y+port[1]*h]});
    }
    return result;
  };
  const [a,b]=edge.points,left=choices(edge.diagramEdge.from,a,b),right=choices(edge.diagramEdge.to,b,a);
  let best=null;
  for(const l of left)for(const r of right){
    const ev=straightEdgeEvidence(l.p,r.p,objects,raster);
    if(ev.status!=='supported')continue;
    const score=ev.coverage+ev.minBin-.001*(Math.hypot(l.p[0]-a[0],l.p[1]-a[1])+Math.hypot(r.p[0]-b[0],r.p[1]-b[1]));
    if(!best||score>best.score)best={l,r,ev,score};
  }
  if(!best||best.ev.coverage<.25||best.ev.minBin<.12)return edge;
  return {...edge,points:[best.l.p,best.r.p],diagramEdge:{from:best.l.ref,to:best.r.ref},portEvidence:{before,after:best.ev}};
}
