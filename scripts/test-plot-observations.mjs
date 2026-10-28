import assert from 'node:assert/strict';
import { fitPrintedMarkers, fitReferenceLine, measureOpenAxes } from '../server/plot-observations.mjs';
const raster={w:400,h:400,rgb:new Uint8Array(400*400*3).fill(255)};
const put=(x,y,c)=>{if(x>=0 && x<400 && y>=0 && y<400)raster.rgb.set(c,(y*400+x)*3);};
const points=Array.from({length:11},(_,i)=>[60+i*27,i%2?240+i*2:110-i*2]);
for(let i=1;i<points.length;i++) {
  const a=points[i-1],b=points[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]));
  for(let k=0;k<=n;k++)put(Math.round(a[0]+(b[0]-a[0])*k/n),Math.round(a[1]+(b[1]-a[1])*k/n),[240,45,30]);
}
for(const [x,y] of points)for(let dy=-7;dy<=7;dy++)for(let dx=-7;dx<=7;dx++)if(dx*dx+dy*dy<=49)put(x+dx,y+dy,[240,45,30]);
for(let x=50;x<=370;x++)put(x,320,[0,0,0]);
for(let y=40;y<=320;y++)put(50,y,[0,0,0]);
for(let x=60;x<=330;x++)if((x-60)%36<24)for(let y=178;y<=183;y++)put(x,y,[204,204,204]);
const series={id:'observations',connection:'linear',color:'#e8402a',marker:{shape:'circle',radiusPx:7,filled:true},points:[[100,100],[200,200]]};
const fit=fitPrintedMarkers(raster,series);
assert.equal(fit.points.length,11,'a finite circle model counts actual markers independently of the model guess');
fit.points.forEach((p,i)=>assert.ok(Math.hypot(p[0]*0.4-points[i][0],p[1]*0.4-points[i][1])<0.6));
assert.equal(fit.expectedPointCount,11);
assert.ok(fit.marker.radiusPx>6 && fit.marker.radiusPx<8);
assert.equal(fitPrintedMarkers(raster,{...series,marker:{shape:'none'}}).points.length,2,'smooth unmarked curves never become observations');
const ref=fitReferenceLine(raster,{id:'zero',role:'reference',color:'#c8c8c8',connection:'linear',dash:'dashed',points:[[100,470],[900,470]]});
assert.ok(Math.abs(ref.points[0][1]*0.4-180.5)<0.1);
assert.equal(ref.dashOnPx,24);
assert.equal(ref.dashOffPx,12);
const axes=measureOpenAxes(raster,{x0:50,x1:370,y:320});
assert.equal(axes.length,2);
assert.equal(axes[1].y1,100);
console.log('analytic marker objects, reference stroke/dash parameters and open-axis line fits passed');
