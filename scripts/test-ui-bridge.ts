import { parseBodySafe, buildDocument } from "../src/lib/figure/bridge";

let failed = 0;
const ok = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (detail === undefined ? "" : " :: " + JSON.stringify(detail))); }
};

const source = String.raw`\begin{tikzpicture}[>=stealth, line width=0.9pt, font=\fontsize{17.641}{21.169}\selectfont]
  \useasboundingbox (0,0) rectangle (12,4.2);
  \node (n1) at (2,2) {$A$};
  \node (n2) at (6,2) {$X$};
  \draw[->] (n1.east) -- (n2.west);
\end{tikzpicture}`;

const first = parseBodySafe(source);
ok("document parses through the UI bridge", !!first, first);
if (first) {
  const nodes = first.elements.filter((element) => element.kind === "node");
  const lines = first.elements.filter((element) => element.kind === "line");
  ok("picture font is inherited", nodes.length === 2 && nodes.every((node: any) => Math.abs(node.fontSize - 17.641) < 1e-6), nodes);
  ok("picture line width is inherited", lines.length === 1 && Math.abs((lines[0] as any).style.lineWidth - 0.9) < 1e-6, lines);

  const firstLine = lines[0] as any;
  const rebuilt = buildDocument(first);
  const second = parseBodySafe(rebuilt);
  const secondLine = second?.elements.find((element) => element.kind === "line") as any;
  ok("arrow endpoints survive one save/reopen", !!secondLine && Math.abs(secondLine.from.x - firstLine.from.x) < 0.001 && Math.abs(secondLine.to.x - firstLine.to.x) < 0.001, { firstLine, secondLine });
}

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
