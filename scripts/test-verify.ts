import { readFile } from "node:fs/promises";
import { decodePng } from "../server/trace.mjs";
import { inkMask, distanceField, evaluateModel, compareInk } from "../server/verify.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { failed++; console.log("  FAIL " + name + (extra === undefined ? "" : " :: " + JSON.stringify(extra))); }
}
const load = async (p) => decodePng("data:image/png;base64," + (await readFile(p)).toString("base64"));

const line = await load(".probe-tests/v-src.png");
const rendered = await load(".probe-tests/v-render.png");
const blank = await load(".probe-tests/v-blank.png");

console.log("distance field");
const field = distanceField(inkMask(line, 210), line.w, line.h);
ok("ink has distance 0", field[20 * line.w + 10] === 0);
ok("3px away is ~3", Math.abs(field[23 * line.w + 10] - 3) < 0.01, field[23 * line.w + 10]);

console.log("per-element support");
const model = { type: "plot", elements: [
  { kind: "line", x1: 0, y1: 512, x2: 1000, y2: 512 },
  { kind: "line", x1: 0, y1: 100, x2: 1000, y2: 100 },
]};
const evaluated = evaluateModel(model, 1, line);
ok("on-ink line is supported", evaluated.support[0].ratio > 0.95, evaluated.support[0]);
ok("off-ink line is flagged", evaluated.support[1].ratio < 0.1, evaluated.support[1]);
ok("one problem reported", evaluated.problems.length === 1, evaluated.problems);

console.log("text boxes");
const textEval = evaluateModel({ type: "plot", elements: [
  { kind: "text", box: [400, 460, 100, 60], tex: "0" },
  { kind: "text", box: [400, 100, 100, 60], tex: "ghost" },
]}, 1, line);
ok("empty label box is flagged", textEval.problems.some((p) => p.includes("空白处")), textEval.problems);

console.log("pruning");
import { pruneUnsupported } from "../server/verify.mjs";
const pruned = pruneUnsupported({ elements: [
  { kind: "line", x1: 0, y1: 512, x2: 1000, y2: 512 },
  { kind: "line", x1: 0, y1: 100, x2: 1000, y2: 100 },
  { kind: "line", x1: 0, y1: 512, x2: 1000, y2: 512 },
]}, evaluated);
ok("off-ink element removed", pruned.removed.some((r) => r.why === "no-ink"), pruned.removed);
ok("duplicate element removed", pruned.removed.some((r) => r.why === "duplicate"), pruned.removed);
ok("one element kept", pruned.model.elements.length === 1, pruned.model.elements.length);

console.log("render comparison");
const good = compareInk(line, "data:image/png;base64," + (await readFile(".probe-tests/v-render.png")).toString("base64"));
const empty = compareInk(line, "data:image/png;base64," + (await readFile(".probe-tests/v-blank.png")).toString("base64"));
ok("matching render recalls everything", good.recall > 0.95 && good.precision > 0.9, good);
ok("blank render recalls nothing", empty.recall < 0.05, empty);

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;
