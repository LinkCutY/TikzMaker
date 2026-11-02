import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AxesEl, BezierEl, CircleEl, Element, EllipseEl, Figure, LineEl, NodeEl, PlotEl, Pt, RectEl } from "../../lib/figure/types";
import { elementLabel } from "../../lib/figure/types";
import { bboxOf, bezierAt, createFromDrag, handlesOf, hitTest, nodeBox, plotRuns, setHandle, translate, type ToolId } from "../../lib/figure/edit";
import { PT_CM } from "../../lib/figure/edit";
import { compileExpr } from "../../lib/figure/expr";
import { colorToHex } from "../../lib/figure/colors";

interface Camera {
  wx: number;
  wy: number;
  s: number;
}

interface Props {
  figure: Figure;
  selectedId: string | null;
  tool: ToolId;
  snap: boolean;
  showGrid: boolean;
  fitToken: number;
  preset: string | null;
  onPresetAt: (p: Pt) => void;
  onCancelPreset: () => void;
  onSelect: (id: string | null) => void;
  onBeginEdit: () => void;
  onCommit: () => void;
  onCreate: (el: Element) => void;
  onReplace: (id: string, next: Element) => void;
  onDelete: () => void;
}

type Drag =
  | { type: "create"; a: Pt; b: Pt }
  | { type: "move"; last: Pt; id: string }
  | { type: "handle"; handle: string; id: string }
  | { type: "pan"; startX: number; startY: number; cam: Camera };

// xcolor names map to their real values so the canvas matches the compiled PDF
// (our UI accent blue is much greyer than TikZ's "blue").
const COLOR_HEX: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  blue: "#0000ff",
  red: "#ff0000",
  green: "#00ff00",
  orange: "#ff8000",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  purple: "#800080",
  violet: "#800080",
  brown: "#bf8040",
  gray: "#808080",
  grey: "#808080",
  lightgray: "#bfbfbf",
  darkgray: "#404040",
  olive: "#808000",
  teal: "#008080",
};

const STROKE_PT: Record<string, number> = { thin: 0.2, normal: 0.4, thick: 0.8, "very thick": 1.2 };

function resolveColor(name: string, fallback = "#111318"): string {
  const resolved = colorToHex(name || "");
  if (resolved) return resolved;
  if (!name) return fallback;
  const m = /^([a-z]+)(?:!(\d+))?$/.exec(name.trim());
  if (!m) return COLOR_HEX[name] ?? fallback;
  const base = COLOR_HEX[m[1]] ?? fallback;
  const pct = m[2] ? Number(m[2]) : 100;
  return mixWithWhite(base, pct);
}

