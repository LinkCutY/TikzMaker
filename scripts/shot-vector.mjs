import { readFile, writeFile, mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { vectorizePng } from "../server/vectorize.mjs";
import { compileToPdf } from "../server/latex.mjs";
import { renderPreview } from "../server/render.mjs";

/*
 * PNG -> filled-region TikZ -> compile -> PNG.
 * Usage: node scripts/shot-vector.mjs [input.png] [output-name]
 * Env: MODE=spline|polygon|pixel  SIMPLIFY=1.2  WIDTH_CM=12  PRECISION=2
 */
const input = process.argv[2] || ".shots/panelb-orig.png";
const name = process.argv[3] || "vector-" + (process.env.MODE || "spline");
const mode = process.env.MODE || "spline";
const simplify = Number(process.env.SIMPLIFY || 1.2);
const widthCm = Number(process.env.WIDTH_CM || 12);
const precision = Number(process.env.PRECISION || 2);
const minAreaPx = Number(process.env.MIN_AREA || 0);
const minThicknessPx = Number(process.env.MIN_THICK || 0);
const maxColors = Number(process.env.MAX_COLORS || 0);

await mkdir(".probe-tests", { recursive: true });
await mkdir(".shots", { recursive: true });

const bytes = await readFile(input);
const started = Date.now();
const vtracer = { mode, simplify, pathPrecision: precision };
if (maxColors > 0) vtracer.maxColors = maxColors;
const out = await vectorizePng(bytes, {
  targetWidthCm: widthCm,
  precision,
  minAreaPx,
  minThicknessPx,
  vtracer,
});
const vectorMs = Date.now() - started;
console.log("vectorize  " + vectorMs + "ms  " + JSON.stringify(out.stats));

const texPath = ".probe-tests/" + name + ".tex";
await writeFile(texPath, out.document);

const job = await compileToPdf(out.document, { engine: "xelatex", timeoutMs: 180_000 });
if (!job.ok) {
  console.log("compile FAILED", job.errors.slice(0, 3));
  await job.cleanup();
  process.exit(1);
}
const rendered = await renderPreview(job.pdfPath, job.dir, { dpi: 200, wantPng: true });
const pngPath = ".shots/" + name + ".png";
await writeFile(pngPath, await readFile(rendered.pngPath));
console.log("compile    " + job.durationMs + "ms  " + rendered.width + "x" + rendered.height);
console.log("tex        " + texPath + "  " + Math.round(out.document.length / 1024) + "KB");
console.log("png        " + pngPath + "  " + Math.round(statSync(pngPath).size / 1024) + "KB");
await job.cleanup();
