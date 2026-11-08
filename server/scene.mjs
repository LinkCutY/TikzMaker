/** Resolution-independent semantic scene. Only model-read objects/landmarks enter
 * this compiler. There is no raster-to-path or dense contour fallback. */
import { safeNodeText, cjkPreamble } from './textext.mjs';
import { CURVE_BUDGET, CURVE_BUDGET_PROMPT } from './curve-budget.mjs';
import { clipCubics, linearCubics, stepPoints } from './curve-clip.mjs';
import { expandDiagramObjects } from './diagram-scene.mjs';
export { analyzeCurveBudget, pathBudget } from './curve-budget.mjs';

export const SCENE_LIMITS={objects:260,paths:60,labels:160,smoothPoints:CURVE_BUDGET.maxPoints,corners:80,markers:100,segments:24};
export const KEYPOINT_SPACING = CURVE_BUDGET.spacing;
export const CORNER_DEGREES = CURVE_BUDGET.cornerDegrees;

/** Arc length of a polyline, in canonical units. */
export function pathLength(points){
  let s=0;
  for(let i=1;i<(points||[]).length;i++){
    const a=points[i-1],b=points[i];
    if(!xy(a)||!xy(b))continue;
    s+=Math.hypot(b[0]-a[0],b[1]-a[1]);
  }
  return s;
}

/** Number of turns sharper than the corner threshold. */
export function cornerCount(points,deg){
  const limit=(deg==null?CORNER_DEGREES:deg)*Math.PI/180;
  let x=0;
  const pts=points||[];
  for(let i=1;i+1<pts.length;i++){
    const a=pts[i-1],b=pts[i],c=pts[i+1];
    if(!xy(a)||!xy(b)||!xy(c))continue;
    const v1=[b[0]-a[0],b[1]-a[1]],v2=[c[0]-b[0],c[1]-b[1]];
    const n1=Math.hypot(v1[0],v1[1]),n2=Math.hypot(v2[0],v2[1]);
    if(n1<1e-9||n2<1e-9)continue;
    const cos=Math.max(-1,Math.min(1,(v1[0]*v2[0]+v1[1]*v2[1])/(n1*n2)));
    if(Math.acos(cos)>limit)x++;
  }
  return x;
}

const finite=v=>typeof v==='number' && Number.isFinite(v);
const xy=p=>Array.isArray(p)&&p.length===2&&p.every(finite)&&p.every(v=>v>=-50&&v<=1050);
const colour=c=>/^#[0-9a-f]{6}$/i.test(c || '');
const f=n=>String(Math.round(n*10000)/10000);
const rgb=c=>'{rgb,255:red,'+parseInt(c.slice(1,3),16)+';green,'+parseInt(c.slice(3,5),16)+';blue,'+parseInt(c.slice(5,7),16)+'}';
/** Model reads source pixels; one explicit boundary converts to canonical units.
 * Asking a vision model to also divide every coordinate by image dimensions led
 * to mixed pixel/normalised coordinates and collapsed figures. Never auto-guess. */