function mixWithWhite(hex: string, percent: number): string {
  const p = Math.max(0, Math.min(100, percent)) / 100;
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const mix = (c: number) => Math.round(255 + (c - 255) * p);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function DrawCanvas(props: Props) {
  const { figure, selectedId, tool, snap, showGrid, fitToken, preset } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState<Camera>({ wx: -0.8, wy: 6.8, s: 62 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [draftEl, setDraftEl] = useState<Element | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const b = boundsOfFigure(figure);
    const pad = 1.1;
    const w = Math.max(2, b.x1 - b.x0 + pad * 2);
    const h = Math.max(2, b.y1 - b.y0 + pad * 2);
    const s = Math.min(size.w / w, size.h / h);
    const scale = Math.max(8, Math.min(220, s));
    setCam({
      wx: b.x0 - pad - (size.w / scale - w) / 2,
      wy: b.y1 + pad + (size.h / scale - h) / 2,
      s: scale,
    });
  }, [figure, size.w, size.h]);

  useEffect(() => {
    if (size.w > 0) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken, size.w, size.h]);

  const toScreen = useCallback((p: Pt) => ({ x: (p.x - cam.wx) * cam.s, y: (cam.wy - p.y) * cam.s }), [cam]);
  const toWorld = useCallback(
    (sx: number, sy: number): Pt => ({ x: cam.wx + sx / cam.s, y: cam.wy - sy / cam.s }),
    [cam]
  );

  const nextNumber = useCallback(
    (t: ToolId) => {
      const kind = t === "select" ? null : t;
      if (!kind) return figure.elements.length + 1;
      return figure.elements.filter((el) => el.kind === kind).length + 1;
    },
    [figure.elements]
  );

  const snapPt = useCallback(
    (p: Pt): Pt => {
      if (!snap) return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
      const g = 0.5;
      return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    },
    [snap]
  );

  const pointerWorld = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return toWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  /* ---------------------------------------------------------- interaction */

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Keep keyboard panning (space) available without an extra click.
    wrapRef.current?.focus({ preventScroll: true });
    if (e.button === 1 || e.altKey || spaceDown) {
      e.preventDefault();
      setDrag({ type: "pan", startX: e.clientX, startY: e.clientY, cam });
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = pointerWorld(e);
    const snapped = snapPt(p);

    if (preset) {
      e.preventDefault();
      props.onPresetAt(snapped);
      return;
    }

    if (tool !== "select") {
      props.onBeginEdit();
      if (tool === "node" || tool === "plot") {
        const el = createFromDrag(tool, snapped, snapped, nextNumber(tool));
        if (el) props.onCreate(el);
        setDrag(null);
        return;
      }
      setDrag({ type: "create", a: snapped, b: snapped });
      setDraftEl(createFromDrag(tool, snapped, snapped, nextNumber(tool)));
      return;
    }

    // select tool: handles first, then elements (topmost wins)
    const selected = figure.elements.find((el) => el.id === selectedId) ?? null;
    if (selected) {
      const tol = 9 / cam.s;
      for (const h of handlesOf(selected)) {
        if (Math.hypot(h.p.x - p.x, h.p.y - p.y) <= tol) {
          props.onBeginEdit();
          setDrag({ type: "handle", id: selected.id, handle: h.id });
          return;
        }
      }
    }
    const hitTol = 7 / cam.s;
    for (let i = figure.elements.length - 1; i >= 0; i--) {
      const el = figure.elements[i];
      if (hitTest(el, p, hitTol)) {
        props.onSelect(el.id);
        props.onBeginEdit();
        setDrag({ type: "move", id: el.id, last: p });
        return;
      }
    }
    // Empty area with the select tool: drag pans the canvas (and a plain click
    // still deselects, because the drag never moves).
    props.onSelect(null);
    setDrag({ type: "pan", startX: e.clientX, startY: e.clientY, cam });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = pointerWorld(e);
    setCursor(p);
    if (!drag) return;

    if (drag.type === "pan") {
      const dx = (e.clientX - drag.startX) / drag.cam.s;
      const dy = (e.clientY - drag.startY) / drag.cam.s;
      setCam({ ...drag.cam, wx: drag.cam.wx - dx, wy: drag.cam.wy + dy });
      return;
    }
    if (drag.type === "create") {
      const b = snapPt(p);
      setDrag({ ...drag, b });
      setDraftEl(createFromDrag(tool, drag.a, b, nextNumber(tool)));
      return;
    }
    if (drag.type === "move") {
      const dx = p.x - drag.last.x;
      const dy = p.y - drag.last.y;
      const el = figure.elements.find((it) => it.id === drag.id);
      if (!el) return;
      props.onReplace(el.id, translate(el, dx, dy));
      setDrag({ ...drag, last: p });
      return;
    }
    if (drag.type === "handle") {
      const el = figure.elements.find((it) => it.id === drag.id);
      if (!el) return;
      props.onReplace(el.id, setHandle(el, drag.handle, snapPt(p)));
    }
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.type === "create") {
      const el = createFromDrag(tool, drag.a, drag.b, nextNumber(tool));
      const moved = Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) > 0.12;
      if (el && moved) props.onCreate(el);
    }
    if (drag.type === "move" || drag.type === "handle" || drag.type === "create") props.onCommit();
    setDrag(null);
    setDraftEl(null);
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = toWorld(mx, my);
    const factor = Math.exp(-e.deltaY * 0.0016);
    const s = Math.max(8, Math.min(400, cam.s * factor));
    setCam({ s, wx: world.x - mx / s, wy: world.y + my / s });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === " ") {
      setSpaceDown(true);
      e.preventDefault();
      return;
    }
    const selected = figure.elements.find((el) => el.id === selectedId);
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      props.onDelete();
      return;
    }
    if (e.key === "Escape") {
      if (preset) props.onCancelPreset();
      props.onSelect(null);
      return;
    }
    if (selected && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : snap ? 0.5 : 0.1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      props.onBeginEdit();
      props.onReplace(selected.id, translate(selected, dx, dy));
      props.onCommit();
    }
  }

  /* --------------------------------------------------------------- drawing */

  const grid = useMemo(() => {
    if (!showGrid || size.w === 0) return null;
    const stepCm = cam.s >= 40 ? 1 : cam.s >= 18 ? 2 : 5;
    const x0 = Math.floor(cam.wx / stepCm) * stepCm;
    const x1 = cam.wx + size.w / cam.s;
    const y1 = Math.ceil(cam.wy / stepCm) * stepCm;
    const y0 = cam.wy - size.h / cam.s;
    const vx: { x: number; major: boolean; label: number }[] = [];
    const hy: { y: number; major: boolean; label: number }[] = [];
    for (let x = x0; x <= x1; x += stepCm) {
      if (vx.length > 200) break;
      vx.push({ x: (x - cam.wx) * cam.s, major: Math.abs(x % 5) < 1e-6, label: Math.round(x * 100) / 100 });
    }
    for (let y = y1; y >= y0; y -= stepCm) {
      if (hy.length > 200) break;
      hy.push({ y: (cam.wy - y) * cam.s, major: Math.abs(y % 5) < 1e-6, label: Math.round(y * 100) / 100 });
    }
    return { vx, hy };
  }, [showGrid, cam, size]);

  const selected = figure.elements.find((el) => el.id === selectedId) ?? null;
  const elementsToDraw = draftEl ? [...figure.elements, draftEl] : figure.elements;

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        if (e.key === " ") setSpaceDown(false);
      }}
      data-tool={preset ? "preset" : tool}
      data-panning={drag?.type === "pan" && drag.startX !== undefined ? "true" : undefined}
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="canvas-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <marker id="tk-arrow" viewBox="0 0 5 3" refX="4.6" refY="1.5" markerWidth="4.6" markerHeight="3" orient="auto-start-reverse" markerUnits="strokeWidth">
            <path d="M0,0 L5,1.5 L0,3 z" fill="context-stroke" />
          </marker>
          <pattern id="tk-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
          </pattern>
        </defs>

        {grid && (
          <g className="canvas-grid">
            {grid.vx.map((v, i) => (
              <line key={"v" + i} x1={v.x} y1={0} x2={v.x} y2={size.h} stroke={v.major ? "var(--grid-major)" : "var(--grid-minor)"} strokeWidth={1} />
            ))}
            {grid.hy.map((h, i) => (
              <line key={"h" + i} x1={0} y1={h.y} x2={size.w} y2={h.y} stroke={h.major ? "var(--grid-major)" : "var(--grid-minor)"} strokeWidth={1} />
            ))}
            {grid.vx
              .filter((v) => v.major)
              .map((v, i) => (
                <text key={"lx" + i} x={v.x + 3} y={size.h - 6} className="canvas-axis-label">
                  {v.label}
                </text>
              ))}
            {grid.hy
              .filter((h) => h.major)
              .map((h, i) => (
                <text key={"ly" + i} x={4} y={h.y - 3} className="canvas-axis-label">
                  {h.label}
                </text>
              ))}
          </g>
        )}

        <g className="canvas-elements">
          {elementsToDraw.map((el, i) => (
            <ElementView key={el.id} el={el} cam={cam} dim={draftEl !== null && i === elementsToDraw.length - 1} />
          ))}
        </g>

        {selected && <SelectionOverlay el={selected} cam={cam} />}

        {cursor && (
          <line
            className="canvas-crosshair"
            x1={0}
            y1={(cam.wy - cursor.y) * cam.s}
            x2={size.w}
            y2={(cam.wy - cursor.y) * cam.s}
            strokeDasharray="2 4"
          />
        )}
      </svg>

      <div className="canvas-hud">
        <span className="mono">
          {cursor ? `x ${cursor.x.toFixed(2)} · y ${cursor.y.toFixed(2)}` : "—"}
        </span>
        <span className="canvas-hud-sep" />
        <button className="canvas-zoom" onClick={() => setCam((c) => ({ ...c, s: Math.max(8, c.s / 1.2) }))} title="缩小">
          −
        </button>
        <span className="mono">{Math.round(cam.s / 40 * 100)}%</span>
        <button className="canvas-zoom" onClick={() => setCam((c) => ({ ...c, s: Math.min(400, c.s * 1.2) }))} title="放大">
          +
        </button>
        <button className="canvas-zoom canvas-zoom--text" onClick={fit} title="适应窗口">
          适应
        </button>
        <span className="canvas-hud-sep" />
        <span className="hint" style={{ fontSize: 10.5 }}>拖空白处 / 空格+拖 = 平移</span>
      </div>
    </div>
  );
}

