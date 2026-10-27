import { lintTikz } from "../server/lint.mjs";

const noPlot = String.raw`\documentclass{standalone}
\begin{document}
\begin{tikzpicture}
\draw[->] (-3,0) -- (3,0) node[right] {$x$};
\node at (0,1) {$\cos(\sin x)$ 的图像};
\end{tikzpicture}
\end{document}`;

const withPlot = String.raw`\documentclass{standalone}
\begin{document}
\begin{tikzpicture}
\draw[->] (-3,0) -- (3,0) node[right] {$x$};
% y = cos(sin(x))
\draw plot[domain=-3:3, samples=200, smooth] (\x, {cos(sin(\x r) r)});
\end{tikzpicture}
\end{document}`;

const addplot = String.raw`\documentclass{standalone}
\begin{document}
\begin{tikzpicture}
\addplot[domain=-3:3, samples=100]{cos(sin(x))};
\end{tikzpicture}
\end{document}`;

for (const [name, src] of [["no plot", noPlot], ["plot", withPlot], ["addplot", addplot]]) {
  const r = lintTikz(src, { request: "画一个 cos(sin x) 的函数图像" });
  console.log(name.padEnd(9), "->", r.issues.map((i) => i.code).join(", ") || "(clean)");
}
