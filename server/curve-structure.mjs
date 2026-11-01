/** Structure from finite semantic landmarks, never image contours. */
export function structuralExtrema(points,epsilon=1){
  if(points.length<3)return [];
  const result=[];let previous=0,turnStart=0;
  for(let i=1;i<points.length;i++){
    const dy=points[i][1]-points[i-1][1],sign=Math.abs(dy)<1e-9?0:Math.sign(dy);
    if(!sign)continue;
    if(previous&&sign!==previous){
      const left=turnStart,right=i-1,index=Math.floor((left+right)/2),y=points[index][1];
      // Multi-scale prominence across the adjoining monotone runs. Tiny steps
      // at a broad extremum do not cause rejection of a significant turn.
      let a=left,b=right;
      while(a>0&&previous*(points[a][1]-points[a-1][1])>=0)a--;
      while(b+1<points.length&&sign*(points[b+1][1]-points[b][1])>=0)b++;
      const prominence=Math.min(Math.abs(points[a][1]-y),Math.abs(points[b][1]-y));
      if(prominence>=epsilon)result.push({index,x:points[index][0],y,kind:previous>0?'maximum':'minimum',leftSign:previous,rightSign:sign,prominence});
    }
    previous=sign;turnStart=i;
  }
  return result;
}
