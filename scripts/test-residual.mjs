import { readFile, writeFile } from "node:fs/promises";
import { decodePng } from "../server/trace.mjs";
import { encodePng } from "../server/pngwrite.mjs";
import { plotResidual } from "../server/digitize.mjs";
import { countSpecks } from "../server/denoise.mjs";

let failed = 0;
const ok = (name, cond, extra) => { if (cond) console.log("  ok   " + name); else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); } };

const raster = decodePng("data:image/png;base64," + (await readFile(".probe-tests/fixtures/panel-bl.png")).toString("base64"));
const { w, h, rgb } = raster;
const at = (x, y) => { const i = (y * w + x) * 3; return [rgb[i], rgb[i + 1], rgb[i + 2]]; };
const isPurple = (x, y) => { const c = at(x, y); return c[2] > c[1] + 18 && c[2] > 90 && c[0] > c[1]; };

// follow the purple stroke: median purple y per column
const pts = [];
for (let x = 10; x < w - 10; x += 5) {
  const ys = [];
  for (let y = 0; y < h; y++) if (isPurple(x, y)) ys.push(y);
  if (!ys.length) continue;
  ys.sort((a, b) => a - b);
  pts.push([x / w * 1000, ys[ys.length >> 1] / h * 1000]);
}
console.log("purple samples:", pts.length);
const purpleLeft = (r) => { let n = 0; for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const i = (y * r.w + x) * 3; const c = [r.rgb[i], r.rgb[i+1], r.rgb[i+2]]; if (c[2] > c[1] + 18 && c[2] > 90 && c[0] > c[1]) n++; } return n; };
console.log("purple pixels before:", purpleLeft(raster));
const residual = plotResidual(raster, [{ points: pts, width: 2 }]);
console.log("purple pixels after:", purpleLeft(residual), "| islands removed:", residual.removed);
ok("the measured stroke is erased", purpleLeft(residual) < purpleLeft(raster) * 0.15, { before: purpleLeft(raster), after: purpleLeft(residual) });
ok("no confetti is created", countSpecks(residual).specks <= countSpecks(raster).specks + 2, { src: countSpecks(raster).specks, res: countSpecks(residual).specks });
const inkInk = (r) => { let n = 0; for (let y = Math.floor(r.h * 0.55); y < r.h; y++) for (let x = 0; x < r.w; x++) { const i = (y * r.w + x) * 3; if ((r.rgb[i] * 0.299 + r.rgb[i+1] * 0.587 + r.rgb[i+2] * 0.114) / 1 < 150) n++; } return n; };
ok("tick labels survive", inkInk(residual) > 150, inkInk(residual));
await writeFile(".shots/denoise-residual.png", encodePng(residual));

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
