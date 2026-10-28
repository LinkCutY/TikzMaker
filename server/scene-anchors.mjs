/** Fit existing axis/tick LINE primitives to source pixels. This estimates a
 * small fixed set of line positions; it never follows or samples data curves.
 * All observations stay in source pixels until converted at the scene boundary. */
const numeric=text=>/^[-+−]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(text||'').replace(/\$/g,'').trim());
function lineOf(o,w,h){
  if(o.kind!=='path'||o.connection!=='linear'||o.points?.length!==2||o.closed||o.style?.arrow||!['solid',undefined].includes(o.style?.dash))return null;
  const c=o.style?.stroke||'#000000';if(!/^#[0-9a-f]{6}$/i.test(c))return null;
  const rgb=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
  if(Math.max(...rgb)>120||Math.max(...rgb)-Math.min(...rgb)>30)return null;
  const p=o.points.map(([x,y])=>[x*w/1000,y*h/1000]);
  const horizontal=Math.abs(p[0][1]-p[1][1])<1,vertical=Math.abs(p[0][0]-p[1][0])<1;
  if(!horizontal&&!vertical)return null;
  const dim=horizontal?0:1,lo=Math.min(p[0][dim],p[1][dim]),hi=Math.max(p[0][dim],p[1][dim]);
  return {id:o.id,dim,normal:(p[0][1-dim]+p[1][1-dim])/2,lo,hi,length:hi-lo};
}
function dark(r,x,y){
  x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=r.w||y>=r.h)return false;
  const i=(y*r.w+x)*3,a=r.rgb[i],b=r.rgb[i+1],c=r.rgb[i+2];
  return Math.max(a,b,c)<140&&Math.max(a,b,c)-Math.min(a,b,c)<30;
}
function fitAxis(r,line){
  const extent=line.dim===0?r.w:r.h,normalExtent=line.dim===0?r.h:r.w;
  const ink=(along,normal)=>line.dim===0?dark(r,along,normal):dark(r,normal,along);
  const pad=Math.min(40,extent*.1),lo=Math.max(0,Math.floor(line.lo-pad)),hi=Math.min(extent-1,Math.ceil(line.hi+pad));
  let best=null;
  for(let normal=Math.max(0,Math.round(line.normal)-16);normal<=Math.min(normalExtent-1,Math.round(line.normal)+16);normal++){
    let start=null,last=null,count=0;
    const finish=()=>{
      if(start==null||last-start<line.length*.65||count/(last-start+1)<.85)return;
      const overlap=Math.max(0,Math.min(last,line.hi)-Math.max(start,line.lo));
      const score=overlap-.25*Math.abs(normal-line.normal);
      if(!best||score>best.score)best={normal,lo:start,hi:last,score};
    };
    for(let p=lo;p<=hi;p++){
      if(ink(p,normal)){if(start==null)start=p;last=p;count++;}
      else if(last!=null&&p-last>2){finish();start=last=null;count=0;}
    }
    finish();
  }
  return best;
}

function matchTickRows(r,axis,fitted,ticks){
  // Match the complete ordered tick set, not independent small windows around
  // guessed positions. A wrong scale can put upper ticks tens of pixels away.
  const offsets=ticks.map(t=>[t.lo-axis.normal,t.hi-axis.normal]);
  const lo=Math.round(fitted.normal+Math.min(...offsets.map(p=>p[0])));
  const hi=Math.round(fitted.normal+Math.max(...offsets.map(p=>p[1])));
  const peaks=[];let run=null;
  for(let position=fitted.lo;position<=fitted.hi;position++){
    let count=0;
    for(let cross=lo;cross<=hi;cross++){
      if(Math.abs(cross-fitted.normal)<1.5)continue;
      if(axis.dim===0?dark(r,position,cross):dark(r,cross,position))count++;
    }
    if(count>=2){
      if(!run)run={sum:0,weight:0,first:position,last:position};
      run.sum+=position*count;run.weight+=count;run.last=position;
    }else if(run){if(run.last-run.first<=4)peaks.push(run.sum/run.weight);run=null;}
  }
  if(run&&run.last-run.first<=4)peaks.push(run.sum/run.weight);
  if(peaks.length!==ticks.length)return null; // ambiguous: do not guess missing ticks
  const ordered=ticks.slice().sort((a,b)=>a.normal-b.normal);
  return ordered.map((tick,i)=>({tick,position:peaks[i]}));
}

