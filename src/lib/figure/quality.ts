import type { Figure } from "./types";
import { bboxOf } from "./edit";

export interface FigureIssue { severity: "blocker" | "major" | "minor"; code: string; message: string; }

/** Geometric checks independent of a language model's self-assessment. */
export function assessFigure(fig: Figure): { ok: boolean; issues: FigureIssue[] } {
  const issues: FigureIssue[] = [];
  for(const message of fig.parseErrors||[])issues.push({severity:'blocker',code:'CANVAS_PARSE',message});
  if (!fig.elements.length) issues.push({ severity: "blocker", code: "EMPTY", message: "没有可编辑元素" });
  if (fig.elements.length > (fig.viewport ? 1800 : 500)) issues.push({ severity: "blocker", code: "REPETITION", message: "元素数量异常，可能重复生成" });
  const boxes = fig.elements.map(el => ({ el, b: bboxOf(el) }));
  for (const { el, b } of boxes) if (!b || !Object.values(b).every(Number.isFinite)) issues.push({ severity: "blocker", code: "INVALID_GEOMETRY", message: `${el.name} 的坐标无效` });
  const frames = boxes.filter(x => x.el.kind === "rect" && !x.el.style.fill && x.b).sort((a, b) => ((b.b!.x1 - b.b!.x0) * (b.b!.y1 - b.b!.y0)) - ((a.b!.x1 - a.b!.x0) * (a.b!.y1 - a.b!.y0)));
  const frame = frames[0]?.b;
  if (frame) {
    const w = frame.x1 - frame.x0, h = frame.y1 - frame.y0;
    const curves = boxes.filter(x => ["plot", "bezier", "poly"].includes(x.el.kind) && x.b && x.b.x1 - x.b.x0 > w * 0.45);
    for (const { el, b } of curves) {
      if (!b || b.x1 < frame.x0 || b.x0 > frame.x1) continue;
      if (b.x0 < frame.x0 - w * 0.02 || b.x1 > frame.x1 + w * 0.02 || b.y0 < frame.y0 - h * 0.02 || b.y1 > frame.y1 + h * 0.02) issues.push({ severity: "major", code: "CURVE_OUTSIDE_FRAME", message: `${el.name} 超出坐标框，需要修正曲线或坐标映射` });
    }
  }
  return { ok: !issues.some(i => i.severity !== "minor"), issues };
}
