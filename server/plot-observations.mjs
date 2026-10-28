/** Fit a finite set of model-identified objects to image evidence.
 * No skeletons, contour walking or curve samples: outputs are disc parameters,
 * straight-axis endpoints and one reference-line/dash-pattern parameter set.
 */
import { MAX_OBSERVATIONS } from './series-geometry.mjs';

const median=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];
const rgb=hex=>/^#[0-9a-f]{6}$/i.test(hex || '') ? [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)) : null;

export function fitPrintedMarkers(raster, series, options = {}) {
  if(series.markerFit) return series;
  if(series.marker?.shape!=='circle' || series.marker.filled===false || series.role==='reference') return series;
  const color=rgb(series.color || series.style?.stroke);
  if(!color || Math.max(...color)-Math.min(...color)<45) return series;
  const {w,h}=raster, mask=new Uint8Array(w*h), core=new Uint8Array(w*h);
  for(let i=0;i<mask.length;i++) {
    const bounds=options.bounds;
    if(bounds && (i%w<bounds.x0||i%w>bounds.x1||Math.floor(i/w)<bounds.y0||Math.floor(i/w)>bounds.y1))continue;
    const p=raster.rgb.subarray(i*3,i*3+3);
    if(Math.max(...p)-Math.min(...p)>40 && Math.hypot(...color.map((c,k)=>c-p[k]))<90) mask[i]=1;
  }
  // A small disk erosion removes the thin connectors, leaving filled marker
  // interiors. Each interior is reduced to its centroid/covariance (disc fit).
  const erode=Math.max(1,Math.min(3,Math.floor((series.marker.radiusPx || 4)/3)));
  const offsets=[];
  for(let dy=-erode;dy<=erode;dy++) for(let dx=-erode;dx<=erode;dx++) if(dx*dx+dy*dy<=erode*erode) offsets.push([dx,dy]);
  for(let y=erode;y<h-erode;y++) for(let x=erode;x<w-erode;x++) {
    if(mask[y*w+x] && offsets.every(([dx,dy])=>mask[(y+dy)*w+x+dx])) core[y*w+x]=1;
  }
  const objects=[];
  for(let start=0;start<core.length;start++) {
    if(!core[start]) continue;
    const todo=[start]; core[start]=0;
    let sx=0,sy=0,sxx=0,syy=0,sxy=0,x0=w,x1=0,y0=h,y1=0;
    for(let j=0;j<todo.length;j++) {
      const p=todo[j],x=p%w,y=Math.floor(p/w);sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const xx=x+dx,yy=y+dy,q=yy*w+xx;
        if(xx>=0&&xx<w&&yy>=0&&yy<h&&core[q]){core[q]=0;todo.push(q);}
      }
    }
    const n=todo.length,cx=sx/n,cy=sy/n,vx=sxx/n-cx*cx,vy=syy/n-cy*cy,cov=sxy/n-cx*cy;
    const trace=vx+vy,disc=Math.hypot(vx-vy,2*cov),ratio=(trace+disc)/Math.max(0.1,trace-disc);
    const radius=Math.sqrt(n/Math.PI)+erode;
    if(n<6 || ratio>2 || radius<2 || radius>18 || n/((x1-x0+1)*(y1-y0+1))<0.5) continue;
    objects.push({cx,cy,radius});
  }
  if(objects.length<2 || objects.length>MAX_OBSERVATIONS) return series;
  const r=median(objects.map(o=>o.radius));
  const kept=objects.filter(o=>o.radius>=r*0.65 && o.radius<=r*1.45).sort((a,b)=>a.cx-b.cx);
  if(kept.length<2 || kept.some((o,i)=>i && o.cx-kept[i-1].cx<r)) return series;
  const points=kept.map(o=>[o.cx/w*1000,o.cy/h*1000]);
  const landmarks=points.map((p,i)=>({id:series.id+'-observation-'+i,kind:i===0?'left-end':i===points.length-1?'right-end':
    p[1]>points[i-1][1] && p[1]>points[i+1][1]?'minimum':p[1]<points[i-1][1] && p[1]<points[i+1][1]?'maximum':'observation',point:p,confidence:0.99}));
  return {...series,points,landmarks:landmarks.filter(l=>l.kind!=='observation'),expectedPointCount:points.length,
    marker:{...series.marker,radiusPx:r},markerFit:{method:'analytic-disc-moments',count:points.length,modelCount:series.points.length},geometry:undefined};
}

