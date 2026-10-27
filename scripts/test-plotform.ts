import { jsToPgfmath, pgfmathToJs } from "../src/lib/figure/pgfmath";
import { buildDocument, generateBody } from "../src/lib/figure/generate";
import { parseBody } from "../src/lib/figure/parse";
import { defaultStyle, type Figure } from "../src/lib/figure/types";

let fails = 0;
const check = (n: string, c: boolean, e?: unknown) => {
  if (!c) { fails++; console.log("FAIL:", n, JSON.stringify(e)); } else console.log("ok:", n);
};

check("sin(exp(x)) -> pgf", jsToPgfmath("sin(exp(x))").pgf === "sin(exp(\\x) r)", jsToPgfmath("sin(exp(x))"));
check("poly -> pgf", jsToPgfmath("2.4*exp(-0.55*x)+0.25").pgf === "2.4*exp(-0.55*\\x)+0.25", jsToPgfmath("2.4*exp(-0.55*x)+0.25"));
check("abs -> pgf", jsToPgfmath("abs(x)").pgf === "abs(\\x)", jsToPgfmath("abs(x)"));
check("unsupported rejected", !jsToPgfmath("foo(x)").ok);

const back = pgfmathToJs("sin(exp(\\x) r)");
check("round trip expr", back.ok && back.expr === "sin(exp(x))", back);

const base = defaultStyle();
const fig: Figure = {
  elements: [
    { id: "a", kind: "axes", name: "坐标轴 1", origin: { x: 0, y: 0 }, xMin: -0.5, xMax: 6, yMin: -1.5, yMax: 1.5, xLabel: "x", yLabel: "y", tickStep: 1, showTicks: true, style: { ...base, thickness: "thick", arrow: "->" } },
    { id: "p", kind: "plot", name: "函数 1", expr: "sin(exp(x))", xMin: -0.5, xMax: 5.5, samples: 400, offset: { x: 0, y: 0 }, style: { ...base, color: "blue", thickness: "very thick" } },
  ],
};

const body = generateBody(fig);
const plotLine = body.split("\n").find((l) => l.includes("plot[")) ?? "";
console.log("emitted:", plotLine);
check("uses domain form", /plot\[domain=-0\.5:5\.5, samples=400, smooth\]/.test(plotLine), plotLine);
check("no coordinates", !plotLine.includes("coordinates"));

const re = parseBody(body);
const p: any = re.elements.find((e: any) => e.kind === "plot");
check("re-parse expr", p?.expr === "sin(exp(x))", p?.expr);
check("re-parse domain", p?.xMin === -0.5 && p?.xMax === 5.5, [p?.xMin, p?.xMax]);
check("re-parse samples", p?.samples === 400, p?.samples);

process.stdout.write("---DOC---\n" + buildDocument(fig));
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
