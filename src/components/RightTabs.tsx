import { DraftingCompass, Eye } from "lucide-react";
import { useApp } from "../store";

export function RightTabs() {
  const rightTab = useApp((s) => s.rightTab);
  const setRightTab = useApp((s) => s.setRightTab);
  const errors = useApp((s) => s.errors);
  return (
    <div className="tabs-inline">
      <button data-active={rightTab === "canvas"} onClick={() => setRightTab("canvas")} title="图形化编辑">
        <DraftingCompass size={13} />
        画布
      </button>
      <button data-active={rightTab === "preview"} onClick={() => setRightTab("preview")} title="编译后的真实效果">
        <Eye size={13} />
        预览
        {errors.length > 0 && <span className="tab-dot" />}
      </button>
    </div>
  );
}