export function fitReferenceLine(raster,series) {
  if(series.referenceFit) return series;
  const color=rgb(series.color || series.style?.stroke);
  if(series.role!=='reference' || !color || series.points.length!==2 || Math.abs(series.points[0][1]-series.points[1][1])>50) return series;
  const {w,h}=raster, prior=series.points[0][1]/1000*h;
  const score=new Float64Array(h);
  const isInk=(x,y)=>{const p=raster.rgb.subarray((y*w+x)*3,(y*w+x)*3+3);return Math.hypot(...color.map((c,k)=>c-p[k]))<45;};
  for(let y=Math.max(0,Math.floor(prior-h*0.15));y<Math.min(h,prior+h*0.15);y++) for(let x=0;x<w;x++) if(isInk(x,y))score[y]++;
  const peak=Math.max(...score);
  if(peak<w*0.25) return series;
  const rows=Array.from(score.keys()).filter(y=>score[y]>=peak*0.8);
  const cy=rows.reduce((sum,y)=>sum+y*score[y],0)/rows.reduce((sum,y)=>sum+score[y],0);
  const row=Math.round(cy),runs=[];let start=-1;
  for(let x=0;x<=w;x++) {
    const on=x<w && isInk(x,row);
    if(on && start<0) start=x;
    if(!on && start>=0){if(x-start>=3)runs.push([start,x-1]);start=-1;}
  }
  if(!runs.length) return series;
  const lengths=runs.map(([a,b])=>b-a+1).sort((a,b)=>a-b);
  const on=lengths[Math.floor((lengths.length-1)*0.8)];
  const gaps=runs.slice(1).map((p,i)=>p[0]-runs[i][1]-1).filter(n=>n>Math.max(1,on*0.25));
  return {...series,points:[[runs[0][0]/w*1000,cy/h*1000],[runs.at(-1)[1]/w*1000,cy/h*1000]],
    width:rows.length,dashOnPx:series.dash==='dashed' && gaps.length?on:undefined,dashOffPx:series.dash==='dashed' && gaps.length?median(gaps):undefined,
    referenceFit:{method:'horizontal-line-fit'},geometry:undefined};
}

export function measureOpenAxes(raster,horizontal) {
  if(!horizontal) return [];
  const {w,h}=raster;
  let best=null;
  for(let x=Math.max(0,horizontal.x0-5);x<=Math.min(w-1,horizontal.x0+5);x++) {
    let start=-1;
    for(let y=0;y<=Math.min(h-1,horizontal.y+2);y++) {
      const i=(y*w+x)*3,on=raster.rgb[i]<100 && raster.rgb[i+1]<100 && raster.rgb[i+2]<100;
      if(on && start<0)start=y;
      if((!on || y===horizontal.y+2) && start>=0){const end=y-1;if(!best || end-start>best.y1-best.y0)best={x,y0:start,y1:end};start=-1;}
    }
  }
  if(!best || best.y1-best.y0<h*0.25 || Math.abs(best.y1-horizontal.y)>5) return [];
  const style={stroke:'#000000',width:1};
  return [{kind:'line',role:'axis',x1:horizontal.x0/w*1000,y1:horizontal.y/h*1000,x2:horizontal.x1/w*1000,y2:horizontal.y/h*1000,style},
    {kind:'line',role:'axis',x1:best.x/w*1000,y1:best.y0/h*1000,x2:best.x/w*1000,y2:horizontal.y/h*1000,style}];
}
