import {
  Circle, Crosshair, Grid3x3, Magnet, MousePointer2, Redo2, Slash, Spline, Square, Sigma, Trash2, Type, Undo2,
} from "lucide-react";
import type { ToolId } from "../../lib/figure/edit";

const TOOLS: { id: ToolId; label: string; icon: typeof Circle; hotkey: string }[] = [
  { id: "select", label: "选择", icon: MousePointer2, hotkey: "V" },
  { id: "line", label: "直线", icon: Slash, hotkey: "L" },
  { id: "bezier", label: "曲线", icon: Spline, hotkey: "B" },
  { id: "rect", label: "矩形", icon: Square, hotkey: "R" },
  { id: "circle", label: "圆", icon: Circle, hotkey: "C" },
  { id: "node", label: "文本", icon: Type, hotkey: "T" },
  { id: "axes", label: "坐标轴", icon: Crosshair, hotkey: "X" },
  { id: "plot", label: "函数", icon: Sigma, hotkey: "F" },
];

interface Props {
  tool: ToolId;
  snap: boolean;
  grid: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  onTool: (t: ToolId) => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
}

export function ToolRail({ tool, snap, grid, canUndo, canRedo, canDelete, onTool, onToggleSnap, onToggleGrid, onUndo, onRedo, onDelete }: Props) {
  return (
    <div className="tool-rail">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            className="rail-btn"
            data-active={tool === t.id}
            title={`${t.label}（${t.hotkey}）`}
            onClick={() => onTool(t.id)}
          >
            <Icon size={16} />
            <span className="rail-tip">{t.label}</span>
          </button>
        );
      })}

      <div className="rail-sep" />

      <button className="rail-btn" data-active={snap} title="吸附到 0.5cm 网格" onClick={onToggleSnap}>
        <Magnet size={15} />
        <span className="rail-tip">吸附</span>
      </button>
      <button className="rail-btn" data-active={grid} title="显示网格" onClick={onToggleGrid}>
        <Grid3x3 size={15} />
        <span className="rail-tip">网格</span>
      </button>

      <div className="spacer" />

      <button className="rail-btn" disabled={!canUndo} title="撤销（Ctrl+Z）" onClick={onUndo}>
        <Undo2 size={15} />
      </button>
      <button className="rail-btn" disabled={!canRedo} title="重做（Ctrl+Shift+Z）" onClick={onRedo}>
        <Redo2 size={15} />
      </button>
      <button className="rail-btn rail-btn--danger" disabled={!canDelete} title="删除选中（Delete）" onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}
