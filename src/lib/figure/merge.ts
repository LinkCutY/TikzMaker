import type { Element, Figure } from "./types";
import { uid } from "./types";
import { bboxOf } from "./edit";

export interface PanelPart {
  fig: Figure;
  /** Panel box in source-image pixels. */
  box: { x: number; y: number; w: number; h: number };
}

function bboxAll(fig: Figure) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of fig.elements) {
    const b = bboxOf(el);
    if (!b) continue;
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
}

/** Scale an element about the origin, then translate it. */
export function transformElement(el: Element, k: number, tx: number, ty: number): Element {
  if (!Number.isFinite(k) || k <= 0 || !Number.isFinite(tx) || !Number.isFinite(ty)) {
    throw new Error("图形变换需要有限的正缩放比例和位移");
  }
  const p = (pt: { x: number; y: number }) => ({ x: pt.x * k + tx, y: pt.y * k + ty });
  if (el.style.lineWidth !== undefined) el = { ...el, style: { ...el.style, lineWidth: el.style.lineWidth * k } };
  if (el.style.dashPattern) el = { ...el, style: { ...el.style, dashPattern: el.style.dashPattern.map(v => v * k) } };
  switch (el.kind) {
    case "line":
      return { ...el, from: p(el.from), to: p(el.to) };
    case "rect":
      return { ...el, from: p(el.from), to: p(el.to), rounded: el.rounded * k };
    case "circle":
      return { ...el, center: p(el.center), radius: el.radius * k };
    case "ellipse":
      return { ...el, center: p(el.center), rx: el.rx * k, ry: el.ry * k };
    case "bezier":
      return { ...el, p0: p(el.p0), c1: p(el.c1), c2: p(el.c2), p1: p(el.p1) };
    case "poly":
      return { ...el, points: el.points.map(p), rings: el.rings?.map(ring => ring.map(p)), ocr: el.ocr ? { ...el.ocr, at: p(el.ocr.at), fontSize: el.ocr.fontSize * k } : undefined };
    case "node":
      return { ...el, at: p(el.at), fontSize: Math.max(1, el.fontSize * k) };
    case "axes":
      return {
        ...el,
        origin: p(el.origin),
        xMin: el.xMin * k,
        xMax: el.xMax * k,
        yMin: el.yMin * k,
        yMax: el.yMax * k,
        tickStep: el.tickStep * k,
      };
    case "plot":
      return {
        ...el,
        // x' = k*x, y' = k*f(x): the new function is k*f(x'/k).
        // Scaling just the domain moves peaks and leaves their heights unchanged.
        expr: k === 1 ? el.expr : `(${k})*(${el.expr.replace(/\bx\b/g, `(x/(${k}))`)})`,
        offset: p(el.offset),
        xMin: el.xMin * k,
        xMax: el.xMax * k,
      };
    default:
      return el;
  }
}

/**
 * Compose per-panel figures onto one canvas. Each panel keeps its aspect ratio,
 * is fitted into the space its panel occupies in the screenshot, and is placed
 * with TikZ's y-up convention (the screenshot's y axis points down).
 */
export function mergePanels(parts: PanelPart[], imgW: number, imgH: number, canvasCm = 12): Figure {
  const scale = canvasCm / imgW;
  const elements: Element[] = [];
  for (const { fig, box } of parts) {
    // Clean the panel BEFORE measuring it: a stray 300cm line inside one panel
    // must not shrink that panel's real content when we compute its scale.
    const clean = dropOutliers(fig.elements, canvasCm);
    const bb = fig.viewport && fig.viewport.w > 0 && fig.viewport.h > 0
      ? { ...fig.viewport, x1: fig.viewport.x0 + fig.viewport.w, y1: fig.viewport.y0 + fig.viewport.h }
      : bboxAll({ elements: clean });
    if (!bb) continue;
    const targetW = box.w * scale;
    const targetH = box.h * scale;
    // A panel whose content is a single horizontal/vertical line has a zero-size
    // bbox; using it as a divisor produced absurd scale factors.
    const kx = bb.w > 1e-6 ? targetW / bb.w : Infinity;
    const ky = bb.h > 1e-6 ? targetH / bb.h : Infinity;
    let k = Math.min(kx, ky);
    if (!Number.isFinite(k)) k = Number.isFinite(kx) ? kx : Number.isFinite(ky) ? ky : 1;
    k = Math.max(0.02, Math.min(50, k));
    const tx = box.x * scale - bb.x0 * k;
    const ty = (imgH - box.y - box.h) * scale - bb.y0 * k;
    for (const el of clean) {
      elements.push({ ...transformElement(el, k, tx, ty), id: uid(el.kind.slice(0, 2)) });
    }
  }
  const finite = elements.filter((el) => {
    const b = bboxOf(el);
    return b && Number.isFinite(b.x0) && Number.isFinite(b.y0) && Number.isFinite(b.x1) && Number.isFinite(b.y1);
  });

  // One stray element (a 400cm line, a collapsed panel) used to stretch the page
  // into a 1:10 sliver. Dropping the outlier is right; scaling the whole figure
  // down would keep the stray and shrink everything good along with it.
  const kept = dropOutliers(finite, canvasCm);

  const all = bboxAll({ elements: kept });
  if (!all) return { elements: kept };
  const limitW = canvasCm;
  const limitH = Math.max(canvasCm, (imgH / imgW) * canvasCm) * 1.5;
  const fit = Math.min(1, limitW / Math.max(all.w, 1e-6), limitH / Math.max(all.h, 1e-6));
  if (fit < 0.35) {
    // Still oversized after removing outliers: shrink, but never below a
    // readable scale — a figure that fits the page but is 2cm tall is useless.
    return { elements: kept.map((el) => transformElement(el, fit, -all.x0 * fit, -all.y0 * fit)) };
  }
  return { elements: kept, viewport: { x0: 0, y0: 0, w: canvasCm, h: imgH / imgW * canvasCm } };
}

/**
 * Drop genuinely broken geometry only: something 4x wider/taller than the page,
 * or sitting more than 2 pages away from the rest. Absolute limits, because a
 * relative "core" test kept deleting legitimate axis lines.
 */
function dropOutliers(elements: Element[], canvasCm: number): Element[] {
  const boxes = elements.map((el) => ({ el, b: bboxOf(el) })).filter((x) => x.b) as { el: Element; b: { x0: number; y0: number; x1: number; y1: number } }[];
  if (!boxes.length) return elements;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const cx = median(boxes.map((x) => (x.b.x0 + x.b.x1) / 2));
  const cy = median(boxes.map((x) => (x.b.y0 + x.b.y1) / 2));
  const tooBig = canvasCm * 4;
  const tooFar = canvasCm * 2;
  return boxes
    .filter(({ b }) => {
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      if (w > tooBig || h > tooBig) return false;
      const dist = Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy);
      return dist <= tooFar;
    })
    .map((x) => x.el);
}
