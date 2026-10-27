import type { AxesEl, BezierEl, CircleEl, EllipseEl, Element, LineEl, NodeEl, PlotEl, PolyEl, Pt, RectEl } from "./types";
import { defaultStyle, uid, elementLabel } from "./types";
import { compileExpr, samplePlot } from "./expr";

export type ToolId = "select" | "line" | "rect" | "circle" | "bezier" | "node" | "axes" | "plot";

export const PT_CM = 0.0352778; // 1pt in cm

export function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;

export function estimateTextWidth(text: string, fontSizePt: number): number {
  const em = fontSizePt * PT_CM;
  let w = 0;
  for (const ch of text) w += CJK.test(ch) ? 1.0 * em : 0.52 * em;
  return w;
}

export function nodeBox(el: NodeEl) {
  const em = el.fontSize * PT_CM;
  // TikZ's inner sep is 0.3333em, but the glyph box adds side bearings on top;
  // 0.5em is what actually looks like the compiled output.
  const inner = Math.max(4 * PT_CM, em * 0.5);
  // $…$ delimiters are markup, not glyphs.
  const w = estimateTextWidth((el.text || " ").replace(/\$/g, ""), el.fontSize) + inner * 2;
  const h = em * 1.6 + inner * 0.8;
  let x0 = el.at.x - w / 2;
  let y0 = el.at.y - h / 2;
  let x1 = el.at.x + w / 2;
  let y1 = el.at.y + h / 2;
  if (el.anchor.includes("west")) {
    x0 = el.at.x;
    x1 = el.at.x + w;
  } else if (el.anchor.includes("east")) {
    x1 = el.at.x;
    x0 = el.at.x - w;
  }
  if (el.anchor.includes("north")) {
    y1 = el.at.y;
    y0 = el.at.y - h;
  } else if (el.anchor.includes("south")) {
    y0 = el.at.y;
    y1 = el.at.y + h;
  }
  return { x0, y0, x1, y1, w, h };
}

export function plotRuns(el: PlotEl, minSamples = 0) {
  const compiled = compileExpr(el.expr);
  if (!compiled.ok) return [];
  // Canvas renders at screen density; the stored "samples" is the export density.
  const n = Math.max(el.samples, minSamples);
  return samplePlot(compiled.fn, el.xMin, el.xMax, n).map((run) => run.map((p) => ({ x: p.x + el.offset.x, y: p.y + el.offset.y })));
}

export function hitTest(el: Element, p: Pt, tol: number): boolean {
  switch (el.kind) {
    case "poly": {
      const e = el as PolyEl;
      let inside = false;
      for (const ring of [e.points, ...(e.rings || [])]) {
        const pts = e.closed ? [...ring, ring[0]] : ring;
        for (let i = 0; i < pts.length - 1; i++) {
          if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return true;
          const a = pts[i], b = pts[i + 1];
          if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
      }
      if (e.closed && e.style.fill && inside) return true;
      return false;
    }
    case "line": {
      const e = el as LineEl;
      return distToSegment(p, e.from, e.to) <= tol;
    }
    case "rect": {
      const e = el as RectEl;
      const x0 = Math.min(e.from.x, e.to.x);
      const x1 = Math.max(e.from.x, e.to.x);
      const y0 = Math.min(e.from.y, e.to.y);
      const y1 = Math.max(e.from.y, e.to.y);
      const corners: Pt[] = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      if (p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol) return true;
      for (let i = 0; i < 4; i++) if (distToSegment(p, corners[i], corners[(i + 1) % 4]) <= tol) return true;
      return false;
    }
    case "circle": {
      const e = el as CircleEl;
      return Math.abs(dist(p, e.center) - e.radius) <= tol || dist(p, e.center) <= e.radius;
    }
    case "ellipse": {
      const e = el as EllipseEl;
      const dx = (p.x - e.center.x) / Math.max(e.rx, 1e-6);
      const dy = (p.y - e.center.y) / Math.max(e.ry, 1e-6);
      const k = Math.hypot(dx, dy);
      return Math.abs(k - 1) * Math.min(e.rx, e.ry) <= tol || k <= 1;
    }
    case "bezier": {
      const e = el as BezierEl;
      let prev = e.p0;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24;
        const pt = bezierAt(e, t);
        if (distToSegment(p, prev, pt) <= tol) return true;
        prev = pt;
      }
      return false;
    }
    case "node": {
      const b = nodeBox(el as NodeEl);
      return p.x >= b.x0 - tol && p.x <= b.x1 + tol && p.y >= b.y0 - tol && p.y <= b.y1 + tol;
    }
    case "axes": {
      const e = el as AxesEl;
      const xa = { x: e.origin.x + e.xMin, y: e.origin.y };
      const xb = { x: e.origin.x + e.xMax, y: e.origin.y };
      const ya = { x: e.origin.x, y: e.origin.y + e.yMin };
      const yb = { x: e.origin.x, y: e.origin.y + e.yMax };
      return distToSegment(p, xa, xb) <= tol || distToSegment(p, ya, yb) <= tol;
    }
    case "plot": {
      const e = el as PlotEl;
      for (const run of plotRuns(e)) {
        for (let i = 1; i < run.length; i++) {
          if (distToSegment(p, run[i - 1], run[i]) <= tol) return true;
        }
      }
      return false;
    }
  }
  return false;
}

