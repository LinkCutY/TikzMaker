// Local logged-model replay, no external model request. Explicitly repairs the
// unit fields in the fixture; production never guesses units from magnitude.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {compileComposition,validateTextFigure} from '../server/text-validation.mjs';
import {compileToPdf} from '../server/latex.mjs';
const path=process.argv[2];if(!path)throw new Error('Pass a local .model.json log');
const log=JSON.parse(await readFile(path,'utf8'));
const original=log.history.at(-1).composition;
await assert.rejects(()=>compileComposition(original),/point marker radius/);
const repaired=structuredClone(original);
for(const o of repaired.objects){if(o.kind==='point'&&o.radius>0.3){o.radiusPt=o.radius;delete o.radius;}}
const built=await compileComposition(repaired);
assert.equal((await validateTextFigure(built.code,'拉格朗日中值定理',true)).ok,true);
const result=await compileToPdf(built.code,{engine:'xelatex'});
assert.equal(result.ok,true,JSON.stringify(result.errors));
await mkdir('.probe-tests',{recursive:true});await writeFile('.probe-tests/replayed-composition.tex',built.code);
console.log('Logged second-round graph compiled with explicit pt units; function layout reference and mathematical witness verified. No external model request.');
