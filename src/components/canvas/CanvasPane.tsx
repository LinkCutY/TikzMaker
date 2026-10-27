import { AlertTriangle, Maximize2, RefreshCw, Sparkles } from "lucide-react";
import { useApp } from "../../store";
import { ToolRail } from "./ToolRail";
import { DrawCanvas } from "./DrawCanvas";
import { Inspector } from "./Inspector";
import { RightTabs } from "../RightTabs";
import { extractBody, generateBody } from "../../lib/figure/bridge";
import { getPreset } from "../../lib/figure/presets";
import { ArrowLeftRight, ArrowRight, Circle, CircleDot, Crosshair, Diamond, Spline, Square, Type } from "lucide-react";
import { KIND_LABEL } from "../../lib/figure/types";
import { useMemo, useState } from "react";
import { plotRuns } from "../../lib/figure/edit";

const PRESET_ICON: Record<string, typeof Square> = {
  "flow-box": Square,
  "flow-decision": Diamond,
  arrow: ArrowRight,
  "arrow-both": ArrowLeftRight,
  dot: CircleDot,
  "dot-hollow": Circle,
  label: Type,
  "axes-pos": Crosshair,
  "axes-quad": Crosshair,
  bezier: Spline,
};

export function CanvasPane() {
  const figure = useApp((s) => s.figure);
  const selectedId = useApp((s) => s.selectedId);
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const snap = useApp((s) => s.snap);
  const grid = useApp((s) => s.canvasGrid);
  const toggleSnap = useApp((s) => s.toggleSnap);
  const toggleGrid = useApp((s) => s.toggleCanvasGrid);
  const selectElement = useApp((s) => s.selectElement);
  const beginEdit = useApp((s) => s.beginEdit);
  const replaceElement = useApp((s) => s.replaceElement);
  const commitEdit = useApp((s) => s.commitEdit);
  const createElement = useApp((s) => s.createElement);
  const deleteSelected = useApp((s) => s.deleteSelected);
  const reorderSelected = useApp((s) => s.reorderSelected);
  const undoFigure = useApp((s) => s.undoFigure);
  const redoFigure = useApp((s) => s.redoFigure);
  const fitCanvas = useApp((s) => s.fitCanvas);
  const fitAxesToPlots = useApp((s) => s.fitAxesToPlots);
  const fitToken = useApp((s) => s.fitToken);
  const source = useApp((s) => s.source);
  const editing = useApp((s) => s.editing);
  const bodyStamp = useApp((s) => s.bodyStamp);
  const sourceOnly = useApp((s) => s.sourceOnly);
  const preset = useApp((s) => s.preset);
  const setPreset = useApp((s) => s.setPreset);
  const activeTools = useApp((s) => s.activeTools);
  const createPresetAt = useApp((s) => s.createPresetAt);
  const openDrawer = useApp((s) => s.openDrawer);
  const toast = useApp((s) => s.toast);
  const syncFigureFromSource = useApp((s) => s.syncFigureFromSource);
  const overwriteSourceFromFigure = useApp((s) => s.overwriteSourceFromFigure);
  const history = useApp((s) => s.history);
  const compile = useApp((s) => s.compile);
  const status = useApp((s) => s.status);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const selected = figure.elements.find((el) => el.id === selectedId) ?? null;
  const body = extractBody(source);
  // "Out of sync" means the tikzpicture text is neither what the canvas generated
  // nor what the canvas was last built from (legacy / hand-written figures).
  const diverged = !editing && body !== null && bodyStamp !== null && body !== bodyStamp;

  // Does any curve leave the coordinate system it is supposed to live in?
  const axesOutOfRange = useMemo(() => {
    const axes = figure.elements.find((el) => el.kind === "axes");
    const plots = figure.elements.filter((el) => el.kind === "plot");
    if (!axes || !plots.length) return false;
    const ax = axes as { origin: { x: number; y: number }; xMin: number; xMax: number; yMin: number; yMax: number };
    const left = ax.origin.x + Math.min(ax.xMin, ax.xMax);
    const right = ax.origin.x + Math.max(ax.xMin, ax.xMax);
    const bottom = ax.origin.y + Math.min(ax.yMin, ax.yMax);
    const top = ax.origin.y + Math.max(ax.yMin, ax.yMax);
    const tol = 0.35;
    return plots.some((p) => {
      const plot = p as { xMin: number; xMax: number; offset: { x: number; y: number }; expr: string };
      if (plot.xMin + plot.offset.x < left - tol || plot.xMax + plot.offset.x > right + tol) return true;
      for (const run of plotRuns(plot as never)) {
        for (const pt of run) {
          if (pt.y < bottom - tol || pt.y > top + tol) return true;
        }
      }
      return false;
    });
  }, [figure]);

  // How many elements does the editor's source actually contain vs what the
  // canvas managed to recognise? A large gap explains "画布和预览不一样".
  const sourceCount = useMemo(() => {
    if (!body) return 0;
    return (body.match(/\\(draw|node|filldraw|fill)\b/g) || []).length;
  }, [body]);
  const missing = sourceCount - figure.elements.length;

  // A plot that is (nearly) a horizontal line is almost always a degrees/radians
  // mistake — the figure compiles, so nothing else catches it.
  const flatPlot = useMemo(() => {
    for (const el of figure.elements) {
      if (el.kind !== "plot") continue;
      const runs = plotRuns(el as never);
      let lo = Infinity;
      let hi = -Infinity;
      for (const run of runs) for (const p of run) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      if (runs.length && hi - lo < 0.05) return el as { expr: string };
    }
    return null;
  }, [figure]);

  // A function request that produced no curve is the most common silent failure.
  const plotDiagnostics = useMemo(() => {
    if (!body) return null;
    const sourcePlots = (body.match(/\\(addplot|plot)\b/g) || []).length;
    const canvasPlots = figure.elements.filter((el) => el.kind === "plot").length;
    if (sourcePlots > 0 && canvasPlots === 0) {
      const line = body.split("\n").find((l) => /\\(addplot|plot)\b/.test(l))?.trim() ?? "";
      return { sourcePlots, line };
    }
    return null;
  }, [body, figure]);

  return (
    <section className="pane preview-pane canvas-pane">
      <header className="pane-head">
        <RightTabs />
        <span className="pill pill--muted">{figure.elements.length} 个元素</span>
        {selected && <span className="pill pill--accent">{KIND_LABEL[selected.kind]}</span>}
        {flatPlot && (
          <button
            className="pill pill--warn"
            style={{ cursor: "pointer" }}
            title="函数值几乎不变，通常是角度/弧度写混了"
            onClick={() => toast("info", `曲线几乎是直线：${flatPlot.expr}——检查是否漏了 r 后缀或多加了 deg()`)}
          >
            <AlertTriangle size={11} /> 曲线几乎是直线 · 查角度
          </button>
        )}
        {plotDiagnostics && (
          <button
            className="pill pill--warn"
            style={{ cursor: "pointer" }}
            title={plotDiagnostics.line.slice(0, 160)}
            onClick={() => {
              syncFigureFromSource();
              toast("info", "源码里有 plot 命令但没识别出曲线：" + plotDiagnostics.line.slice(0, 60));
            }}
          >
            <AlertTriangle size={11} /> plot 未识别出曲线 · 重建
          </button>
        )}
        {missing >= 2 && (
          <button
            className="pill pill--warn"
            style={{ cursor: "pointer" }}
            title="源码里的图元比画布识别到的多，说明有写法画布没读懂"
            onClick={syncFigureFromSource}
          >
            <AlertTriangle size={11} /> 源码 {sourceCount} 个图元 · 画布 {figure.elements.length} 个 · 重建
          </button>
        )}
        {axesOutOfRange && (
          <button className="pill pill--warn" style={{ cursor: "pointer" }} title="曲线画到了坐标系外" onClick={fitAxesToPlots}>
            <AlertTriangle size={11} /> 曲线超出坐标系 · 适配
          </button>
        )}
        <div className="spacer" />
        <button className="icon-btn" title="显示全部" onClick={fitCanvas}>
          <Maximize2 size={14} />
        </button>
        <button className="icon-btn" title="用画布重新生成源码并编译" onClick={() => void compile(true)}>
          <RefreshCw size={14} className={status === "running" ? "spin" : undefined} />
        </button>
      </header>

      {sourceOnly && (
        <div className="diverged-banner" data-kind="info">
          <AlertTriangle size={14} color="var(--text-faint)" style={{ flex: "none", marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <b style={{ color: "var(--text-dim)" }}>当前文档不是由画布生成的</b>
            <div className="hint">
              这份 TikZ 里有画布无法识别的写法（例如 decorations、矩阵、`let`）。可以直接编辑源码与预览；
              若要用画布修改，先「从源码重建」试一次，或重新绘制（会替换 tikzpicture 块）。
            </div>
          </div>
          <button className="btn" onClick={syncFigureFromSource}>
            从源码重建画布
          </button>
        </div>
      )}

      {diverged && !sourceOnly && !bannerDismissed && (
        <div className="diverged-banner">
          <AlertTriangle size={14} color="var(--warn)" style={{ flex: "none", marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <b>源码与画布不同步</b>
            <div className="hint">你手动改过编辑器里的 TikZ。可以二选一：</div>
          </div>
          <button className="btn" onClick={syncFigureFromSource}>
            用源码重建画布
          </button>
          <button className="btn btn--primary" onClick={overwriteSourceFromFigure}>
            用画布覆盖源码
          </button>
          <button className="icon-btn" title="先不管" onClick={() => setBannerDismissed(true)}>
            ✕
          </button>
        </div>
      )}

      {activeTools.length > 0 && (
        <div className="preset-strip">
          <span className="preset-label">模板工具</span>
          {activeTools.map((id) => {
            const def = getPreset(id);
            if (!def) return null;
            const Icon = PRESET_ICON[id] ?? Square;
            return (
              <button
                key={id}
                className="preset-chip"
                data-active={preset === id}
                title={def.hint}
                onClick={() => setPreset(preset === id ? null : id)}
              >
                <Icon size={12} />
                {def.label}
              </button>
            );
          })}
          {preset && <span className="hint" style={{ marginLeft: 6 }}>在画布上点击放置，Esc 取消</span>}
        </div>
      )}

      <div className="canvas-stage">
        <ToolRail
          tool={tool}
          snap={snap}
          grid={grid}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          canDelete={Boolean(selected)}
          onTool={setTool}
          onToggleSnap={toggleSnap}
          onToggleGrid={toggleGrid}
          onUndo={undoFigure}
          onRedo={redoFigure}
          onDelete={deleteSelected}
        />
        <div className="canvas-center">
          {figure.elements.length === 0 && (
            <div className="canvas-empty">
              <Sparkles size={20} color="var(--accent)" />
              <b>画布还是空的</b>
              <span className="hint">从左栏选工具手动画，或者用一句话让 AI 生成一版草稿。</span>
              <button className="btn btn--primary" onClick={() => openDrawer("ai")}>
                用一句话生成
              </button>
            </div>
          )}
          <DrawCanvas
            figure={figure}
            selectedId={selectedId}
            tool={tool}
            snap={snap}
            showGrid={grid}
            fitToken={fitToken}
            preset={preset}
            onPresetAt={createPresetAt}
            onCancelPreset={() => setPreset(null)}
            onSelect={selectElement}
            onBeginEdit={beginEdit}
            onCommit={commitEdit}
            onCreate={createElement}
            onReplace={replaceElement}
            onDelete={deleteSelected}
          />
        </div>
        <Inspector
          figure={figure}
          selected={selected}
          snap={snap}
          grid={grid}
          onSelect={selectElement}
          onPatch={replaceElement}
          onBeginEdit={beginEdit}
          onCommit={commitEdit}
          onDelete={deleteSelected}
          onReorder={reorderSelected}
          onToggleSnap={toggleSnap}
          onToggleGrid={toggleGrid}
        />
      </div>
    </section>
  );
}
