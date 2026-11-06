export const COMPOSITION_PROMPT = `You construct editable mathematical and explanatory figures from user intent.
Return ONLY JSON, not TikZ: {"version":1,"requirements":[{"id":"r1","text":"one concrete user requirement","objects":["id"]}],"objects":[...],"constraints":[...]}.
First decompose the user's intent into required objects, their exact counts, labels, connections, directions and mathematical relationships. Cover EVERY requested clause. Then construct those requirements using the object graph below. All coordinates are Cartesian centimeters, y up. Use a compact readable layout (typically width 10, height 7). Objects may reference other ids in any order. No circular dependencies. Stable ids MUST survive repairs. Do not weaken/remove requirements to pass checks.
PointRef is [x,y], an existing point/box/circle/label id (shape references mean center), {on:"functionId",x:number} for a point ON a function, {ref:"objectId",anchor:"center"|"north"|"south"|"east"|"west"|"north east"|"north west"|"south east"|"south west"} for a geometric bounds anchor, or {project:"pointId",axis:"x"|"y",value:0} for projection onto an axis. A bare function id is NOT a mathematical point. Put curve labels at an explicit on-curve or bounds anchor plus offset.
Supported objects (each has unique id and optional style):
- {id,kind:"point",at:PointRef,visible:true}; alternatively on:"functionId",x:number; midpoint:[PointRef,PointRef]; intersection:["lineId","lineId"] (infinite lines); meanValue:{curve:"functionId",a:number,b:number}. Optional offset:[dx,dy], radiusPt (TeX points, typically 1.5..3) OR radius (CENTIMETERS, typically 0.04..0.1, max 0.3 for point markers). Default radius is 0.045 cm. Visible defaults true; do not add duplicate visible markers at the same point.
- {id,kind:"rect",at:PointRef,width,height}; {id,kind:"square",at:PointRef,size}; {id,kind:"circle",at:PointRef,radius}. at is center. Add separate labels referencing the shape id.
- {id,kind:"label",at:PointRef,text:"text with $math$",offset:[dx,dy],fontSize:10}. Put all formula markup in $...$.
- {id,kind:"function",expr:"x^2",domain:[a,b]}; expressions use x, arithmetic, pi, sin/cos in RADIANS, exp, ln, sqrt, abs. Finite continuous domain only; split discontinuities explicitly.
- {id,kind:"segment",from:PointRef,to:PointRef}.
- {id,kind:"connector",from:"shapeId",to:"shapeId",style:{arrow:"->"}}; endpoints calculated on boundaries. Use for flowchart edges, not guessed positions. Space shapes so they don't overlap.
- {id,kind:"parallel"|"perpendicular",line:"lineId",through:PointRef,length:number}.
- {id,kind:"tangent",curve:"functionId",through:"pointId",length:number}; point must lie on the curve, slope is computed by the program.
- {id,kind:"polygon",points:[PointRef,...]}.
- {id,kind:"polyline",points:[PointRef,...]} for discrete data joined by straight segments; {id,kind:"bezier",from:PointRef,c1:PointRef,c2:PointRef,to:PointRef} for curved connectors; {id,kind:"ellipse",at:PointRef,rx,ry}.
style may contain color:"red" or "#RRGGBB", fill:"blue!12", arrow:"none"|"->"|"<-"|"<->", dashed:true, dotted:true, thickness:"thin"|"normal"|"thick"|"very thick".
Constraints: {kind:"parallel"|"perpendicular"|"equalLength",a:"lineId",b:"lineId"}; {kind:"onCurve",point:"pointId",curve:"functionId"}; {kind:"leftOf"|"above",a:"objectId" or PointRef,b:"objectId" or PointRef}. Layout constraints compare geometric centers, including functions/lines/polygons; to require being ABOVE THE ENTIRE curve use b:{ref:"f",anchor:"north"}. Curve bounds are sampled estimates. Include checks for requested relationships even when constructors already enforce them. Text labels alone do not implement a relation. All requirements must reference visible objects.
For a mean value theorem illustration, construct f, A and B on f, their segment, an interior point using meanValue, and its tangent. Assert tangent parallel to segment, label a,b,xi and the derivative relation. The program solves xi; ALL aliases/markers/tangents must reference that computed point (e.g. {id:"P",kind:"point",at:"xi"}), NEVER replace it with a guessed x number. Put its x-axis label at {project:"xi",axis:"x"} plus a small downward offset. This is an illustration, not a proof of regularity.
For coordinate axes use arrow segments and separate labels; for ticks use explicit short segments/labels. For branches use separate directed connectors with labels. For geometric equality use derived constructions and explicit constraints. Do not substitute an unrelated diagram when the request is difficult. Bounds: 120 objects, 80 requirements, 100 constraints. If unsupported, return {"version":1,"unsupported":"concrete reason"} instead of claiming completion.`;

// The original acceptance contract survives retries. Geometry and styling can
// change, but successful repair cannot mean deleting difficult requirements.
export function preserveRequirements(plan, contract){
  if(!contract)return;
  for(const old of contract){
    const r=plan.requirements?.find(r=>r.id===old.id);
    if(!r||r.text!==old.text||JSON.stringify(r.objects)!==JSON.stringify(old.objects))throw new Error('COMPOSITION: restore original requirement '+old.id);
  }
}

export function requirementContract(plan){
  if(!Array.isArray(plan?.objects)||!Array.isArray(plan?.requirements)||!plan.requirements.length)return null;
  const ids=new Set(plan.objects.map(o=>o?.id));
  if(plan.requirements.some(r=>!r||typeof r.id!=='string'||typeof r.text!=='string'||!Array.isArray(r.objects)||!r.objects.length||r.objects.some(id=>!ids.has(id))))return null;
  return structuredClone(plan.requirements);
}

export function preserveConstraints(plan, contract){
  const key=c=>JSON.stringify(Object.entries(c).sort(([a],[b])=>a.localeCompare(b)));
  for(const old of contract||[])if(!plan.constraints?.some(c=>c&&key(c)===key(old)))throw new Error('COMPOSITION: restore original relation '+JSON.stringify(old));
}