export function bezierAt(e: BezierEl, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * e.p0.x + b * e.c1.x + c * e.c2.x + d * e.p1.x,
    y: a * e.p0.y + b * e.c1.y + c * e.c2.y + d * e.p1.y,
  };
}

export function translate(el: Element, dx: number, dy: number): Element {
  const mv = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  switch (el.kind) {
    case "poly":
      return { ...el, points: el.points.map(mv), rings: el.rings?.map(ring => ring.map(mv)), ocr: el.ocr ? { ...el.ocr, at: mv(el.ocr.at) } : undefined };
    case "line":
      return { ...el, from: mv(el.from), to: mv(el.to) };
    case "rect":
      return { ...el, from: mv(el.from), to: mv(el.to) };
    case "circle":
      return { ...el, center: mv(el.center) };
    case "ellipse":
      return { ...el, center: mv(el.center) };
    case "bezier":
      return { ...el, p0: mv(el.p0), c1: mv(el.c1), c2: mv(el.c2), p1: mv(el.p1) };
    case "node":
      return { ...el, at: mv(el.at) };
    case "axes":
      return { ...el, origin: mv(el.origin) };
    case "plot":
      return { ...el, offset: mv(el.offset) };
  }
  return el;
}

export interface Handle {
  id: string;
  p: Pt;
  kind: "end" | "control";
}

export function handlesOf(el: Element): Handle[] {
  switch (el.kind) {
    case "poly": {
      const b = bboxOf(el);
      return b ? [{ id: "nw", p: { x: b.x0, y: b.y1 }, kind: "end" }, { id: "se", p: { x: b.x1, y: b.y0 }, kind: "end" }] : [];
    }
    case "line":
      return [
        { id: "a", p: el.from, kind: "end" },
        { id: "b", p: el.to, kind: "end" },
      ];
    case "rect":
      return [
        { id: "nw", p: { x: Math.min(el.from.x, el.to.x), y: Math.max(el.from.y, el.to.y) }, kind: "end" },
        { id: "ne", p: { x: Math.max(el.from.x, el.to.x), y: Math.max(el.from.y, el.to.y) }, kind: "end" },
        { id: "se", p: { x: Math.max(el.from.x, el.to.x), y: Math.min(el.from.y, el.to.y) }, kind: "end" },
        { id: "sw", p: { x: Math.min(el.from.x, el.to.x), y: Math.min(el.from.y, el.to.y) }, kind: "end" },
      ];
    case "circle":
      return [{ id: "r", p: { x: el.center.x + el.radius, y: el.center.y }, kind: "end" }];
    case "ellipse":
      return [
        { id: "rx", p: { x: el.center.x + el.rx, y: el.center.y }, kind: "end" },
        { id: "ry", p: { x: el.center.x, y: el.center.y + el.ry }, kind: "end" },
      ];
    case "bezier":
      return [
        { id: "p0", p: el.p0, kind: "end" },
        { id: "c1", p: el.c1, kind: "control" },
        { id: "c2", p: el.c2, kind: "control" },
        { id: "p1", p: el.p1, kind: "end" },
      ];
    case "axes":
      return [
        { id: "origin", p: el.origin, kind: "end" },
        { id: "xmax", p: { x: el.origin.x + el.xMax, y: el.origin.y }, kind: "end" },
        { id: "xmin", p: { x: el.origin.x + el.xMin, y: el.origin.y }, kind: "end" },
        { id: "ymax", p: { x: el.origin.x, y: el.origin.y + el.yMax }, kind: "end" },
        { id: "ymin", p: { x: el.origin.x, y: el.origin.y + el.yMin }, kind: "end" },
      ];
    case "plot":
      return [{ id: "offset", p: el.offset, kind: "end" }];
    case "node":
      return [];
  }
  return [];
}