/**
 * Catmull-Rom -> cubic Bézier. TikZ draws `plot[smooth]` with a smoothed curve,
 * so a straight polyline in the canvas looked visibly coarser than the preview.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

const SUP_MAP: Record<string, string> = { "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","+":"⁺","-":"⁻","=":"⁼","(":"⁽",")":"⁾","n":"ⁿ","i":"ⁱ","a":"ᵃ","b":"ᵇ","c":"ᶜ","d":"ᵈ","e":"ᵉ","f":"ᶠ","g":"ᵍ","h":"ʰ","j":"ʲ","k":"ᵏ","l":"ˡ","m":"ᵐ","o":"ᵒ","p":"ᵖ","r":"ʳ","s":"ˢ","t":"ᵗ","u":"ᵘ","v":"ᵛ","w":"ʷ","x":"ˣ","y":"ʸ","z":"ᶻ" };
const SUB_MAP: Record<string, string> = { "0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉","+":"₊","-":"₋","=":"₌","(":"₍",")":"₎","a":"ₐ","e":"ₑ","h":"ₕ","i":"ᵢ","j":"ⱼ","k":"ₖ","l":"ₗ","m":"ₘ","n":"ₙ","o":"ₒ","p":"ₚ","r":"ᵣ","s":"ₛ","t":"ₜ","u":"ᵤ","v":"ᵥ","x":"ₓ" };
const GREEK: Record<string, string> = { alpha:"α", beta:"β", gamma:"γ", delta:"δ", epsilon:"ε", varepsilon:"ε", zeta:"ζ", eta:"η", theta:"θ", kappa:"κ", lambda:"λ", mu:"μ", nu:"ν", xi:"ξ", pi:"π", rho:"ρ", sigma:"σ", tau:"τ", phi:"φ", varphi:"φ", chi:"χ", psi:"ψ", omega:"ω", Gamma:"Γ", Delta:"Δ", Theta:"Θ", Lambda:"Λ", Xi:"Ξ", Pi:"Π", Sigma:"Σ", Phi:"Φ", Psi:"Ψ", Omega:"Ω", infty:"∞", cdot:"·", times:"×", pm:"±", leq:"≤", geq:"≥", neq:"≠", approx:"≈", to:"→", rightarrow:"→", leftarrow:"←", partial:"∂", sum:"∑", int:"∫" };
const toScript = (s: string, map: Record<string, string>) => s.split("").map((ch) => map[ch] ?? ch).join("");

/**
 * Canvas text fallback.
 *
 * The canvas cannot typeset TeX. Dropping "$" left raw "A^{(p)}" on screen; this
 * keeps the content readable by converting super/subscripts and common commands to
 * Unicode. It is an approximation, NOT typesetting: the authoritative rendering is
 * the real TeX compile preview.
 */
