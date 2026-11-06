import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
let runtime;
/** Bundle the same pure TypeScript parser used by the canvas. Do not maintain
 * a second, more permissive server-side approximation of canvas support. */
async function getRuntime(){
  runtime??=build({entryPoints:[fileURLToPath(new URL('../src/lib/figure/text-validation.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'})
    .then(result=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')))
    .catch(e=>{runtime=null;throw e;});
  return runtime;
}
export async function validateTextFigure(source,request,canvasMode){return (await getRuntime()).validateTextFigure(source,request,canvasMode);}
export async function compileComposition(plan){return (await getRuntime()).compileComposition(plan);}
