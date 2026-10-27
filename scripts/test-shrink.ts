import { analyzeSource, shrinkCoordinates, simplifyPoints } from "../server/shrink.mjs";

const pts = Array.from({ length: 520 }, (_, i) => `(${(i * 0.01).toFixed(2)},${Math.sin(i / 20).toFixed(3)})`).join(" ");
const big = [
  "\\documentclass[tikz]{standalone}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "\\draw[blue] plot[domain=0:5, samples=520, smooth] coordinates {" + pts + "};",
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");

const a = analyzeSource(big);
console.log("before:", a.chars, "chars,", a.coords, "points");
const s = shrinkCoordinates(big);
console.log("after :", s.code.length, "chars,", s.after, "points (kept", s.before, "->", s.after + ")")
console.log("max deviation:", (s.maxError ?? 0).toFixed(4), "cm  (= " + ((s.maxError ?? 0) * 72 / 2.54).toFixed(1) + " pt)");

// straight line should collapse to its endpoints
const line = [[0,0],[1,0],[2,0],[3,0],[4,0]];
console.log("collinear 5 ->", simplifyPoints(line, 0.01).length);