/** Semantic graph objects lower to the same explicit primitives used by the
 * canvas and TeX compiler. Geometric crossings never create graph vertices. */
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const anchors=new Set(['auto','center','north','south','east','west','north east','north west','south east','south west']);
function center(o){
  if(o.box)return [o.box[0]+o.box[2]/2,o.box[1]+o.box[3]/2];
  return o.at||o.points?.[0];
}
function attach(ref,other,map){
  if(!ref||typeof ref.id!=='string'||!map.has(ref.id))throw new Error('Diagram edge references a missing node');
  const o=map.get(ref.id),p=center(o),anchor=ref.anchor||'auto';
  if(!point(p)||!anchors.has(anchor))throw new Error('Invalid diagram anchor: '+ref.id);
  if(ref.port!=null){
    if(!o.box||!point(ref.port)||ref.port.some(v=>v<0||v>1))throw new Error('Invalid diagram box port: '+ref.id);
    return [o.box[0]+ref.port[0]*o.box[2],o.box[1]+ref.port[1]*o.box[3]];
  }
  if(!o.box||anchor==='center')return p.slice();
  const [x,y,w,h]=o.box;
  if(anchor!=='auto')return [anchor.includes('west')?x:anchor.includes('east')?x+w:p[0],anchor.includes('north')?y:anchor.includes('south')?y+h:p[1]];
  const dx=other[0]-p[0],dy=other[1]-p[1];if(Math.hypot(dx,dy)<1e-9)return p.slice();
  const scale=o.kind==='ellipse'?1/Math.hypot(dx/(w/2),dy/(h/2)):1/Math.max(Math.abs(dx)/(w/2),Math.abs(dy)/(h/2));
  return [p[0]+scale*dx,p[1]+scale*dy];
}
export function expandDiagramObjects(input){
  const scene=structuredClone(input);if(!Array.isArray(scene.objects))return scene;
  const ids=new Set();for(const o of scene.objects){if(o.id&&ids.has(o.id))throw new Error('Duplicate diagram object id: '+o.id);ids.add(o.id);}
  const map=new Map(scene.objects.filter(o=>o.kind!=='edge').map(o=>[o.id,o]));
  scene.objects=scene.objects.map(o=>{
    if(o.kind==='vertex'){
      if(!point(o.at)||!Number.isFinite(o.radiusPx??2)||(o.radiusPx??2)<=0)throw new Error('Invalid diagram vertex '+o.id);
      return {id:o.id,kind:'path',role:'node',connection:'none',points:[o.at],marker:{shape:'circle',radiusPx:o.radiusPx??2,filled:true},style:{stroke:'#000000',fill:'#000000',width:.5,...o.style},z:o.z??30};
    }
    if(o.kind!=='edge')return o;
    const refs=[o.from,o.to];for(const ref of refs){const target=map.get(ref?.id);if(!target||!(['vertex','rect','ellipse','text'].includes(target.kind)||target.kind==='path'&&target.role==='node'&&target.points?.length===1))throw new Error('Invalid endpoint for edge '+o.id);}
    if(o.from.id===o.to.id&&!o.controls&&!o.via)throw new Error('Self-loop requires explicit controls or waypoints');
    if(o.controls&&(!Array.isArray(o.controls)||o.controls.length!==2||!o.controls.every(point)))throw new Error('Edge controls must contain two points');
    if(o.via&&(!Array.isArray(o.via)||o.via.length>24||!o.via.every(point)))throw new Error('Invalid edge waypoints');
    if(o.controls&&o.via)throw new Error('Choose controls or via, not both');
    const target=attach(o.to,center(map.get(o.from.id)),map);
    const a=attach(o.from,o.controls?.[0]||o.via?.[0]||target,map);
    const b=attach(o.to,o.controls?.[1]||o.via?.at(-1)||a,map);
    const metadata={from:o.from,to:o.to};
    return {id:o.id,kind:'path',role:'edge',z:o.z??10,style:{stroke:'#000000',width:1,...o.style},diagramEdge:metadata,
      ...(o.controls?{connection:'bezier',start:a,segments:[[...o.controls,b]]}:{connection:'linear',points:[a,...(o.via||[]),b]})};
  });
  return scene;
}

export function checkDiagramConnections(scene){
  const issues=[],edges=scene.objects.filter(o=>o.diagramEdge),map=new Map(scene.objects.map(o=>[o.id,o]));
  for(const o of edges){
    const {from,to}=o.diagramEdge,a=o.start||o.points?.[0],b=o.segments?.at(-1)?.[2]||o.points?.at(-1);
    try{
      const points=o.points||[o.start,...o.segments.map(s=>s[2])];
      const wantA=attach(from,o.segments?.[0]?.[0]||points[1],map),wantB=attach(to,o.segments?.at(-1)?.[1]||points.at(-2),map);
      if(!point(a)||!point(b)||Math.hypot(a[0]-wantA[0],a[1]-wantA[1])>1e-4||Math.hypot(b[0]-wantB[0],b[1]-wantB[1])>1e-4)issues.push({id:o.id,kind:'diagram-edge-detached'});
    }catch(e){issues.push({id:o.id,kind:'diagram-node-missing',message:e.message});}
  }
  return {ok:!issues.length,issues,edges:edges.length,vertices:scene.objects.filter(o=>o.role==='node').length};
}
