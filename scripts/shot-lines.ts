import { readFile, writeFile } from "node:fs/promises";
import { decodePng } from "../server/trace.mjs";
import { traceStrokes, interpolate } from "../server/lines.mjs";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const LABELS = [
  { box: [60, 130, 330, 80], tex: '1st supermode' },
  { box: [55, 250, 160, 60], tex: 'm = 1' },
  { box: [790, 150, 180, 60], tex: 't/tau0' },
];
const { tracks, stats } = traceStrokes(raster, { mergeDist: 4, minLength: 8, labels: LABELS, upscale: 2.5 });
console.log("stats:", JSON.stringify(stats));
const k = 12 / raster.w;
const fmt = (v: number) => Math.round(v * 1000) / 1000;
const lines = ["\\documentclass[tikz,border=0pt]{standalone}", "\\begin{document}", "\\begin{tikzpicture}",
  `\\useasboundingbox (0,0) rectangle (12,${fmt(raster.h * k)});`];
for (const t of tracks) {
  const curve = interpolate(t, 0);
  if (!curve) continue;
  const [cr, cg, cb] = t.color.map((v: number) => Math.round(v));
  const hex = `rgb,255:red,${cr};green,${cg};blue,${cb}`;
  const pt = (p: number[]) => `(${fmt(p[0] * k)},${fmt((raster.h - p[1]) * k)})`;
  const chain = [pt(curve.start), ...curve.path.map((s: any) => `.. controls ${pt(s.c1)} and ${pt(s.c2)} .. ${pt(s.p)}`)].join(" ");
  lines.push(`\\draw[draw={${hex}},line width=0.7pt,line cap=round] ${chain};`);
}
lines.push("\\end{tikzpicture}", "\\end{document}");
const code = lines.join("\n");
console.log("tracks kept=" + tracks.length, "KB=" + Math.round(code.length / 1024));
const res = await fetch("http://127.0.0.1:8788/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: code, format: "png", engine: "xelatex", dpi: 200, filename: "lines" }) });
const buf = Buffer.from(await res.arrayBuffer());
await writeFile(".shots/final-lines.png", buf);
console.log("export", res.status, buf.length);
