import {pgfmathToJs} from './pgfmath';
import {compileExpr} from './expr';

/** Evaluate constant coordinate expressions using the restricted math parser.
 * Balanced scanning handles nested parentheses, without touching node text or
 * dynamic plot expressions. No eval, macros or arbitrary JavaScript. */
export function normalizeCoordinates(source: string): string {
  let out='',brace=0,bracket=0;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='{'&&source[i-1]!=='\\')brace++;
    if(ch==='}'&&source[i-1]!=='\\')brace--;
    if(ch==='[')bracket++;if(ch===']')bracket--;
    if(ch!=='('||brace||bracket){out+=ch;continue;}
    let depth=1,b=0,comma=-1,end=i+1;
    for(;end<source.length;end++){
      const c=source[end];if(c==='(')depth++;if(c===')'&&!--depth)break;
      if(c==='{')b++;if(c==='}')b--;
      if(c===','&&depth===1&&b===0)comma=end;
    }
    if(end>=source.length){out+=source.slice(i);break;}
    const original=source.slice(i,end+1);
    if(comma<0||/\\x\b/.test(original)){out+=original;i=end;continue;}
    const values=[source.slice(i+1,comma),source.slice(comma+1,end)].map(raw=>{
      let s=raw.trim();while(s.startsWith('{')&&s.endsWith('}'))s=s.slice(1,-1).trim();
      const converted=pgfmathToJs(s),expr=compileExpr(converted.expr);
      return converted.ok&&expr.ok&&!/\bx\b/.test(converted.expr)?expr.fn(0):NaN;
    });
    out+=values.every(Number.isFinite)?'('+values.map(v=>Number(v.toFixed(10))).join(',')+')':original;
    i=end;
  }
  return out;
}
