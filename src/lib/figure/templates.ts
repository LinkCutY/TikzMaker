import type { Figure } from "./types";
import { defaultStyle, elementLabel } from "./types";

const S = (over: Partial<ReturnType<typeof defaultStyle>> = {}) => ({ ...defaultStyle(), ...over });

let counters: Record<string, number> = {};
const nm = (kind: Parameters<typeof elementLabel>[0]) => {
  counters[kind] = (counters[kind] ?? 0) + 1;
  return elementLabel(kind, counters[kind]);
};

function resetNames() {
  counters = {};
}

export interface FigureTemplate {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  /** Preset ids offered in the canvas tool strip for this template. */
  tools?: string[];
  build: () => Figure;
}

function axes(opts: {
  origin?: { x: number; y: number };
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  xLabel?: string;
  yLabel?: string;
  tick?: number;
}) {
  return {
    id: "tpl-ax",
    kind: "axes" as const,
    name: nm("axes"),
    origin: opts.origin ?? { x: 0, y: 0 },
    xMin: opts.xMin ?? 0,
    xMax: opts.xMax ?? 5,
    yMin: opts.yMin ?? 0,
    yMax: opts.yMax ?? 3,
    xLabel: opts.xLabel ?? "t",
    yLabel: opts.yLabel ?? "y",
    tickStep: opts.tick ?? 1,
    showTicks: true,
    style: S({ thickness: "thick", arrow: "->" }),
  };
}

