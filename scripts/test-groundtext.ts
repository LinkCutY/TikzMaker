import { matchLabels, textBlocks } from "../server/groundtext.mjs";
import { readFile } from "node:fs/promises";
import { decodePng } from "../server/trace.mjs";

let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

// two stacked labels, boxes deliberately wrong by a little
const blocks = [
  { x: 110, y: 22, w: 133, h: 20, n: 900 },   // long line: "1st supermode"
  { x: 35, y: 45, w: 56, h: 20, n: 220 },     // short line: "m = 1"
];
const labels = [
  { tex: "1st supermode", box: [40, 50, 410, 100] },
  { tex: "m = 1", box: [40, 120, 170, 60] },
];
const m = matchLabels(labels, blocks, { w: 329, h: 185 });
console.log("matches:", JSON.stringify(m.matches));
ok("both labels matched", m.matches.length === 2, m.matches);
ok("the long string takes the wide block", m.matches.find((x) => x.labelIndex === 0).blockIndex === 0, m.matches);
ok("the short string takes the narrow block", m.matches.find((x) => x.labelIndex === 1).blockIndex === 1, m.matches);
ok("each block used once", new Set(m.matches.map((x) => x.blockIndex)).size === 2);

// swappable case: a naive nearest-centre would swap these
const near = [ { x: 110, y: 22, w: 133, h: 20, n: 800 }, { x: 35, y: 45, w: 56, h: 20, n: 200 } ];
const swapped = [ { tex: "m = 1", box: [40, 90, 170, 60] }, { tex: "1st supermode", box: [40, 30, 410, 100] } ];
const m2 = matchLabels(swapped, near, { w: 329, h: 185 });
ok("width wins over a wrong prior", m2.matches.find((x) => x.labelIndex === 1).blockIndex === 0, m2.matches);

// real image: blocks should be found and be few
const raster = decodePng("data:image/png;base64," + (await readFile(".probe-tests/fixtures/panel-1.png")).toString("base64"));
const tb = textBlocks(raster);
console.log("blocks on panel-1:", tb.length, JSON.stringify(tb.slice(0, 4).map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)])));
ok("finds a handful of text rows", tb.length >= 2 && tb.length <= 12, tb.length);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
