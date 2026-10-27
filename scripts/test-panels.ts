import { readFileSync } from "node:fs";
import { detectPanelsFromGray } from "../src/lib/panels";

for (const file of [".shots/panelb-orig.json", ".shots/panelb-gray.json"]) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const panels = detectPanelsFromGray(raw);
  console.log(file, raw.w + "x" + raw.h, "->", panels.length, "panels:", panels.map((p: any) => `(${p.x},${p.y},${p.w}x${p.h})`).join(" "));
}