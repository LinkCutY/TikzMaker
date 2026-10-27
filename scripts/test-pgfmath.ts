import { pgfmathToJs } from "../src/lib/figure/pgfmath";
import { compileExpr } from "../src/lib/figure/expr";

let fails = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    fails++;
    console.log("FAIL:", name, extra === undefined ? "" : JSON.stringify(extra));
  } else console.log("ok:", name);
}

const r1 = pgfmathToJs("sin(\\x r)");
check("radian suffix kept", r1.ok && near(compileExpr(r1.expr).fn(Math.PI / 2), 1), r1);

const r2 = pgfmathToJs("sin(\\x)");
check("degrees converted", r2.ok && near(compileExpr(r2.expr).fn(90), 1), r2);

const r3 = pgfmathToJs("\\sin(e^\\x)");
check("rejects e^", !r3.ok && /exp/.test(r3.reason || ""), r3);

const r4 = pgfmathToJs("2*exp(-0.55*\\x)+0.25");
check("exp survives", r4.ok && near(compileExpr(r4.expr).fn(0), 2.25), r4);

const r5 = pgfmathToJs("sin(exp(\\x) r)");
check("nested radian", r5.ok && near(compileExpr(r5.expr).fn(0), Math.sin(1)), r5);

const r6 = pgfmathToJs("\\sqrt{\\x}");
check("braced sqrt rejected cleanly", !r6.ok, r6);

const r7 = pgfmathToJs("cos(2*\\x r)+1");
check("scaled radian", r7.ok && near(compileExpr(r7.expr).fn(Math.PI), 2), r7);

const r8 = pgfmathToJs("\\ln(\\x)");
check("ln accepted", r8.ok && near(compileExpr(r8.expr).fn(Math.E), 1), r8);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
