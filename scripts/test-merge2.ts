import { mergePanels } from "../src/lib/figure/merge";
import { defaultStyle } from "../src/lib/figure/types";

const st = defaultStyle();
const good = (x: number, y: number) => ({ elements: [
  { id: "r" + x, kind: "rect" as const, name: "rect", from: { x, y }, to: { x: x + 4, y: y + 3 }, style: st, rounded: 0 },
  { id: "l" + x, kind: "line" as const, name: "line", from: { x, y }, to: { x: x + 4, y: y + 3 }, style: st },
] });
// panel 3 returns one element that runs 300cm off the page
const wild = { elements: [
  { id: "a", kind: "rect" as const, name: "rect", from: { x: 0, y: 0 }, to: { x: 4, y: 3 }, style: st, rounded: 0 },
  { id: "b", kind: "line" as const, name: "line", from: { x: 0, y: 0 }, to: { x: 4, y: 3 }, style: st },
  { id: "c", kind: "line" as const, name: "stray", from: { x: 0, y: 0 }, to: { x: 0, y: -300 }, style: st },
] };

const merged = mergePanels([
  { fig: good(0, 0) as any, box: { x: 0, y: 0, w: 200, h: 150 } },
  { fig: wild as any, box: { x: 200, y: 0, w: 200, h: 150 } },
], 400, 150, 12);

const els = merged.elements as any[];
const pts = els.flatMap((el) => (el.from ? [el.from, el.to] : el.points ?? []));
const ys = pts.map((p: any) => p.y);
const xs = pts.map((p: any) => p.x);
console.log("elements:", els.length, "| stray kept:", els.some((e) => e.name === "stray"));
console.log("x:", Math.min(...xs).toFixed(1), "..", Math.max(...xs).toFixed(1), "| y:", Math.min(...ys).toFixed(1), "..", Math.max(...ys).toFixed(1));