import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, highlightSpecialChars, scrollPastEnd } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, StreamLanguage } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { setDiagnostics } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { stex } from "../lib/editorlang";
import { tikzCompletions, editorTheme, highlightStyle, type ThemeMode } from "../lib/editorlang";
import type { Diag } from "../lib/api";

interface Props {
  value: string;
  theme: ThemeMode;
  diagnostics: Diag[];
  jumpLine: { line: number; ts: number } | null;
  onChange: (v: string) => void;
}

export function CodeEditor({ value, theme, diagnostics, jumpLine, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ override: [tikzCompletions], activateOnTyping: true }),
        highlightActiveLine(),
        highlightSelectionMatches(),
        scrollPastEnd(),
        EditorView.lineWrapping,
        StreamLanguage.define(stex),
        themeCompartment.current.of([editorTheme(theme), highlightStyle(theme)]),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { overflow: "auto" } }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: themeCompartment.current.reconfigure([editorTheme(theme), highlightStyle(theme)]) });
  }, [theme]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const list: Diagnostic[] = [];
    for (const d of diagnostics) {
      if (!d.line) continue;
      const n = Math.max(1, Math.min(d.line, doc.lines));
      const line = doc.line(n);
      list.push({
        from: line.from,
        to: Math.max(line.from + 1, line.to),
        severity: "error",
        message: d.message,
      });
    }
    v.dispatch(setDiagnostics(v.state, list));
  }, [diagnostics]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jumpLine) return;
    const n = Math.max(1, Math.min(jumpLine.line, v.state.doc.lines));
    const line = v.state.doc.line(n);
    v.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    v.focus();
  }, [jumpLine]);

  return <div className="editor-wrap" ref={host} />;
}
