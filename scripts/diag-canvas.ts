import { parseBody } from "../src/lib/figure/parse";
import { bboxOf } from "../src/lib/figure/edit";

const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\usepackage{amsmath}
\begin{document}
\begin{tikzpicture}
\node at (3,3.6) {函数 $y=\sin(e^x)$ 的图像};
\draw[->, thick] (-0.5,0) -- (7,0) node[right] {$x$};
\draw[->, thick] (0,-3) -- (0,3) node[above] {$y$};
% y = sin(exp(x))
\draw[blue, very thick] plot[domain=-0.5:5.5, samples=300, smooth] (\x, {sin(exp(\x) r)});
\end{tikzpicture}
\end{document}`;

const fig = parseBody(DOC);
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const el of fig.elements) {
  const b = bboxOf(el);
  console.log(el.kind.padEnd(6), (el as any).name.padEnd(8), b ? `[${b.x0.toFixed(2)}, ${b.y0.toFixed(2)}] .. [${b.x1.toFixed(2)}, ${b.y1.toFixed(2)}]` : "no bbox", (el as any).expr ? "expr=" + (el as any).expr : "");
  if (b) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
}
console.log("figure bbox:", { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 });
