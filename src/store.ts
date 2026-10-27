import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, type Diag, type Engine } from "./lib/api";
import { buildDocument, extractBody, generateBody, parseBodySafe, upsertBody } from "./lib/figure/bridge";
import type { AxesEl, Element, Figure, PlotEl, Pt } from "./lib/figure/types";
import { plotRuns } from "./lib/figure/edit";
import type { ToolId } from "./lib/figure/edit";
import { defaultFigure, figureTemplates } from "./lib/figure/templates";
import { defaultTools, getPreset } from "./lib/figure/presets";
import { detectProvider, providerById } from "./lib/providers";

export type Theme = "dark" | "light";
export type PreviewBg = "checker" | "white" | "dark";
export type CompileStatus = "idle" | "running" | "ok" | "error";
export type RightTab = "canvas" | "preview";

export interface Settings {
  engine: Engine;
  autoCompile: boolean;
  delay: number;
  theme: Theme;
  previewBg: PreviewBg;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
}

export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
}

interface AppState {
  docName: string;
  source: string;
  compiledSource: string | null;

  figure: Figure;
  /** Body text the canvas is currently considered to match (generated *or* parsed). */
  bodyStamp: string | null;
  /** True when the document holds TikZ the canvas could not turn into elements. */
  sourceOnly: boolean;
  selectedId: string | null;
  tool: ToolId;
  /** Armed preset from the template tool strip (one click on canvas = one element). */
  preset: string | null;
  activeTools: string[];
  snap: boolean;
  canvasGrid: boolean;
  /** Model ids the provider itself told us are valid, per provider id. */
  learnedModels: Record<string, string[]>;
  rightTab: RightTab;
  fitToken: number;
  editing: boolean;
  history: { past: Figure[]; future: Figure[] };

  settings: Settings;

  status: CompileStatus;
  svg: string | null;
  width: number;
  height: number;
  pages: number;
  errors: Diag[];
  warnings: Diag[];
  log: string;
  durationMs: number;
  cached: boolean;
  compiledAt: number | null;
  engineUsed: Engine | null;
  wrapped: boolean;

  dockTab: "log" | "problems";
  dockOpen: boolean;
  editorWidth: number;
  dockHeight: number;

  drawer: "none" | "ai" | "settings" | "templates";
  toasts: Toast[];
  jumpLine: { line: number; ts: number } | null;

  setSource: (v: string) => void;
  setDocName: (v: string) => void;
  patchSettings: (v: Partial<Settings>) => void;
  useProvider: (id: string) => void;
  compile: (force?: boolean) => Promise<void>;
  insertSnippet: (code: string, mode?: "replace" | "insert") => void;
  setDock: (v: { tab?: "log" | "problems"; open?: boolean }) => void;
  setLayout: (v: { editorWidth?: number; dockHeight?: number }) => void;
  openDrawer: (d: AppState["drawer"]) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
  jumpTo: (line: number) => void;

  setTool: (t: ToolId) => void;
  learnModels: (providerId: string, ids: string[]) => void;
  setPreset: (id: string | null) => void;
  createPresetAt: (p: Pt) => void;
  setRightTab: (t: RightTab) => void;
  toggleSnap: () => void;
  toggleCanvasGrid: () => void;
  selectElement: (id: string | null) => void;
  beginEdit: () => void;
  replaceElement: (id: string, next: Element) => void;
  commitEdit: () => void;
  createElement: (el: Element) => void;
  deleteSelected: () => void;
  reorderSelected: (dir: -1 | 1) => void;
  undoFigure: () => void;
  redoFigure: () => void;
  loadFigure: (fig: Figure, mode?: "template" | "replace", tools?: string[]) => void;
  syncFigureFromSource: () => void;
  overwriteSourceFromFigure: () => void;
  fitCanvas: () => void;
  fitAxesToPlots: () => void;
}

let toastSeq = 0;
let inflight = false;
let queued = false;
let inflightStartedAt = 0;
/** A compile that has not answered by then is treated as dead. */
const COMPILE_TIMEOUT_MS = 60_000;
/** Longer than the token budget plus queueing: the lock is stale, not busy. */
const COMPILE_STALE_MS = 90_000;
let lastSnapshotAt = 0;
const clone = <T,>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

