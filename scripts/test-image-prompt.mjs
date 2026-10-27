import assert from "node:assert/strict";
import { debugPrompt } from "../server/ai.mjs";
import { annotateFunctions, splitBezierChains } from "../server/autofix.mjs";
import { lintTikz } from "../server/lint.mjs";
const prompt = debugPrompt({ mode: "image", perPanel: true, strict: true, canvasMode: true, prompt: "retain blue" });
assert.match(prompt, /ONE cropped panel/);
assert.match(prompt, /HARD CONSTRAINTS/);
assert.match(prompt, /retain blue/);
assert.doesNotMatch(prompt, /at most 40|exactly two draws|One axis pair only/);
const source = String.raw`\documentclass{standalone}
\begin{document}
\begin{tikzpicture}
\draw[blue] plot[domain=0:2] (\x,{exp(-\x)});
\end{tikzpicture}
\end{document}`;
const repaired = annotateFunctions(source);
assert.match(repaired, /% y = exp\(-x\)/);
assert.equal(annotateFunctions(repaired), repaired);
const lint = lintTikz(repaired, { screenshot: true });
assert.ok(!lint.issues.some(i => i.code === "AXIS_MISSING" || i.code === "PLOT_EXPR"));
const chain = String.raw`\draw[blue] (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);`;
const split = splitBezierChains(chain);
assert.equal(split.split("\n").length, 2);
assert.match(split.split("\n")[1], /\(3,1\) \.\. controls/);
assert.equal(splitBezierChains(split), split);
console.log("PASS: image prompt preserves panel/strict flags, no invented axes, metadata repair is local and idempotent.");
