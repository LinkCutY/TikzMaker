import { parseBody } from "../src/lib/figure/parse";
import { parseBodySafe } from "../src/lib/figure/bridge";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

const doc = [
  "\\begin{tikzpicture}[>=stealth, font=\\fontsize{17.641}{21.169}\\selectfont]",
  "  \\useasboundingbox (0,0) rectangle (12,4.816);",
  "  \\node (n1) at (3.963,2.167) {$A$};",
  "  \\node (n2) at (5.727,2.167) {$X$};",
  "  \\draw[->] (n1.east) -- (n2.west);",
  "\\end{tikzpicture}",
].join("\n");

const direct = parseBody(doc);
const viaBridge = parseBodySafe(doc);
ok("the bridge returns a figure", !!viaBridge && viaBridge.elements.length > 0);
if (viaBridge) {
  const fontsA = direct.elements.filter((e) => e.kind === "node").map((e) => e.fontSize);
  const fontsB = viaBridge.elements.filter((e) => e.kind === "node").map((e) => e.fontSize);
  console.log("fonts", JSON.stringify(fontsA), JSON.stringify(fontsB));
  ok("the bridge keeps the picture font", JSON.stringify(fontsA) === JSON.stringify(fontsB) && fontsB[0] > 15, fontsB);
  const lineA = direct.elements.find((e) => e.kind === "line");
  const lineB = viaBridge.elements.find((e) => e.kind === "line");
  ok("the bridge keeps the anchors", lineA && lineB && Math.abs(lineA.from.x - lineB.from.x) < 1e-9 && Math.abs(lineA.to.x - lineB.to.x) < 1e-9, [lineA && lineA.from, lineB && lineB.from]);
  ok("the bridge keeps the viewport", JSON.stringify(!!direct.viewport) === JSON.stringify(!!viaBridge.viewport));
}

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;