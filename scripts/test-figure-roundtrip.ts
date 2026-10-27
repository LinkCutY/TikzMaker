import { readFile, writeFile } from "node:fs/promises";
import { decodePng } from "../server/trace.mjs";
import { snapTextElements } from "../server/snaplabels.mjs";
import { primitivesToTikz } from "../server/primitives.mjs";
import { parseBody } from "../src/lib/figure/parse";
import { compileToPdf } from "../server/latex.mjs";
import { renderPreview } from "../server/render.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

const bytes = await readFile(".probe-tests/fixtures/sphere.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const model = {
  type: "geometry", summary: "球体", elements: [
    { kind: "circle", cx: 500, cy: 470, r: 430, style: { stroke: "#000000", width: 3, fill: "#f2f2f2" } },
    { kind: "arc", cx: 500, cy: 470, rx: 430, ry: 90, start: 180, end: 360, style: { stroke: "#888888", width: 2, dash: "dashed" } },
    { kind: "arc", cx: 500, cy: 470, rx: 430, ry: 90, start: 0, end: 180, style: { stroke: "#000000", width: 3 } },
    { kind: "text", box: [465, 874, 66, 54], tex: "球" },
  ],
};
const snapped = snapTextElements(raster, model.elements);
const built = primitivesToTikz({ ...model, elements: snapped.elements }, { aspect: raster.h / raster.w, imageWidthPx: raster.w });
console.log("source lines:", built.code.split("\n").length, "bytes:", built.code.length);
console.log(built.code.split("\n").slice(5, 10).join("\n"));

const fig = parseBody(built.code);
const kinds = fig.elements.map((e) => e.kind);
console.log("parsed elements:", fig.elements.length, kinds.join(","));
ok("canvas keeps all four elements", fig.elements.length === 4, kinds);
ok("circle survives as a circle", kinds.filter((k) => k === "circle").length === 1, kinds);
ok("both equator arcs survive as curves", kinds.filter((k) => k === "poly").length === 2, kinds);
ok("label survives", kinds.filter((k) => k === "node").length === 1, kinds);

const job = await compileToPdf(built.code, { engine: "xelatex", timeoutMs: 120000 });
ok("compiles", job.ok, job.errors);
if (job.ok) {
  const r = await renderPreview(job.pdfPath, job.dir, { dpi: 200, wantPng: true });
  await writeFile(".shots/roundtrip-sphere.png", await readFile(r.pngPath));
}
await job.cleanup();
console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