function endpointInk(r,o,x,y){
  const hex=o.style?.stroke;if(!/^#[0-9a-f]{6}$/i.test(hex||''))return false;
  const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),v=[c[0]-c[1],c[2]-c[1]],n=Math.hypot(...v);
  let support=0;
  for(let py=Math.floor(y)-4;py<=Math.ceil(y)+4;py++)for(let px=Math.floor(x)+1;px<=Math.ceil(x)+10;px++){
    if(px<0||py<0||px>=r.w||py>=r.h)continue;
    const i=(py*r.w+px)*3,p=[...r.rgb.subarray(i,i+3)],u=[p[0]-p[1],p[2]-p[1]],m=Math.hypot(...u);
    const on=n<35?Math.min(...p)>45&&Math.max(...p)<210&&m<25:
      m>35&&(u[0]*v[0]+u[1]*v[1])/(m*n)>.98;
    if(on&&++support>=2)return true;
  }
  return false;
}

export function groundSceneAxes(scene,raster){
  const {w,h}=raster,objects=scene.objects.map(o=>structuredClone(o));
  // Only this source-grounding pass may author equality constraints. Do not
  // trust copied model metadata from an earlier render or another coordinate space.
  for(const o of objects)delete o.endpointAnchors;
  const lines=scene.objects.map(o=>lineOf(o,w,h)).filter(Boolean),byId=new Map(objects.map(o=>[o.id,o])),reports=[];
  for(const axis of lines.filter(l=>l.length>Math.min(w,h)*.45)){
    const ticks=lines.filter(t=>t.dim!==axis.dim&&t.length>=2&&t.length<=12&&
      Math.min(Math.abs(t.lo-axis.normal),Math.abs(t.hi-axis.normal))<3&&t.normal>=axis.lo-axis.length*.2&&t.normal<=axis.hi+axis.length*.2);
    if(ticks.length<3)continue;
    const fitted=fitAxis(raster,axis);if(!fitted)continue;
    const globalMatches=matchTickRows(raster,axis,fitted,ticks);
    const grounded=globalMatches||[],scale=(fitted.hi-fitted.lo)/axis.length;
    for(const tick of globalMatches?[]:ticks){
      const expected=fitted.lo+(tick.normal-axis.lo)*scale;
      // Search only within the declared short tick primitive, excluding the
      // long axis itself. Require at least two supporting source pixels.
      const offset=fitted.normal-axis.normal;
      const a=Math.round(tick.lo+offset),b=Math.round(tick.hi+offset);
      let best=null;
      for(let position=Math.round(expected)-14;position<=Math.round(expected)+14;position++){
        let count=0;
        for(let cross=a;cross<=b;cross++){
          if(Math.abs(cross-fitted.normal)<1.5)continue;
          if(axis.dim===0?dark(raster,position,cross):dark(raster,cross,position))count++;
        }
        const score=count-.035*Math.abs(position-expected);
        if(count>=2&&(!best||score>best.score))best={position,score};
      }
      if(best)grounded.push({tick,position:best.position});
    }
    // Commit only coherent, one-to-one tick matches. A failed tick grounding
    // must not leave a partially moved axis with its old tick coordinates.
    const sorted=grounded.slice().sort((a,b)=>a.tick.normal-b.tick.normal);
    if(grounded.length!==ticks.length||sorted.some((p,i)=>i&&p.position<=sorted[i-1].position+2))continue;
    const axisObject=byId.get(axis.id);
    axisObject.points=axisObject.points.map((p,i)=>{
      const q=p.slice(),forward=axisObject.points[0][axis.dim]<=axisObject.points[1][axis.dim];
      q[axis.dim]=((i===0)===forward?fitted.lo:fitted.hi)*1000/(axis.dim===0?w:h);
      q[1-axis.dim]=fitted.normal*1000/(axis.dim===0?h:w);return q;
    });
    const pairs=[];
    for(const {tick,position} of grounded){
      const obj=byId.get(tick.id),delta=position-tick.normal,offset=fitted.normal-axis.normal;
      obj.points=obj.points.map(p=>{
        const q=[p[0]*w/1000,p[1]*h/1000];q[axis.dim]+=delta;q[1-axis.dim]+=offset;
        return [q[0]/w*1000,q[1]/h*1000];
      });
      const labels=scene.objects.filter(o=>o.kind==='text'&&numeric(o.text)&&o.at).map(o=>{
        const p=[o.at[0]*w/1000,o.at[1]*h/1000];
        return {o,along:Math.abs(p[axis.dim]-tick.normal),across:Math.abs(p[1-axis.dim]-axis.normal)};
      }).filter(l=>l.along<5&&l.across>3&&l.across<40).sort((a,b)=>a.along-b.along||a.across-b.across);
      if(labels.length){
        const label=byId.get(labels[0].o.id),p=[label.at[0]*w/1000,label.at[1]*h/1000];
        p[axis.dim]+=delta;p[1-axis.dim]+=offset;label.at=[p[0]/w*1000,p[1]/h*1000];
        pairs.push({tickId:tick.id,labelId:label.id,value:label.text,beforePixel:tick.normal,pixel:position});
      }
    }
    // Ground full-span smooth-curve x domains to the same measured x axis.
    // Never warp y values or observed scatter/line data using a guessed scale.
    if(axis.dim===0)for(const o of objects){
      if(o.kind!=='path'||o.frameAnchor||!['smooth','bezier'].includes(o.connection)||o.closed||o.marker?.shape&&o.marker.shape!=='none')continue;
      const points=o.points||(o.start&&o.segments?[o.start,...o.segments.map(s=>s[2])]:[]);
      if(points.length<2||Math.abs(points[0][0]*w/1000-axis.lo)>12||Math.abs(points.at(-1)[0]*w/1000-axis.hi)>12)continue;
      const map=p=>[(fitted.lo+(p[0]*w/1000-axis.lo)*scale)/w*1000,p[1]];
      if(o.points)o.points=o.points.map(map);if(o.start)o.start=map(o.start);if(o.segments)o.segments=o.segments.map(s=>s.map(map));
      o.frameAnchor={axisId:axis.id,source:'measured-axis-line'};
    }
    reports.push({axisId:axis.id,direction:axis.dim===0?'x':'y',source:'source-pixel-line-fit',before:axis,after:fitted,ticks:pairs});
  }
  // Bind a model-declared endpoint/tick coincidence to the VERIFIED source
  // tick, only when that series colour supports the meeting point. Do not
  // hard-code a value such as 0.5 or snap arbitrary nearby endpoints.
  for(const report of reports.filter(r=>r.direction==='y'))for(const original of scene.objects){
    if(original.kind!=='path'||!['smooth','bezier'].includes(original.connection)||original.closed||original.marker?.shape&&original.marker.shape!=='none')continue;
    const first=original.points?.[0]||original.start;if(!first)continue;
    const x=first[0]*w/1000,y=first[1]*h/1000;
    if(Math.abs(x-report.before.normal)>6)continue;
    const tick=report.ticks.find(t=>Math.abs(t.beforePixel-y)<=2);
    if(!tick||!endpointInk(raster,original,report.after.normal,tick.pixel))continue;
    const o=byId.get(original.id),at=[report.after.normal/w*1000,tick.pixel/h*1000];
    const next=o.points?.[1]||o.segments?.[0]?.[2];if(next&&at[0]>=next[0])continue;
    const old=o.points?.[0]||o.start,dx=at[0]-old[0],dy=at[1]-old[1];
    if(o.points)o.points[0]=at;
    else {o.start=at;o.segments[0][0]=[o.segments[0][0][0]+dx,o.segments[0][0][1]+dy];}
    o.endpointAnchors={start:{at,axisId:report.axisId,tickId:tick.tickId,value:tick.value,source:'verified-source-tick-and-colour'}};
  }
  return {...scene,objects,coordinateAnchors:reports};
}