export function displayText(text: string): string {
  const t = text || "";
  let s = t
    .replace(/\\(small|footnotesize|scriptsize|tiny|normalsize|large|Large|LARGE|huge|Huge|bfseries|itshape|slshape|scshape|ttfamily|rmfamily|sffamily|selectfont)/g, "")
    .replace(/\\[()\[\]]/g, "")
    .replace(/\\(?:dfrac|tfrac|frac)\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\([a-zA-Z]+)/g, (_m, name: string) => GREEK[name] ?? name)
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\^\{([^{}]*)\}/g, (_m, g: string) => toScript(g, SUP_MAP))
      .replace(/\^([A-Za-z0-9])/g, (_m, g: string) => toScript(g, SUP_MAP))
      .replace(/_\{([^{}]*)\}/g, (_m, g: string) => toScript(g, SUB_MAP))
      .replace(/_([A-Za-z0-9])/g, (_m, g: string) => toScript(g, SUB_MAP));
  }
  return s;
}

function boundsOfFigure(fig: Figure) {
  if (!fig.elements.length) return { x0: 0, y0: 0, x1: 8, y1: 5 };
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
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 8, y1: 5 };
  return { x0, y0, x1, y1 };
}

/* ------------------------------------------------------------- rendering */

function useScreen(cam: Camera) {
  return useCallback((p: Pt) => ({ x: (p.x - cam.wx) * cam.s, y: (cam.wy - p.y) * cam.s }), [cam]);
}

