import { parseBody } from "../src/lib/figure/parse";
import { buildDocument, generateBody } from "../src/lib/figure/generate";
import { lintTikz } from "../server/lint.mjs";

const S = (name: string, body: string) => ({ name, doc: `\\documentclass[tikz,border=8pt]{standalone}
\\usepackage{ctex}
\\usepackage{amsmath}
\\usepackage{pgfplots}
\\pgfplotsset{compat=1.18}
\\begin{document}
\\begin{tikzpicture}
${body}
\\end{tikzpicture}
\\end{document}` });

const cases = [
  S("pgfplots addplot", `\\addplot[domain=-3.14:3.14, samples=200]{cos(sin(x))};`),
  S("deg() expression", `% y = cos(deg(sin(x))*pi/180)
\\draw[blue] plot[domain=-3:3, samples=100] (\\x, {cos(deg(sin(\\x)))});`),
  S("manual tick arrows", `\\draw[->, thick] (-3.6,0) -- (3.6,0) node[right] {$x$};
\\draw[->, thick] (0,0) -- (0,1.4) node[above] {$y$};
\\draw[->, thick] (-0.05,0.5) -- (0,0.5) node[right] {$0.5$};
\\draw[->, thick] (-0.05,1) -- (0,1) node[right] {$1$};
\\draw[->, thick] (-3.142,-0.025) -- (-3.142,0) node[above] {$-\\pi$};`),
  S("variable \\t", `% y = sin(t)
\\draw plot[domain=0:3, samples=50] (\\t, {sin(\\t r)});`),
  S("plot function{}", `\\draw[blue] plot[domain=0:3, samples=50] function{sin(x)};`),
  S("unsupported \\path", `\\path[draw] (0,0) -- (1,1);`),
  S("samples at={}", `% y = x*x
\\draw plot[domain=0:2] (\\x, {\\x*\\x});`),
];

export function run() {
  const rows: any[] = [];
  for (const c of cases) {
    const fig = parseBody(c.doc);
    const kinds = fig.elements.map((e) => e.kind + (e.kind === "plot" && (e as any).exprError ? "(invalid)" : ""));
    const rebuilt = generateBody(fig);
    const keptCurve = /plot|addplot/.test(rebuilt);
    const lint = lintTikz(c.doc, { request: "" });
    rows.push({
      scenario: c.name,
      elements: kinds.join("+") || "(none)",
      axes: fig.elements.filter((e) => e.kind === "axes").length,
      curves: fig.elements.filter((e) => e.kind === "plot").length,
      curveSurvives: keptCurve,
      lint: lint.issues.map((i) => i.code).join(",") || "-",
      rebuiltHasDroppedComment: rebuilt.includes("表达式无有效采样点"),
    });
  }
  console.table(rows);
  return rows;
}

run();
