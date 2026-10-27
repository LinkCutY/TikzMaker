import { readFile, writeFile } from "node:fs/promises";
import { decodePng } from "../server/trace.mjs";
import { encodePng } from "../server/pngwrite.mjs";
import { vectorizePng } from "../server/vectorize.mjs";
import { countSpecks, medianFilter } from "../server/denoise.mjs";

let failed = 0;
const ok = (name, cond, extra) => { if (cond) console.log("  ok   " + name); else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); } };

const base = decodePng("data:image/png;base64," + (await readFile(".probe-tests/fixtures/panel-bl.png")).toString("base64"));
console.log("source", base.w + "x" + base.h, "specks", countSpecks(base).specks);

// salt-and-pepper: isolated dark pixels like JPEG ringing
const noisy = { w: base.w, h: base.h, rgb: new Uint8Array(base.rgb) };
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 1400; i++) {
  const x = Math.floor(rnd() * base.w), y = Math.floor(rnd() * base.h);
  const v = rnd() < 0.5 ? 20 : 240;
  const p = (y * base.w + x) * 3;
  noisy.rgb[p] = v; noisy.rgb[p + 1] = v; noisy.rgb[p + 2] = v;
}
const noisySpecks = countSpecks(noisy).specks;
console.log("noisy specks", noisySpecks, "(added by the test)");
ok("test image really has specks", noisySpecks > 300, noisySpecks);
await writeFile(".shots/denoise-noisy.png", encodePng(noisy));
await writeFile(".shots/denoise-clean.png", encodePng(medianFilter(noisy, 1)));
ok("median filter removes most specks", countSpecks(medianFilter(noisy, 1)).specks < noisySpecks * 0.2, countSpecks(medianFilter(noisy, 1)).specks);

const bytes = encodePng(noisy);
const raw = await vectorizePng(bytes, { denoise: false, minAreaPx: 0, minThicknessPx: 0 });
const clean = await vectorizePng(bytes, {});
const ring = (r) => (r.stats.rings ?? r.stats.paths ?? r.stats.elements ?? 0);
console.log("raw  ", JSON.stringify(raw.stats).slice(0, 160));
console.log("clean", JSON.stringify(clean.stats).slice(0, 160));
ok("denoising cuts the number of filled paths", ring(clean) < ring(raw), { raw: ring(raw), clean: ring(clean) });
ok("denoising cuts the bytes", clean.document.length < raw.document.length, { raw: raw.document.length, clean: clean.document.length });
ok("stats report the removed specks", clean.stats.denoise && clean.stats.denoise.specksBefore > clean.stats.denoise.specksAfter, clean.stats.denoise);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
