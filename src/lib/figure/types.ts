export type Pt = { x: number; y: number };
export type ArrowKind = "none" | "->" | "<-" | "<->";
export type Thickness = "thin" | "normal" | "thick" | "very thick";

export interface Style {
  color: string;
  fill: string | null;
  dashed: boolean;
  thickness: Thickness;
  arrow: ArrowKind;
  dotted?: boolean;
  /** Alternating on/off lengths in TeX points. */
  dashPattern?: number[];
  lineCap?: 'round' | 'butt' | 'rect';
  lineWidth?: number;
  opacity?: number;
  strokeNone?: boolean;
}

export interface BaseEl {
  id: string;
  kind: string;
  name: string;
}

export interface LineEl extends BaseEl {
  kind: "line";
  from: Pt;
  to: Pt;
  style: Style;
}

export interface RectEl extends BaseEl {
  kind: "rect";
  from: Pt;
  to: Pt;
  style: Style;
  rounded: number;
}

export interface CircleEl extends BaseEl {
  kind: "circle";
  center: Pt;
  radius: number;
  style: Style;
}

export interface EllipseEl extends BaseEl {
  kind: "ellipse";
  center: Pt;
  rx: number;
  ry: number;
  style: Style;
}

export interface BezierEl extends BaseEl {
  kind: "bezier";
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p1: Pt;
  style: Style;
}

export interface NodeEl extends BaseEl {
  kind: "node";
  at: Pt;
  text: string;
  style: Style;
  boxed: boolean;
  rounded: number;
  fontSize: number;
  rotate?: number;
  fontFamily?: 'serif' | 'sans';
  bold?: boolean;
  anchor: "center" | "west" | "east" | "north" | "south" | "north west" | "north east" | "south west" | "south east";
}

export interface AxesEl extends BaseEl {
  kind: "axes";
  /** Crossing point of the two axes (world cm). */
  origin: Pt;
  /** Extent relative to the origin; negatives give the negative half-axes. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xLabel: string;
  yLabel: string;
  tickStep: number;
  showTicks: boolean;
  style: Style;
}

export interface PlotEl extends BaseEl {
  kind: "plot";
  expr: string;
  /** Set when the source expression could not be evaluated (surfaced on canvas). */
  exprError?: string;
  /** Original TikZ statement, kept so a round-trip cannot destroy the curve. */
  raw?: string;
  xMin: number;
  xMax: number;
  samples: number;
  offset: Pt;
  style: Style;
}

/** Multi-segment path: \draw (a) -- (b) -- (c) -- cycle;  (cube edges, polygons) */
export interface PolyEl extends BaseEl {
  kind: "poly";
  points: Pt[];
  closed: boolean;
  style: Style;
  smooth?: boolean;
  rings?: Pt[][];
  /** Smooth cubic chain: start + segments (points stays as a sampled fallback). */
  start?: Pt;
  path?: { c1: Pt; c2: Pt; p: Pt }[];
  ocr?: { text: string; at: Pt; fontSize: number };
}

export type Element = LineEl | RectEl | CircleEl | EllipseEl | BezierEl | NodeEl | AxesEl | PlotEl | PolyEl;
export type ElementKind = Element["kind"];

export interface Figure {
  elements: Element[];
  viewport?: { x0: number; y0: number; w: number; h: number };
  /** 解析器无法解析的语句。界面必须显示，不能当作解析成功。 */
  parseErrors?: string[];
}

export const KINDS: ElementKind[] = ["line", "rect", "circle", "ellipse", "bezier", "node", "axes", "plot"];

export const KIND_LABEL: Record<ElementKind, string> = {
  line: "直线",
  rect: "矩形",
  circle: "圆",
  ellipse: "椭圆",
  bezier: "曲线",
  node: "文本",
  axes: "坐标轴",
  plot: "函数",
  poly: "多边形",
};

export const COLORS = ["black", "blue", "red", "orange", "teal", "purple", "green", "gray"];
export const FILLS = ["blue!12", "red!12", "orange!16", "teal!12", "purple!12", "green!12", "gray!15", "black!8"];

export function defaultStyle(): Style {
  return { color: "black", fill: null, dashed: false, thickness: "normal", arrow: "none" };
}

let seq = 0;
export function uid(prefix = "el"): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${seq.toString(36)}`;
}

export function elementLabel(kind: ElementKind, n: number): string {
  return `${KIND_LABEL[kind]} ${n}`;
}

/** Axis-aligned bounds of a single element, in cm. */
export function bounds(el: Element): { x0: number; y0: number; x1: number; y1: number } {
  switch (el.kind) {
    case "line": {
      return norm(el.from, el.to);
    }
    case "poly": {
      const all = [el.points, ...(el.rings || [])].flat();
      const xs = all.map((p) => p.x);
      const ys = all.map((p) => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case "rect": {
      return norm(el.from, el.to);
    }
    case "circle": {
      return { x0: el.center.x - el.radius, y0: el.center.y - el.radius, x1: el.center.x + el.radius, y1: el.center.y + el.radius };
    }
    case "ellipse": {
      return { x0: el.center.x - el.rx, y0: el.center.y - el.ry, x1: el.center.x + el.rx, y1: el.center.y + el.ry };
    }
    case "bezier": {
      const xs = [el.p0.x, el.c1.x, el.c2.x, el.p1.x];
      const ys = [el.p0.y, el.c1.y, el.c2.y, el.p1.y];
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case "node": {
      return { x0: el.at.x - 0.3, y0: el.at.y - 0.25, x1: el.at.x + 0.3, y1: el.at.y + 0.25 };
    }
    case "axes": {
      return {
        x0: el.origin.x + Math.min(el.xMin, el.xMax),
        y0: el.origin.y + Math.min(el.yMin, el.yMax),
        x1: el.origin.x + Math.max(el.xMin, el.xMax),
        y1: el.origin.y + Math.max(el.yMin, el.yMax),
      };
    }
    case "plot": {
      return { x0: el.xMin + el.offset.x, y0: el.offset.y - 2, x1: el.xMax + el.offset.x, y1: el.offset.y + 3 };
    }
  }
}

function norm(a: Pt, b: Pt) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export function figureBounds(fig: Figure) {
  if (!fig.elements.length) return { x0: 0, y0: 0, x1: 10, y1: 6 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of fig.elements) {
    const b = bounds(el);
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  return { x0, y0, x1, y1 };
}