export function sceneFromPixels(input,width,height){
  if(input.canvas?.unit!=='px'||input.canvas.width!==width||input.canvas.height!==height)throw new Error('canvas must declare exact source width, height and unit=px');
  const scene=expandDiagramObjects(input),p=q=>[q[0]/width*1000,q[1]/height*1000];
  if(scene.relations)scene.relations=scene.relations.map(r=>({...r,at:r.at?p(r.at):r.at}));
  for(const o of scene.objects||[]){
    if(o.at)o.at=p(o.at);if(o.start)o.start=p(o.start);
    if(o.points)o.points=o.points.map(p);if(o.segments)o.segments=o.segments.map(s=>s.map(p));
    if(o.upper)o.upper=o.upper.map(p);if(o.lower)o.lower=o.lower.map(p);
    if(o.marker?.points)o.marker.points=o.marker.points.map(p);
    if(o.endpointAnchors)for(const anchor of Object.values(o.endpointAnchors))if(anchor.at)anchor.at=p(anchor.at);
    if(o.box)o.box=[o.box[0]/width*1000,o.box[1]/height*1000,o.box[2]/width*1000,o.box[3]/height*1000];
  }
  scene.canvas={width:1000,height:1000,unit:'normalised'};
  // Trusted conversion dimensions, not model estimates. Keep aspect for budgets.
  scene.sourceSize={width,height};delete scene.budgetRegions;return scene;
}
export function sceneToPixels(input,width,height){
  const scene=structuredClone(input),p=q=>[q[0]*width/1000,q[1]*height/1000];
  if(scene.relations)scene.relations=scene.relations.map(r=>({...r,at:r.at?p(r.at):r.at}));
  for(const o of scene.objects||[]){if(o.at)o.at=p(o.at);if(o.start)o.start=p(o.start);if(o.points)o.points=o.points.map(p);if(o.segments)o.segments=o.segments.map(s=>s.map(p));if(o.upper)o.upper=o.upper.map(p);if(o.lower)o.lower=o.lower.map(p);if(o.marker?.points)o.marker.points=o.marker.points.map(p);if(o.box)o.box=[o.box[0]*width/1000,o.box[1]*height/1000,o.box[2]*width/1000,o.box[3]*height/1000];}
  for(const o of scene.objects||[])if(o.endpointAnchors)for(const anchor of Object.values(o.endpointAnchors))if(anchor.at)anchor.at=p(anchor.at);
  scene.canvas={width,height,unit:'px'};return scene;
}
export function sceneCurveBudgetOptions(scene,object){
  const size=scene.sourceSize||{},panel=scene.budgetRegions?.[object.panelId];
  return panel?{...size,referenceDiagonal:Math.hypot(panel.width,panel.height)}:size;
}
export function validateScene(input){
  const errors=[],scene=structuredClone(input);
  if(!Array.isArray(scene.objects))return {ok:false,errors:['objects array required'],scene};
  if(scene.objects.length>SCENE_LIMITS.objects)errors.push('Object budget exceeded; split independent panels');
  const seen=new Set();let labels=0,paths=0;
  for(const [i,o] of scene.objects.entries()){
    o.id ||= 'object-'+(i+1);
    const bad=s=>errors.push(o.id+': '+s);
    if(seen.has(o.id))bad('duplicate id');seen.add(o.id);
    o.style ||= {};
    for(const key of ['stroke','fill'])if(o.style[key]!=null && o.style[key]!=='none'&&!colour(o.style[key]))bad('invalid '+key+' colour');
    if(o.style.width!=null&&(!finite(o.style.width)||o.style.width<0||o.style.width>20))bad('width must be source pixels');
    for(const key of ['dashOn','dashOff','dashPhase'])if(o.style[key]!=null&&(!finite(o.style[key])||o.style[key]<0||o.style[key]>10000))bad('invalid '+key);
    if(o.style.dashOff===0&&o.style.dashOn===0)bad('dash period must be positive');
    if(o.kind==='text'){
      labels++;
      if(!xy(o.at)||typeof o.text!=='string'||!o.text.trim())bad('text and finite centre required');
      if(!finite(o.fontSize)||o.fontSize<=0||o.fontSize>250)bad('fontSize must be source pixels');
      if(/\\(?:input|include|write|read|openout|special|catcode|csname|newcommand|def|usepackage|begin\s*\{(?:document|tikzpicture))/i.test(o.text))bad('text contains a document command');
      if((o.text.match(/\$/g)||[]).length%2)bad('unbalanced math delimiters');
    }else if(o.kind==='path'){
      paths++;
      if(o.shape?.monotone!=null&&!['increasing','decreasing','none'].includes(o.shape.monotone))bad('shape.monotone must describe image y: increasing, decreasing or none');
      // Two endpoints fully determine an axis or tick. Models occasionally
      // omit the redundant connection field for these simple primitives.
      if(o.connection==null&&['axis','tick'].includes(o.role)&&Array.isArray(o.points)&&o.points.length===2&&o.points.every(xy))o.connection='linear';
      if(!['linear','smooth','step','none','bezier'].includes(o.connection))bad('explicit connection required');
      if(o.connection==='bezier'){
        if(!xy(o.start)||!Array.isArray(o.segments)||!o.segments.length||o.segments.length>SCENE_LIMITS.segments||o.segments.some(s=>!Array.isArray(s)||s.length!==3||!s.every(xy)))bad('bounded cubic segments required');
      }else{
        // Visible observations/corners are evidence, not smooth fitting controls.
        // The formula estimates a simplification TARGET, not an admissibility
        // proof. If safe reduction needs more points, retain them up to the cap.
        const max=o.connection==='smooth'?SCENE_LIMITS.smoothPoints:(o.connection==='none'?SCENE_LIMITS.markers:SCENE_LIMITS.corners);
        if(!Array.isArray(o.points)||o.points.length<(o.connection==='none'?1:2)||o.points.length>max||!o.points.every(xy)){
          const got=Array.isArray(o.points)?o.points.length:0;
          bad('invalid landmark/observation budget (max '+max+', got '+got+')');
        }
        if(o.connection==='smooth'&&o.points?.some((p,j)=>j&&p[0]<=o.points[j-1][0]))bad('smooth y(x) requires increasing x; split at jumps, use linear vertical edges or parametric bezier');
      }
      if(o.marker && !['none','circle','square','triangle','diamond','cross','plus'].includes(o.marker.shape))bad('unknown marker');
      if(o.marker && o.marker.shape!=='none'){
        const points=o.marker.points || o.points;
        if(!Array.isArray(points)||points.length>SCENE_LIMITS.markers||!points.every(xy))bad('invalid marker observations');
        if(o.expectedMarkers!=null&&points?.length!==o.expectedMarkers)bad('marker count mismatch');
      }
    }else if(o.kind==='band'){
      paths++;
      for(const name of ['upper','lower']){
        if(!Array.isArray(o[name])||o[name].length<2||o[name].length>SCENE_LIMITS.smoothPoints||!o[name].every(xy)||o[name].some((p,j)=>j&&p[0]<=o[name][j-1][0]))bad('band '+name+' requires 2..'+SCENE_LIMITS.smoothPoints+' increasing semantic landmarks; split at meaningful boundaries if the hard cap is exceeded');
      }
      if(o.upper?.length&&o.lower?.length&&(Math.abs(o.upper[0][0]-o.lower[0][0])>1||Math.abs(o.upper.at(-1)[0]-o.lower.at(-1)[0])>1))bad('band boundaries must share x domain');
    }else if(['rect','ellipse'].includes(o.kind)){
      if(!Array.isArray(o.box)||o.box.length!==4||!o.box.every(finite)||o.box[2]<=0||o.box[3]<=0)bad('box must be [left,top,width,height]');
    }else if(o.kind==='legend'){
      if(!xy(o.at)||!Array.isArray(o.entries)||!o.entries.length)bad('legend needs position and entries');
    }else bad('unsupported kind '+o.kind);
  }
  if(labels>SCENE_LIMITS.labels||paths>SCENE_LIMITS.paths)errors.push('Label/path budget exceeded');
  for(const o of scene.objects)if(o.kind==='legend')for(const e of o.entries||[])if(!seen.has(e.seriesId)||typeof e.text!=='string')errors.push(o.id+': dangling legend reference '+e.seriesId);
  if(scene.relations!=null&&!Array.isArray(scene.relations))errors.push('relations must be an array');
  else {
    if((scene.relations?.length||0)>120)errors.push('crossing relation budget exceeded (120)');
    for(const r of scene.relations||[])if(!r||r.kind!=='crossing'||!xy(r.at)||!Array.isArray(r.seriesIds)||r.seriesIds.length!==2||r.seriesIds[0]===r.seriesIds[1]||r.seriesIds.some(id=>!scene.objects.some(o=>o.id===id&&o.kind==='path'&&o.connection!=='none')))errors.push('invalid crossing relation');
  }
  return {ok:!errors.length,errors,scene};
}

/** Shape-preserving cubic Hermite interpolation; zero derivatives at extrema.
 * Unlike Catmull-Rom this cannot add oscillations between monotone landmarks. */
export function monotoneCubics(points){
  const n=points.length,h=[],d=[],m=[];
  for(let i=0;i<n-1;i++){h[i]=points[i+1][0]-points[i][0];d[i]=(points[i+1][1]-points[i][1])/h[i];}
  m[0]=d[0];m[n-1]=d[n-2];
  for(let i=1;i<n-1;i++)m[i]=d[i-1]*d[i]<=0?0:(3*(h[i-1]+h[i]))/((2*h[i]+h[i-1])/d[i-1]+(h[i]+2*h[i-1])/d[i]);
  return points.slice(1).map((b,i)=>[[points[i][0]+h[i]/3,points[i][1]+m[i]*h[i]/3],[b[0]-h[i]/3,b[1]-m[i+1]*h[i]/3],b]);
}

/** All primitives have explicit physical coordinates. Canvas parse/save and TeX
 * use exactly the same paths; no pgfplots-only implicit coordinate systems. */
export function compileScene(input,{width,height,widthCm=16}={}){
  const v=validateScene(input);if(!v.ok)throw new Error(v.errors.slice(0,6).join('; '));
  const scene=v.scene,heightCm=widthCm*height/width,pt=widthCm*28.45274/width;
  const p=a=>'('+f(a[0]*widthCm/1000)+','+f((1000-a[1])*heightCm/1000)+')';
  const style=s=>{
    const opts=['draw='+ (colour(s.stroke)?rgb(s.stroke):s.stroke==='none'?'none':'black'),'line width='+f((s.width??1)*pt)+'pt','line cap=round','line join=round'];
    if(colour(s.fill))opts.push('fill='+rgb(s.fill));
    if(s.dash==='dashed')opts.push('dash pattern=on '+f((s.dashOn??5)*pt)+'pt off '+f((s.dashOff??3)*pt)+'pt');
    if(s.dash==='dotted')opts.push('dash pattern=on 0pt off '+f((s.dashOff??4)*pt)+'pt');
    if(['dashed','dotted'].includes(s.dash)&&s.dashPhase!=null)opts.push('dash phase='+f(s.dashPhase*pt)+'pt');
    if(s.opacity!=null)opts.push('opacity='+f(Math.max(0,Math.min(1,s.opacity))));
    if(s.arrow==='end')opts.push('-{Stealth}');else if(s.arrow==='both')opts.push('{Stealth}-{Stealth}');
    return opts.join(',');
  };
  const lines=[],map=new Map(scene.objects.map(o=>[o.id,o]));
  const text=(o)=>{
    const size=o.fontSize*pt,anchor=['center','west','east','north','south','north west','north east','south west','south east'].includes(o.anchor)?o.anchor:'center';
    const opts=['anchor='+anchor,'inner sep=0pt','outer sep=0pt','align=center','text='+rgb(colour(o.color)?o.color:'#000000'),'font=\\fontsize{'+f(size)+'}{'+f(size*1.2)+'}\\selectfont'+(o.font==='sans'?'\\sffamily':'')+(o.bold?'\\bfseries':'')];
    if(o.rotate)opts.push('rotate='+f(o.rotate));
    const txt=safeNodeText(o.text).replace(/\n/g,'\\\\');
    lines.push('\\node['+opts.join(',')+'] at '+p(o.at)+' {'+txt+'};');
  };
  const marker=(at,m,s)=>{
    const radius=(m.radiusPx??3)*widthCm/width,dx=radius/widthCm*1000,dy=radius/heightCm*1000;
    const st=style({...s,fill:m.filled===false?'#ffffff':s.stroke,dash:'solid',arrow:null,width:m.width??Math.min(s.width??1,1.5)});
    if(m.shape==='circle')lines.push('\\draw['+st+'] '+p(at)+' circle ('+f(radius)+');');
    else if(['cross','plus'].includes(m.shape)){
      const a=m.shape==='cross'?[-dx,-dy]:[-dx,0],b=m.shape==='cross'?[dx,-dy]:[0,-dy];
      for(const d of [a,b])lines.push('\\draw['+st+'] '+p([at[0]+d[0],at[1]+d[1]])+' -- '+p([at[0]-d[0],at[1]-d[1]])+';');
    }else{
      const pts=m.shape==='triangle'?[[0,-dy],[dx,dy],[-dx,dy]]:m.shape==='diamond'?[[0,-dy],[dx,0],[0,dy],[-dx,0]]:[[-dx,-dy],[dx,-dy],[dx,dy],[-dx,dy]];
      lines.push('\\draw['+st+'] '+pts.map(q=>p([at[0]+q[0],at[1]+q[1]])).join(' -- ')+' -- cycle;');
    }
  };
  for(const o of [...scene.objects].sort((a,b)=>(a.z??(a.kind==='text'||a.kind==='legend'?30:10))-(b.z??(b.kind==='text'||b.kind==='legend'?30:10)))){
    lines.push('% object '+String(o.id).replace(/[^\w.-]/g,'_')+' '+o.kind);
    if(o.kind==='text'){text(o);continue;}
    if(o.kind==='band'){
      const upper=monotoneCubics(o.upper),lower=monotoneCubics(o.lower),edge=(a,b)=>[[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
      const reversed=lower.map((s,i)=>[s[1],s[0],o.lower[i]]).reverse();
      const segments=[...upper,edge(o.upper.at(-1),o.lower.at(-1)),...reversed,edge(o.lower[0],o.upper[0])];
      lines.push('\\draw['+style(o.style)+'] '+p(o.upper[0])+segments.map(s=>' .. controls '+p(s[0])+' and '+p(s[1])+' .. '+p(s[2])).join('')+' -- cycle;');
      continue;
    }
    if(o.kind==='legend'){
      const fs=o.fontSize??12,gap=o.rowHeight??fs*1.65,len=o.swatchWidth??25;
      if(o.box)lines.push('\\draw['+style({stroke:'#777777',fill:'#ffffff',width:0.5})+'] '+p(o.box.slice(0,2))+' rectangle '+p([o.box[0]+o.box[2],o.box[1]+o.box[3]])+';');
      o.entries.forEach((e,i)=>{
        const s=map.get(e.seriesId),a=[o.at[0],o.at[1]+i*gap/height*1000],b=[a[0]+len/width*1000,a[1]];
        if(s.connection!=='none')lines.push('\\draw['+style(s.style)+'] '+p(a)+' -- '+p(b)+';');
        if(s.marker?.shape&&s.marker.shape!=='none')marker([(a[0]+b[0])/2,a[1]],s.marker,s.style);
        text({at:[b[0]+6/width*1000,b[1]],text:e.text,fontSize:fs,anchor:'west',font:o.font});
      });continue;
    }
    if(o.kind==='rect'||o.kind==='ellipse'){
      const [x,y,w,h]=o.box;
      if(o.kind==='rect')lines.push('\\draw['+style(o.style)+'] '+p([x,y])+' rectangle '+p([x+w,y+h])+';');
      else lines.push('\\draw['+style(o.style)+'] '+p([x+w/2,y+h/2])+' ellipse ('+f(w*widthCm/2000)+' and '+f(h*heightCm/2000)+');');
      continue;
    }
    let body='';
    const frame=scene.plotFrames?.find(f=>f.id===o.frameId);
    if(frame&&!o.closed&&!o.style?.arrow&&!['axis','tick','annotation','grid'].includes(o.role)){
      const box=frame.box.map((v,i)=>v/(i%2?height:width)*1000);
      if(o.connection!=='none'){
        const start=o.start||o.points[0],segments=o.segments||(o.connection==='smooth'?monotoneCubics(o.points):linearCubics(stepPoints(o)));
        const result=clipCubics(start,segments,box,[width/1000,height/1000]);
        for(const part of result.paths){
          const s={...o.style};
          if(['dashed','dotted'].includes(s.dash)){
            const period=(s.dash==='dotted'?0:s.dashOn??5)+(s.dashOff??(s.dash==='dotted'?4:3));
            if(period>0)s.dashPhase=((s.dashPhase??0)+part.offset)%period;
          }
          lines.push('\\draw['+style(s)+'] '+p(part.start)+part.segments.map(s=>' .. controls '+p(s[0])+' and '+p(s[1])+' .. '+p(s[2])).join('')+';');
        }
      }
      if(o.marker?.shape&&o.marker.shape!=='none')for(const at of o.marker.points||o.points||[])if(at[0]>=box[0]&&at[0]<=box[0]+box[2]&&at[1]>=box[1]&&at[1]<=box[1]+box[3])marker(at,o.marker,o.style);
      continue;
    }
    if(o.connection==='bezier'||o.connection==='smooth'){
      const start=o.start||o.points[0],segments=o.segments||monotoneCubics(o.points);
      body=p(start)+segments.map(s=>' .. controls '+p(s[0])+' and '+p(s[1])+' .. '+p(s[2])).join('');
    }else if(o.connection!=='none'){
      let pts=o.points;
      if(o.connection==='step')pts=o.points.flatMap((b,i)=>i?[o.stepPosition==='pre'?[o.points[i-1][0],b[1]]:[b[0],o.points[i-1][1]],b]:[b]);
      body=pts.map(p).join(' -- ');
    }
    if(body)lines.push('\\draw['+style(o.style)+'] '+body+(o.closed?' -- cycle':'')+';');
    if(o.marker?.shape&&o.marker.shape!=='none')for(const at of o.marker.points||o.points||[])marker(at,o.marker,o.style);
  }
  const code=['\\documentclass[tikz,border=0pt]{standalone}','\\usepackage{amsmath,amssymb}',...cjkPreamble(lines.join('\n')),'\\usetikzlibrary{arrows.meta}','\\begin{document}','\\begin{tikzpicture}[x=1cm,y=1cm]',
    '\\path[use as bounding box] (0,0) rectangle ('+f(widthCm)+','+f(heightCm)+');',...lines,'\\end{tikzpicture}','\\end{document}'].join('\n');
  return {code,scene,stats:{type:scene.type||'mixed',elements:scene.objects.length,summary:scene.summary||'',kinds:scene.objects.reduce((a,o)=>(a[o.kind]=(a[o.kind]||0)+1,a),{})}};
}

export const SCENE_PROMPT=`Reconstruct the image as a compact editable semantic vector scene. Do NOT trace pixels. Return ONLY valid JSON. ALL coordinates and sizes are SOURCE IMAGE PIXELS, origin top-left, y DOWN. Do NOT normalise coordinates to 0..1000. Preserve aspect, exact relative placements, every readable text, style, series, legend, panels, fills and visible observation marker. Do not force everything into a smooth y(x) plot. No raw TikZ.
DIAGRAMS: If the image shows graph nodes, boxed groups, rewiring, mappings or graph states rather than numerical axes, set type=diagram. First inventory every box, visible black point, mathematical label and edge. Emit each point as {"id":"a","kind":"vertex","at":[x,y],"radiusPx":2}; labels are separate text objects with $LaTeX$. Boxes are rect/ellipse objects with stable IDs. Emit connections as {"id":"ab","kind":"edge","from":{"id":"a","anchor":"center"},"to":{"id":"b","anchor":"center"},"style":{"stroke":"#000000","width":1,"dash":"solid"}}. Anchor may be center, auto, north, south, east, west or a diagonal (north east etc). Point endpoints use center; box endpoints use auto or a visible side. An edge attached to an interior black dot references the dot, not the enclosing box. For bent edges use via:[[x,y],...] or controls:[[c1x,c1y],[c2x,c2y]], not both. Preserve arrow direction, relative thickness and solid/dashed/dotted style independently. No arrow unless one is visible. Crossing edges do NOT create a vertex without an explicit dot. A long dashed edge is ONE edge. Group boxes may be transparent or white-filled according to actual occlusion; use z explicitly to place edges behind white boxes when required. Labels and points are above edges. Multiple graph states get distinct IDs even when their text is identical; preserve connecting transformation arrows. Never infer numerical axes, fit graph edges as data curves or split connected graph states into independent image crops. Keep formulas such as $X'_U$, $G_{\\ell+1}$ and $Y_2^W$ intact. Do not duplicate an edge as an ordinary path.
For smooth paths with clear shape evidence, add "shape":{"monotone":"increasing|decreasing|none"}. This describes IMAGE y as x increases: a visually rising curve is decreasing. Use none for genuine peaks/valleys/oscillations; do not infer monotonicity just from its two endpoints. Identify every significant local maximum and minimum (including broad, shallow turns) BEFORE placing support landmarks; include their source-pixel coordinates explicitly in points. Preserve flat prefixes, sharp onsets, plateau heights and tails as separate semantic landmarks. A larger landmark budget does not excuse inaccurate positions. Read coordinates against the SAME plot axes for all series; never independently rescale a series to its own height. Identify same-colour solid and dashed curves as separate data objects with role=data and stable legend references. Dash gaps are missing observations of a styled continuous curve, not zero-valued points; genuine data gaps remain separate pieces. Record uncertainty in limitations when a hidden turn cannot be located.
For smooth plot curves, independently inspect visible interior crossings and include "relations":[{"kind":"crossing","seriesIds":["s1","s2"],"at":[SOURCE_PIXEL_X,SOURCE_PIXEL_Y]}]. Record crossings from the SOURCE, not from your drafted points; missing valleys can otherwise erase crossings. A shared start is not an interior crossing. Do not invent crossings where lines only approach each other. Include every visible tick as a short linear path with role=tick, its separate numeric label, and both axis paths with role=axis.
Schema: {"canvas":{"width":EXACT_IMAGE_WIDTH,"height":EXACT_IMAGE_HEIGHT,"unit":"px"},"type":"plot|diagram|table|regions|mixed|geometry","summary":"short description","fidelity":"reconstruction|approximate","limitations":[],"relations":[],"objects":[...]}
Every object has a unique stable id, kind, optional role (data,reference,axis,tick,grid,annotation), optional z (background=0, data=10, text=30). Styles use {"stroke":"#rrggbb or none","fill":"#rrggbb or none","width":SOURCE_PIXEL_WIDTH,"dash":"solid|dashed|dotted","arrow":"end|both"}. Width is usually 1-2 source pixels. All sizes including fontSize, radiusPx, rowHeight, swatchWidth are SOURCE PIXELS, never normalised.
Objects:
1. {"id":"...","kind":"text","at":[centreX,centreY],"text":"literal text or $LaTeX$","fontSize":14,"font":"serif|sans","color":"#000000","rotate":0,"anchor":"center|west|east","bold":false}. Use real LaTeX math for subscripts/superscripts/Greek; plain prose remains outside $...$. rotated axis labels use rotate=90. Preserve individual colours. One object per printed label; identical tick values at DIFFERENT locations are distinct.
2. {"id":"s1","kind":"path","connection":"linear|smooth|step|none","points":[[x,y],...],"style":{...},"closed":false,"marker":{"shape":"none|circle|square|triangle|diamond|cross|plus","radiusPx":3,"filled":true},"expectedMarkers":null}.
linear means exact straight segments through observations/corners in GIVEN order; allow repeated x and vertical jumps. NEVER smooth discrete zigzags, CDF corners, step discontinuities, grids or arrows. none means scatter only. step means horizontal then vertical (stepPosition=post or pre). smooth means shape-preserving interpolation with strictly increasing x. ${CURVE_BUDGET_PROMPT} No forced sine or Gaussian. Use up to 80 genuine straight vertices or 100 visible marker observations, NEVER dense regular samples. For smooth marked curves, marker.points holds actual observations independently of adaptive smooth geometry landmarks. A dashed reference is ONE styled path, not separate dash dots. Corners, jumps and changes of marker type must be explicit separate pieces. Do not invent bridging across gaps.
3. For parametric curves, arrows, closed curved filled regions: {"id":"...","kind":"path","connection":"bezier","start":[x,y],"segments":[[[control1x,control1y],[control2x,control2y],[endX,endY]],...],"closed":true/false,"style":{...}}. At most 10 cubic segments. Closed regions use the correct ordered boundary; a straight edge can be one cubic with collinear controls. This supports loops and x not monotone.
4. {"id":"...","kind":"rect|ellipse","box":[left,top,width,height],"style":{...}} for frames, bars, cells, nodes; box dimensions are SOURCE PIXELS too.
5. {"id":"legend","kind":"legend","at":[swatchLeftX,firstRowCentreY],"fontSize":12,"rowHeight":18,"swatchWidth":25,"entries":[{"seriesId":"s1","text":"$f(x)$"}]} (optional box=[left,top,width,height], optional font). Compiler derives samples/markers from referenced series; do NOT also add its text or samples separately. For multicolumn or marker-key legends use separate legends. Coloured fill keys may be ordinary rect + text.
6. Stacked areas and uncertainty bands: {"id":"band1","kind":"band","upper":[[x,y],...],"lower":[[x,y],...],"style":{"fill":"#rrggbb","stroke":"#rrggbb","width":1},"z":5}. Each boundary uses the same adaptive smooth budget (2..${CURVE_BUDGET.maxPoints} meaningful landmarks), ordered left-to-right with the SAME x domain. A straight boundary needs only two endpoints. upper is visually higher (SMALLER image y). A band occupies ONLY the space between its two boundaries, not the entire space down to the axis. Adjacent stacked bands must reuse their shared boundary values. For area under one curve use the horizontal baseline as lower. This is preferred over closed polygons for stacked area charts. Never draw every band from the top envelope to the bottom baseline.
Draw only visible axes/frame sides. Axis ticks are separate short paths, labels in correct order with exact values including negative signs. Logarithmic/categorical/dual axes retain their visual positions; never apply a guessed linear data scale. Gridlines stay light. Fill regions and table cells are FIRST, outlines/data then text. Shared legends are drawn once. Different series with same colour may NOT be merged. Preserve overlapping series and marker types.
Sparse reconstruction cannot exactly recover stochastic signals, tiny unresolvable observations, complex 3D surfaces or continuous colour fields; set fidelity=approximate and add a concrete limitations string only if meaningful details are lost. Ordinary estimation of readable positions is reconstruction, not a limitation. Do NOT fabricate fine noise or claim exact recovery. Give best bounded semantic approximation without embedding a bitmap. Keep <=260 objects, <=160 text labels, <=60 paths. If response would exceed budget, report limitation; do not silently drop axes/labels. Include all objects in every response, including corrections.`;
