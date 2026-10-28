import assert from 'node:assert/strict';
import { validateScene,compileScene,monotoneCubics } from '../server/scene.mjs';
const source={type:'mixed',objects:[
 {id:'jump',kind:'path',connection:'linear',points:[[10,30],[50,30],[50,80],[100,60]],style:{stroke:'#663399',width:2},marker:{shape:'square',radiusPx:3,filled:false},expectedMarkers:4},
 {id:'smooth',kind:'path',connection:'smooth',points:[[120,600],[180,500],[220,500],[300,550]],style:{stroke:'#119922'}},
 {id:'region',kind:'path',connection:'bezier',start:[50,900],segments:[[[90,850],[200,800],[300,700]],[[200,900],[100,900],[50,900]]],closed:true,style:{stroke:'#888888',fill:'#aaddff'},z:0},
 {id:'legend',kind:'legend',at:[200,150],entries:[{seriesId:'jump',text:'$\\alpha$'}],fontSize:12},
 {id:'left-zero',kind:'text',at:[10,950],text:'0',fontSize:14},
 {id:'bottom-zero',kind:'text',at:[60,990],text:'0',fontSize:14},
 {id:'cell',kind:'rect',box:[600,100,200,200],style:{stroke:'#000000',fill:'#ffff00'}},
]};
assert.equal(validateScene(source).ok,true);
const {code}=compileScene(source,{width:500,height:400});
assert.equal((code.match(/\{0\};/g)||[]).length,2,'equal labels at different locations survive');
assert.equal((code.match(/% object/g)||[]).length,source.objects.length);
assert.ok(code.includes('rectangle (16,12.8)'),'source aspect preserved');
assert.ok(code.includes('\\alpha'),'atomic legend text retained');
assert.equal(code.split('% object jump')[1].split('% object smooth')[0].includes('controls'),false,'no smooth substitution for vertical jump');
const check=change=>validateScene({...source,objects:change(structuredClone(source.objects))});
assert.equal(check(a=>(a[0].connection='smooth',a)).ok,false,'smooth jump must not silently bridge');
assert.equal(check(a=>(a[0].expectedMarkers=3,a)).ok,false);
assert.equal(check(a=>(a[3].entries[0].seriesId='missing',a)).ok,false);
assert.equal(check(a=>(a[0].points=Array.from({length:500},(_,i)=>[i,i]),a)).ok,false,'no dense traced paths');
const cubic=(a,b,c,d,t)=>(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;
for(const points of [[[0,0],[20,80],[50,81],[100,100]],[[0,100],[40,30],[80,50],[100,50]]]){
 const segs=monotoneCubics(points);
 for(let i=0;i<segs.length;i++)for(let t=0;t<=1;t+=.01){const y=cubic(points[i][1],segs[i][0][1],segs[i][1][1],segs[i][2][1],t);assert.ok(y>=Math.min(points[i][1],points[i+1][1])-1e-8&&y<=Math.max(points[i][1],points[i+1][1])+1e-8);}
}
if(process.env.TEST_SERVER){
 const response=await fetch(process.env.TEST_SERVER+'/api/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:code,engine:'xelatex'})});
 const out=await response.json();assert.ok(out.ok,JSON.stringify(out.errors));
}
console.log('scene: typed jumps/markers/fills/legends/aspect/budgets/monotone bounds passed');
