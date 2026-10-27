import { readFileSync, writeFileSync } from "node:fs";
import { detectPanelsFromGray } from "../src/lib/panels";
import { mergePanels } from "../src/lib/figure/merge";
import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";

const raw = JSON.parse(readFileSync(".shots/panelb-orig.json", "utf8"));
const panels = detectPanelsFromGray(raw);
const sample = [
  "\\begin{tikzpicture}",
  "\\draw[thick, ->] (0,0) -- (5,0);",
  "\\draw[thick, ->] (0,0) -- (0,3);",
  "\\draw[blue] plot[domain=0:5, samples=80, smooth] (\\x,{1.5*exp(-((\\x-2.5)*(\\x-2.5)))});",
  "\\node at (2.5,-0.6) {panel};",
  "\\end{tikzpicture}",
].join("\n");
const K = 453 / 320;
const parts = panels.map((b) => ({ fig: parseBody(sample), box: { x: b.x * K, y: b.y * K, w: b.w * K, h: b.h * K } }));
const doc = buildDocument(mergePanels(parts, 453, 336, 12));

const res = await fetch("http://127.0.0.1:8788/api/export", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ source: doc, format: "png", engine: "xelatex", dpi: 160, filename: "merged" }),
});
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(".shots/merged-render.png", buf);
console.log("export status", res.status, "bytes", buf.length);