export function setHandle(el: Element, id: string, p: Pt): Element {
  switch (el.kind) {
    case "poly": {
      const b = bboxOf(el);
      if (!b) return el;
      const anchor = id === "nw" ? { x: b.x1, y: b.y0 } : { x: b.x0, y: b.y1 };
      const moving = id === "nw" ? { x: b.x0, y: b.y1 } : { x: b.x1, y: b.y0 };
      const kx = (p.x - anchor.x) / (moving.x - anchor.x || 1), ky = (p.y - anchor.y) / (moving.y - anchor.y || 1);
      const move = (q: Pt) => ({ x: anchor.x + (q.x - anchor.x) * kx, y: anchor.y + (q.y - anchor.y) * ky });
      return { ...el, points: el.points.map(move), rings: el.rings?.map(ring => ring.map(move)), ocr: el.ocr ? { ...el.ocr, at: move(el.ocr.at), fontSize: el.ocr.fontSize * Math.sqrt(Math.abs(kx * ky)) } : undefined };
    }
    case "line": {
      if (id === "a") return { ...el, from: p };
      if (id === "b") return { ...el, to: p };
      return el;
    }
    case "rect": {
      const x0 = Math.min(el.from.x, el.to.x);
      const x1 = Math.max(el.from.x, el.to.x);
      const y0 = Math.min(el.from.y, el.to.y);
      const y1 = Math.max(el.from.y, el.to.y);
      switch (id) {
        case "nw":
          return { ...el, from: { x: Math.min(p.x, x1), y: Math.max(p.y, y0) }, to: { x: x1, y: y0 } };
        case "ne":
          return { ...el, from: { x: x0, y: Math.max(p.y, y0) }, to: { x: Math.max(p.x, x0), y: y0 } };
        case "se":
          return { ...el, from: { x: x0, y: y1 }, to: { x: Math.max(p.x, x0), y: Math.min(p.y, y1) } };
        case "sw":
          return { ...el, from: { x: Math.min(p.x, x1), y: y1 }, to: { x: x1, y: Math.min(p.y, y1) } };
      }
      return el;
    }
    case "circle":
      return { ...el, radius: Math.max(0.05, dist(p, el.center)) };
    case "ellipse": {
      if (id === "rx") return { ...el, rx: Math.max(0.05, Math.abs(p.x - el.center.x)) };
      return { ...el, ry: Math.max(0.05, Math.abs(p.y - el.center.y)) };
    }
    case "bezier": {
      if (id === "p0") return { ...el, p0: p };
      if (id === "c1") return { ...el, c1: p };
      if (id === "c2") return { ...el, c2: p };
      if (id === "p1") return { ...el, p1: p };
      return el;
    }
    case "axes": {
      if (id === "origin") {
        return { ...el, origin: p };
      }
      if (id === "xmax") return { ...el, xMax: p.x - el.origin.x };
      if (id === "xmin") return { ...el, xMin: p.x - el.origin.x };
      if (id === "ymax") return { ...el, yMax: p.y - el.origin.y };
      if (id === "ymin") return { ...el, yMin: p.y - el.origin.y };
      return el;
    }
    case "plot":
      return { ...el, offset: p };
  }
  return el;
}

