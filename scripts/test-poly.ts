import { parseBody } from "../src/lib/figure/parse";
import { generateBody } from "../src/lib/figure/generate";

const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\begin{document}
\begin{tikzpicture}
\draw[thick] (0,0) -- (3,0) -- (3,3) -- (0,3) -- cycle;
\draw[thick] (0,3) -- (1,4) -- (4,4) -- (3,3);
\draw[thick] (3,0) -- (4,1) -- (4,4);
\draw[dashed] (0,0) -- (1,1) -- (1,4);
\draw[dashed] (1,1) -- (4,1);
\node at (2,-0.9) {正方体};
\end{tikzpicture}
\end{document}`;

const fig = parseBody(DOC);
console.log("elements:", fig.elements.map((e: any) => e.kind + (e.closed ? "(closed)" : "")).join(", "));
const polys = fig.elements.filter((e: any) => e.kind === "poly") as any[];
console.log("points:", polys.map((p) => p.points.length).join(","));
console.log("--- regenerated ---");
console.log(generateBody(fig));
