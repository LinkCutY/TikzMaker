/** Fit a small analytic model against a colour image residual. The image never
 * becomes a traced path: only a named function and 4..6 parameters leave here.
 */
import { fitFamily, familyValue } from './family.mjs';
import { evaluateGeometry } from './series-geometry.mjs';

export function colourDirection(hex) {
  if(!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),n=Math.hypot(r-g,b-g);
  return n>15?[(r-g)/n,(b-g)/n]:null;
}

export function fitAnalyticImage(raster,series,options={}) {
  if(series.connection!=='smooth' || series.marker?.shape!=='none' || series.imageFit) return series;
  const direction=colourDirection(series.color || series.style?.stroke);
  if(!direction) return series;
  const {w,h}=raster,b=options.bounds || {x0:0,y0:0,x1:w-1,y1:h-1};
  const cloud=[];
  for(let y=Math.ceil(b.y0+3);y<=b.y1-3;y++) for(let x=Math.ceil(b.x0+3);x<=b.x1-3;x++) {
    const i=(y*w+x)*3,r=raster.rgb[i],g=raster.rgb[i+1],blue=raster.rgb[i+2],n=Math.hypot(r-g,blue-g);
    if(n<18 || ((r-g)*direction[0]+(blue-g)*direction[1])/n<0.96) continue;
    if((options.legendSamples || []).some(s=>x>=s.x0-4 && x<=s.x1+4 && y>=Math.min(s.y0,s.y1)-8 && y<=Math.max(s.y0,s.y1)+8)) continue;
    cloud.push([x/w*1000,y/h*1000]);
  }
  if(cloud.length<30) return series;
  // Bounded quadrature of the image residual, not a per-column curve tracker.
  const evidence=cloud.filter((_,i)=>i%Math.max(1,Math.ceil(cloud.length/1800))===0);
  const before=Math.sqrt(evidence.reduce((sum,[x,y])=>sum+(evaluateGeometry(series.geometry,x)-y)**2,0)/evidence.length);
  const candidates=['tanhPlateau','genDip','gauss'].map(name=>fitFamily(evidence,name,{
    maxIter:60,initialParams:series.geometry.kind==='family' && series.geometry.fit.family===name ? series.geometry.fit.params : undefined,
  })).filter(f=>f?.ok && f.rmse*h/1000<=3);
  candidates.sort((a,b)=>a.rmse*a.rmse+0.5*a.k-(b.rmse*b.rmse+0.5*b.k));
  const best=candidates[0];
  if(!best || best.rmse>=before-0.1) return series;
  const domain=series.geometry.domain || [series.points[0][0],series.points.at(-1)[0]];
  const heights=Array.from({length:65},(_,i)=>familyValue(best.family,best.params,domain[0]+i*(domain[1]-domain[0])/64));
  if(heights.some(y=>!Number.isFinite(y) || y < -200 || y > 1200)) return series;
  return {...series,geometry:{kind:'family',fit:best,domain,description:'图像残差校正 · '+best.family+' · '+best.k+' 参数'},
    imageFit:{method:'analytic-family-image-loss',parameters:best.k,rmsePx:best.rmse*h/1000,beforeRmsePx:before*h/1000}};
}
