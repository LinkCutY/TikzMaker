import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Maximize2, Minus, Plus, RefreshCw, Square, Sun, ZoomIn } from "lucide-react";
import { useApp } from "../store";
import { RightTabs } from "./RightTabs";

const PT_TO_PX = 4 / 3;

function useSvgUrl(svg: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!svg) {
      setUrl(null);
      return;
    }
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [svg]);
  return url;
}

export function PreviewPane() {
  const { status, svg, width, height, pages, errors, warnings, settings, patchSettings, compile, source, compiledSource, wrapped } = useApp();
  const url = useSvgUrl(svg);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState(true);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const dirty = compiledSource !== null && compiledSource !== source;

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitZoom = useMemo(() => {
    if (!width || !height || !box.w) return 100;
    const pad = 72;
    const zx = ((box.w - pad) / (width * PT_TO_PX)) * 100;
    const zy = ((box.h - pad) / (height * PT_TO_PX)) * 100;
    return Math.max(10, Math.min(Math.min(zx, zy), 500));
  }, [width, height, box]);

  useEffect(() => {
    if (fit) setZoom(fitZoom);
  }, [fit, fitZoom]);

  const effective = fit ? fitZoom : zoom;

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setFit(false);
    setZoom((z) => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 10, 800));
  }

  const showError = status === "error";
  const running = status === "running";
  const firstError = errors[0];

  return (
    <section className="pane preview-pane">
      <header className="pane-head">
        <RightTabs />
        {wrapped && status === "ok" && (
          <span className="pill pill--accent" title="当前内容没有 \documentclass，已按 standalone 自动补全导言区">
            片段模式
          </span>
        )}
        {pages > 1 && <span className="pill pill--muted">{pages} 页</span>}
        {dirty && <span className="pill pill--warn">待更新</span>}
        {warnings.length > 0 && <span className="pill pill--warn">{warnings.length} 警告</span>}
        <div className="preview-toolbar">
          <button className="icon-btn" title="缩小" onClick={() => { setFit(false); setZoom((z) => clamp(z / 1.15, 10, 800)); }}>
            <Minus size={14} />
          </button>
          <button
            className="zoom-label"
            title="点击重置为 100%"
            onClick={() => { setFit(false); setZoom(100); }}
            style={{ background: "none", border: "none", cursor: "pointer" }}
          >
            {fit ? "适应" : `${Math.round(effective)}%`}
          </button>
          <button className="icon-btn" title="放大" onClick={() => { setFit(false); setZoom((z) => clamp(z * 1.15, 10, 800)); }}>
            <Plus size={14} />
          </button>
          <button className="icon-btn" data-active={fit} title="适应窗口" onClick={() => setFit(true)}>
            <Maximize2 size={14} />
          </button>
          <div className="divider-v" />
          <button
            className="icon-btn"
            title="切换背景"
            onClick={() => patchSettings({ previewBg: settings.previewBg === "checker" ? "white" : settings.previewBg === "white" ? "dark" : "checker" })}
          >
            {settings.previewBg === "white" ? <Square size={14} /> : settings.previewBg === "dark" ? <ChevronDown size={14} /> : <Sun size={14} />}
          </button>
          <button className="icon-btn" title="重新编译 (Ctrl+Enter)" onClick={() => void compile()}>
            <RefreshCw size={14} className={running ? "spin" : undefined} />
          </button>
        </div>
      </header>

      <div
        className="preview-body"
        data-bg={settings.previewBg}
        ref={bodyRef}
        onWheel={onWheel}
      >
        {showError && (
          <div className="err-banner">
            <AlertTriangle size={15} color="var(--err)" style={{ marginTop: 1, flex: "none" }} />
            <div className="msg">
              <div className="title">编译失败 · {errors.length} 个错误</div>
              <div className="detail">
                {firstError?.line ? `第 ${firstError.line} 行：` : ""}
                {firstError?.message ?? "请查看日志面板"}
              </div>
            </div>
            <button className="btn btn--ghost" onClick={() => useApp.getState().setDock({ tab: "problems", open: true })}>
              查看问题
            </button>
          </div>
        )}

        {url ? (
          <div className="stage">
            <img
              className="page"
              data-stale={showError || dirty}
              src={url}
              alt="TikZ 预览"
              style={{ width: `${width * PT_TO_PX * (effective / 100)}px` }}
            />
          </div>
        ) : (
          !running && (
            <div className="preview-empty">
              <div className="preview-empty-inner">
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <path d="M7 16.5 11 9l2.6 4.6L16 8l2 8.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <strong>还没有预览</strong>
                <span>按 Ctrl+Enter 编译当前文档，渲染结果会出现在这里。</span>
                <button className="btn btn--primary" onClick={() => void compile()}>
                  开始编译
                </button>
              </div>
            </div>
          )
        )}

        {running && (
          <div className="compile-overlay">
            <div className="row" style={{ gap: 10 }}>
              <div className="spinner" />
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>正在编译…</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
