import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";

// the exact shape the model produced in the user's screenshot
const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\begin{document}
\begin{tikzpicture}[line cap=round, line join=round]
\tikzset{
  edge/.style = {line width=0.6pt},
  hidden/.style = {dashed, line width=0.5pt}
}
\coordinate (A) at (1.0, 0.6);
\coordinate (B) at (5.0, 0.6);
\coordinate (C) at (5.0, 4.6);
\coordinate (D) at (1.0, 4.6);
\coordinate (E) at (3.4, 2.4);
\coordinate (F) at (7.4, 2.4);
\coordinate (G) at (7.4, 6.4);
\coordinate (H) at (3.4, 6.4);
\draw[hidden] (E) -- (A);
\draw[hidden] (E) -- (F);
\draw[hidden] (E) -- (H);
\draw[edge] (A) -- (B);
\draw[edge] (B) -- (C);
\draw[edge] (C) -- (D);
\draw[edge] (D) -- (A);
\draw[edge] (B) -- (F);
\draw[edge] (C) -- (G);
\draw[edge] (D) -- (H);
\draw[edge] (F) -- (G);
\draw[edge] (G) -- (H);
\node at (4.2, -0.6) {正方体};
\end{tikzpicture}
\end{document}`;

const fig = parseBody(DOC);
console.log("elements:", fig.elements.length, "->", fig.elements.map((e: any) => e.kind).join(","));
const lines = fig.elements.filter((e: any) => e.kind === "line") as any[];
console.log("dashed lines:", lines.filter((l) => l.style.dashed).length, "/", lines.length);
console.log("first line:", JSON.stringify(lines[0] && { from: lines[0].from, to: lines[0].to, dashed: lines[0].style.dashed }));
console.log("--- regenerated (head) ---");
console.log(buildDocument(fig).split("\n").slice(0, 16).join("\n"));