export const figureTemplates: FigureTemplate[] = [
  {
    id: "decay",
    name: "函数曲线",
    desc: "坐标轴 + 指数衰减曲线 + 交点标注",
    tags: ["坐标轴", "函数"],
    tools: ["axes-pos", "dot", "label", "arrow"],
    build() {
      resetNames();
      return {
        elements: [
          axes({ xMax: 5, yMax: 3, xLabel: "t", yLabel: "y" }),
          {
            id: "tpl-p1",
            kind: "plot",
            name: nm("plot"),
            expr: "2.4*exp(-0.55*x)+0.25",
            xMin: 0,
            xMax: 4.6,
            samples: 64,
            offset: { x: 0, y: 0 },
            style: S({ color: "blue", thickness: "thick" }),
          },
          {
            id: "tpl-p2",
            kind: "plot",
            name: nm("plot"),
            expr: "0.35*x",
            xMin: 0,
            xMax: 4.6,
            samples: 40,
            offset: { x: 0, y: 0 },
            style: S({ color: "orange", dashed: true, thickness: "thick" }),
          },
          {
            id: "tpl-n1",
            kind: "node",
            name: nm("node"),
            at: { x: 2.47, y: 1.02 },
            text: "交点",
            style: S({ color: "red" }),
            boxed: false,
            rounded: 0,
            fontSize: 9,
            anchor: "west",
          },
        ],
      };
    },
  },
  {
    id: "flow",
    name: "流程图",
    desc: "圆角矩形 + 箭头，适合方法总览",
    tags: ["流程图"],
    tools: ["flow-box", "flow-decision", "arrow", "arrow-both", "label"],
    build() {
      resetNames();
      const box = (x: number, y: number, text: string, fill: string) => ({
        id: `f-${x}-${y}`,
        kind: "node" as const,
        name: nm("node"),
        at: { x, y },
        text,
        style: S({ fill }),
        boxed: true,
        rounded: 0.18,
        fontSize: 9,
        anchor: "center" as const,
      });
      const arrow = (from: { x: number; y: number }, to: { x: number; y: number }) => ({
        id: `a-${from.x}-${from.y}-${to.x}-${to.y}`,
        kind: "line" as const,
        name: nm("line"),
        from,
        to,
        style: S({ thickness: "thick", arrow: "->" as const }),
      });
      return {
        elements: [
          box(0, 3, "输入数据", "blue!12"),
          box(4, 3, "特征提取", "blue!12"),
          box(8, 3, "预测结果", "blue!12"),
          box(4, 0.6, "损失计算", "orange!16"),
          arrow({ x: 1.9, y: 3 }, { x: 2.9, y: 3 }),
          arrow({ x: 5.9, y: 3 }, { x: 6.9, y: 3 }),
          arrow({ x: 4, y: 2.4 }, { x: 4, y: 1.3 }),
        ],
      };
    },
  },
  {
    id: "network",
    name: "神经网络",
    desc: "三层全连接结构，节点与连线",
    tags: ["结构图"],
    tools: ["dot", "dot-hollow", "arrow", "label"],
    build() {
      resetNames();
      const els: any[] = [];
      const layers = [
        { n: 4, x: 0 },
        { n: 3, x: 3 },
        { n: 2, x: 6 },
      ];
      layers.forEach((layer) => {
        for (let i = 0; i < layer.n; i++) {
          els.push({
            id: `n-${layer.x}-${i}`,
            kind: "circle",
            name: nm("circle"),
            center: { x: layer.x, y: 3 - i * 1.4 + (layer.n - 1) * 0.7 },
            radius: 0.32,
            style: S({ fill: "blue!10" }),
          });
        }
      });
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          els.push({
            id: `l1-${i}-${j}`,
            kind: "line",
            name: nm("line"),
            from: { x: 0.32, y: 5.1 - i * 1.4 },
            to: { x: 2.68, y: 4.4 - j * 1.4 },
            style: S({ color: "gray" }),
          });
        }
      }
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          els.push({
            id: `l2-${i}-${j}`,
            kind: "line",
            name: nm("line"),
            from: { x: 3.32, y: 4.4 - i * 1.4 },
            to: { x: 5.68, y: 3.7 - j * 1.4 },
            style: S({ color: "gray" }),
          });
        }
      }
      ["输入层", "隐层", "输出层"].forEach((t, i) => {
        els.push({
          id: `t-${i}`,
          kind: "node",
          name: nm("node"),
          at: { x: i * 3, y: 6.2 },
          text: t,
          style: S(),
          boxed: false,
          rounded: 0,
          fontSize: 9,
          anchor: "center",
        });
      });
      return { elements: els };
    },
  },
  {
    id: "bezier",
    name: "贝塞尔曲线",
    desc: "三次曲线与控制点，便于后续调形",
    tags: ["曲线"],
    tools: ["bezier", "arrow", "label"],
    build() {
      resetNames();
      return {
        elements: [
          {
            id: "b1",
            kind: "bezier",
            name: nm("bezier"),
            p0: { x: 0, y: 0 },
            c1: { x: 1.5, y: 3 },
            c2: { x: 3.5, y: 3 },
            p1: { x: 5, y: 0.5 },
            style: S({ color: "blue", thickness: "thick" }),
          },
          {
            id: "b2",
            kind: "line",
            name: nm("line"),
            from: { x: 0, y: 0 },
            to: { x: 1.5, y: 3 },
            style: S({ color: "gray", dashed: true }),
          },
          {
            id: "b3",
            kind: "line",
            name: nm("line"),
            from: { x: 3.5, y: 3 },
            to: { x: 5, y: 0.5 },
            style: S({ color: "gray", dashed: true }),
          },
        ],
      };
    },
  },
  {
    id: "geometry",
    name: "几何示意",
    desc: "三角形与直角标记，适合数学插图",
    tags: ["几何"],
    tools: ["arrow", "label", "dot"],
    build() {
      resetNames();
      return {
        elements: [
          {
            id: "g1",
            kind: "line",
            name: nm("line"),
            from: { x: 0, y: 0 },
            to: { x: 4, y: 0 },
            style: S({ thickness: "thick" }),
          },
          {
            id: "g2",
            kind: "line",
            name: nm("line"),
            from: { x: 4, y: 0 },
            to: { x: 4, y: 2.6 },
            style: S({ thickness: "thick" }),
          },
          {
            id: "g3",
            kind: "line",
            name: nm("line"),
            from: { x: 4, y: 2.6 },
            to: { x: 0, y: 0 },
            style: S({ thickness: "thick" }),
          },
          {
            id: "g4",
            kind: "rect",
            name: nm("rect"),
            from: { x: 3.6, y: 0 },
            to: { x: 4, y: 0.4 },
            style: S({ color: "gray" }),
            rounded: 0,
          },
          {
            id: "g5",
            kind: "node",
            name: nm("node"),
            at: { x: 2.2, y: 1.6 },
            text: "c",
            style: S(),
            boxed: false,
            rounded: 0,
            fontSize: 10,
            anchor: "center",
          },
        ],
      };
    },
  },
  {
    id: "tree",
    name: "树状结构",
    desc: "根节点与分支，适合分类/语法树",
    tags: ["结构图"],
    tools: ["dot", "dot-hollow", "arrow", "label"],
    build() {
      resetNames();
      const r = 0.3;
      const node = (id: string, x: number, y: number, text: string, fill = "teal!12") => ({
        id,
        kind: "circle" as const,
        name: nm("circle"),
        center: { x, y },
        radius: r,
        style: S({ fill }),
      });
      const edge = (id: string, a: { x: number; y: number }, b: { x: number; y: number }) => ({
        id,
        kind: "line" as const,
        name: nm("line"),
        from: a,
        to: b,
        style: S({ color: "gray", thickness: "thick" as const }),
      });
      return {
        elements: [
          node("t0", 3, 4.2, "A", "blue!12"),
          node("t1", 1.2, 2.4, "B"),
          node("t2", 3, 2.4, "C"),
          node("t3", 4.8, 2.4, "D"),
          node("t4", 0.4, 0.6, "E"),
          node("t5", 2, 0.6, "F"),
          edge("e1", { x: 3, y: 3.9 }, { x: 1.2, y: 2.7 }),
          edge("e2", { x: 3, y: 3.9 }, { x: 3, y: 2.7 }),
          edge("e3", { x: 3, y: 3.9 }, { x: 4.8, y: 2.7 }),
          edge("e4", { x: 1.2, y: 2.1 }, { x: 0.4, y: 0.9 }),
          edge("e5", { x: 1.2, y: 2.1 }, { x: 2, y: 0.9 }),
        ],
      };
    },
  },
  {
    id: "axes-only",
    name: "空白坐标系",
    desc: "只有坐标轴和刻度，从零开始画",
    tags: ["坐标轴"],
    tools: ["axes-pos", "axes-quad", "dot", "label", "arrow"],
    build() {
      resetNames();
      return { elements: [axes({ xMax: 6, yMax: 4 })] };
    },
  },
  {
    id: "quadrant",
    name: "四象限坐标系",
    desc: "含负半轴，适合画周期函数与对称曲线",
    tags: ["坐标轴"],
    tools: ["axes-quad", "dot", "label", "arrow"],
    build() {
      resetNames();
      return {
        elements: [
          axes({ xMin: -3, xMax: 3, yMin: -1.6, yMax: 1.6, xLabel: "x", yLabel: "y", origin: { x: 0, y: 0 }, tick: 1 }),
          {
            id: "q-p1",
            kind: "plot",
            name: nm("plot"),
            expr: "sin(x)",
            xMin: -3,
            xMax: 3,
            samples: 80,
            offset: { x: 0, y: 0 },
            style: S({ color: "blue", thickness: "thick" }),
          },
        ],
      };
    },
  },
  {
    id: "blank",
    name: "空白画布",
    desc: "什么都不放，自由绘制",
    tags: ["空白"],
    tools: ["flow-box", "arrow", "dot", "label", "axes-quad"],
    build() {
      resetNames();
      return { elements: [] };
    },
  },
];

export function templateById(id: string): FigureTemplate | undefined {
  return figureTemplates.find((t) => t.id === id);
}

export function defaultFigure(): Figure {
  return figureTemplates[0].build();
}
