import { readFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument } from "../server/trace.mjs";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const semantics = { labels: [{ box: [95, 70, 305, 80], tex: "supermode", confidence: 0.9 }] };
for (const plan of [{ colors: 28, epsilon: 0.35 }, { colors: 16, epsilon: 0.7 }, { colors: 8, epsilon: 1.2 }]) {
  const { figure, stats } = traceRaster(raster, semantics, plan);
  const code = traceDocument(figure);
  console.log(`colors=${plan.colors} eps=${plan.epsilon}  elements=${stats.elements} points=${stats.points} code=${Math.round(code.length / 1024)}KB`);
}