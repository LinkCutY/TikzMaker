import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FileCode2 } from "lucide-react";
import { useApp } from "./store";
import { api, type HealthResponse } from "./lib/api";
import { TopBar } from "./components/TopBar";
import { CodeEditor } from "./components/CodeEditor";
import { PreviewPane } from "./components/PreviewPane";
import { CanvasPane } from "./components/canvas/CanvasPane";
import { Dock } from "./components/Dock";
import { StatusBar } from "./components/StatusBar";
import { AiDrawer } from "./components/AiDrawer";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { TemplatesDialog } from "./components/TemplatesDialog";
import { Toasts } from "./components/Toasts";
import type { ToolId } from "./lib/figure/edit";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  l: "line",
  b: "bezier",
  r: "rect",
  c: "circle",
  t: "node",
  x: "axes",
  f: "plot",
};

export default function App() {
  const source = useApp((s) => s.source);
  const setSource = useApp((s) => s.setSource);
  const docName = useApp((s) => s.docName);
  const settings = useApp((s) => s.settings);
  const compile = useApp((s) => s.compile);
  const errors = useApp((s) => s.errors);
  const jumpLine = useApp((s) => s.jumpLine);
  const editorWidth = useApp((s) => s.editorWidth);
  const dockHeight = useApp((s) => s.dockHeight);
  const dockOpen = useApp((s) => s.dockOpen);
  const setLayout = useApp((s) => s.setLayout);
  const openDrawer = useApp((s) => s.openDrawer);
  const toast = useApp((s) => s.toast);
  const rightTab = useApp((s) => s.rightTab);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const wbRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);

  /* theme */
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  /* health */
  useEffect(() => {
    const c = new AbortController();
    api
      .health(c.signal)
      .then(setHealth)
      .catch(() => toast("error", "无法连接本地后端（端口 8788），请确认 npm run dev 正在运行"));
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* auto compile */
  useEffect(() => {
    if (!settings.autoCompile) return;
    const t = setTimeout(() => void compile(), Math.max(300, settings.delay));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, settings.autoCompile, settings.delay, settings.engine]);

  /* shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = Boolean(el && (el.closest(".cm-editor") || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));

      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void compile();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openDrawer("ai");
        return;
      }
      if (e.key === "Escape" && useApp.getState().drawer !== "none") {
        openDrawer("none");
        return;
      }
      if (typing) return;

      const st = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && st.rightTab === "canvas") {
        e.preventDefault();
        if (e.shiftKey) st.redoFigure();
        else st.undoFigure();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (st.rightTab === "canvas") {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool && !e.shiftKey) {
          st.setTool(tool);
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && st.selectedId) {
          e.preventDefault();
          st.deleteSelected();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compile, openDrawer]);

  const startDrag = useCallback(
    (kind: "v" | "h") => (e: ReactPointerEvent) => {
      e.preventDefault();
      const move = (ev: PointerEvent) => {
        if (kind === "v" && wbRef.current) {
          const r = wbRef.current.getBoundingClientRect();
          const pct = ((ev.clientX - r.left) / r.width) * 100;
          setLayout({ editorWidth: Math.max(24, Math.min(72, Math.round(pct * 10) / 10)) });
        } else if (kind === "h" && colRef.current) {
          const r = colRef.current.getBoundingClientRect();
          const h = r.bottom - ev.clientY;
          setLayout({ dockHeight: Math.max(90, Math.min(r.height - 140, h)) });
        }
      };
      const up = () => {
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      document.body.style.cursor = kind === "v" ? "col-resize" : "row-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [setLayout]
  );

  return (
    <div className="app">
      <TopBar health={health} />

      <div className="workbench" ref={wbRef} style={{ gridTemplateColumns: `${editorWidth}% 6px 1fr` }}>
        <div className="editor-col" ref={colRef} style={{ gridTemplateRows: `1fr 6px ${dockOpen ? dockHeight : 32}px` }}>
          <section className="pane">
            <header className="pane-head">
              <div className="pane-title">
                <FileCode2 size={13} /> 源码
              </div>
              <span className="pill pill--muted mono" style={{ marginLeft: 4 }}>{docName}</span>
              <div className="spacer" />
              <span className="hint" style={{ fontSize: 11 }}>Ctrl+Space 补全 · Ctrl+Enter 编译</span>
            </header>
            <CodeEditor value={source} theme={settings.theme} diagnostics={errors} jumpLine={jumpLine} onChange={setSource} />
          </section>

          <div className="splitter splitter--h" onPointerDown={startDrag("h")} />

          <Dock />
        </div>

        <div className="splitter" onPointerDown={startDrag("v")} />

        <div className="right-col">
          <div className="right-slot" data-active={rightTab === "canvas"}>
            <CanvasPane />
          </div>
          <div className="right-slot" data-active={rightTab === "preview"}>
            <PreviewPane />
          </div>
        </div>
      </div>

      <StatusBar />

      <AiDrawer />
      <SettingsDrawer health={health} />
      <TemplatesDialog />
      <Toasts />
    </div>
  );
}
