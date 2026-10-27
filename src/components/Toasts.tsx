import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useApp } from "../store";

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-kind={t.kind}>
          {t.kind === "ok" ? (
            <CheckCircle2 size={14} color="var(--ok)" />
          ) : t.kind === "error" ? (
            <AlertCircle size={14} color="var(--err)" />
          ) : (
            <Info size={14} color="var(--accent)" />
          )}
          <span style={{ flex: 1 }}>{t.text}</span>
          <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => dismissToast(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
