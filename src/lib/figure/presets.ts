import type { AxesEl, BezierEl, CircleEl, Element, LineEl, NodeEl, Pt, Style } from "./types";
import { defaultStyle, elementLabel, uid } from "./types";

/**
 * One-click figure primitives shown in the canvas tool strip. Templates declare
 * which presets they want, so importing a flowchart immediately gives you
 * flowchart-shaped boxes and arrows instead of a bare black rectangle tool.
 */
export interface Preset {
  id: string;
  label: string;
  hint: string;
  build: (p: Pt, n: number) => Element;
}

const S = (over: Partial<Style> = {}): Style => ({ ...defaultStyle(), ...over });

const node = (p: Pt, n: number, opts: { text: string; fill: string; rounded?: number; fontSize?: number; boxed?: boolean }): NodeEl => ({
  id: uid("nd"),
  kind: "node",
  name: elementLabel("node", n),
  at: p,
  text: opts.text,
  style: S({ fill: opts.fill }),
  boxed: opts.boxed ?? true,
  rounded: opts.rounded ?? 0.12,
  fontSize: opts.fontSize ?? 9,
  anchor: "center",
});

const line = (p: Pt, n: number, dx: number, arrow: Style["arrow"], over: Partial<Style> = {}): LineEl => ({
  id: uid("ln"),
  kind: "line",
  name: elementLabel("line", n),
  from: { x: p.x - dx, y: p.y },
  to: { x: p.x + dx, y: p.y },
  style: S({ thickness: "thick", arrow, ...over }),
});

const axes = (p: Pt, n: number, xMin: number, xMax: number, yMin: number, yMax: number): AxesEl => ({
  id: uid("ax"),
  kind: "axes",
  name: elementLabel("axes", n),
  origin: p,
  xMin,
  xMax,
  yMin,
  yMax,
  xLabel: "x",
  yLabel: "y",
  tickStep: 1,
  showTicks: true,
  style: S({ thickness: "thick", arrow: "->" }),
});

export const PRESETS: Preset[] = [
  {
    id: "flow-box",
    label: "流程框",
    hint: "带文字的圆角矩形",
    build: (p, n) => node(p, n, { text: "步骤", fill: "blue!12" }),
  },
  {
    id: "flow-decision",
    label: "判断框",
    hint: "橙色判断节点",
    build: (p, n) => node(p, n, { text: "条件？", fill: "orange!18", rounded: 0.3 }),
  },
  {
    id: "arrow",
    label: "箭头",
    hint: "水平箭头，拖动端点可改方向",
    build: (p, n) => line(p, n, 0.9, "->"),
  },
  {
    id: "arrow-both",
    label: "双向箭头",
    hint: "两端都有箭头",
    build: (p, n) => line(p, n, 0.9, "<->"),
  },
  {
    id: "dot",
    label: "圆点",
    hint: "实心小圆点",
    build: (p, n): CircleEl => ({
      id: uid("ci"),
      kind: "circle",
      name: elementLabel("circle", n),
      center: p,
      radius: 0.09,
      style: S({ fill: "black" }),
    }),
  },
  {
    id: "dot-hollow",
    label: "空心圆",
    hint: "用于树/网络节点",
    build: (p, n): CircleEl => ({
      id: uid("ci"),
      kind: "circle",
      name: elementLabel("circle", n),
      center: p,
      radius: 0.3,
      style: S({ fill: "blue!8" }),
    }),
  },
  {
    id: "label",
    label: "文字",
    hint: "无边框文本",
    build: (p, n) => node(p, n, { text: "说明", fill: "white", boxed: false, rounded: 0 }),
  },
  {
    id: "axes-pos",
    label: "坐标轴",
    hint: "正半轴 5×3",
    build: (p, n) => axes(p, n, 0, 5, 0, 3),
  },
  {
    id: "axes-quad",
    label: "四象限轴",
    hint: "含负半轴 -3..3",
    build: (p, n) => axes(p, n, -3, 3, -2, 2),
  },
  {
    id: "bezier",
    label: "曲线",
    hint: "三次贝塞尔，可拖控制点",
    build: (p, n): BezierEl => ({
      id: uid("bz"),
      kind: "bezier",
      name: elementLabel("bezier", n),
      p0: { x: p.x - 1.2, y: p.y },
      c1: { x: p.x - 0.6, y: p.y + 1.2 },
      c2: { x: p.x + 0.6, y: p.y - 1.2 },
      p1: { x: p.x + 1.2, y: p.y },
      style: S({ thickness: "thick", arrow: "->" }),
    }),
  },
];

export function getPreset(id: string | null | undefined): Preset | undefined {
  if (!id) return undefined;
  return PRESETS.find((p) => p.id === id);
}

export function defaultTools(): string[] {
  return ["flow-box", "arrow", "dot", "label", "axes-quad"];
}
