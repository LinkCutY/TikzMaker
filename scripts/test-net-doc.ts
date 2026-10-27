import { parseBody } from "../src/lib/figure/parse";

const layer = (x: number, ys: number[]) => ys.map((y) => `\\draw[thick] (${x},${y}) circle (0.3);`).join("\n");
const link = (x1: number, ys1: number[], x2: number, ys2: number[]) =>
  ys1.flatMap((y1) => ys2.map((y2) => `\\draw[gray!70] (${x1},${y1}) -- (${x2},${y2});`)).join("\n");
const L1 = [1.2, 0, -1.2];
const L2 = [1.8, 0.6, -0.6, -1.8];
const L3 = [0.6, -0.6];
const doc = [
  "\\documentclass[tikz,border=8pt]{standalone}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  link(0, L1, 3, L2),
  link(3, L2, 6, L3),
  layer(0, L1),
  layer(3, L2),
  layer(6, L3),
  "\\node at (3,3) {\\small 三层神经网络结构图};",
  "\\node[below] at (0,-1.9) {输入层};",
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");

const fig = parseBody(doc);
console.log("elements:", fig.elements.length, fig.elements.map((e) => e.kind).join(","));