function bodyFor(fig: Figure) {
  return generateBody(fig);
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      docName: "figure.tex",
      source: buildDocument(defaultFigure()),
      compiledSource: null,

      figure: defaultFigure(),
      bodyStamp: generateBody(defaultFigure()),
      sourceOnly: false,
      selectedId: null,
      tool: "select",
      preset: null,
      activeTools: figureTemplates[0]?.tools ?? defaultTools(),
      snap: true,
      canvasGrid: true,
      learnedModels: {},
      rightTab: "canvas",
      fitToken: 0,
      editing: false,
      history: { past: [], future: [] },

      settings: {
        engine: "xelatex",
        autoCompile: true,
        delay: 900,
        theme: "dark",
        previewBg: "checker",
        provider: "deepseek",
        apiBaseUrl: "https://api.deepseek.com/v1",
        apiKey: "",
        apiModel: "deepseek-chat",
      },

      status: "idle",
      svg: null,
      width: 0,
      height: 0,
      pages: 1,
      errors: [],
      warnings: [],
      log: "",
      durationMs: 0,
      cached: false,
      compiledAt: null,
      engineUsed: null,
      wrapped: false,

      dockTab: "problems",
      dockOpen: true,
      editorWidth: 46,
      dockHeight: 190,

      drawer: "none",
      toasts: [],
      jumpLine: null,

      setSource: (v) => set({ source: v }),
      setDocName: (v) => set({ docName: v }),
      patchSettings: (v) => set((s) => ({ settings: { ...s.settings, ...v } })),
      useProvider: (id) => {
        const p = providerById(id);
        set((s) => ({
          settings: {
            ...s.settings,
            provider: id,
            apiBaseUrl: p.baseUrl || s.settings.apiBaseUrl,
            apiModel: p.models[0] ?? s.settings.apiModel,
          },
        }));
      },
      setTool: (t) => set({ tool: t, preset: null }),
      learnModels: (providerId, ids) => {
        if (!ids.length) return;
        set((s) => ({
          learnedModels: {
            ...s.learnedModels,
            [providerId]: Array.from(new Set([...ids, ...(s.learnedModels[providerId] ?? [])])).slice(0, 24),
          },
        }));
      },
      setPreset: (id) => set({ preset: id, tool: "select" }),
      createPresetAt: (p) => {
        const def = getPreset(get().preset);
        if (!def) return;
        const kind = def.build(p, 1).kind;
        const n = get().figure.elements.filter((el) => el.kind === kind).length + 1;
        get().createElement(def.build(p, n));
      },
      setRightTab: (t) => set({ rightTab: t }),
      toggleSnap: () => set((s) => ({ snap: !s.snap })),
      toggleCanvasGrid: () => set((s) => ({ canvasGrid: !s.canvasGrid })),
      selectElement: (id) => set({ selectedId: id }),
      fitCanvas: () => set((s) => ({ fitToken: s.fitToken + 1 })),

      /** Make the first coordinate system cover every curve, so labels and curves agree. */
      fitAxesToPlots: () => {
        const fig = get().figure;
        const plots = fig.elements.filter((el) => el.kind === "plot") as PlotEl[];
        const axes = fig.elements.find((el) => el.kind === "axes") as AxesEl | undefined;
        if (!plots.length || !axes) {
          get().toast("info", "需要同时有坐标轴和函数曲线");
          return;
        }
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const p of plots) {
          x0 = Math.min(x0, p.xMin + p.offset.x);
          x1 = Math.max(x1, p.xMax + p.offset.x);
          for (const run of plotRuns(p)) {
            for (const pt of run) {
              y0 = Math.min(y0, pt.y);
              y1 = Math.max(y1, pt.y);
            }
          }
        }
        if (!Number.isFinite(y0)) {
          get().toast("error", "曲线没有有效采样点，先修表达式");
          return;
        }
        const pad = 0.5;
        const nx0 = Math.floor(x0 - pad);
        const nx1 = Math.ceil(x1 + pad);
        const ny0 = Math.floor(y0 - pad);
        const ny1 = Math.ceil(y1 + pad);
        get().beginEdit();
        get().replaceElement(axes.id, {
          ...axes,
          xMin: nx0 - axes.origin.x,
          xMax: nx1 - axes.origin.x,
          yMin: ny0 - axes.origin.y,
          yMax: ny1 - axes.origin.y,
        });
        get().commitEdit();
        get().toast("ok", `坐标轴已适配曲线（x ${nx0}…${nx1}，y ${ny0}…${ny1}）`);
      },

      beginEdit: () => {
        const s = get();
        const now = Date.now();
        const last = s.history.past[s.history.past.length - 1];
        const sameAsLast = last && JSON.stringify(last) === JSON.stringify(s.figure);
        // Coalesce bursts (drag start + inspector typing) into one undo step.
        if (sameAsLast && now - lastSnapshotAt < 800) {
          set({ editing: true });
          return;
        }
        lastSnapshotAt = now;
        set({ history: { past: [...s.history.past.slice(-49), clone(s.figure)], future: [] }, editing: true });
      },

      replaceElement: (id, next) =>
        set((s) => ({
          figure: { elements: s.figure.elements.map((el) => (el.id === id ? next : el)) },
        })),

      commitEdit: () => {
        const { figure, history, source } = get();
        const last = history.past[history.past.length - 1];
        const unchanged = last && JSON.stringify(last) === JSON.stringify(figure);
        set({
          source: upsertBody(source, bodyFor(figure)),
          bodyStamp: bodyFor(figure),
          sourceOnly: false,
          editing: false,
          history: { past: unchanged ? history.past.slice(0, -1) : history.past, future: unchanged ? history.future : [] },
        });
      },

      createElement: (el) => {
        get().beginEdit();
        set((s) => ({ figure: { elements: [...s.figure.elements, el] }, selectedId: el.id, tool: "select" }));
        get().commitEdit();
      },

      deleteSelected: () => {
        const id = get().selectedId;
        if (!id) return;
        get().beginEdit();
        set((s) => ({ figure: { elements: s.figure.elements.filter((el) => el.id !== id) }, selectedId: null }));
        get().commitEdit();
      },

      reorderSelected: (dir) => {
        const id = get().selectedId;
        if (!id) return;
        const els = [...get().figure.elements];
        const i = els.findIndex((el) => el.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= els.length) return;
        get().beginEdit();
        [els[i], els[j]] = [els[j], els[i]];
        set({ figure: { elements: els } });
        get().commitEdit();
      },

      undoFigure: () => {
        const { history, figure, source } = get();
        if (!history.past.length) return;
        const past = [...history.past];
        const prev = past.pop()!;
        set({
          figure: prev,
          selectedId: null,
          history: { past, future: [clone(figure), ...history.future].slice(0, 50) },
          source: upsertBody(source, bodyFor(prev)),
          bodyStamp: bodyFor(prev),
        });
      },

      redoFigure: () => {
        const { history, figure, source } = get();
        if (!history.future.length) return;
        const [next, ...rest] = history.future;
        set({
          figure: next,
          selectedId: null,
          history: { past: [...history.past, clone(figure)].slice(-50), future: rest },
          source: upsertBody(source, bodyFor(next)),
          bodyStamp: bodyFor(next),
        });
      },

      loadFigure: (fig, mode = "template", tools) => {
        set({
          figure: clone(fig),
          preset: null,
          activeTools: tools && tools.length ? tools : defaultTools(),
          selectedId: null,
          history: { past: [], future: [] },
          source: mode === "template" ? buildDocument(fig) : upsertBody(get().source, bodyFor(fig)),
          bodyStamp: bodyFor(fig),
          sourceOnly: false,
          drawer: "none",
          rightTab: "canvas",
          fitToken: get().fitToken + 1,
        });
        setTimeout(() => void get().compile(true), 80);
      },

      syncFigureFromSource: () => {
        const parsed = parseBodySafe(get().source);
        if (!parsed || !parsed.elements.length) {
          get().toast("error", "没能从源码中识别出可编辑的图形");
          return;
        }
        set({
          figure: parsed,
          bodyStamp: extractBody(get().source),
          sourceOnly: false,
          selectedId: null,
          history: { past: [], future: [] },
          fitToken: get().fitToken + 1,
        });
        get().toast("ok", `已从源码重建画布（${parsed.elements.length} 个元素）`);
      },

      overwriteSourceFromFigure: () => {
        set({ source: upsertBody(get().source, bodyFor(get().figure)), bodyStamp: bodyFor(get().figure) });
        get().toast("ok", "已用画布内容覆盖 TikZ 源码");
        setTimeout(() => void get().compile(true), 80);
      },

      async compile(force = false) {
        const s = get();
        if (!s.source.trim()) {
          set({ status: "error", errors: [{ line: null, message: "文档为空，没有可编译的内容" }], log: "" });
          return;
        }
        if (!force && s.status === "ok" && s.compiledSource === s.source && s.engineUsed === s.settings.engine) return;
        // A request that never settles used to leave `inflight` true forever: every
        // later compile returned immediately and the button stayed disabled until a
        // page reload. Recover from a stale lock instead of trusting it blindly.
        if (inflight && Date.now() - inflightStartedAt > COMPILE_STALE_MS) {
          inflight = false;
          queued = false;
        }
        if (inflight) {
          queued = true;
          return;
        }
        inflight = true;
        inflightStartedAt = Date.now();
        set({ status: "running" });
        const started = performance.now();
        // Hard deadline: the browser default is minutes, which looks like a freeze.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), COMPILE_TIMEOUT_MS);
        try {
          const res = await api.compile({ source: s.source, engine: s.settings.engine }, controller.signal);
          if (res.ok) {
            set({
              status: "ok",
              svg: res.svg,
              width: res.width,
              height: res.height,
              pages: res.pages,
              errors: [],
              warnings: res.warnings ?? [],
              log: res.log ?? "",
              durationMs: res.cached ? Math.round(performance.now() - started) : res.durationMs,
              cached: Boolean(res.cached),
              compiledAt: Date.now(),
              compiledSource: s.source,
              engineUsed: res.engine,
              wrapped: Boolean(res.wrapped),
            });
          } else {
            set({
              status: "error",
              errors: res.errors ?? [],
              warnings: res.warnings ?? [],
              log: res.log ?? "",
              durationMs: res.durationMs ?? Math.round(performance.now() - started),
              cached: false,
              compiledAt: Date.now(),
              compiledSource: s.source,
              engineUsed: s.settings.engine,
              dockTab: "problems",
              dockOpen: true,
            });
          }
        } catch (err: any) {
          const aborted = err?.name === "AbortError";
          const message = aborted
            ? "编译超时（" + Math.round(COMPILE_TIMEOUT_MS / 1000) + "s），已取消这次请求。可直接重试"
            : err?.message || "编译请求失败";
          set({
            status: "error",
            errors: [{ line: null, message }],
            log: String(err?.stack || err?.message || err),
            durationMs: Math.round(performance.now() - started),
            dockTab: "problems",
            dockOpen: true,
          });
          get().toast("error", message);
        } finally {
          clearTimeout(timeout);
          inflight = false;
          if (queued) {
            queued = false;
            const again = get();
            if (again.source !== again.compiledSource) setTimeout(() => void get().compile(), 30);
          }
        }
      },

      insertSnippet: (code, mode = "replace") => {
        set(mode === "replace" ? { source: code, drawer: "none" } : { source: get().source + "\n" + code, drawer: "none" });
        const parsed = parseBodySafe(code);
        if (parsed && parsed.elements.length) {
          set({ figure: parsed, bodyStamp: extractBody(code), sourceOnly: false, selectedId: null, fitToken: get().fitToken + 1, rightTab: "canvas" });
        }
        setTimeout(() => void get().compile(true), 80);
      },

      setDock: (v) => set((s) => ({ dockTab: v.tab ?? s.dockTab, dockOpen: v.open ?? s.dockOpen })),
      setLayout: (v) => set({ ...v }),
      openDrawer: (d) => set({ drawer: d }),
      toast: (kind, text) => {
        const id = ++toastSeq;
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
        setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 3200);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      jumpTo: (line) => set({ jumpLine: { line, ts: Date.now() } }),
    }),
    {
      name: "tikz-studio:v1",
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Post-set, so apply through setState (zustand already committed the merge).
        queueMicrotask(() => {
          try {
            const cur = useApp.getState();
            const providerId = cur.settings.provider || detectProvider(cur.settings.apiBaseUrl, cur.settings.apiModel);
            const preset = providerById(providerId);
            const patch: Record<string, unknown> = {};
            if (!cur.settings.provider) patch.provider = providerId;
            // An empty base URL would silently fail every request — heal it from the preset.
            if (!cur.settings.apiBaseUrl && preset.baseUrl) patch.apiBaseUrl = preset.baseUrl;
            if (Object.keys(patch).length) {
              useApp.setState({ settings: { ...cur.settings, ...patch } });
            }
            const body = extractBody(cur.source);
            if (!body) return;
            const parsed = parseBodySafe(cur.source);
            if (!parsed || !parsed.elements.length) {
              // We cannot represent this document on the canvas. Do NOT leave the
              // default template on screen pretending to be the user's figure.
              useApp.setState({ figure: { elements: [] }, bodyStamp: body, sourceOnly: true, selectedId: null });
              return;
            }
            if (body.trim() !== generateBody(cur.figure).trim()) {
              // The saved document wins: the canvas should show what the user last wrote.
              useApp.setState({ figure: parsed, bodyStamp: body, sourceOnly: false, selectedId: null });
            }
          } catch {
            /* keep persisted state */
          }
        });
      },
      partialize: (s) => ({
        docName: s.docName,
        source: s.source,
        figure: s.figure,
        bodyStamp: s.bodyStamp,
        sourceOnly: s.sourceOnly,
        settings: s.settings,
        editorWidth: s.editorWidth,
        dockHeight: s.dockHeight,
        rightTab: s.rightTab,
        learnedModels: s.learnedModels,
        activeTools: s.activeTools,
        snap: s.snap,
        canvasGrid: s.canvasGrid,
      }),
    }
  )
);

export const isDirty = (s: AppState) => s.compiledSource !== null && s.compiledSource !== s.source;
