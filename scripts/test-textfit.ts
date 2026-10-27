import { primitivesToTikz } from "../server/primitives.mjs";
import { compileToPdf } from "../server/latex.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}

const model = { type: "plot", elements: [
  { kind: "polyline", closed: true, points: [[100, 100], [900, 100], [900, 700], [100, 700]] },
  { kind: "text", box: [120, 120, 500, 160], tex: "1st supermode" },   // huge box
  { kind: "text", box: [140, 300, 200, 120], tex: "m = 1" },
  { kind: "text", box: [380, 420, 260, 140], tex: "400" },            // huge box for 3 chars
  { kind: "text", box: [390, 430, 240, 130], tex: "400" },            // duplicate a few px away
  { kind: "text", box: [120, 120, 120, 60], tex: "100" },             // overlaps the first label
]};
const built = primitivesToTikz(model, { aspect: 0.6, imageWidthPx: 900 });
const nodes = built.code.split("\n").filter((l) => l.startsWith("\\node"));
console.log(nodes.join("\n"));
const sizes = nodes.map((l) => Number((/fontsize\{([\d.]+)\}/.exec(l) || [])[1]));
ok("overlapping duplicate dropped (one 400 left)", nodes.filter((l) => l.includes("{400}")).length === 1, nodes.length);
ok("no label bigger than 8% of canvas height", sizes.every((s) => s <= 0.08 * (12 * 0.6) * 28.3465 + 0.1), sizes);
ok("long text fits its box (scale down)", sizes[0] < 3 * sizes[1], sizes);
const job = await compileToPdf(built.code, { engine: "xelatex", timeoutMs: 120000 });
ok("compiles", job.ok, job.errors);
await job.cleanup();

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
