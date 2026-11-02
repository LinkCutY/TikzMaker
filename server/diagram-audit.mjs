import {sceneToPixels,sceneFromPixels,validateScene} from './scene.mjs';
import {locateDiagramVertices,diagramLineCandidates,straightEdgeEvidence,refineDiagramPorts} from './diagram-evidence.mjs';
/** Independent source inventory plus bounded geometric evidence. Neither a
 * plausible rendering nor the model's declared confidence proves topology. */
export async function auditDiagramEdges(scene,raster,opts,services){
  const source=sceneToPixels(scene,raster.w,raster.h);
  const located=locateDiagramVertices(source.objects.filter(o=>!o.diagramEdge),raster);
  const fixed=located.objects,known=new Set(fixed.map(o=>o.id));
  const candidates=diagramLineCandidates(fixed,raster);
  const response=await services.chat({...opts,temperature:0,thinking:'disabled',maxTokens:6500,timeoutMs:Math.min(45000,opts.timeoutMs||45000),messages:[{role:'user',content:[
    {type:'text',text:`Audit this SOURCE graph (${raster.w} x ${raster.h} pixels). Independently list ALL and ONLY the actual edges between the known nodes/boxes. Do NOT copy the previous guessed edge list: it is intentionally withheld. Trace each edge conceptually through intersections to its true endpoints; a crossing without a black dot is NOT a vertex. Do not add symmetric or completing edges merely because the layout is symmetric. Preserve solid/dashed/dotted, thickness, direction and occlusion. Boxes are groups, interior dots may be attachment points; use a box boundary only where the visible edge ends there. Labels are fixed. Return ONLY {"complete":true,"issues":[],"edges":[{"id":"unique_edge_id","kind":"edge","from":{"id":"known_id","anchor":"center|auto|east|west|north|south"},"to":{"id":"known_id","anchor":"..."},"style":{"stroke":"#000000","width":SOURCE_PIXEL_WIDTH,"dash":"solid|dashed|dotted","arrow":"end only if visible"}}]}. Omit arrow if none. For curves use two explicit controls; for bent polylines use via. Do not duplicate free annotation paths already in the fixed objects (e.g. an arrow between graph states). If the fixed nodes are insufficient or a connection is genuinely unreadable, set complete=false and explain issues; do not invent a node. Fixed objects in source pixels: `+JSON.stringify(fixed)},
    {type:'text',text:'Measured point/rectangle positions above supersede draft positions. Bounded straight-line templates found these candidate point-to-point connections: '+JSON.stringify(candidates)+'. These are source evidence, NOT a complete edge list. In particular, a line ending on a BOX SIDE must reference that box, not an interior dot. For arbitrary box attachment use from/to={id:box_id,port:[u,v]} with u,v in [0,1] relative to the box. A vertical arrow between two boxes may use south/north anchors although interior dots are offset horizontally. Inspect diagonal dashed connections separately; do not move a line to a dot if the visible line ends elsewhere on the box. Inspect interrupted strokes to distinguish short rectangular dashes from round dots; provide dashOn/dashOff in source pixels if visible. Never complete a pattern by inventing connections.'},
    {type:'image_url',image_url:{url:opts.image}}]}]});
  if(response.finishReason==='length')throw Error('Diagram edge inventory truncated');
  const parsed=services.parseJsonObject(response.text);
  if(typeof parsed.complete!=='boolean'||!Array.isArray(parsed.edges)||parsed.edges.length>60)throw Error('Invalid diagram edge inventory');
  if(!parsed.complete)return {...scene,diagramAudit:{ok:false,issues:Array.isArray(parsed.issues)?parsed.issues:['incomplete graph inventory']}};
  if(!parsed.edges.length&&scene.objects.some(o=>o.diagramEdge))throw Error('Empty inventory cannot silently erase all graph connections');
  if(parsed.edges.some(e=>e.kind!=='edge'||!known.has(e.from?.id)||!known.has(e.to?.id)))throw Error('Edge inventory references an unknown endpoint');
  const validated=validateScene(sceneFromPixels({...source,objects:[...fixed,...parsed.edges]},raster.w,raster.h));
  if(!validated.ok)throw Error(validated.errors.slice(0,3).join('; '));
  const measured=sceneToPixels(validated.scene,raster.w,raster.h),evidence=[];
  measured.objects=measured.objects.map(o=>o.diagramEdge?refineDiagramPorts(o,fixed,raster):o);
  for(const edge of measured.objects.filter(o=>o.diagramEdge&&o.points?.length===2)){
    evidence.push({id:edge.id,...straightEdgeEvidence(edge.points[0],edge.points[1],fixed,raster)});
  }
  const issues=[...(Array.isArray(parsed.issues)?parsed.issues:[]),...evidence.filter(e=>e.status==='unsupported').map(e=>({kind:'diagram-edge-without-source-support',...e}))];
  return {...sceneFromPixels(measured,raster.w,raster.h),diagramAudit:{ok:!issues.length,issues,edges:parsed.edges.length,source:'independent-source-inventory',vertices:located.report,evidence,candidates}};
}
