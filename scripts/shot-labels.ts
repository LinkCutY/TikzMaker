import { readFile, writeFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument } from "../server/trace.mjs";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
// pretend the semantics model read these strings off the figure
const labels = [
  { box: [60, 55, 290, 60], tex: "$1^{st}$ supermode", confidence: 0.9 },
  { box: [60, 120, 150, 55], tex: "$m=1$", confidence: 0.9 },
  { box: [20, 300, 40, 40], tex: "$0$", confidence: 0.8 },
  { box: [780, 120, 90, 40], tex: "$t/\\tau_0$", confidence: 0.6 },
];
const { figure, stats } = traceRaster(raster, { labels }, { colors: 8, epsilon: 1.2 });
const nodes = figure.elements.filter((e: any) => e.kind === "node");
console.log("elements=" + stats.elements, "text nodes=" + nodes.length, "KB=" + Math.round(traceDocument(figure).length / 1024));
console.log("node texts:", nodes.map((n: any) => n.text).join(" | "));
const res = await fetch("http://127.0.0.1:8788/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: traceDocument(figure), format: "png", engine: "xelatex", dpi: 200, filename: "labels" }) });
const buf = Buffer.from(await res.arrayBuffer());
await writeFile(".shots/final-labels.png", buf);
console.log("export", res.status, buf.length);