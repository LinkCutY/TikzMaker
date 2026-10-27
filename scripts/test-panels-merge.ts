import { readFileSync } from "node:fs";
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
const merged = mergePanels(parts, 453, 336, 12);
const doc = buildDocument(merged);
console.log("panels:", panels.length, "| elements:", merged.elements.length, "| lines:", doc.split("\n").length);
process.stdout.write("---DOC---\n" + doc);