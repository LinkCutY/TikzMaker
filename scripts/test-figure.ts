import { compileExpr, samplePlot } from "../src/lib/figure/expr";
import { buildDocument, extractBody, generateBody, upsertBody } from "../src/lib/figure/generate";
import { parseBody } from "../src/lib/figure/parse";
import { defaultStyle, type Figure } from "../src/lib/figure/types";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    failures++;
    console.log("FAIL:", name, extra === undefined ? "" : JSON.stringify(extra));
  } else {
    console.log("ok:", name);
  }
}

// ---------- expression ----------
const e1 = compileExpr("2*x+1");
check("expr linear", e1.ok && e1.fn(3) === 7, e1.error);
const e2 = compileExpr("sin(x)");
check("expr sin", e2.ok && Math.abs(e2.fn(Math.PI / 2) - 1) < 1e-9);
const e3 = compileExpr("x^2 - 3*x + 1");
check("expr poly", e3.ok && e3.fn(2) === -1);
const e4 = compileExpr("1/x");
const runs = samplePlot(e4.fn, -2, 2, 200);
check("expr asymptote splits", runs.length >= 2, runs.length);
const e5 = compileExpr("foo(x)");
check("expr rejects unknown", !e5.ok && Boolean(e5.error), e5.error);
const e6 = compileExpr("exp(-x)*cos(3*x)");
check("expr composite", e6.ok && Math.abs(e6.fn(0) - 1) < 1e-9);
check("expr rejects trailing", !compileExpr("x + ").ok);
check("expr constants", compileExpr("pi").ok && Math.abs(compileExpr("pi").fn(0) - Math.PI) < 1e-12);

// ---------- figure round trip ----------
const base = defaultStyle();
const fig: Figure = {
  elements: [
    { id: "1", kind: "line", name: "直线 1", from: { x: 0, y: 0 }, to: { x: 3, y: 2 }, style: { ...base, color: "blue", arrow: "->", thickness: "thick" } },
    { id: "2", kind: "rect", name: "矩形 1", from: { x: 1, y: 1 }, to: { x: 4, y: 3 }, style: { ...base, color: "red", fill: "red!12" }, rounded: 0.15 },
    { id: "3", kind: "circle", name: "圆 1", center: { x: 2, y: 2 }, radius: 0.6, style: { ...base, dashed: true } },
    { id: "4", kind: "ellipse", name: "椭圆 1", center: { x: 5, y: 2 }, rx: 1.2, ry: 0.6, style: base },
    { id: "5", kind: "bezier", name: "曲线 1", p0: { x: 0, y: 0 }, c1: { x: 1, y: 2 }, c2: { x: 3, y: 2 }, p1: { x: 4, y: 0 }, style: base },
    { id: "6", kind: "node", name: "文本 1", at: { x: 2, y: 3.5 }, text: "输入 层", style: base, boxed: true, rounded: 0.15, fontSize: 9, anchor: "center" },
    { id: "7", kind: "axes", name: "坐标轴 1", origin: { x: 0, y: 0 }, xMin: -2, xMax: 5, yMin: -1.5, yMax: 3, xLabel: "t", yLabel: "y", tickStep: 1, showTicks: true, style: { ...base, thickness: "thick", arrow: "->" } },
    { id: "8", kind: "plot", name: "函数 1", expr: "2.4*exp(-0.55*x)+0.25", xMin: 0, xMax: 4.6, samples: 40, offset: { x: 0, y: 0 }, style: { ...base, color: "blue", thickness: "thick" } },
  ],
};

const body = generateBody(fig);
const parsed = parseBody(body);
const kinds = parsed.elements.map((e) => e.kind);
check("roundtrip kind count", parsed.elements.length === fig.elements.length, { got: parsed.elements.length, kinds });

const axes = parsed.elements.find((e) => e.kind === "axes") as any;
check(
  "roundtrip axes with negative halves",
  Boolean(axes) && axes.xMax === 5 && axes.xMin === -2 && axes.yMax === 3 && axes.yMin === -1.5 && axes.xLabel === "t",
  axes
);
const plot = parsed.elements.find((e) => e.kind === "plot") as any;
check("roundtrip plot expr", Boolean(plot) && plot.expr.startsWith("2.4*exp"), plot?.expr);
const node = parsed.elements.find((e) => e.kind === "node") as any;
check("roundtrip node text", Boolean(node) && node.text === "输入 层" && node.boxed, node);
const line = parsed.elements.find((e) => e.kind === "line") as any;
check("roundtrip line style", Boolean(line) && line.style.color === "blue" && line.style.arrow === "->", line?.style);
const rect = parsed.elements.find((e) => e.kind === "rect") as any;
check("roundtrip rect fill", Boolean(rect) && rect.style.fill === "red!12" && rect.rounded > 0, rect);

// ---------- document assembly ----------
const doc = buildDocument(fig);
check("doc has standalone", doc.includes("\\documentclass[tikz,border=10pt]{standalone}"));
check("doc has ctex", doc.includes("\\usepackage{ctex}"));
const extracted = extractBody(doc);
check("doc extractable", extracted === body, extracted === body ? undefined : { exp: JSON.stringify(body.slice(0, 70)), got: JSON.stringify((extracted ?? "").slice(0, 70)), lenExp: body.length, lenGot: (extracted ?? "").length });

const edited = doc.replace("输入 层", "输出 层");
check("upsert after edit keeps text", upsertBody(edited, body) === doc);

const frag = "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
check("upsert replaces block", upsertBody(frag, "\\draw (0,0) -- (2,2);").includes("(2,2)"));
const bare = "\\begin{tikzpicture}\n\\end{tikzpicture}";
const built = upsertBody(bare, "\\node at (0,0) {x};");
check("upsert keeps existing doc", built.startsWith("\\begin{tikzpicture}"));

// minimal TikZ pasted by hand should still be adoptable
const handWritten = "\\draw[thick, red, ->] (0,0) -- (2,1);\n\\node[draw, rounded corners] at (1,1) {A};\n\\draw (0,0) circle (0.5);";
const hand = parseBody(handWritten);
check("parses hand written", hand.elements.length === 3, hand.elements.map((e) => e.kind));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
