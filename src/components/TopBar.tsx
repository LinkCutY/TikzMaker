import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, FileCode2, FileDown, FileText, FileType2, Image as ImageIcon,
  LayoutTemplate, Moon, Play, Settings, Sparkles, Sun, Wand2,
} from "lucide-react";
import { useApp } from "../store";
import { api, downloadBlob } from "../lib/api";
import type { HealthResponse } from "../lib/api";

interface Props {
  health: HealthResponse | null;
}

export function TopBar({ health }: Props) {
  const { docName, setDocName, compile, status, settings, patchSettings, openDrawer } = useApp();
  const running = status === "running";
  const engine = health?.engines.find((e) => e.name === settings.engine);
  const engineOk = engine?.available ?? true;

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 18 9.5 6l3.5 7.5L17 5l3 11" />
          </svg>
        </div>
        <div className="brand-name">
          TikZ <span>Studio</span>
        </div>
      </div>

      <div className="divider-v" />

      <input
        className="doc-name"
        value={docName}
        spellCheck={false}
        onChange={(e) => setDocName(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value.trim() || "figure.tex";
          setDocName(v.endsWith(".tex") ? v : v + ".tex");
        }}
        title="文档名称（导出时使用）"
      />

      <span className="pill" title={engine?.version || ""}>
        <span className="dot" style={{ background: engineOk ? "var(--ok)" : "var(--err)" }} />
        {engine?.label ?? settings.engine}
      </span>

      <div className="spacer" />

      {/* Never disable this: a stuck request must stay cancellable by a second
          click (which queues a re-run) instead of freezing the toolbar. */}
      <button
        className="btn btn--primary"
        onClick={() => void compile()}
        title={running ? "编译中，再点一次会在这次结束后重编" : "编译（Ctrl+Enter）"}
      >
        {running ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> : <Play size={13} fill="currentColor" />}
        {running ? "编译中" : "编译"}
        <span className="kbd">Ctrl ↵</span>
      </button>

      <label className="row" style={{ gap: 7, cursor: "pointer", userSelect: "none" }} title="停止输入后自动编译">
        <span className="switch" data-on={settings.autoCompile} onClick={() => patchSettings({ autoCompile: !settings.autoCompile })} />
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>自动</span>
      </label>

      <ExportMenu />

      <div className="divider-v" />

      <button className="btn btn--ai" onClick={() => openDrawer("ai")} title="用一句话描述，让 AI 生成 TikZ（Ctrl+K）">
        <Sparkles size={14} />
        文生 TikZ
        <span className="kbd">Ctrl K</span>
      </button>
      <button className="icon-btn" title="模板库" onClick={() => openDrawer("templates")}>
        <LayoutTemplate size={15} />
      </button>
      <button className="icon-btn" title="设置" onClick={() => openDrawer("settings")}>
        <Settings size={15} />
      </button>
      <button
        className="icon-btn"
        title="切换主题"
        onClick={() => patchSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}
      >
        {settings.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </header>
  );
}

const FORMATS = [
  { key: "tex", label: "LaTeX 源文件", meta: ".tex", icon: FileCode2, hint: "完整可编译文档" },
  { key: "pdf", label: "PDF 文档", meta: ".pdf", icon: FileText, hint: "矢量，直接投稿" },
  { key: "svg", label: "SVG 矢量图", meta: ".svg", icon: FileType2, hint: "可导入 Figma / PPT" },
  { key: "png", label: "PNG 位图", meta: ".png @300dpi", icon: ImageIcon, hint: "透明背景" },
] as const;

function ExportMenu() {
  const { source, settings, docName, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function download(format: (typeof FORMATS)[number]["key"]) {
    const base = docName.replace(/\.tex$/i, "") || "figure";
    try {
      setBusy(format);
      const blob = await api.exportFile({
        source,
        format,
        engine: settings.engine,
        dpi: format === "png" ? 300 : undefined,
        filename: base,
      });
      downloadBlob(blob, `${base}.${format}`);
      toast("ok", `已导出 ${base}.${format}`);
      setOpen(false);
    } catch (err: any) {
      toast("error", err?.message || "导出失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="btn" onClick={() => setOpen((v) => !v)}>
        <FileDown size={14} />
        导出
        <ChevronDown size={13} style={{ opacity: 0.7 }} />
      </button>
      {open && (
        <div className="menu" style={{ top: 36, right: 0 }}>
          <div className="menu-label">导出当前图形</div>
          {FORMATS.map((f) => (
            <button key={f.key} className="menu-item" onClick={() => void download(f.key)} disabled={busy !== null}>
              <f.icon size={14} />
              <span style={{ display: "grid", gap: 1 }}>
                <span>{f.label}</span>
                <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{f.hint}</span>
              </span>
              <span className="meta">{busy === f.key ? "处理中…" : f.meta}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { navigator.clipboard.writeText(source); toast("ok", "源码已复制"); setOpen(false); }}>
            <Wand2 size={14} />
            复制源码
          </button>
        </div>
      )}
    </div>
  );
}
