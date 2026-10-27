import { readFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument } from "../server/trace.mjs";
import { parseBody } from "../src/lib/figure/parse";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
const { figure, stats } = traceRaster(raster, { labels: [] }, { colors: 8, epsilon: 1.2 });
const code = traceDocument(figure);
console.log("trace:", JSON.stringify(stats).slice(0, 160));
const parsed = parseBody(code);
console.log("parse elements:", parsed.elements.length, "of", figure.elements.length);
const res = await fetch("http://127.0.0.1:8788/api/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: code, engine: "xelatex" }) });
const body: any = await res.json();
console.log("compile ok:", body.ok, body.ok ? `${Math.round(body.width)}x${Math.round(body.height)}` : JSON.stringify(body.errors?.slice(0, 2)));