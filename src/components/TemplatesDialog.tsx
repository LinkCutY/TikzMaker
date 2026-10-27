import { X } from "lucide-react";
import { useApp } from "../store";
import { figureTemplates } from "../lib/figure/templates";
import { KIND_LABEL } from "../lib/figure/types";

export function TemplatesDialog() {
  const { drawer, openDrawer, loadFigure, toast } = useApp();
  if (drawer !== "templates") return null;

  return (
    <>
      <div className="scrim" onClick={() => openDrawer("none")} />
      <aside className="drawer" style={{ width: "min(560px, 94vw)" }}>
        <div className="drawer-head">
          <div className="drawer-title">模板库</div>
          <span className="pill pill--muted">画布模板</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => openDrawer("none")} title="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="hint">
            每个模板都是可继续编辑的图形，载入后画布与源码同时更新；也可以用左侧工具从空白画布开始。
          </div>
          <div className="template-grid">
            {figureTemplates.map((t) => {
              const fig = t.build();
              const kinds = [...new Set(fig.elements.map((e) => KIND_LABEL[e.kind]))];
              return (
                <button
                  key={t.id}
                  className="template"
                  onClick={() => {
                    loadFigure(t.build(), "template", t.tools);
                    toast("ok", `已载入模板：${t.name}`);
                  }}
                >
                  <b>{t.name}</b>
                  <span>{t.desc}</span>
                  <span className="template-meta">
                    {fig.elements.length} 个元素 · {kinds.slice(0, 3).join(" / ") || "空白"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}
