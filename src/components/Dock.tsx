import { AlertTriangle, CheckCircle2, ScrollText, TriangleAlert } from "lucide-react";
import { useApp } from "../store";
import type { Diag } from "../lib/api";

export function Dock() {
  const { dockTab, dockOpen, setDock, errors, warnings, log, status, durationMs } = useApp();
  if (!dockOpen) {
    return (
      <section className="dock" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="dock-head" style={{ borderBottom: "none" }}>
          <button className="tab" onClick={() => setDock({ open: true, tab: "problems" })}>
            <TriangleAlert size={13} />
            问题
            {errors.length > 0 && <span className="count">{errors.length}</span>}
          </button>
          <button className="tab" onClick={() => setDock({ open: true, tab: "log" })}>
            <ScrollText size={13} />
            编译日志
          </button>
          <div className="spacer" />
          <span className="hint" style={{ fontSize: 11 }}>{status === "error" ? "存在编译错误" : "面板已收起"}</span>
          <button className="icon-btn" title="展开面板" onClick={() => setDock({ open: true })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="dock">
      <div className="dock-head">
        <button className="tab" data-active={dockTab === "problems"} onClick={() => setDock({ tab: "problems" })}>
          <TriangleAlert size={13} />
          问题
          {errors.length > 0 && <span className="count">{errors.length}</span>}
          {errors.length === 0 && warnings.length > 0 && <span className="count count--warn">{warnings.length}</span>}
        </button>
        <button className="tab" data-active={dockTab === "log"} onClick={() => setDock({ tab: "log" })}>
          <ScrollText size={13} />
          编译日志
        </button>
        <div className="spacer" />
        {status === "ok" && (
          <span className="pill pill--ok">
            <CheckCircle2 size={12} /> 通过 · {Math.round(durationMs)}ms
          </span>
        )}
        {status === "error" && (
          <span className="pill pill--err">
            <AlertTriangle size={12} /> {errors.length} 个错误
          </span>
        )}
        <button className="icon-btn" title="收起面板" onClick={() => setDock({ open: false })} style={{ marginLeft: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      <div className="dock-body">
        {dockTab === "problems" ? (
          errors.length === 0 && warnings.length === 0 ? (
            <div className="dock-empty">{status === "running" ? "正在编译…" : "没有发现错误或警告。✨"}</div>
          ) : (
            <>
              {errors.map((e, i) => (
                <Problem key={"e" + i} d={e} kind="error" />
              ))}
              {warnings.map((w, i) => (
                <Problem key={"w" + i} d={w} kind="warning" />
              ))}
            </>
          )
        ) : (
          <pre className="log">{highlightLog(log || "（暂无日志，编译后显示）")}</pre>
        )}
      </div>
    </section>
  );
}

function Problem({ d, kind }: { d: Diag; kind: "error" | "warning" }) {
  const jumpTo = useApp((s) => s.jumpTo);
  return (
    <div
      className="problem"
      data-kind={kind}
      onClick={() => d.line && jumpTo(d.line)}
      title={d.line ? "跳转到该行" : undefined}
    >
      <span className="bar" />
      <span className="line-no">{d.line ?? "—"}</span>
      <span className="text">{d.message}</span>
    </div>
  );
}

function highlightLog(raw: string) {
  const lines = raw.split(/\r?\n/).slice(-400);
  return lines.map((line, i) => {
    let cls = undefined as string | undefined;
    if (/^!\s/.test(line) || /error/i.test(line) || /:\d+:/.test(line)) cls = "l-err";
    else if (/warning/i.test(line)) cls = "l-warn";
    else if (/^(This is|entering|restricted|\(|\*)/.test(line) && line.length < 12) cls = "l-dim";
    return (
      <span key={i} className={cls}>
        {line}
        {"\n"}
      </span>
    );
  });
}
