import { CheckCircle2, CircleDot, Loader2, XCircle } from "lucide-react";
import { useApp } from "../store";

export function StatusBar() {
  const { status, errors, warnings, durationMs, cached, pages, settings, source, compiledSource } = useApp();
  const dirty = compiledSource !== null && compiledSource !== source;

  return (
    <footer className="statusbar">
      <span className="seg">
        {status === "running" && <Loader2 size={12} className="spin" />}
        {status === "ok" && <CheckCircle2 size={12} className="ok" />}
        {status === "error" && <XCircle size={12} className="err" />}
        {status === "idle" && <CircleDot size={12} />}
        <span>
          {status === "running" && "正在编译…"}
          {status === "ok" && `编译成功${cached ? "（缓存）" : ""} · ${Math.round(durationMs)}ms`}
          {status === "error" && `编译失败 · ${errors.length} 个错误`}
          {status === "idle" && "就绪"}
        </span>
      </span>
      {dirty && <span className="seg warn">● 有未编译的修改</span>}
      {warnings.length > 0 && status === "ok" && <span className="seg warn">{warnings.length} 个警告</span>}
      <span className="seg mono">{source.split("\n").length} 行</span>
      <span className="seg mono">{source.length} 字符</span>
      <div className="spacer" />
      {status === "ok" && <span className="seg mono">{pages} 页</span>}
      <span className="seg mono">{settings.engine}</span>
      <span className="seg">Ctrl+Enter 编译</span>
    </footer>
  );
}
