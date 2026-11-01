/** Locate a proposed multi-row legend using a finite translated swatch template.
 * The result is an exclusion rectangle, never a traced curve. */
import {inkLikelihood} from './stroke-evidence.mjs';
const rgb=c=>/^#[0-9a-f]{6}$/i.test(c||'')?[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)):null;
export function legendEvidenceBoxes(raster,objects){
  const boxes=[];
  for(const legend of objects.filter(o=>o.kind==='legend')){
    const x=legend.at[0]*raster.w/1000,y=legend.at[1]*raster.h/1000,fs=legend.fontSize||12,len=legend.swatchWidth||25,row=legend.rowHeight||fs*1.65;
    const colors=legend.entries.map(e=>rgb(objects.find(o=>o.id===e.seriesId)?.style?.stroke));
    const labelWidth=Math.max(...legend.entries.map(e=>e.text.length))*fs*.6;
    boxes.push([x-4,y-fs,len+12+labelWidth,row*colors.length+fs]);
    if(colors.filter(Boolean).length<2)continue;
    const range=Math.max(12,fs*2),step=Math.max(2,range/12);let best=null;
    for(let dx=-range;dx<=range;dx+=step)for(let dy=-range;dy<=range;dy+=step)for(const factor of [.8,.9,1,1.1,1.2]){
      let sum=0,n=0;
      for(let i=0;i<colors.length;i++)if(colors[i])for(const t of [.15,.3,.45,.6,.75,.85]){
        sum+=inkLikelihood(raster,colors[i],x+dx+t*len,y+dy+i*row*factor)??0;n++;
      }
      const score=n?sum/n:0;
      if(!best||score>best.score)best={dx,dy,factor,score};
    }
    if(best?.score>.35){
      // A line swatch has an interval of equally plausible x translations.
      // Pad that ambiguity instead of letting its uncovered tip become data.
      const pad=Math.max(6,len*.4);
      boxes.push([x+best.dx-pad,y+best.dy-fs,len+labelWidth+12+2*pad,row*best.factor*(colors.length-1)+2*fs]);
    }
  }return boxes;
}
