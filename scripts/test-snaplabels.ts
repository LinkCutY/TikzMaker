import { snapTextElements } from "../server/snaplabels.mjs";
import { hasCjk, cjkPreamble } from "../server/textext.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

function raster(w, h, blobs) {
  const rgb = new Uint8Array(w * h * 3).fill(255);
  for (const [x0, y0, x1, y1] of blobs) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 3;
      rgb[i] = 20; rgb[i + 1] = 20; rgb[i + 2] = 20;
    }
  }
  return { w, h, rgb };
}

console.log("label snapping");
const r1 = raster(200, 100, [[150, 60, 159, 73]]);
const snap = snapTextElements(r1, [{ kind: "text", box: [900, 900, 100, 100], tex: "球" }]);
const b = snap.elements[0].box;
ok("snapped to the only ink cluster", snap.snapped === 1 && snap.missed === 0, snap);
// boxes are normalised 0..1000, not pixels
ok("x lands on the glyph", Math.abs(b[0] - 745) < 25 && Math.abs(b[2] - 60) < 20, b);
ok("y lands on the glyph", Math.abs(b[1] - 590) < 25 && Math.abs(b[3] - 160) < 25, b);

const r2 = raster(200, 100, [[20, 20, 60, 90]]);
const snake = snapTextElements(r2, [{ kind: "text", box: [500, 500, 100, 100], tex: "x" }]);
ok("a large figure outline is not treated as a glyph", snake.snapped === 0, snake);

const r3 = raster(200, 100, [[100, 40, 103, 45], [110, 40, 113, 45]]);
const gap = snapTextElements(r3, [{ kind: "text", box: [520, 400, 60, 60], tex: "求" }]);
ok("separate radicals merge into one box", gap.snapped === 1 && gap.elements[0].box[2] > 8, gap.elements[0].box);

const untouched = [{ kind: "circle", cx: 500, cy: 500, r: 100 }];
const same = snapTextElements(r1, untouched);
ok("non-text elements pass through unchanged", same.elements === untouched && same.snapped === 0);

console.log("CJK preamble");
ok("detects Chinese", hasCjk("球") && hasCjk("$1^{st}$ supermode 球"));
ok("ignores Latin", !hasCjk("gamma(t)") && !hasCjk("$x^2$"));
ok("emits ctex only when needed", cjkPreamble("球").length === 1 && cjkPreamble("x").length === 0);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
