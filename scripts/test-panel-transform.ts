import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformElement, mergePanels } from "../src/lib/figure/merge";
import { defaultStyle, type PlotEl } from "../src/lib/figure/types";
import { compileExpr } from "../src/lib/figure/expr";
import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";

function close(a: number, b: number, message: string) {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) < 1e-8, `${message}: ${a} != ${b}`);
}

const base: PlotEl = { id: "p", kind: "plot", name: "peak", expr: "2+3*exp(-((x-6)/1.2)^2)", xMin: 0, xMax: 12, samples: 150, offset: { x: 1.2, y: -0.7 }, style: defaultStyle() };
for (const k of [0.15, 0.5, 1, 2.5]) {
  const moved = transformElement(base, k, 3.7, -2.1) as PlotEl;
  const before = compileExpr(base.expr), after = compileExpr(moved.expr);
  assert.ok(before.ok && after.ok);
  for (const x of [0, 1, 4.8, 6, 7.2, 12]) {
    close(x * k + moved.offset.x, (x + base.offset.x) * k + 3.7, "x transform");
    close(after.fn(x * k) + moved.offset.y, (before.fn(x) + base.offset.y) * k - 2.1, "y transform");
  }
  const reopened = parseBody(buildDocument({ elements: [moved] })).elements.find(e => e.kind === "plot") as PlotEl;
  assert.ok(reopened, "exported curve must reopen as a function");
  const fn = compileExpr(reopened.expr);
  assert.ok(fn.ok);
  for (const x of [0, 4.8, 6, 7.2, 12]) {
    const worldX = x * k + moved.offset.x;
    close(fn.fn(worldX), (before.fn(x) + base.offset.y) * k - 2.1, "export/reopen translation");
  }
}

// Historical real-model reply: all 13 curves must keep their position relative
// to the panel frame, including the tallest peak. This is a regression fixture,
// not a substitute for the fresh live-model acceptance test.
const source = readFileSync("logs/ai/20261025-005706-25.tex", "utf8");
const fig = parseBody(source);
const merged = mergePanels([{ fig, box: { x: 34, y: 16, w: 321, h: 177 } }], 453, 336);
const beforeFrame = fig.elements.find(e => e.kind === "rect")!;
const afterFrame = merged.elements.find(e => e.kind === "rect")!;
assert.ok(beforeFrame.kind === "rect" && afterFrame.kind === "rect");
const scale = (afterFrame.to.x - afterFrame.from.x) / (beforeFrame.to.x - beforeFrame.from.x);
const beforePlots = fig.elements.filter((e): e is PlotEl => e.kind === "plot");
const afterPlots = merged.elements.filter((e): e is PlotEl => e.kind === "plot");
assert.equal(beforePlots.length, 13);
assert.equal(afterPlots.length, beforePlots.length);
for (let i = 0; i < beforePlots.length; i++) {
  const a = beforePlots[i], b = afterPlots[i];
  const fa = compileExpr(a.expr), fb = compileExpr(b.expr);
  for (const x of [a.xMin, 6.5, a.xMax]) {
    close(fb.fn(x * scale) + b.offset.y - afterFrame.from.y, (fa.fn(x) - beforeFrame.from.y) * scale, "real-model curve/frame alignment");
  }
}
assert.throws(() => transformElement(base, 0, 0, 0));
console.log("PASS: function scale, translation, export/reopen, and 13 historical model curves preserve geometry.");
