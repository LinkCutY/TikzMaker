import { readFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument, chaikin } from "../server/trace.mjs";

// unit: a square ring becomes a rounded shape with more, evenly spaced points
const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const smooth = chaikin(square, 2);
const maxDev = Math.max(...smooth.map(p => Math.max(-p.x, p.x - 10, -p.y, p.y - 10)));
console.log("chaikin: points", square.length, "->", smooth.length, "| stays inside box:", maxDev <= 0);

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const semantics = { labels: [{ box: [95, 70, 305, 80], tex: "supermode", confidence: 0.9 }] };
for (const [name, opts] of [
  ["raw (no smoothing)", { smoothing: 0 }],
  ["chaikin x2", { smoothing: 2 }],
] as const) {
  const { figure, stats } = traceRaster(raster, semantics, { colors: 8, epsilon: 1.2, ...(opts as object) });
  const code = traceDocument(figure);
  console.log(name.padEnd(18), "elements=" + stats.elements, "points=" + stats.points, "code=" + Math.round(code.length / 1024) + "KB");
}