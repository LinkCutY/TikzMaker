import { buildDocument } from "../src/lib/figure/generate";
import { parseBody } from "../src/lib/figure/parse";

// exactly the broken line from the screenshot
const BROKEN = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\usepackage{amsmath}
\begin{document}
\begin{tikzpicture}
\node[anchor=south] at (0,0) {函数 y=\sin(e^x) 的图像};
\end{tikzpicture}
\end{document}`;

const fig = parseBody(BROKEN);
const repaired = buildDocument(fig);
console.log("--- repaired line ---");
console.log(repaired.split("\n").find((l) => l.includes("node")));
process.stdout.write("---DOC---\n" + repaired);
