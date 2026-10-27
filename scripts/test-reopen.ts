import { readFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument } from "../server/trace.mjs";
import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const { figure } = traceRaster(raster, { labels: [] }, { colors: 8, epsilon: 1.2 });
const first = parseBody(traceDocument(figure));
const second = parseBody(buildDocument(first));
const curves = first.elements.filter((e: any) => e.start && e.path?.length).length;
console.log("reopen: parse1=" + first.elements.length, "parse2=" + second.elements.length, "| cubic chains=" + curves);
console.log("same:", first.elements.length === second.elements.length);