import { readFile, writeFile, mkdir } from "node:fs/promises";
import { decodePng } from "../server/trace.mjs";
import { traceStrokes, interpolate } from "../server/lines.mjs";
import { vectorizePng } from "../server/vectorize.mjs";
import { compileToPdf } from "../server/latex.mjs";
import { renderPreview } from "../server/render.mjs";

/*
 * Three-layer reconstruction:
 *   1. filled regions  <- VTracer (this is the layer the old tracer could not do)
 *   2. thin curves     <- lines.mjs walking tracer
 *   3. text            <- nodes (in production the label boxes + strings come from the VLM)
 *
 * Usage: node scripts/shot-hybrid.mjs [input.png] [output-name]
 */

const input = process.argv[2] || ".shots/panelb-orig.png";
const name = process.argv[3] || "hybrid";

// [x, y, w, h] in source pixels, plus the LaTeX to put in the node.
const LABELS = [
  { box: [52, 34, 160, 26], tex: "$1^{\\mathrm{st}}$ supermode" },
  { box: [52, 64, 62, 22], tex: "$m=1$" },
  { box: [6, 100, 20, 56], tex: "$t/\\tau_0$", rotate: 90 },
  { box: [384, 30, 56, 22], tex: "$\\gamma(t)$" },
  { box: [370, 102, 74, 24], tex: "$\\langle n(t)\\rangle$" },
  { box: [26, 240, 56, 22], tex: "$\\gamma(z)$" },
  { box: [26, 280, 50, 22], tex: "$V(z)$" },
  { box: [194, 312, 52, 22], tex: "$z/l_0$" },
  { box: [370, 304, 74, 24], tex: "$\\langle n(z)\\rangle$" },
];

await mkdir(".probe-tests", { recursive: true });
await mkdir(".shots", { recursive: true });

const bytes = await readFile(input);
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const { w, h } = raster;
const k = 12 / w;
const heightCm = h * k;
const fmt = (v) => String(Math.round(v * 1000) / 1000);

/* 1. filled regions */
const fills = await vectorizePng(bytes, {
  targetWidthCm: 12,
  precision: 2,
  minAreaPx: 260,
  minThicknessPx: 2.5,
  vtracer: { mode: "spline", simplify: 1.5, maxColors: 32 },
});
console.log("fills     " + JSON.stringify(fills.stats));

/* 2. curves -- label boxes are normalised to 0..1000 for lines.mjs */
const norm = LABELS.map((l) => ({
  box: [l.box[0] / w * 1000, l.box[1] / h * 1000, l.box[2] / w * 1000, l.box[3] / h * 1000].map(fmt),
  tex: l.tex,
}));
const { tracks, stats } = traceStrokes(raster, { upscale: 2.5, mergeDist: 4, minLength: 9, labels: norm });
console.log("strokes   " + JSON.stringify(stats));

const point = (p) => "(" + fmt(p[0] * k) + "," + fmt((h - p[1]) * k) + ")";
const draws = [];
for (const t of tracks) {
  const curve = interpolate(t, 0);
  if (!curve) continue;
  const [r, g, b] = t.color.map((v) => Math.round(v));
  const chain = [point(curve.start)]
    .concat(curve.path.map((s) => ".. controls " + point(s.c1) + " and " + point(s.c2) + " .. " + point(s.p)))
    .join(" ");
  draws.push("\\draw[draw={rgb,255:red," + r + ";green," + g + ";blue," + b + "},line width=0.35pt,line cap=round] " + chain + ";");
}

/* 3. text */
const nodes = LABELS.map((l) => {
  const cx = (l.box[0] + l.box[2] / 2) * k;
  const cy = heightCm - (l.box[1] + l.box[3] / 2) * k;
  const rotate = l.rotate ? ", rotate=" + l.rotate : "";
  return "\\node[anchor=center, inner sep=0pt, font=\\fontsize{5}{6}\\selectfont" + rotate + "] at (" + fmt(cx) + "," + fmt(cy) + ") {" + l.tex + "};";
});

const document = [
  "\\documentclass[tikz,border=0pt]{standalone}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "% @viewport 0 0 " + fmt(12) + " " + fmt(heightCm),
  "\\useasboundingbox (0,0) rectangle (" + fmt(12) + "," + fmt(heightCm) + ");",
  "% --- layer 1: filled regions (VTracer) ---",
  fills.body,
  "% --- layer 2: curves (lines.mjs) ---",
  ...draws,
  "% --- layer 3: text (nodes) ---",
  ...nodes,
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");

console.log("document  " + Math.round(document.length / 1024) + "KB  fills=" + fills.stats.rings + " strokes=" + (draws.length) + " nodes=" + nodes.length);
const texPath = ".probe-tests/" + name + ".tex";
await writeFile(texPath, document);

const job = await compileToPdf(document, { engine: "xelatex", timeoutMs: 240_000 });
if (!job.ok) {
  console.log("compile FAILED", job.errors.slice(0, 4));
  await job.cleanup();
  process.exit(1);
}
const rendered = await renderPreview(job.pdfPath, job.dir, { dpi: 200, wantPng: true });
const pngPath = ".shots/" + name + ".png";
await writeFile(pngPath, await readFile(rendered.pngPath));
console.log("compile   " + job.durationMs + "ms  png=" + pngPath);
await job.cleanup();