/** Build a brand new element for a drag of tool from a -> b. */
export function createFromDrag(tool: ToolId, a: Pt, b: Pt, n: number): Element | null {
  const name = (k: Element["kind"]) => elementLabel(k, n);
  const style = defaultStyle();
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  switch (tool) {
    case "line":
      return { id: uid("ln"), kind: "line", name: name("line"), from: a, to: b, style: { ...style, thickness: "thick" } } as LineEl;
    case "rect":
      return { id: uid("rc"), kind: "rect", name: name("rect"), from: a, to: b, style, rounded: 0 } as RectEl;
    case "circle":
      return { id: uid("ci"), kind: "circle", name: name("circle"), center: a, radius: Math.max(0.1, dist(a, b)), style } as CircleEl;
    case "bezier":
      return {
        id: uid("bz"),
        kind: "bezier",
        name: name("bezier"),
        p0: a,
        c1: { x: a.x + dx * 0.33, y: a.y + dy * 0.9 },
        c2: { x: a.x + dx * 0.67, y: a.y + dy * 0.9 },
        p1: b,
        style: { ...style, thickness: "thick" },
      } as BezierEl;
    case "axes":
      return {
        id: uid("ax"),
        kind: "axes",
        name: name("axes"),
        origin: a,
        xMin: Math.min(0, dx),
        xMax: Math.max(0.5, dx),
        yMin: Math.min(0, dy),
        yMax: Math.max(0.5, dy),
        xLabel: "x",
        yLabel: "y",
        tickStep: 1,
        showTicks: true,
        style: { ...style, thickness: "thick", arrow: "->" },
      } as AxesEl;
    case "node":
      return {
        id: uid("nd"),
        kind: "node",
        name: name("node"),
        at: a,
        text: "文本",
        style,
        boxed: true,
        rounded: 0.12,
        fontSize: 9,
        anchor: "center",
      } as NodeEl;
    case "plot":
      return {
        id: uid("pl"),
        kind: "plot",
        name: name("plot"),
        expr: "sin(x)",
        xMin: 0,
        xMax: 6.283,
        samples: 60,
        offset: a,
        style: { ...style, color: "blue", thickness: "thick" },
      } as PlotEl;
    default:
      return null;
  }
}

export function bboxOf(el: Element) {
  if (el.kind === "poly") {
    const e = el as PolyEl;
    if (!e.points.length) return null;
    const points = [e.points, ...(e.rings || [])].flat();
    return {
      x0: Math.min(...points.map((p) => p.x)),
      y0: Math.min(...points.map((p) => p.y)),
      x1: Math.max(...points.map((p) => p.x)),
      y1: Math.max(...points.map((p) => p.y)),
    };
  }
  if (el.kind === "node") {
    const b = nodeBox(el as NodeEl);
    return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  }
  if (el.kind === "plot") {
    const pts = plotRuns(el as PlotEl).flat();
    if (!pts.length) return null;
    return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
  }
  if (el.kind === "line") return { x0: Math.min(el.from.x, el.to.x), y0: Math.min(el.from.y, el.to.y), x1: Math.max(el.from.x, el.to.x), y1: Math.max(el.from.y, el.to.y) };
  if (el.kind === "rect") return { x0: Math.min(el.from.x, el.to.x), y0: Math.min(el.from.y, el.to.y), x1: Math.max(el.from.x, el.to.x), y1: Math.max(el.from.y, el.to.y) };
  if (el.kind === "circle") return { x0: el.center.x - el.radius, y0: el.center.y - el.radius, x1: el.center.x + el.radius, y1: el.center.y + el.radius };
  if (el.kind === "ellipse") return { x0: el.center.x - el.rx, y0: el.center.y - el.ry, x1: el.center.x + el.rx, y1: el.center.y + el.ry };
  if (el.kind === "bezier") {
    const pts = [el.p0, el.c1, el.c2, el.p1];
    return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
  }
  if (el.kind === "axes") {
    return {
      x0: el.origin.x + Math.min(el.xMin, el.xMax),
      y0: el.origin.y + Math.min(el.yMin, el.yMax),
      x1: el.origin.x + Math.max(el.xMin, el.xMax),
      y1: el.origin.y + Math.max(el.yMin, el.yMax),
    };
  }
  return null;
}
