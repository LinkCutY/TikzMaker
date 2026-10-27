import { useState } from "react";
import { ArrowDown, ArrowUp, Layers, Sliders, Trash2 } from "lucide-react";
import type { AxesEl, Element, Figure, NodeEl, PlotEl, Style } from "../../lib/figure/types";
import { COLORS, FILLS, KIND_LABEL } from "../../lib/figure/types";
import { compileExpr } from "../../lib/figure/expr";

const STROKE_W: { id: Style["thickness"]; label: string }[] = [
  { id: "thin", label: "细" },
  { id: "normal", label: "常规" },
  { id: "thick", label: "粗" },
  { id: "very thick", label: "特粗" },
];

const ARROWS: { id: Style["arrow"]; label: string }[] = [
  { id: "none", label: "无" },
  { id: "->", label: "→" },
  { id: "<->", label: "↔" },
  { id: "<-", label: "←" },
];

interface Props {
  figure: Figure;
  selected: Element | null;
  snap: boolean;
  grid: boolean;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, next: Element) => void;
  onBeginEdit: () => void;
  onCommit: () => void;
  onDelete: () => void;
  onReorder: (dir: -1 | 1) => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
}

export function Inspector(props: Props) {
  const { figure, selected } = props;

  return (
    <aside className="inspector">
      {selected ? (
        <SelectedPanel {...props} el={selected} />
      ) : (
        <div className="inspector-empty">
          <Sliders size={16} />
          <div className="section-label" style={{ margin: 0 }}>画布设置</div>
          <label className="row row--between" style={{ fontSize: 12.5 }}>
            <span>吸附到网格</span>
            <span className="switch" data-on={props.snap} onClick={props.onToggleSnap} />
          </label>
          <label className="row row--between" style={{ fontSize: 12.5 }}>
            <span>显示网格</span>
            <span className="switch" data-on={props.grid} onClick={props.onToggleGrid} />
          </label>
          <p className="hint" style={{ marginTop: 4 }}>
            在左侧选择工具，然后在画布上拖动即可创建图形。选中元素后这里会显示它的属性。
          </p>
        </div>
      )}

      <div className="layer-list">
        <div className="row row--between" style={{ padding: "6px 2px" }}>
          <span className="section-label" style={{ margin: 0 }}>
            <Layers size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
            图层 · {figure.elements.length}
          </span>
        </div>
        <div className="layer-scroll">
          {figure.elements.length === 0 && <div className="hint" style={{ padding: 8 }}>还没有元素</div>}
          {[...figure.elements].reverse().map((el) => (
            <div key={el.id} className="layer" data-active={el.id === props.selected?.id} onClick={() => props.onSelect(el.id)}>
              <span className="layer-name">{el.name}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function SelectedPanel({ el, onPatch, onBeginEdit, onCommit, onDelete, onReorder }: Props & { el: Element }) {
  const patch = (next: Partial<Element> | { style?: Partial<Style> }) => {
    const merged: any = { ...el, ...next };
    if ("style" in next && next.style) merged.style = { ...(el as any).style, ...next.style };
    onPatch(el.id, merged as Element);
  };

  return (
    <div className="inspector-body">
      <div className="row row--between">
        <span className="section-label" style={{ margin: 0 }}>
          {KIND_LABEL[el.kind]} · {el.name}
        </span>
        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn" title="上移一层" onClick={() => onReorder(1)}>
            <ArrowUp size={13} />
          </button>
          <button className="icon-btn" title="下移一层" onClick={() => onReorder(-1)}>
            <ArrowDown size={13} />
          </button>
          <button className="icon-btn" title="删除" onClick={onDelete}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <Field label="颜色">
        <Swatches colors={COLORS} value={el.style.color} onChange={(c) => patch({ style: { color: c, ...(el.style.strokeNone && el.style.fill ? { fill: c } : {}) } })} />
      </Field>

      {el.kind === "poly" && el.ocr && <div style={{ display: "grid", gap: 6 }}>
        <span className="hint">识别文字：{el.ocr.text}</span>
        <button className="btn" onClick={() => { onBeginEdit(); onPatch(el.id, { id: el.id, kind: "node", name: el.ocr!.text, at: el.ocr!.at, text: el.ocr!.text, fontSize: el.ocr!.fontSize, anchor: "center", boxed: false, rounded: 0, style: { ...el.style, color: el.style.fill || el.style.color, fill: null, strokeNone: false } }); onCommit(); }}>转为文字编辑</button>
      </div>}

      {el.kind !== "axes" && (
        <Field label="线宽">
          <div className="seg">
            {STROKE_W.map((s) => (
              <button key={s.id} data-active={(el as any).style.thickness === s.id} onClick={() => patch({ style: { thickness: s.id } })}>
                {s.label}
              </button>
            ))}
          </div>
        </Field>
      )}

      <label className="row row--between" style={{ fontSize: 12.5 }}>
        <span>虚线</span>
        <span className="switch" data-on={(el as any).style.dashed} onClick={() => patch({ style: { dashed: !(el as any).style.dashed } })} />
      </label>

      {(el.kind === "rect" || el.kind === "circle" || el.kind === "ellipse" || el.kind === "node" || el.kind === "poly" && el.closed) && (
        <Field label="填充">
          <div className="swatches">
            <button className="swatch swatch--none" data-active={!(el as any).style.fill} onClick={() => patch({ style: { fill: null } })} title="无填充">
              /
            </button>
            {FILLS.map((c) => (
              <button key={c} className="swatch" style={{ background: cssFill(c) }} data-active={(el as any).style.fill === c} onClick={() => patch({ style: { fill: c } })} />
            ))}
          </div>
        </Field>
      )}

      {(el.kind === "line" || el.kind === "bezier" || el.kind === "axes") && (
        <Field label="箭头">
          <div className="seg">
            {ARROWS.map((a) => (
              <button key={a.id} data-active={(el as any).style.arrow === a.id} onClick={() => patch({ style: { arrow: a.id } })}>
                {a.label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {el.kind === "node" && <NodeFields el={el as NodeEl} patch={patch} commit={onCommit} />}

      {el.kind === "rect" && (
        <NumField label="圆角 (cm)" value={(el as any).rounded} step={0.02} min={0} onChange={(v) => patch({ rounded: v } as any)} onCommit={onCommit} />
      )}

      {el.kind === "circle" && <NumField label="半径 (cm)" value={(el as any).radius} step={0.05} min={0.05} onChange={(v) => patch({ radius: v } as any)} onCommit={onCommit} />}

      {(el.kind === "ellipse" || el.kind === "axes" || el.kind === "node") && <Hint el={el} />}

      {el.kind === "plot" && <PlotFields el={el as PlotEl} patch={patch} commit={onCommit} />}
      {el.kind === "axes" && <AxesFields el={el as AxesEl} patch={patch} commit={onCommit} />}
    </div>
  );
}

function Hint({ el }: { el: Element }) {
  const tips: Record<string, string> = {
    ellipse: "拖动画布上的两个手柄可分别调整水平/垂直半径。",
    axes: "拖动末端手柄调整轴长，拖原点手柄移动整组坐标轴。",
    node: "拖动节点本体可移动位置；双击画布空白处不会创建文本，请选择文本工具。",
  };
  const tip = tips[el.kind];
  return tip ? <p className="hint">{tip}</p> : null;
}

/** \small, \bfseries … are fine outside maths mode; don't nag about them. */
const TEXT_MODE_ONLY = /^((\s*(\\[a-zA-Z]+|\{[^{}]*\}))*)$/;

function NodeFields({ el, patch, commit }: { el: NodeEl; patch: (n: any) => void; commit: () => void }) {
  return (
    <>
      <Field label="文本（支持 LaTeX）">
        <textarea className="textarea" rows={2} value={el.text} onChange={(e) => patch({ text: e.target.value })} onBlur={commit} />
      </Field>
      {/\\[a-zA-Z]+/.test(el.text) && !/\$/.test(el.text) && !TEXT_MODE_ONLY.test(el.text) && (
        <div className="notice notice--warn" style={{ padding: "6px 9px", alignItems: "center" }}>
          <span style={{ flex: 1, fontSize: 11.5 }}>含 LaTeX 命令但没加 <code className="mono">$…$</code>，编译器会当普通文本排</span>
          <button className="btn" style={{ height: 24 }} onClick={() => { patch({ text: `$${el.text}$` }); commit(); }}>
            包成数学
          </button>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <NumField label="字号 (pt)" value={el.fontSize} step={1} min={5} max={30} onChange={(v) => patch({ fontSize: v })} onCommit={commit} compact />
        <label className="row row--between" style={{ fontSize: 12, flex: 1 }}>
          <span>边框</span>
          <span className="switch" data-on={el.boxed} onClick={() => patch({ boxed: !el.boxed })} />
        </label>
      </div>
      {el.boxed && <NumField label="圆角 (cm)" value={el.rounded} step={0.02} min={0} onChange={(v) => patch({ rounded: v })} onCommit={commit} />}
      <Field label="对齐基点">
        <div className="seg">
          {(["center", "west", "east", "north", "south"] as const).map((a) => (
            <button key={a} data-active={el.anchor === a} onClick={() => patch({ anchor: a })}>
              {{ center: "中", west: "左", east: "右", north: "上", south: "下" }[a]}
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

function AxesFields({ el, patch, commit }: { el: AxesEl; patch: (n: any) => void; commit: () => void }) {
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <NumField label="x 起点" value={el.xMin} step={0.5} onChange={(v) => patch({ xMin: v })} onCommit={commit} />
        <NumField label="x 终点" value={el.xMax} step={0.5} onChange={(v) => patch({ xMax: v })} onCommit={commit} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <NumField label="y 起点" value={el.yMin} step={0.5} onChange={(v) => patch({ yMin: v })} onCommit={commit} />
        <NumField label="y 终点" value={el.yMax} step={0.5} onChange={(v) => patch({ yMax: v })} onCommit={commit} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <NumField label="刻度间隔" value={el.tickStep} step={0.5} min={0} onChange={(v) => patch({ tickStep: v })} onCommit={commit} />
        <label className="row row--between" style={{ fontSize: 12, flex: 1 }}>
          <span>显示刻度</span>
          <span className="switch" data-on={el.showTicks} onClick={() => patch({ showTicks: !el.showTicks })} />
        </label>
      </div>
      <Field label="x 轴标签">
        <input className="input" value={el.xLabel} onChange={(e) => patch({ xLabel: e.target.value })} onBlur={commit} />
      </Field>
      <Field label="y 轴标签">
        <input className="input" value={el.yLabel} onChange={(e) => patch({ yLabel: e.target.value })} onBlur={commit} />
      </Field>
      <p className="hint">把起点设为负数即可得到负半轴；四个端点手柄也能直接拖动。</p>
    </>
  );
}

function PlotFields({ el, patch, commit }: { el: PlotEl; patch: (n: any) => void; commit: () => void }) {
  const compiled = compileExpr(el.expr);
  return (
    <>
      <Field label="函数表达式 y = f(x)">
        <input className="input mono" value={el.expr} onChange={(e) => patch({ expr: e.target.value })} onBlur={commit} spellCheck={false} />
      </Field>
      {!compiled.ok && <div className="field-error">{compiled.error}</div>}
      <div className="row" style={{ gap: 8 }}>
        <NumField label="x 起点" value={el.xMin} step={0.5} onChange={(v) => patch({ xMin: v })} onCommit={commit} compact />
        <NumField label="x 终点" value={el.xMax} step={0.5} onChange={(v) => patch({ xMax: v })} onCommit={commit} compact />
      </div>
      <NumField label="采样点" value={el.samples} step={20} min={20} max={2000} onChange={(v) => patch({ samples: v })} onCommit={commit} />
      <p className="hint">
        支持 sin、cos、exp、ln、sqrt、abs、^、pi 等。采样点范围 20–2000：高频函数（如 sin(e^x)）建议 600 以上；
        点数越大越平滑，但生成的 TikZ 也越长。
      </p>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label style={{ fontSize: 11.5 }}>{label}</label>
      {children}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  onCommit,
  step = 0.1,
  min,
  max,
  compact,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  step?: number;
  min?: number;
  max?: number;
  compact?: boolean;
}) {
  // A controlled number input cannot round-trip intermediate states ("-" / "-."
  // / "1e"), so keep the raw text while editing and only push parsed numbers up.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatNum(value);

  const push = (raw: string) => {
    const parsed = parseNum(raw);
    if (parsed === null) return null; // wait for a complete number
    const next = clamp(parsed, min, max);
    if (next !== value) onChange(next);
    return next;
  };

  return (
    <div className="field" style={{ flex: 1, minWidth: 0 }}>
      <label style={{ fontSize: 11.5 }}>{label}</label>
      <input
        className="input mono"
        type="text"
        inputMode="decimal"
        value={shown}
        onFocus={(e) => setDraft(e.target.value)}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          push(raw);
        }}
        onBlur={(e) => {
          const next = push(e.target.value);
          setDraft(next === null ? null : formatNum(next));
          onCommit();
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
            return;
          }
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const base = parseNum(e.currentTarget.value) ?? value;
          const delta = step * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
          const next = clamp(Math.round((base + delta) * 1e6) / 1e6, min, max);
          setDraft(formatNum(next));
          onChange(next);
        }}
      />
    </div>
  );
}

function parseNum(raw: string): number | null {
  const t = raw.trim().replace(/[−–—]/g, "-").replace(/，/g, ".");
  if (!t || t === "-" || t === "." || t === "-." || t === "+") return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} className="swatch" title={c} style={{ background: cssStroke(c) }} data-active={value === c} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

function cssStroke(name: string): string {
  const map: Record<string, string> = {
    black: "#111318",
    blue: "#3b6fd4",
    red: "#d94b4b",
    orange: "#e5883a",
    teal: "#2a9d8f",
    purple: "#8b5cf6",
    green: "#2f9e5f",
    gray: "#8a8f98",
  };
  return map[name] ?? "#111318";
}

function cssFill(name: string): string {
  const m = /^([a-z]+)!(\d+)$/.exec(name);
  if (!m) return cssStroke(name);
  return `color-mix(in srgb, ${cssStroke(m[1])} ${m[2]}%, white)`;
}
