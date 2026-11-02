import assert from 'node:assert/strict';
import {normalizeCoordinates} from '../src/lib/figure/coordinates';
import {parseBodySafe,buildDocument} from '../src/lib/figure/bridge';
import {validateTextFigure} from '../src/lib/figure/text-validation';
import {meanValueDocument} from './fixtures/mean-value.mjs';
const request='生成一个表示拉格朗日中值定理的示意图';
const bad=meanValueDocument(false),good=meanValueDocument(true);
const figure=parseBodySafe(bad)!;
assert.deepEqual(figure.parseErrors,[]);
assert.equal(figure.elements.filter(e=>e.kind==='line').length,2,'chord and tangent must both survive');
assert.equal(figure.elements.filter(e=>e.kind==='circle').length,3);
assert.equal(figure.elements.filter(e=>e.kind==='node').length,2);
assert.equal(validateTextFigure(bad,request).ok,false,'a formula is not a valid geometric witness');
const valid=validateTextFigure(good,request);assert.equal(valid.ok,true,JSON.stringify(valid));
const saved=buildDocument(parseBodySafe(good)!);
assert.equal(validateTextFigure(saved,request).ok,true,'save/reopen retains the witness: '+JSON.stringify(validateTextFigure(saved,request))+'\n'+saved);
assert.equal(validateTextFigure(good.replace('1.930875+1.365*(5.6-2.95)','1.930875'),request).ok,false,'horizontal tangent rejected');
const cubic=String.raw`\begin{tikzpicture}
\draw plot[domain=0:2] (\x,{\x^3});
\draw (0,0) -- (2,8);
\fill ({sqrt(4/3)},{(sqrt(4/3))^3}) circle (2pt);
\draw (1,{(sqrt(4/3))^3+4*(1-sqrt(4/3))}) -- (1.5,{(sqrt(4/3))^3+4*(1.5-sqrt(4/3))});
\end{tikzpicture}`;
assert.equal(validateTextFigure(cubic,request).ok,true,'not tied to quadratic example');
assert.equal(normalizeCoordinates(String.raw`\draw ({min(2,3)},{sin(90)+sqrt(4)}) -- (1e-3,-2);`),String.raw`\draw (2,3) -- (0.001,-2);`);
const text=String.raw`\node at (1,2) {text (3,4) and $f(2,3)$};`;
assert.equal(normalizeCoordinates(text),text,'do not rewrite prose/math labels');
for(const statement of [String.raw`\node at (unknown,1) {x};`,String.raw`\draw (0,0) -- ({1/0},1);`,String.raw`\draw plot (\x,{unknown(\x)});`,String.raw`\draw (0,0) to[out=30,in=20] (1,1);`]){
  const doc=String.raw`\begin{tikzpicture}`+'\n'+String.raw`\draw (0,0) rectangle (1,1);`+'\n'+statement+'\n'+String.raw`\end{tikzpicture}`;
  assert.equal(validateTextFigure(doc,'draw').ok,false,statement);
}
console.log('expression coordinates, primitive retention, save/reopen, invalid math, quadratic/cubic MVT witnesses passed');
