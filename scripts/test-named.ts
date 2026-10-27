import { parseBody } from "../src/lib/figure/parse";
import { generateBody } from "../src/lib/figure/generate";

const FLOW = String.raw`\documentclass[tikz,border=8pt]{standalone}
\begin{document}
\begin{tikzpicture}
\node[draw, rounded corners, fill=blue!10] (in) at (0,0) {输入};
\node[draw, rounded corners, fill=blue!10] (mid) at (4,0) {处理};
\node[draw, rounded corners, fill=orange!15] (out) at (8,0) {输出};
\draw[->, thick] (in) -- (mid);
\draw[->, thick] (mid) -- (out);
\end{tikzpicture}
\end{document}`;

const fig = parseBody(FLOW);
console.log("elements:", fig.elements.map((e) => e.kind + ":" + (e as any).name).join(", "));
const lines = fig.elements.filter((e) => e.kind === "line") as any[];
console.log("resolved lines:", lines.map((l) => `(${l.from.x},${l.from.y})->(${l.to.x},${l.to.y})`).join(" "));
console.log("--- regenerated ---");
console.log(generateBody(fig));
