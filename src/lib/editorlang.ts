import { StreamLanguage, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

export type ThemeMode = "dark" | "light";

const COMMANDS = [
  "\\draw", "\\fill", "\\filldraw", "\\shade", "\\shadedraw", "\\node", "\\coordinate", "\\path", "\\clip",
  "\\foreach", "\\begin{tikzpicture}", "\\end{tikzpicture}", "\\begin{axis}", "\\end{axis}", "\\addplot",
  "\\usetikzlibrary", "\\usepackage", "\\documentclass", "\\tikzset", "\\def", "\\newcommand",
];

const OPTIONS = [
  "thick", "very thick", "ultra thick", "thin", "dashed", "dotted", "dash dot", "densely dashed", "loosely dashed",
  "->", "<-", "<->", ">=Stealth", ">=Latex", "fill=", "draw=", "domain=", "samples=", "smooth", "rounded corners",
  "line width=", "opacity=", "rotate=", "scale=", "xshift=", "yshift=", "above", "below", "left", "right",
  "above right", "below left", "midway", "pos=", "node distance=", "minimum width=", "minimum height=",
  "inner sep=", "outer sep=", "align=center", "circle", "rectangle", "ellipse", "bend left=", "bend right=",
  "out=", "in=", "controls", "and", "loop", "remember=", "evaluate=", "variable=", "pattern=", "preaction=",
  "postaction=", "decorate", "decoration=",
];

const COLORS = [
  "red", "blue", "green", "orange", "purple", "teal", "cyan", "magenta", "brown", "gray", "olive",
  "violet", "black", "white", "lightgray", "darkgray", "red!50", "blue!20", "gray!30",
];

const LIBRARIES = [
  "arrows.meta", "positioning", "calc", "shapes.geometric", "decorations.pathreplacing",
  "decorations.markings", "patterns", "plotmarks", "matrix", "trees", "3d", "angles", "quotes",
];

const SNIPPETS: { label: string; detail: string; apply: string }[] = [
  {
    label: "tikzpicture 环境",
    detail: "插入空的 tikzpicture",
    apply: "\\begin{tikzpicture}\n  \n\\end{tikzpicture}",
  },
  {
    label: "\\foreach 循环",
    detail: "遍历节点",
    apply: "\\foreach \\i in {1,...,4} {\n  \\node at (\\i,0) {$\\i$};\n}",
  },
  {
    label: "\\node 带样式",
    detail: "圆角矩形节点",
    apply: "\\node[draw, rounded corners, fill=blue!8, align=center] at (0,0) {文本};",
  },
  {
    label: "1cm 网格",
    detail: "辅助网格，便于对齐",
    apply: "\\draw[very thin, gray!30, step=1] (0,0) grid (6,4);",
  },
];

function item(label: string, type: string, detail?: string): Completion {
  return { label, type, detail };
}

export function tikzCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\\a-zA-Z][\\a-zA-Z0-9{}=<>!.,:\-]*$/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;
  const options: Completion[] = [
    ...COMMANDS.map((c) => item(c, "keyword", "命令")),
    ...OPTIONS.map((o) => item(o, "property", "选项")),
    ...COLORS.map((c) => item(c, "constant", "颜色")),
    ...LIBRARIES.map((l) => item(l, "class", "库")),
    ...SNIPPETS.map((s) => ({
      label: s.label,
      type: "text",
      detail: s.detail,
      apply: s.apply,
    })),
  ];
  return { from: word.from, options, validFor: /^[\\a-zA-Z0-9{}=<>!.,:\-]*$/ };
}

export function editorTheme(mode: ThemeMode): Extension {
  const dark = mode === "dark";
  return EditorView.theme(
    {
      "&": { color: dark ? "#e7eaf0" : "#161a21", backgroundColor: "transparent" },
      ".cm-content": { caretColor: dark ? "#7aa2ff" : "#3f6bff" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: dark ? "#5c6678" : "#9aa4b8",
        border: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px" },
      ".cm-foldPlaceholder": {
        backgroundColor: dark ? "#1d222c" : "#eef2f8",
        border: "1px solid " + (dark ? "#262c38" : "#dde3ec"),
        color: dark ? "#a6afc0" : "#57617a",
        borderRadius: "4px",
        padding: "0 4px",
      },
    },
    { dark }
  );
}

export function highlightStyle(mode: ThemeMode): Extension {
  const dark = mode === "dark";
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: t.keyword, color: dark ? "#8ab4ff" : "#2f5bd4" },
      { tag: t.atom, color: dark ? "#f0b072" : "#a35200" },
      { tag: t.number, color: dark ? "#f0b072" : "#a35200" },
      { tag: t.string, color: dark ? "#a7e0a7" : "#1f7a3a" },
      { tag: t.comment, color: dark ? "#6b7385" : "#8d97a8", fontStyle: "italic" },
      { tag: t.tagName, color: dark ? "#8ab4ff" : "#2f5bd4" },
      { tag: t.bracket, color: dark ? "#c9d1e0" : "#3d4657" },
      { tag: t.operator, color: dark ? "#d0d7e6" : "#3d4657" },
      { tag: t.variableName, color: dark ? "#e7eaf0" : "#161a21" },
      { tag: t.typeName, color: dark ? "#9ce2d0" : "#0f6b57" },
    ])
  );
}

export { stex };