function ElementView({ el, cam, dim }: { el: Element; cam: Camera; dim: boolean }) {
  const S = useScreen(cam);
  const stroke = resolveColor(el.kind === "axes" ? el.style.color : (el as any).style.color);
  const widthPt = (el.style.lineWidth ?? STROKE_PT[el.style.thickness ?? "normal"]) * cam.s * PT_CM;
  const strokeWidth = Math.max(0.8, widthPt);
  const dash = el.style.dashPattern?.length ? el.style.dashPattern.map(v => v * cam.s * PT_CM).join(' ') : el.style.dotted ? `1 ${Math.max(2, widthPt * 3)}` : el.style.dashed ? "6 4" : undefined;
  const fill = (el as any).style?.fill ? resolveColor((el as any).style.fill) : "none";
  const arrow = (el as any).style?.arrow as string | undefined;
  const markerEnd = arrow === "->" || arrow === "<->" ? "url(#tk-arrow)" : undefined;
  const markerStart = arrow === "<-" || arrow === "<->" ? "url(#tk-arrow)" : undefined;
  const opacity = (dim ? 0.55 : 1) * (el.style.opacity ?? 1);

  const common = {
    stroke: el.style.strokeNone ? "none" : stroke,
    strokeWidth,
    strokeDasharray: dash,
    fill: "none",
    markerEnd,
    markerStart,
    opacity,
    strokeLinecap: el.style.lineCap === 'rect' ? 'square' as const : el.style.lineCap ?? 'round' as const,
    strokeLinejoin: "round" as const,
  };

  switch (el.kind) {
    case "line": {
      const a = S(el.from);
      const b = S(el.to);
      return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />;
    }
    case "rect": {
      const a = S({ x: Math.min(el.from.x, el.to.x), y: Math.max(el.from.y, el.to.y) });
      const b = S({ x: Math.max(el.from.x, el.to.x), y: Math.min(el.from.y, el.to.y) });
      return (
        <rect
          x={a.x}
          y={a.y}
          width={Math.max(0.5, b.x - a.x)}
          height={Math.max(0.5, b.y - a.y)}
          rx={el.rounded * cam.s}
          {...common}
          fill={fill}
        />
      );
    }
    case "circle": {
      const c = S(el.center);
      return <circle cx={c.x} cy={c.y} r={Math.max(0.5, el.radius * cam.s)} {...common} fill={fill} />;
    }
    case "ellipse": {
      const c = S(el.center);
      return <ellipse cx={c.x} cy={c.y} rx={Math.max(0.5, el.rx * cam.s)} ry={Math.max(0.5, el.ry * cam.s)} {...common} fill={fill} />;
    }
    case "bezier": {
      const p0 = S(el.p0);
      const c1 = S(el.c1);
      const c2 = S(el.c2);
      const p1 = S(el.p1);
      return <path d={`M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p1.x} ${p1.y}`} {...common} />;
    }
    case "poly": {
      if (el.start && el.path?.length) {
        const a = S(el.start);
        let d = `M ${a.x} ${a.y}`;
        for (const seg of el.path) {
          const c1 = S(seg.c1), c2 = S(seg.c2), p = S(seg.p);
          d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p.x} ${p.y}`;
        }
        return <path d={d + (el.closed ? ' Z' : '')} {...common} fill={el.closed ? fill : 'none'} />;
      }
      if (el.rings?.length) {
        const d = [el.points, ...el.rings].map(ring => ring.map((p, i) => { const s = S(p); return `${i ? "L" : "M"} ${s.x} ${s.y}`; }).join(" ") + " Z").join(" ");
        return <path d={d} {...common} fill={fill} fillRule="evenodd" />;
      }
      if (el.smooth) return <path d={smoothPath(el.points.map(S)) + (el.closed ? " Z" : "")} {...common} fill={el.closed ? fill : "none"} />;
      const pts = el.points.map((p) => {
        const s = S(p);
        return `${s.x},${s.y}`;
      }).join(" ");
      // open paths must not be filled, whatever the style says
      return el.closed ? <polygon points={pts} {...common} fill={fill} /> : <polyline points={pts} {...common} fill="none" />;
    }
    case "node": {
      const box = nodeBox(el);
      const screenBox = {
        x: S({ x: box.x0, y: box.y1 }).x,
        y: S({ x: box.x0, y: box.y1 }).y,
        w: box.w * cam.s,
        h: box.h * cam.s,
      };
      const cx = S(el.at).x;
      const cy = S(el.at).y;
      // Text with LaTeX commands but no $…$ is almost always meant as maths.
      const mathish = /\\[a-zA-Z]+/.test(el.text) && !/\$/.test(el.text);
      const anchorX = el.anchor.includes("west") ? "start" : el.anchor.includes("east") ? "end" : "middle";
      const textX = el.anchor.includes("west") ? screenBox.x + 4 * PT_CM * cam.s : el.anchor.includes("east") ? screenBox.x + screenBox.w - 4 * PT_CM * cam.s : cx;
      return (
        <g opacity={opacity} transform={el.rotate ? `rotate(${-el.rotate} ${cx} ${cy})` : undefined}>
          {el.boxed && (
            <rect
              x={screenBox.x}
              y={screenBox.y}
              width={screenBox.w}
              height={screenBox.h}
              rx={el.rounded * cam.s}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
            />
          )}
          <text
            x={textX}
            y={el.anchor.includes("north") ? screenBox.y + el.fontSize * PT_CM * cam.s * 0.7 : el.anchor.includes("south") ? screenBox.y + screenBox.h - el.fontSize * PT_CM * cam.s * 0.7 : cy}
            textAnchor={anchorX}
            dominantBaseline="central"
            className={mathish ? "canvas-node-text canvas-node-text--math" : "canvas-node-text"}
            style={{ fontSize: el.fontSize * PT_CM * cam.s, fill: resolveColor(el.style.color), fontFamily: el.fontFamily === 'sans' ? 'Arial, sans-serif' : undefined, fontWeight: el.bold ? 'bold' : undefined }}
          >
            {displayText(el.text) || " "}
          </text>
        </g>
      );
    }
    case "axes": {
      const xa = S({ x: el.origin.x + el.xMin, y: el.origin.y });
      const xb = S({ x: el.origin.x + el.xMax, y: el.origin.y });
      const ya = S({ x: el.origin.x, y: el.origin.y + el.yMin });
      const yb = S({ x: el.origin.x, y: el.origin.y + el.yMax });
      const ticks: JSX.Element[] = [];
      const tickVals = (min: number, max: number) => {
        const out: number[] = [];
        const step = el.tickStep;
        if (step <= 0) return out;
        const start = Math.ceil(Math.min(min, max) / step - 1e-9) * step;
        for (let v = start; v <= Math.max(min, max) + 1e-9 && out.length < 40; v += step) {
          const r = Math.round(v * 1000) / 1000;
          if (Math.abs(r) < 1e-9) continue;
          out.push(r);
        }
        return out;
      };
      const nearEnd = (v: number, min: number, max: number) =>
        Math.abs(v - min) < el.tickStep * 0.25 || Math.abs(v - max) < el.tickStep * 0.25;
      for (const v of tickVals(el.xMin, el.xMax)) {
        if (nearEnd(v, el.xMin, el.xMax)) continue; // a tick on the arrow tip reads as a glitch
        const p = S({ x: el.origin.x + v, y: el.origin.y });
        ticks.push(<line key={"xt" + v} x1={p.x} y1={p.y} x2={p.x} y2={p.y + 4} stroke="#9aa3b2" strokeWidth={1} />);
        ticks.push(
          <text key={"xtl" + v} x={p.x} y={p.y + 13} textAnchor="middle" className="canvas-tick-label">
            {v}
          </text>
        );
      }
      for (const v of tickVals(el.yMin, el.yMax)) {
        if (nearEnd(v, el.yMin, el.yMax)) continue;
        const p = S({ x: el.origin.x, y: el.origin.y + v });
        ticks.push(<line key={"yt" + v} x1={p.x} y1={p.y} x2={p.x - 4} y2={p.y} stroke="#9aa3b2" strokeWidth={1} />);
        ticks.push(
          <text key={"ytl" + v} x={p.x - 7} y={p.y + 3.5} textAnchor="end" className="canvas-tick-label">
            {v}
          </text>
        );
      }
      // Arrow only on the positive end of each axis.
      const axisLine = (a: {x:number;y:number}, b: {x:number;y:number}, toPositive: boolean) => (
        <line
          x1={toPositive ? a.x : b.x}
          y1={toPositive ? a.y : b.y}
          x2={toPositive ? b.x : a.x}
          y2={toPositive ? b.y : a.y}
          stroke={stroke}
          strokeWidth={strokeWidth}
          markerEnd={markerEnd ?? "url(#tk-arrow)"}
          opacity={opacity}
          strokeLinecap="round"
        />
      );
      return (
        <g opacity={opacity}>
          {axisLine(xa, xb, true)}
          {axisLine(ya, yb, true)}
          {ticks}
          {el.xLabel && (
            <text x={xb.x + 10} y={xb.y + 10} className="canvas-axis-name">
              {el.xLabel}
            </text>
          )}
          {el.yLabel && (
            <text x={yb.x + 2} y={yb.y - 9} textAnchor="middle" className="canvas-axis-name">
              {el.yLabel}
            </text>
          )}
        </g>
      );
    }
    case "plot": {
      // An expression that cannot be evaluated must be visible, not silent.
      const compiled = compileExpr(el.expr);
      if (!compiled.ok) {
        const at = S({ x: el.offset.x + (el.xMin + el.xMax) / 2, y: el.offset.y });
        const msg = el.exprError || compiled.error || "表达式无效";
        return (
          <g opacity={0.95}>
            <rect x={at.x - 90} y={at.y - 26} width={180} height={52} rx={6} fill="rgba(255,111,111,.10)" stroke="#d94b4b" strokeDasharray="4 3" />
            <text x={at.x} y={at.y - 6} textAnchor="middle" style={{ fontSize: 11, fill: "#d94b4b", fontFamily: "var(--font-mono)" }}>
              函数表达式无效
            </text>
            <text x={at.x} y={at.y + 10} textAnchor="middle" style={{ fontSize: 9.5, fill: "#a14747" }}>
              {msg.slice(0, 42)}
            </text>
          </g>
        );
      }
      // Draw exactly the points the exported TikZ will use ("samples"), then
      // smooth them — otherwise the canvas and the compiled preview disagree.
      const runs = plotRuns(el);
      return (
        <g opacity={opacity}>
          {runs.map((run, i) => (
            <path
              key={i}
              d={smoothPath(run.map((p) => S(p)))}
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </g>
      );
    }
  }
  return null;
}

function SelectionOverlay({ el, cam }: { el: Element; cam: Camera }) {
  const S = useScreen(cam);
  const b = bboxOf(el);
  const handles = handlesOf(el);
  const hs = 4;
  return (
    <g className="canvas-selection">
      {b && (
        <rect
          x={S({ x: b.x0, y: b.y1 }).x - 3}
          y={S({ x: b.x0, y: b.y1 }).y - 3}
          width={(b.x1 - b.x0) * cam.s + 6}
          height={(b.y1 - b.y0) * cam.s + 6}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2}
          strokeDasharray="4 3"
          rx={3}
        />
      )}
      {el.kind === "bezier" &&
        [["c1", (el as BezierEl).p0, (el as BezierEl).c1], ["c2", (el as BezierEl).p1, (el as BezierEl).c2]].map(([k, a, c]: any, i) => {
          const A = S(a);
          const C = S(c);
          return <line key={k} x1={A.x} y1={A.y} x2={C.x} y2={C.y} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />;
        })}
      {handles.map((h) => {
        const p = S(h.p);
        return (
          <rect
            key={h.id}
            x={p.x - hs}
            y={p.y - hs}
            width={hs * 2}
            height={hs * 2}
            fill="var(--panel)"
            stroke="var(--accent)"
            strokeWidth={1.4}
            rx={1.5}
            className="canvas-handle"
          />
        );
      })}
    </g>
  );
}
