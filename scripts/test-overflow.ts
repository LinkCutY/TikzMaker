import { parseBody } from "../src/lib/figure/parse";

// panel where the curves poke out of the frame (what the model actually wrote)
const INSIDE = String.raw`
\begin{tikzpicture}
\draw (0,0) rectangle (10,6);
\draw plot[domain=0:10, samples=60, smooth] (\x,{3+2*exp(-((\x-5)*(\x-5)/4))});
\end{tikzpicture}`;
const OUTSIDE = String.raw`
\begin{tikzpicture}
\draw (0,0) rectangle (10,6);
\draw plot[domain=0:10, samples=60, smooth] (\x,{4+3*exp(-((\x-5)*(\x-5)/4))});
\end{tikzpicture}`;

for (const [name, src] of [["inside", INSIDE], ["poking out", OUTSIDE]] as const) {
  const fig = parseBody(src);
  const rect = fig.elements.find((e) => e.kind === "rect") as any;
  const plots = fig.elements.filter((e) => e.kind === "plot") as any[];
  console.log(name, "| elements:", fig.elements.length, "| frame h:", rect ? rect.to.y - rect.from.y : "-",
    "| plot max y:", plots.length ? Math.max(...plots.map((p) => p.yMaxHint ?? 0)).toFixed?.(1) ?? "-" : "-");
}