import { mergePanels } from "../src/lib/figure/merge";
import { defaultStyle } from "../src/lib/figure/types";

const st = defaultStyle();
const fig = (cx: number, cy: number) => ({ elements: [
  { id: "r", kind: "rect" as const, name: "rect", from: { x: cx - 2, y: cy - 2 }, to: { x: cx + 2, y: cy + 2 }, style: st, rounded: 0 },
  { id: "t", kind: "node" as const, name: "node", at: { x: cx, y: cy }, text: "x", style: st, boxed: false, rounded: 0, fontSize: 10, anchor: "center" as const },
] });

// 200x100 image, two panels side by side, 12cm wide canvas
const merged = mergePanels([
  { fig: fig(0, 0) as any, box: { x: 0, y: 0, w: 100, h: 100 } },
  { fig: fig(0, 0) as any, box: { x: 100, y: 0, w: 100, h: 100 } },
], 200, 100, 12);

const rects = merged.elements.filter((e) => e.kind === "rect") as any[];
for (const r of rects) console.log("rect", JSON.stringify(r.from), "->", JSON.stringify(r.to))
console.log("canvas width used:", Math.max(...rects.map((r) => r.to.x)).toFixed(2), "cm");
const y0 = Math.min(...rects.map((r) => r.from.y));
console.log("bottom margin (y-min):", y0.toFixed(2), "cm");