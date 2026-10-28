/** Finite marker template fitting (centre x/y, radius), not curve digitisation.
 * A projection proposes object centres; a circle/square template must support
 * each one. No raster-derived path or column samples are returned. */
const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)]||0;
export function fitHollowMarkers(raster,object,exclusions=[]){
  if(!['circle','square'].includes(object.marker?.shape)||object.marker.filled!==false||!object.points?.length)return object;
  const hex=object.style?.stroke;if(!/^#[0-9a-f]{6}$/i.test(hex||''))return object;
  const color=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));if(Math.max(...color)-Math.min(...color)<45)return object;
  const {w,h}=raster,xs=object.points.map(p=>p[0]*w/1000),ys=object.points.map(p=>p[1]*h/1000);
  const x0=Math.max(0,Math.floor(Math.min(...xs)-12)),x1=Math.min(w-1,Math.ceil(Math.max(...xs)+12));
  const y0=Math.max(0,Math.floor(Math.min(...ys)-h*.35)),y1=Math.min(h-1,Math.ceil(Math.max(...ys)+h*.35));
  const mask=new Uint8Array(w*h),profile=new Float64Array(w),ranges=Array.from({length:w},()=>[]);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    if(exclusions.some(b=>x>=b[0]&&x<=b[0]+b[2]&&y>=b[1]&&y<=b[1]+b[3]))continue;
    const i=(y*w+x)*3,p=raster.rgb.subarray(i,i+3);
    if(Math.hypot(...color.map((v,j)=>v-p[j]))>85)continue;
    mask[y*w+x]=1;profile[x]++;ranges[x].push(y);
  }
  const base=median([...profile.slice(x0,x1+1)]),peaks=[];
  for(let x=x0;x<=x1;){if(profile[x]<Math.max(3,base+1.5)){x++;continue;}
    const begin=x;while(x<=x1&&profile[x]>=Math.max(3,base+1.5))x++;const end=x-1;
    if(end-begin>45)continue;
    let sum=0,sx=0;for(let j=begin;j<=end;j++){const v=profile[j]-base;sum+=v;sx+=v*j;}
    peaks.push(sx/sum);
  }
  const centres=[];
  for(let i=0;i<peaks.length;i++){
    if(i+1<peaks.length && peaks[i+1]-peaks[i]<=2*(object.marker.radiusPx||4)+4){centres.push((peaks[i]+peaks[++i])/2);}
    else centres.push(peaks[i]);
  }
  const proposals=[];
  for(const x of centres){
    const values=ranges[Math.round(x)]||[];if(!values.length)continue;
    // Search a small family of finite geometric templates, not contours.
    const yCandidates=new Set(values.flatMap(y=>[y-.5,y,y+.5,y-3,y+3,y-6,y+6]));
    let best=null;
    const on=(x,y)=>{x=Math.round(x);y=Math.round(y);return x>=0&&x<w&&y>=0&&y<h&&mask[y*w+x];};
    for(const cy of yCandidates)for(let radius=1.5;radius<=14;radius+=.5){
      let hit=0;
      for(let k=0;k<16;k++){
        const a=k*Math.PI/8;
        const scale=object.marker.shape==='square'?radius/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a))):radius;
        const dx=scale*Math.cos(a),dy=scale*Math.sin(a);
        if(on(x+dx,cy+dy)||on(x+dx*.9,cy+dy*.9)||on(x+dx*1.1,cy+dy*1.1))hit++;
      }
      const score=hit/16;
      if(score>=.75 && (!best||score>best.score||score===best.score&&Math.abs(radius-(object.marker.radiusPx||4))<Math.abs(best.radius-(object.marker.radiusPx||4))))best={x,y:cy,radius,score};
    }
    if(best){
      let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
      for(let yy=Math.floor(best.y-best.radius-1);yy<=best.y+best.radius+1;yy++)for(let xx=Math.floor(best.x-best.radius-1);xx<=best.x+best.radius+1;xx++)if(on(xx,yy)){n++;sx+=xx;sy+=yy;sxx+=xx*xx;syy+=yy*yy;sxy+=xx*yy;}
      const cx=sx/n,cy=sy/n,vx=sxx/n-cx*cx,vy=syy/n-cy*cy,cov=sxy/n-cx*cy,t=vx+vy,d=Math.hypot(vx-vy,2*cov);
      if(n>=6&&(t+d)/Math.max(.1,t-d)<2.5&&Math.hypot(cx-best.x,cy-best.y)<best.radius*.6)proposals.push({...best,x:cx,y:cy});
    }
  }
  const accepted=[];
  for(const p of proposals.sort((a,b)=>b.score-a.score))if(!accepted.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<Math.max(p.radius,q.radius)*2))accepted.push(p);
  if(accepted.length<Math.max(2,object.points.length)||accepted.length>100)return object;
  accepted.sort((a,b)=>a.x-b.x);
  const points=accepted.map(p=>[p.x/w*1000,p.y/h*1000]);
  return {...object,points,expectedMarkers:points.length,marker:{...object.marker,radiusPx:median(accepted.map(p=>p.radius))},fit:{method:'finite-ring-templates',parametersPerObject:3,count:points.length}};
}
