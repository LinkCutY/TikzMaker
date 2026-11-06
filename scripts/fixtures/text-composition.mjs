export const squarePlan={version:1,requirements:[{id:'r1',text:'画一个正方形',objects:['square']}],objects:[{id:'square',kind:'square',at:[1,1],size:2}],constraints:[]};
export const flowPlan={version:1,requirements:[{id:'r1',text:'从输入经过处理到输出',objects:['input','process','output','e1','e2']}],objects:[
  {id:'input',kind:'rect',at:[0,0],width:2,height:1},{id:'process',kind:'rect',at:[4,0],width:2,height:1},{id:'output',kind:'rect',at:[8,0],width:2,height:1},
  {id:'e1',kind:'connector',from:'input',to:'process',style:{arrow:'->'}},{id:'e2',kind:'connector',from:'process',to:'output',style:{arrow:'->'}},
  {id:'t1',kind:'label',at:'input',text:'输入'},{id:'t2',kind:'label',at:'process',text:'处理'},{id:'t3',kind:'label',at:'output',text:'输出'}
],constraints:[{kind:'leftOf',a:'input',b:'process'},{kind:'leftOf',a:'process',b:'output'}]};
export const meanValuePlan={version:1,requirements:[{id:'r1',text:'曲线、割线、内点和与割线平行的切线',objects:['f','a','b','chord','xi','tangent']}],objects:[
  {id:'f',kind:'function',expr:'0.35*(x-1)^2+0.6',domain:[.3,5.6],style:{color:'blue'}},
  {id:'a',kind:'point',on:'f',x:.3},{id:'b',kind:'point',on:'f',x:5.6},
  {id:'chord',kind:'segment',from:'a',to:'b',style:{color:'gray'}},
  {id:'xi',kind:'point',meanValue:{curve:'f',a:.3,b:5.6}},
  {id:'tangent',kind:'tangent',curve:'f',through:'xi',length:4,style:{color:'red'}},
  {id:'label',kind:'label',at:'xi',offset:[0,.4],text:'$\\xi$'}
],constraints:[{kind:'parallel',a:'chord',b:'tangent'},{kind:'onCurve',point:'xi',curve:'f'}]};
