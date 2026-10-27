import { readFile, writeFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument } from "../server/trace.mjs";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const { figure, stats } = traceRaster(raster, { labels: [] }, { colors: 8, epsilon: 1.2 });
const code = traceDocument(figure);
const curves = figure.elements.filter((e: any) => e.start && e.path?.length).length;
console.log("elements=" + stats.elements, "curves=" + curves, "points=" + stats.points, "KB=" + Math.round(code.length / 1024));
const res = await fetch("http://127.0.0.1:8788/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: code, format: "png", engine: "xelatex", dpi: 200, filename: "shot" }) });
const buf = Buffer.from(await res.arrayBuffer());
await writeFile(".shots/final-trace.png", buf);
console.log("export", res.status, buf.length, "bytes");