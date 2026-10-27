import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { decodePng, traceRaster, traceDocument } from "../server/trace.mjs";
import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";
import { translate, hitTest, bboxOf } from "../src/lib/figure/edit";
import { transformElement } from "../src/lib/figure/merge";
const bytes = await readFile(".probe-tests/fixtures/paper.png");
const raster = decodePng("data:image/png;base64," + bytes.toString("base64"));
assert.equal(raster.w, 453); assert.equal(raster.h, 336);
const result = traceRaster(raster, { labels: [{ box: [95, 70, 305, 80], tex: "supermode", confidence: 0.9 }] });
const code = traceDocument(result.figure);
await writeFile(".probe-tests/trace-local.tex", code);
const parsed = parseBody(code);
assert.equal(parsed.elements.length, result.figure.elements.length, "No pixel-derived shape may be dropped");
const reopened = parseBody(buildDocument(parsed));
assert.equal(reopened.elements.length, parsed.elements.length);
assert.ok(parsed.elements.some(e => e.kind === "poly" && e.rings?.length), "Compound shapes must preserve holes");
assert.ok(parsed.elements.some(e => e.kind === "poly" && e.ocr), "Recognized text metadata must survive export");
for (const element of parsed.elements) {
  const shifted = translate(element, 2, 3);
  const a = bboxOf(element)!, b = bboxOf(shifted)!;
  assert.ok(Math.abs(b.x0 - a.x0 - 2) < 1e-6 && Math.abs(b.y0 - a.y0 - 3) < 1e-6);
  const scaled = transformElement(element, 0.5, 1, 2);
  assert.ok(bboxOf(scaled));
}
console.log("PASS: PNG decode, real-image contours, holes, OCR metadata, export/reopen, drag and scale. " + JSON.stringify(result.stats));
