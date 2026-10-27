import { samplePlot, compileExpr } from "../src/lib/figure/expr";
import { simplifyPath } from "../src/lib/figure/simplify";

const c = compileExpr("sin(exp(x))");
if (!c.ok) throw new Error("expr failed");
const runs = samplePlot(c.fn, -0.5, 5.5, 300);
const all = runs[0];
const kept = simplifyPath(all, 0.004);
let maxErr = 0;
for (const p of all) {
  let best = Infinity;
  for (let i = 0; i < kept.length - 1; i++) {
    const a = kept[i], b = kept[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  if (best > maxErr) maxErr = best;
}
console.log("sin(exp x): samples", all.length, "->", kept.length, "points | max err", maxErr.toFixed(4), "cm =", (maxErr * 72 / 2.54).toFixed(2), "pt");