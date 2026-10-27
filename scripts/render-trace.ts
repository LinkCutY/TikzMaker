import { readFile, writeFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument } from "../server/trace.mjs";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const semantics = { labels: [] as any[] };
for (const [name, opts] of [["raw", { colors: 8, epsilon: 1.2, smoothing: 0 }], ["smooth", { colors: 8, epsilon: 1.2, smoothing: 2 }]] as const) {
  const { figure } = traceRaster(raster, semantics, opts as any);
  const code = traceDocument(figure);
  const res = await fetch("http://127.0.0.1:8788/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: code, format: "png", engine: "xelatex", dpi: 120, filename: name }) });
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(`.shots/trace-${name}.png`, buf);
  console.log(name, "export", res.status, buf.length, "bytes");
}