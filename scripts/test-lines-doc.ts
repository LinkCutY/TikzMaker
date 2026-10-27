import { linesDocument } from "../server/lines.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

const raster = { w: 100, h: 50, rgb: new Uint8Array(100 * 50 * 3) };
const tracks = [
  { color: [0, 0, 0], points: [[10, 10], [30, 10], [50, 20]] },
  { color: [200, 30, 40], points: [[0, 40], [100, 40]] },
];
const out = linesDocument(raster, tracks, {
  labels: [
    { box: [0, 0, 1000, 1000], tex: "$x$" },
    { box: [0, 0, 100, 400], tex: "50% & more" },
    { box: [0, 0, 10] },
  ],
});

console.log("document");
ok("viewport 12 x 6", out.code.includes("% @viewport 0 0 12 6"), out.code.split("\n")[3]);
ok("bounding box matches", out.code.includes("\\useasboundingbox (0,0) rectangle (12,6);"));
ok("two tracks -> two draws", (out.code.match(/\\draw\[draw=\{/g) || []).length === 2, out.stats);
ok("stroke carries a line width", out.code.includes("line width=0.4pt"));
ok("colour preserved", out.code.includes("rgb,255:red,200;green,30;blue,40"));
ok("bezier chain emitted", out.code.includes(".. controls "));
ok("y axis flipped: (10,10) in 100x50 -> (1.2,4.8)", out.code.includes("(1.2,4.8)"), out.code.split("\n")[5]);
ok("no fill commands", !out.code.includes("\\fill["));

console.log("text layer");
ok("centre label at (6,3)", out.code.includes("(6,3)"), out.code.slice(-260));
ok("tall box rotates", out.code.includes("rotate=90"));
ok("characters escaped", out.code.includes("50\\% \\& more"), out.code.slice(-200));
ok("incomplete label ignored", out.stats.nodes === 2, out.stats);
ok("stats bytes reported", out.stats.bytes === out.code.length, out.stats);

const empty = linesDocument(raster, [], {});
ok("empty track list still yields a valid document", empty.code.includes("\\begin{tikzpicture}") && empty.stats.curves === 0);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
