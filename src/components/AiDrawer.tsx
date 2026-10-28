import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowDownToLine, Check, ClipboardCopy, Eye, EyeOff, ImagePlus, KeyRound,
  Loader2, PencilLine, Sparkles, SquarePen, Type, X,
} from "lucide-react";
import { useApp } from "../store";
import { api, type AiStreamEvent, type Diag } from "../lib/api";
import { parseBody } from "../lib/figure/parse";
import { buildDocument } from "../lib/figure/generate";
import { mergePanels, type PanelPart } from "../lib/figure/merge";
import { cropPanel, cropBounds, panelRegions, detectPanels, loadImage, type PanelBox } from "../lib/panels";
import { KIND_LABEL, defaultStyle, uid, type Figure } from "../lib/figure/types";
import { bboxOf } from "../lib/figure/edit";
import { runPanelJobs } from "../lib/panel-runner";
import { assessFigure } from "../lib/figure/quality";
import type { Understanding, VectorizeStats, VisualReview } from "../lib/api";
import { PROVIDERS, providerById, modelLabel, resolveModelId, visionCapability, type ModelMeta } from "../lib/providers";

type Mode = "text" | "image";
const UNDERSTAND_LABEL: Record<string, string> = { circle: "圆", ellipse: "椭圆", arc: "弧", line: "线段", polyline: "折线", text: "文字" };
type Step = { id: string; label: string; status: "running" | "ok" | "fail"; detail?: string };

interface Result {
  ok: boolean;
  attempts: number;
  rounds?: number;
  phased?: "budget" | "review" | "stuck";
  reviewAccepted?: string;
  lintAccepted?: string[];
  truncated?: boolean;
  size?: { chars: number; lines: number; coords: number; draws: number; nodes: number; biggest: string };
  visual?: { score: number; pass: boolean; issues?: { severity: string; message: string }[] } | null;
  /** Which local tracer produced the document: contour fill or skeleton walking. */
  representation?: string;
  reason?: string;
  geometry?: { recall: number | null; precision: number | null; problems: string[] } | null;
  versions?: { round: number; recall: number | null; precision: number | null; problems: number; chars: number; compiled: boolean; score?: number | null }[] | null;
  trace?: {
    elements?: number;
    points?: number;
    palette?: number;
    labels?: number;
    tracks?: number;
    curves?: number;
    nodes?: number;
    bytes?: number;
    kinds?: Record<string, number>;
    labelsAsOutlines?: boolean;
    reconstruction?: string;
  } | null;
  model?: string;
  durationMs: number;
  errors?: Diag[];
  panelsDone?: number;
  panelsTotal?: number;
}

/** Pick the most plausible valid id for a rejected one (`deepseek-v4.1-flash` → `deepseek-flash`). */
function pickClosestModel(current: string, valid: string[]): string {
  const c = current.toLowerCase();
  const exact = valid.find((v) => v.toLowerCase() === c);
  if (exact) return exact;
  const tokens = c.split(/[-_.\s]+/).filter((t) => t.length > 2);
  let best = valid[0];
  let bestScore = -1;
  for (const v of valid) {
    const vl = v.toLowerCase();
    let score = 0;
    for (const t of tokens) if (vl.includes(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

const EXAMPLES = [
  "三层前馈网络：输入 4 个节点、隐层 3 个、输出 2 个，全连接并标注层名",
  "误差随迭代下降的折线图，带网格与图例",
  "论文方法总览：数据 → 特征提取 → 分类器 → 结果，用箭头连接",
  "sin(x) 与 cos(x) 在同一坐标系里的对比，含负半轴",
];

/** How much of a panel's content falls outside its largest rectangle (0..1). */
function panelOverflow(fig: Figure): number {
  const rects = fig.elements.filter((e) => e.kind === "rect");
  if (!rects.length) return 0;
  const boxes = fig.elements.map((e) => ({ e, b: bboxOf(e) })).filter((x) => x.b) as { e: any; b: any }[];
  const frame = boxes
    .filter((x) => x.e.kind === "rect")
    .map((x) => x.b)
    .reduce((a, b) => ((b.x1 - b.x0) * (b.y1 - b.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a));
  const area = (b: any) => Math.max(1e-9, (b.x1 - b.x0) * (b.y1 - b.y0));
  let outside = 0;
  for (const { b } of boxes) {
    if (b === frame) continue;
    const ix = Math.max(0, Math.min(b.x1, frame.x1) - Math.max(b.x0, frame.x0));
    const iy = Math.max(0, Math.min(b.y1, frame.y1) - Math.max(b.y0, frame.y0));
    outside += area(b) - ix * iy;
  }
  const total = boxes.reduce((sum, x) => sum + area(x.b), 0);
  return total > 0 ? Math.min(1, outside / total) : 0;
}

/** Marks a panel that could not be recognised, so the layout keeps its slot. */
function placeholderPanel(): Figure {
  const style = defaultStyle();
  return {
    elements: [
      { id: uid("ph"), kind: "rect", name: "占位", from: { x: 0, y: 0 }, to: { x: 10, y: 6 }, style: { ...style, color: "gray", dashed: true }, rounded: 0 },
      {
        id: uid("ph"),
        kind: "node",
        name: "占位说明",
        at: { x: 5, y: 2.6 },
        text: "此面板识别失败",
        style: { ...style, color: "gray" },
        boxed: false,
        rounded: 0,
        fontSize: 12,
        anchor: "center",
      },
    ],
  };
}

/** Downscale a screenshot so the request stays small; line art survives PNG. */
async function shrinkImage(dataUrl: string, max: number): Promise<{ url: string; w: number; h: number; scaled: boolean }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url: dataUrl, w: img.width, h: img.height, scaled: false };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height, scaled: scale < 1 };
}

export function AiDrawer() {
  const { drawer, openDrawer, settings, patchSettings, useProvider, insertSnippet, toast, learnModels, source } = useApp();
  const learned = useApp((s) => s.learnedModels);
  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageSize, setImageSize] = useState<{ w: number; h: number; scaled: boolean } | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [cropped, setCropped] = useState(false);
  const [cropHint, setCropHint] = useState("");
  const thumbRef = useRef<HTMLImageElement>(null);
  const [dragRect, setDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [panels, setPanels] = useState<PanelBox[] | null>(null);
  const [logId, setLogId] = useState<string | null>(null);

  /** Cut the selected rectangle out of the screenshot (paper figures are multi-panel). */
  async function cropToRect(rect: { x0: number; y0: number; x1: number; y1: number }) {
    const img = thumbRef.current;
    if (!img) return;
    const x = Math.min(rect.x0, rect.x1);
    const y = Math.min(rect.y0, rect.y1);
    const w = Math.abs(rect.x1 - rect.x0);
    const h = Math.abs(rect.y1 - rect.y0);
    if (w < 16 || h < 16) return;
    const sx = img.naturalWidth / img.clientWidth;
    const sy = img.naturalHeight / img.clientHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * sx));
    canvas.height = Math.max(1, Math.round(h * sy));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, Math.round(x * sx), Math.round(y * sy), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    setOriginalImage((prev) => prev ?? image);
    setImage(canvas.toDataURL("image/png"));
    setImageSize({ w: canvas.width, h: canvas.height, scaled: false });
    setCropped(true);
    setCropHint(`已裁切 ${canvas.width}×${canvas.height}，只发送这一块`);
    toast("ok", "已裁切到选区");
  }
  const [canvasMode, setCanvasMode] = useState(true);
  /** How many extra rounds after a rejected attempt; 0 = validate only. */
  const [repairs, setRepairs] = useState(1);
  const [reviewer, setReviewer] = useState(true);
  const [review, setReview] = useState<{ verdict: "pass" | "revise"; score: number; issues: AiStreamEvent["issues"]; instructions?: string } | null>(null);
  const [diff, setDiff] = useState<{ total: number; kept: number; changed: number; ratio: number } | null>(null);
  const [budget, setBudget] = useState<{ limitMs: number; reason?: string; rounds?: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);
  const [editable, setEditable] = useState<{ total: number; kinds: string } | null>(null);
  /** editable = model reads semantics + local tracing; high = VTracer fills only. */
  const [fidelity, setFidelity] = useState<"editable" | "high">("editable");
  const [fillsOnly, setFillsOnly] = useState(false);
  const [withText, setWithText] = useState(false);
  const [vector, setVector] = useState<VectorizeStats | null>(null);
  /**
   * Image route: "figure" understands the picture and redraws it with real
   * primitives; "trace" is the old contour fill (no understanding step).
   */
  const [tracer, setTracer] = useState<"figure" | "trace">("figure");
  const [understanding, setUnderstanding] = useState<Understanding | null>(null);
  /** True when the API process predates server/*.mjs: new routes silently fall back. */
  const [staleApi, setStaleApi] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [visualReview, setVisualReview] = useState<VisualReview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [lint, setLint] = useState<{ ok: boolean; issues: { code: string; severity: string; where?: string | null; message: string; fix?: string }[] } | null>(null);
  const autoFixedRef = useRef(false);
  const [diagnostics, setDiagnostics] = useState<{ attempt: number; errors: Diag[] } | null>(null);
  const [showCode, setShowCode] = useState(true);
  const [over, setOver] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [meta, setMeta] = useState<ModelMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const panelCacheRef = useRef<{ key: string; parts: Map<number, PanelPart> }>({ key: "", parts: new Map() });

  useEffect(() => {
    if (drawer !== "ai") abortRef.current?.abort();
  }, [drawer]);

  // A stale API is invisible otherwise: the request looks fine and quietly runs
  // the old pipeline. Say it out loud.
  useEffect(() => {
    if (drawer !== "ai") return;
    let cancelled = false;
    api.version()
      .then((h) => {
        if (cancelled) return;
        const started = Number(h.startedAt ?? 0);
        const updated = Number(h.sourceUpdatedAt ?? 0);
        setStaleApi(Boolean(started && updated && updated > started + 2000));
      })
      .catch((err: { status?: number }) => {
        // No /api/version at all: the server predates this check, so it is old.
        if (!cancelled && err?.status === 404) setStaleApi(true);
      });
    return () => {
      cancelled = true;
    };
  }, [drawer]);

  // Show the connect card when nothing is configured, but keep it open while
  // the user is typing a key (setting a key must not yank the card away).
  useEffect(() => {
    if (drawer === "ai" && !useApp.getState().settings.apiKey) setSetupOpen(true);
  }, [drawer]);

  // Ctrl+V with a screenshot in the clipboard — the drop zone promises it.
  // Must stay above the early return: hooks cannot be conditional.
  useEffect(() => {
    if (drawer !== "ai" || mode !== "image") return;
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const img = items.find((i) => i.type.startsWith("image/"));
      if (!img) return;
      const file = img.getAsFile();
      if (!file) return;
      e.preventDefault();
      // readFile is hoisted, so this is safe even though it is declared below.
      void readFile(new File([file], file.name || `clipboard-${Date.now()}.png`, { type: file.type }));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [drawer, mode]);

  // A five-minute run should feel alive, not frozen.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => clearInterval(t);
  }, [running]);

  // Panel detection: multi-panel paper figures are transcribed one panel at a
  // time, which is far more reliable than asking for everything at once.
  useEffect(() => {
    if (drawer !== "ai" || mode !== "image" || !image) {
      setPanels(null);
      return;
    }
    let cancelled = false;
    void detectPanels(image)
      .then((r) => {
        if (!cancelled) setPanels(r.panels.length >= 2 ? r.panels : null);
      })
      .catch(() => {
        if (!cancelled) setPanels(null);
      });
    return () => {
      cancelled = true;
    };
  }, [drawer, mode, image]);

  if (drawer !== "ai") return null;
  const ready = Boolean(settings.apiKey);
  const provider = providerById(settings.provider);
  const currentMeta = meta.find((m) => m.id === settings.apiModel);
  const vision = visionCapability(settings.apiModel, currentMeta);
  const canVision = vision !== "no";
  // Suggestions = preset + whatever /models returned + ids the API itself told us are valid.
  const modelOptions = Array.from(
    new Set([...provider.models, ...meta.map((m) => m.id), ...(learned[settings.provider] ?? [])])
  ).filter(Boolean);
  if (settings.apiModel && !modelOptions.includes(settings.apiModel)) modelOptions.push(settings.apiModel);

  async function connect() {
    if (!settings.apiKey.trim()) {
      setConnectMsg("先填一个 API Key（Ollama 本地服务随便填即可）");
      return;
    }
    setConnecting(true);
    setConnectMsg(null);
    try {
      const res = await api.aiCheck({ baseUrl: settings.apiBaseUrl }, settings.apiKey);
      setMeta(res.meta ?? []);
      setConnectMsg(`连接成功，找到 ${(res.models ?? []).length} 个模型`);
      toast("ok", "已连接 " + provider.name);
      setTimeout(() => setSetupOpen(false), 700);
    } catch (err: any) {
      setConnectMsg(err?.message || "连接失败");
    } finally {
      setConnecting(false);
    }
  }

  async function readFile(file: File) {
    if (!file.type.startsWith("image/")) return toast("error", "请选择图片文件");
    if (file.size > 12 * 1024 * 1024) return toast("error", "图片请小于 12 MB");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
    // Paper screenshots are often 2000+ px wide; most gateways cap the payload.
    const shrunk = await shrinkImage(dataUrl, 1600);
    setImage(shrunk.url);
    setOriginalImage(shrunk.url);
    setCropped(false);
    setCropHint("");
    setImageName(file.name);
    setImageSize({ w: shrunk.w, h: shrunk.h, scaled: shrunk.scaled });
    setResult(null);
    setFailure(null);
    setEditable(null);
  }

  /** One vision call for one cropped panel; resolves to the generated document. */
  async function recognizePanel(
    dataUrl: string,
    onStep?: (text: string) => void,
    budgetMs = 75_000,
    strict = false,
    panelIndex = 0,
    signal?: AbortSignal
  ): Promise<string | null> {
    let out: string | null = null;
    const requested = settings.apiModel;
    const model = resolveModelId(requested, meta, modelOptions);
    await api.aiText2Tikz(
      {
        mode: "image",
        perPanel: true,
        image: dataUrl,
        baseUrl: settings.apiBaseUrl,
        model,
        canvasMode: true,
        maxAttempts: 1,
        engine: settings.engine,
        reviewer: false,
        // One panel must never inherit the whole five-minute budget.
        budgetMs,
        strict,
        panelIndex,
        representation: tracer,
      },
      settings.apiKey,
      (ev) => {
        if (ev.type === "step" && ev.label && onStep) {
          onStep(ev.label + (ev.detail ? " · " + ev.detail : ""));
        }
        if (ev.type === "error") {
          // The server tells us exactly what the upstream said; swallowing it made
          // every failure look like "no content".
          throw Object.assign(new Error(ev.message || "上游拒绝请求"), {
            code: ev.code,
            supported: Array.isArray((ev as { supported?: string[] }).supported) ? (ev as { supported?: string[] }).supported : undefined,
          });
        }
        if (ev.type === "done") {
          if (!ev.ok || !ev.code) throw new Error(ev.reason === "TIMEOUT" ? "此面板达到时间上限" : "模型未交付可编译的完整面板");
          out = ev.code;
        }
      },
      signal
    );
    return out;
  }

  /** Multi-panel path: crop → transcribe each → compose one document. */
  async function runPanels(retryOnly = false) {
    if (!ready) return setFailure("请先配置 API Key。");
    if (!image || !panels?.length) return setFailure("没有检测到多个面板。");
    const key = JSON.stringify([image, settings.apiBaseUrl, settings.apiModel, settings.engine, tracer]);
    if (!retryOnly || panelCacheRef.current.key !== key) panelCacheRef.current = { key, parts: new Map() };
    const cache = panelCacheRef.current.parts;
    const ac = new AbortController();
    const wholeJobTimer = setTimeout(() => ac.abort(new Error('整图识别与审核达到三分钟上限')), 180_000);
    abortRef.current = ac;
    setRunning(true);
    startedAt.current = Date.now();
    setElapsed(0);
    setSteps([]);
    setFailure(null);
    setVisualReview(null);
    setBudget({ limitMs: 180_000 });
    if (!retryOnly) { setCode(null); setResult(null); }
    try {
      const img = await loadImage(image);
      const k = img.naturalWidth / 320;
      const regions = panelRegions(panels, 320, img.naturalHeight / k);
      const update = () => {
        const parts = [...cache.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => part);
        if (parts.length) {
          const merged = mergePanels(parts, img.naturalWidth, img.naturalHeight, 12);
          setCode(buildDocument(merged));
          setEditable({ total: merged.elements.length, kinds: "" });
        }
        setResult({ ok: false, attempts: 0, panelsDone: parts.length, panelsTotal: panels.length, durationMs: Date.now() - startedAt.current });
      };
      const report = await runPanelJobs<PanelPart>({
        count: panels.length, signal: ac.signal, initial: cache, concurrency: 2,
        budgetMs: reviewer ? 135_000 : 180_000, panelBudgetMs: 75_000, maxAttempts: 2,
        run: async (i, context) => {
          const box = cropBounds(regions[i], k, img.naturalWidth, img.naturalHeight, 0);
          const crop = cropPanel(img, box, 1, 0);
          const source = await recognizePanel(crop, text => upsertStep({ id: "panel" + i, label: `识别面板 ${i + 1}/${panels.length}`, status: "running", detail: text }), context.budgetMs, context.strict, i + 1, context.signal);
          if (!source) throw new Error("上游返回了空面板");
          const fig = parseBody(source);
          if (!fig.elements.length) throw new Error("面板无法解析为可编辑元素");
          const quality = assessFigure(fig);
          if (!quality.ok) throw new Error(quality.issues[0].message);
          return { fig, box };
        },
        onUpdate: states => {
          for (const state of states) {
            if (state.status === "ok" && state.value) cache.set(state.index, state.value);
            upsertStep({ id: "panel" + state.index, label: `识别面板 ${state.index + 1}/${panels.length}`, status: state.status === "pending" ? "running" : state.status, detail: state.status === "ok" ? `${state.value?.fig.elements.length ?? 0} 个元素${state.attempts === 0 ? "（已保留）" : ""}` : state.error ?? (state.status === "pending" ? "等待处理" : `第 ${state.attempts} 次`) });
          }
          update();
        },
      });
      update();
      if (cache.size === panels.length) {
        const doc = buildDocument(mergePanels([...cache.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => part), img.naturalWidth, img.naturalHeight));
        if (reviewer) {
          upsertStep({ id: "visual", label: "对照原图检查", status: "running" });
          const check = await api.aiCompare({ source: doc, image, baseUrl: settings.apiBaseUrl, model: resolveModelId(settings.apiModel, meta, modelOptions), engine: settings.engine }, settings.apiKey, ac.signal);
          setVisualReview(check);
          upsertStep({ id: "visual", status: check.pass ? "ok" : "fail", detail: `${check.score} 分` });
          setResult({ ok: check.pass, attempts: 1, panelsDone: cache.size, panelsTotal: panels.length, durationMs: Date.now() - startedAt.current });
        }
        toast("ok", `已保留全部 ${panels.length} 个面板`);
      }
      else setFailure(`${report.cancelled ? "已停止" : report.timedOut ? "达到整图时间上限" : "部分面板未完成"}；已保留 ${cache.size}/${panels.length} 个面板，可单独重试未完成部分。`);
    } catch (err) {
      setFailure((err as Error).message || "识别失败");
    } finally {
      clearTimeout(wholeJobTimer);
      setRunning(false);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  function upsertStep(patch: { id: string; label?: string; status: Step["status"]; detail?: string }) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.id === patch.id);
      if (i < 0) {
        return [...prev, { id: patch.id, label: patch.label ?? "处理中", status: patch.status, detail: patch.detail }];
      }
      const next = [...prev];
      const merged: Step = { ...next[i], status: patch.status };
      if (patch.label) merged.label = patch.label;
      if (patch.detail !== undefined) merged.detail = patch.detail;
      next[i] = merged;
      return next;
    });
  }

  async function run(override?: { model?: string; auto?: boolean; edit?: boolean }) {
    if (!override?.edit && !override?.auto && mode === "image" && panels && panels.length >= 2) return runPanels();
    if (!ready) return setFailure("未配置 API Key。请先到「设置 → API」填入密钥。");
    const editing = Boolean(override?.edit);
    if (editing && !source.trim()) return setFailure("编辑器里还没有 TikZ 文档。");
    if (!editing && mode === "text" && !prompt.trim()) return setFailure("请先描述你想要的图形。");
    if (!editing && mode === "image" && !image) return setFailure("请先上传一张图片。");
    if (editing && !prompt.trim()) return setFailure("请先写出要改什么，比如「把球上的洞去掉」。");
    const requested = override?.model ?? settings.apiModel;
    // Accept display names ("DeepSeek-V4.1-Flash 1017") — the protocol wants the id.
    const model = resolveModelId(requested, meta, modelOptions);
    if (model !== requested) patchSettings({ apiModel: model });
    if (!override?.auto) autoFixedRef.current = false;

    setRunning(true);
    startedAt.current = Date.now();
    setElapsed(0);
    setSuggested([]);
    if (!override?.auto) setSteps([]);
    setCode(null);
    setResult(null);
    setFailure(null);
    setVisualReview(null);
    setDiagnostics(null);
    setDiff(null);
    setBudget(null);
    setEditable(null);
    setVector(null);
    setUnderstanding(null);
    const ac = new AbortController();
    abortRef.current = ac;
    let finalCode: string | null = null;
    let delivered = false;
    let serverReview: VisualReview | null = null;

    try {
      await api.aiText2Tikz(
        {
          mode: override?.edit ? "edit" : mode,
          current: override?.edit ? source : undefined,
          prompt: prompt.trim() || undefined,
          image: mode === "image" ? image ?? undefined : undefined,
          baseUrl: settings.apiBaseUrl,
          model,
          canvasMode,
          // maxAttempts counts the first try plus the corrections.
          maxAttempts: Math.max(1, Math.min(6, repairs + 1)),
          engine: settings.engine,
          reviewer,
          representation: mode === "image" ? tracer : undefined,
        },
        settings.apiKey,
        (event: AiStreamEvent) => {
          if (event.type === "step" && event.id) {
            // Later frames only carry status/detail; keep the original label.
            upsertStep({
              id: event.id,
              label: event.label,
              status: (event.status as Step["status"]) ?? "running",
              detail: event.detail,
            });
          } else if (event.type === "code") {
            setCode(event.code ?? null);
          } else if (event.type === "lint") {
            setLint({ ok: Boolean(event.ok), issues: (event.issues as never[]) ?? [] });
          } else if (event.type === "budget") {
            setBudget({ limitMs: Number(event.limitMs ?? 300000) });
          } else if (event.type === "log" && event.logId) {
            setLogId(event.logId);
          } else if (event.type === "understanding") {
            setUnderstanding(event.understanding ?? null);
          } else if (event.type === "diff") {
            setDiff({
              total: Number(event.total ?? 0),
              kept: Number(event.kept ?? 0),
              changed: Number(event.changed ?? 0),
              ratio: Number(event.ratio ?? 0),
            });
          } else if (event.type === "review") {
            setReview({
              verdict: event.verdict ?? "revise",
              score: Number(event.score ?? 0),
              issues: event.issues ?? [],
              instructions: event.instructions,
            });
          } else if (event.type === "diagnostics") {
            setDiagnostics({ attempt: event.attempt ?? 1, errors: event.errors ?? [] });
          } else if (event.type === "done") {
            if (event.visual) {
              serverReview = { ok: true, compiled: true, pass: event.visual.pass, score: event.visual.score, issues: event.visual.issues || [] };
              setVisualReview(serverReview);
            }
            finalCode = event.code ?? null;
            delivered = Boolean(event.ok);
            if (event.code) setCode(event.code);
            setResult({
              ok: Boolean(event.ok),
              attempts: event.attempts ?? 1,
              rounds: event.rounds,
              phased: event.timedOut || event.reason === "TIME_BUDGET" || event.reason === "TIMEOUT"
                ? "budget"
                : event.reason === "STUCK"
                  ? "stuck"
                  : event.reason === "REVIEW_REJECTED"
                    ? "review"
                    : undefined,
              reviewAccepted: event.reviewAccepted,
              lintAccepted: event.lintAccepted,
              truncated: event.truncated,
              size: event.size,
              representation: event.representation,
              reason: event.reason,
              geometry: event.geometry ?? null,
              versions: event.versions ?? null,
              visual: event.visual ?? null,
              trace: event.trace ?? null,
              model: event.model,
              durationMs: event.durationMs ?? 0,
              errors: event.errors ?? [],
            });
            if (event.ok) toast("ok", mode === "image" ? "已识别为可编辑 TikZ" : "已生成可编译的 TikZ");
            // For screenshots the whole point is editability: summarise what the canvas can pick up.
            if (event.ok && mode === "image" && event.code) {
              try {
                const fig = parseBody(event.code);
                const counts = new Map<string, number>();
                for (const el of fig.elements) counts.set(el.kind, (counts.get(el.kind) ?? 0) + 1);
                setEditable({
                  total: fig.elements.length,
                  kinds: [...counts.entries()].map(([k, n]) => KIND_LABEL[k as keyof typeof KIND_LABEL] + " " + n).join(" · "),
                });
              } catch {
                setEditable(null);
              }
            }
          } else if (event.type === "error") {
            setFailure(event.message ?? "生成失败");
            // The gateway told us which ids are valid — remember them…
            const valid = Array.isArray(event.supported) ? event.supported : [];
            setSuggested(valid);
            if (valid.length) learnModels(settings.provider, valid);
            // …and fix the typo ourselves instead of making the user click.
            if (valid.length && !autoFixedRef.current && !valid.includes(model)) {
              const best = pickClosestModel(model, valid);
              autoFixedRef.current = true;
              patchSettings({ apiModel: best });
              // restart the timeline with the correction first, so the log reads top-down
              setSteps([{ id: "autofix", label: "模型名不可用 · 已自动切换", status: "ok", detail: best }]);
              setTimeout(() => void run({ model: best, auto: true }), 350);
            }
          }
        },
        ac.signal
      );
      if (mode === "image" && image && delivered && finalCode && reviewer) {
        const geometry = assessFigure(parseBody(finalCode));
        if (!geometry.ok) {
          setFailure(geometry.issues.map(i => i.message).join("；"));
          setResult(prev => prev ? { ...prev, ok: false } : prev);
        }
        const check = serverReview ?? await api.aiCompare({ source: finalCode, image, baseUrl: settings.apiBaseUrl, model, engine: settings.engine }, settings.apiKey, ac.signal);
        setVisualReview(check);
        setResult(prev => prev ? { ...prev, ok: geometry.ok && check.pass } : prev);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") setFailure(err?.message || "生成失败");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  /**
   * High-fidelity route: VTracer fills locally (no key, ~0.3s), optional model
   * labels for text, then a real compile so the card tells the truth.
   */
  async function runHighFidelity() {
    if (!image) return setFailure("请先上传一张图片。");
    if (withText && !ready) return setFailure("补文字需要 API Key；也可以关掉「用模型补文字」再试。");
    setRunning(true);
    startedAt.current = Date.now();
    setElapsed(0);
    setSteps([]);
    setCode(null);
    setResult(null);
    setFailure(null);
    setVisualReview(null);
    setDiagnostics(null);
    setDiff(null);
    setBudget(null);
    setEditable(null);
    setVector(null);
    setUnderstanding(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let labels: { box: number[]; tex: string }[] = [];
      if (withText) {
        upsertStep({ id: "labels", label: "识别文字", status: "running" });
        const res = await api.aiLabels(
          { image, baseUrl: settings.apiBaseUrl, model: resolveModelId(settings.apiModel, meta, modelOptions) },
          settings.apiKey,
          ac.signal
        );
        labels = (res.labels ?? []).filter((l) => l.tex).map((l) => ({ box: l.box, tex: l.tex }));
        upsertStep({ id: "labels", label: "识别文字", status: "ok", detail: labels.length + " 处" });
      }

      upsertStep({ id: "vector", label: "矢量化填充区域", status: "running" });
      const out = await api.vectorize(
        {
          image,
          widthCm: 12,
          mode: "spline",
          simplify: 1.2,
          precision: 2,
          minAreaPx: fillsOnly ? 260 : 0,
          minThicknessPx: fillsOnly ? 2.5 : 0,
          maxColors: fillsOnly ? 32 : undefined,
          labels,
        },
        ac.signal
      );
      upsertStep({
        id: "vector",
        label: "矢量化填充区域",
        status: "ok",
        detail: out.stats.rings + " 环 · " + Math.round(out.stats.bytes / 1024) + "KB",
      });
      setCode(out.tikz);
      setVector(out.stats);

      upsertStep({ id: "compile", label: "编译校验", status: "running" });
      const check = await api.compile({ source: out.tikz, engine: settings.engine }, ac.signal);
      upsertStep({
        id: "compile",
        label: "编译校验",
        status: check.ok ? "ok" : "fail",
        detail: check.ok ? (check.durationMs / 1000).toFixed(1) + "s" : check.errors.length + " 个错误",
      });
      setResult({
        ok: check.ok,
        attempts: 0,
        durationMs: out.durationMs,
        model: withText ? "VTracer + " + settings.apiModel : "VTracer（本地）",
        errors: check.errors,
      });
      if (check.ok) toast("ok", "高保真还原：" + out.stats.rings + " 个填充区域");
    } catch (err: any) {
      if (err?.name !== "AbortError") setFailure(err?.message || "矢量化失败");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function apply(mode2: "replace" | "insert") {
    if (!code) return;
    insertSnippet(code, mode2);
    toast("ok", mode2 === "replace" ? "已替换编辑器内容" : "已追加到文档末尾");
  }

  return (
    <>
      <div className="scrim" onClick={() => openDrawer("none")} />
      <aside className="drawer" style={{ width: "min(520px, 94vw)" }}>
        <div className="drawer-head">
          <Sparkles size={15} color="var(--accent)" />
          <div className="drawer-title">文生 TikZ</div>
          <span className="pill pill--muted">API</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => openDrawer("none")} title="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="drawer-body">
          {staleApi && (
            <div className="notice notice--warn" style={{ padding: "8px 10px" }}>
              <AlertTriangle size={13} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 11.5 }}>
                服务端进程比代码旧：<b>「先理解再画」这条路线不会生效</b>，请求会退回旧的描点流程。
                请重启 API（<code className="mono">npm run dev</code> 或 <code className="mono">node server/index.mjs</code>）。
              </span>
            </div>
          )}

          {ready && !setupOpen && (
            <div className="connect-bar">
              <span className="pill pill--muted">{provider.name}</span>
              {/* model is editable right here — no need to dig into settings */}
              <input
                className="input input--bare mono"
                list="ai-model-options"
                value={settings.apiModel}
                spellCheck={false}
                title="模型 id 或显示名都可以"
                onChange={(e) => patchSettings({ apiModel: e.target.value })}
                onBlur={(e) => {
                  // leaving the field: normalise a pasted display name to the id
                  const resolved = resolveModelId(e.target.value, meta, modelOptions);
                  if (resolved !== e.target.value) patchSettings({ apiModel: resolved });
                }}
                style={{ width: 220 }}
              />
              <datalist id="ai-model-options">
                {modelOptions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {resolveModelId(settings.apiModel, meta, modelOptions) !== settings.apiModel && (
                <span className="hint mono" title="实际发送给 API 的 model id">
                  → {resolveModelId(settings.apiModel, meta, modelOptions)}
                </span>
              )}
              <span className="hint" style={{ color: vision === "no" ? "var(--warn)" : undefined }}>
                {vision === "yes" ? "支持识图" : vision === "no" ? "纯文本" : "识图能力未知"}
              </span>
              <div className="spacer" />
              <button className="btn btn--ghost" style={{ height: 24, fontSize: 11.5 }} onClick={() => setSetupOpen(true)}>
                更换服务
              </button>
            </div>
          )}

          {(setupOpen || !ready) && (
            <div className="card connect-card">
              <div className="row" style={{ gap: 7 }}>
                <KeyRound size={14} color="var(--accent)" />
                <b style={{ fontSize: 12.5 }}>先连一个模型服务</b>
                <span className="hint">两步就好</span>
              </div>

              <div className="field">
                <label>1 · 服务商</label>
                <div className="provider-grid">
                  {PROVIDERS.map((p) => (
                    <button key={p.id} className="provider-chip" data-active={settings.provider === p.id} title={p.note} onClick={() => useProvider(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
                <div className="hint">
                  {provider.note}
                  {provider.keyUrl && (
                    <>
                      {" · "}
                      <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="link">
                        获取 Key
                      </a>
                    </>
                  )}
                </div>
              </div>

              <div className="field">
                <label>2 · API Key</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="input"
                    type={showKey ? "text" : "password"}
                    value={settings.apiKey}
                    placeholder={settings.provider === "ollama" ? "本地服务可随便填" : "sk-..."}
                    onChange={(e) => patchSettings({ apiKey: e.target.value })}
                    style={{ paddingRight: 34 }}
                  />
                  <button className="icon-btn" style={{ position: "absolute", right: 2, top: 2 }} onClick={() => setShowKey((v) => !v)} title={showKey ? "隐藏" : "显示"}>
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>

              {(settings.provider === "custom" || !settings.apiBaseUrl) && (
                <div className="field">
                  <label>Base URL</label>
                  <input
                    className="input mono"
                    placeholder="https://api.deepseek.com/v1"
                    value={settings.apiBaseUrl}
                    onChange={(e) => patchSettings({ apiBaseUrl: e.target.value })}
                  />
                  {!settings.apiBaseUrl && provider.baseUrl && (
                    <button className="btn" style={{ height: 24, justifySelf: "start", marginTop: 2 }} onClick={() => patchSettings({ apiBaseUrl: provider.baseUrl })}>
                      填入 {provider.name} 默认地址
                    </button>
                  )}
                </div>
              )}

              <div className="field">
                <label>模型</label>
                <input
                  className="input mono"
                  list="ai-model-options"
                  value={settings.apiModel}
                  spellCheck={false}
                  placeholder="模型 id，可手打"
                  onChange={(e) => patchSettings({ apiModel: e.target.value })}
                />
                <datalist id="ai-model-options">
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {modelLabel(m, meta)}
                    </option>
                  ))}
                </datalist>
                <div className="hint" style={{ color: vision === "no" ? "var(--warn)" : undefined }}>
                  {vision === "yes" ? "✓ 支持图片输入" : vision === "no" ? "✗ 该模型只接受文本" : "? 识图能力待验证"} ·
                  Base URL 已自动填好，可在设置里改
                </div>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => void connect()} disabled={connecting}>
                  {connecting ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                  保存并测试
                </button>
                <button className="btn btn--ghost" onClick={() => openDrawer("settings")}>
                  更多设置
                </button>
              </div>
              {connectMsg && (
                <div className="hint" style={{ color: connectMsg.startsWith("连接成功") ? "var(--ok)" : "var(--err)" }}>
                  {connectMsg}
                </div>
              )}
            </div>
          )}

          <div className="seg" style={{ alignSelf: "start" }}>
            <button data-active={mode === "text"} onClick={() => setMode("text")}>
              <Type size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              文字描述
            </button>
            <button data-active={mode === "image"} onClick={() => setMode("image")}>
              <ImagePlus size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              图片识别
            </button>
          </div>

          {mode === "image" && (
            <div className="field">
              <label>生成方式</label>
              <div className="hint">
                <b>先理解，再画</b>：模型先读出图里的圆 / 椭圆 / 弧 / 线 / 文字，再用 TikZ 精确重画（不是描点）。
                理解结果会单独显示在下面的「图像理解」里，确认无误再替换编辑器。
              </div>
              <details>
                <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
                  高级：文字与保真选项（描摹已停用）
                </summary>
                <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
              <div className="hint">
                描摹（轮廓 / 骨架 / 局部填充）已按方案停用：图片只做语义重建，无法重建时明确报告失败。
              </div>
              {fidelity === "editable" && (
                <>
                  <div className="row row--between" style={{ fontSize: 12 }}>
                    <span>本地描摹器</span>
                    <div className="seg">
                      <button data-active={tracer === "figure"} onClick={() => setTracer("figure")}>
                        理解重画
                      </button>
                      <button data-active={tracer === "trace"} onClick={() => setTracer("trace")}>
                        旧版轮廓描摹
                      </button>
                    </div>
                  </div>
                  <div className="hint">
                    {tracer === "figure"
                      ? "先让模型读懂图：识别圆 / 椭圆 / 线 / 文字等图元，再用 TikZ 精确重画（不是描点）。回查不通过时把意见回灌给「理解」再来一遍。"
                      : "旧路线：按颜色分箱取轮廓再填充，没有「理解」这一步。只在图元方式完全不适用时用。"}
                  </div>
                </>
              )}
              {fidelity === "high" && (
                <>
                  <div className="row row--between" style={{ fontSize: 12 }}>
                    <span>只保留大块填充（细线留给描线层）</span>
                    <span className="switch" data-on={fillsOnly} onClick={() => setFillsOnly((v) => !v)} />
                  </div>
                  <div className="row row--between" style={{ fontSize: 12 }}>
                    <span>用模型补文字（LaTeX 节点）</span>
                    <span className="switch" data-on={withText} onClick={() => setWithText((v) => !v)} />
                  </div>
                  <div className="hint">
                    文字不能从像素里描（字形会糊成色块），要保留可读文字就打开第二项：多一次模型调用。
                  </div>
                </>
              )}
                </div>
              </details>
            </div>
          )}

          {mode === "text" ? (
            <div className="field">
              <label>图形描述</label>
              <textarea
                className="textarea"
                rows={5}
                placeholder="例如：画一个带编号的三层前馈网络，输入层 4 个节点，隐层 3 个，输出层 2 个，用箭头连接并标注层名。"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="row row--wrap" style={{ gap: 6 }}>
                {EXAMPLES.map((p) => (
                  <button key={p} className="btn" style={{ height: 24, fontSize: 11, padding: "0 8px" }} onClick={() => setPrompt(p)}>
                    {p.length > 18 ? p.slice(0, 18) + "…" : p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="field">
              <label>参考图片</label>
              <div
                className="dropzone"
                data-over={over}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void readFile(f);
                }}
              >
                <ImagePlus size={20} />
                <div style={{ fontSize: 12 }}>点击选择 / 拖拽 / 粘贴（Ctrl+V）截图</div>
                <div className="hint">支持 PNG、JPG、WebP</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                }}
              />
              {panels && panels.length >= 2 && fidelity === "editable" && (
                <div className="notice" style={{ padding: "8px 10px", alignItems: "center" }}>
                  <span style={{ flex: 1, fontSize: 11.5 }}>
                    检测到 <b>{panels.length}</b> 个面板。成功的面板会立即保留，整图最多等待 3 分钟。
                  </span>
                  <button className="btn" style={{ height: 26, fontSize: 11.5 }} disabled={running} onClick={() => void runPanels()}>
                    逐块识别（{panels.length} 块）
                  </button>
                  {result?.panelsDone !== undefined && result.panelsDone < panels.length && (
                    <button className="btn" disabled={running} onClick={() => void runPanels(true)}>重试未完成面板</button>
                  )}
                </div>
              )}

              {vision === "no" && (
                <div className="notice notice--warn" style={{ padding: "8px 10px" }}>
                  <AlertTriangle size={13} style={{ marginTop: 2 }} />
                  <span style={{ fontSize: 11.5 }}>
                    服务商声明 <b>{settings.apiModel}</b> 只接受文本输入。换个多模态模型即可识图——
                    例如 <code className="mono">deepseek-flash</code>、<code className="mono">gpt-4o</code>、
                    <code className="mono">qwen-vl-max</code>。仍然可以点下方按钮实测。
                  </span>
                </div>
              )}
              {vision === "unknown" && (
                <div className="hint" style={{ padding: "2px 2px" }}>
                  没有拿到该模型的模态信息，识图能否用会在第一次请求时验证。
                </div>
              )}
              {image && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div
                    className="crop-wrap"
                    onPointerDown={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - r.left;
                      const y = e.clientY - r.top;
                      setDragRect({ x0: x, y0: y, x1: x, y1: y });
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!dragRect) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      setDragRect((d) => (d ? { ...d, x1: e.clientX - r.left, y1: e.clientY - r.top } : d));
                    }}
                    onPointerUp={() => {
                      if (dragRect) void cropToRect(dragRect);
                      setDragRect(null);
                    }}
                  >
                    <img className="thumb" src={image} alt={imageName} ref={thumbRef} draggable={false} />
                    {dragRect && (
                      <div
                        className="crop-rect"
                        style={{
                          left: Math.min(dragRect.x0, dragRect.x1),
                          top: Math.min(dragRect.y0, dragRect.y1),
                          width: Math.abs(dragRect.x1 - dragRect.x0),
                          height: Math.abs(dragRect.y1 - dragRect.y0),
                        }}
                      />
                    )}
                  </div>
                  <div className="row row--between">
                    <span className="hint">
                      {cropHint || "论文里多栏图建议只截取一个子图，识别会准很多"}
                    </span>
                    {cropped && (
                      <button
                        className="btn"
                        style={{ height: 26, fontSize: 11.5 }}
                        onClick={() => {
                          setImage(originalImage);
                          setCropped(false);
                          setCropHint("");
                        }}
                      >
                        还原全图
                      </button>
                    )}
                  </div>
                  <div className="row row--between">
                    <span className="hint mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {imageName}
                      {imageSize ? ` · ${imageSize.w}×${imageSize.h}${imageSize.scaled ? "（已缩放）" : ""}` : ""}
                    </span>
                    <button className="btn btn--ghost btn--danger" onClick={() => { setImage(null); setImageName(""); setImageSize(null); setEditable(null); }}>
                      移除
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ gap: 8 }}>
            <div className="row row--between" style={{ fontSize: 12 }}>
              <span>画布兼容模式</span>
              <span className="switch" data-on={canvasMode} onClick={() => setCanvasMode((v) => !v)} />
            </div>
            <div className="hint">
              开启后只允许「线 / 矩形 / 圆 / 曲线 / 文本 / 坐标轴 / 函数」，生成结果可以直接在画布上拖改；
              关闭则放开全部 TikZ 能力（更自由，但画布只能预览）。
            </div>
            <div className="row row--between" style={{ fontSize: 12 }}>
              <span>生成器 + 审核器双智能体</span>
              <span className="switch" data-on={reviewer} onClick={() => setReviewer((v) => !v)} />
            </div>
            <div className="hint">
              开启后每一版都会再过一道审核器：它只判断、不改代码，输出 JSON 结论（问题 + 改法），
              生成器据此重写。关闭则只用编译报错驱动修复。
            </div>
            <div className="row row--between" style={{ fontSize: 12 }}>
              <span>修正次数（0 = 仅校验，编译错误不占）</span>
              <input
                className="input mono"
                type="number"
                min={0}
                max={5}
                step={1}
                value={repairs}
                title="审核不通过后最多再改几次；编译错误会自动重写且不计入次数，全程上限 5 分钟"
                style={{ width: 62, height: 26, textAlign: "center" }}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setRepairs(Number.isFinite(next) ? Math.max(0, Math.min(5, Math.round(next))) : 1);
                }}
              />
            </div>
          </div>

          <button
            className="btn btn--primary"
            onClick={() => void (mode === "image" && fidelity === "high" ? runHighFidelity() : run())}
            disabled={running}
            style={{ height: 34, justifyContent: "center" }}
          >
            {running ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {running
              ? `${mode === "image" && fidelity === "high" ? "矢量化" : panels?.length ? `逐块识别 ${panels.length} 块` : mode === "image" ? "理解并生成" : "生成中"}… ${Math.floor(elapsed / 1000)}s`
              : mode === "image" && fidelity === "high"
                ? "高保真还原"
                : mode === "image"
                  ? "理解并生成 TikZ"
                  : "生成并校验"}
          </button>

          {running && <button className="btn" onClick={() => abortRef.current?.abort()}>停止并保留已完成部分</button>}

          <button
            className="btn"
            onClick={() => void run({ edit: true })}
            disabled={running}
            title="把编辑器里的 TikZ 交给模型，只改你描述的部分，不重画"
            style={{ height: 34, justifyContent: "center" }}
          >
            {running ? <Loader2 size={14} className="spin" /> : <PencilLine size={14} />}
            修改当前 TikZ
          </button>
          <div className="hint">
            编辑模式：以编辑器现有文档为底稿做局部修改（保留坐标、样式、结构），而不是重新生成一张图。
          </div>

          {steps.length > 0 && (
            <div className="ai-steps">
              {steps.map((s) => (
                <div key={s.id} className="ai-step" data-status={s.status}>
                  <span className="ai-step-icon">
                    {s.status === "running" ? <Loader2 size={12} className="spin" /> : s.status === "ok" ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <span className="ai-step-label">{s.label}</span>
                  {s.detail && <span className="ai-step-detail">{s.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {understanding && (
            <div className="card" style={{ gap: 6 }}>
              <div className="row row--between">
                <span className="section-label" style={{ margin: 0 }}>图像理解</span>
                <span className="hint">{understanding.elements} 个图元</span>
              </div>
              <div className="hint">
                {understanding.type}
                {understanding.summary ? " · " + understanding.summary : ""}
              </div>
              <div className="row row--wrap" style={{ gap: 4 }}>
                {Object.entries(understanding.kinds).map(([kind, count]) => (
                  <span key={kind} className="pill pill--muted">
                    {UNDERSTAND_LABEL[kind] ?? kind} {count}
                  </span>
                ))}
              </div>
              {understanding.items.length > 0 && (
                <div className="hint mono" style={{ fontSize: 11 }}>
                  {understanding.items.join(" · ")}
                </div>
              )}
            </div>
          )}

          {failure && (
            <div className="notice notice--warn" style={{ borderColor: "rgba(255,111,111,.4)" }}>
              <AlertTriangle size={14} color="var(--err)" style={{ marginTop: 2 }} />
              <div style={{ flex: 1, display: "grid", gap: 8 }}>
                <span>{failure}</span>
                {suggested.length > 0 && (
                  <div className="row row--wrap" style={{ gap: 6 }}>
                    <span className="hint" style={{ alignSelf: "center" }}>换成：</span>
                    {suggested.map((m) => (
                      <button
                        key={m}
                        className="btn"
                        style={{ height: 26, fontSize: 11.5 }}
                        onClick={() => {
                          patchSettings({ apiModel: m });
                          void run({ model: m });
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className="card">
              <div className="row row--between">
                <span className="pill" data-ok={result.ok}>
                  {result.ok ? <Check size={11} /> : <AlertTriangle size={11} />}
                  {result.ok
                    ? visualReview?.pass ? "视觉校验通过" : "编译通过"
                    : result.reason === "GEOMETRY_REJECTED"
                      ? "几何核对未通过"
                    : result.reason === "SCENE_REJECTED"
                      ? "图形结构校验未通过"
                    : result.reason === "REVIEW_UNAVAILABLE"
                      ? "未取得有效视觉评审"
                    : result.reason === "APPROXIMATION_REQUIRED"
                      ? "已生成近似结果，需核对细节"
                    : result.reason === "REVIEW_REJECTED"
                      ? "视觉评审未通过"
                    : result.panelsDone !== undefined
                      ? `已完成 ${result.panelsDone}/${result.panelsTotal} 个面板`
                    : result.truncated
                      ? "输出超长，未完成"
                      : result.phased === "budget"
                        ? "达到时间上限，已停止"
                        : result.reason === "COMPILE_FAILED"
                          ? "仍有编译错误"
                          : "生成未完成"}
                </span>
                <span className="hint mono">
                  {result.size ? `${(result.size.chars / 1000).toFixed(1)}K 字符 · ${result.size.lines} 行 · ` : ""}
                  {result.rounds ? `${result.rounds} 轮 · ` : ""}
                  {result.panelsTotal === undefined && result.attempts > 0 ? `${result.attempts} 次审核 · ` : ""}{(result.durationMs / 1000).toFixed(1)}s
                  {budget ? ` / ${Math.round(budget.limitMs / 1000)}s` : ""}
                  {result.model ? ` · ${result.model}` : ""}
                </span>
              </div>

              {visualReview && <div className={visualReview.pass ? "hint" : "notice notice--warn"} style={{ display: "grid", gap: 4 }}>
                <span>原图对照：{visualReview.score} 分 · {visualReview.pass ? "通过" : "需要修正"}</span>
                {visualReview.issues.map((issue, i) => <span key={i}>{issue.message}</span>)}
              </div>}

              {editable && (
                <div className="hint">
                  可编辑元素 {editable.total} 个{editable.kinds ? `（${editable.kinds}）` : ""}
                  {editable.total === 0
                    ? " · 画布无法解析，只能看预览"
                    : result?.representation === "figure"
                      ? " · 圆/线/文字可拖改；弧与椭圆暂不支持画布编辑（预览与导出正常）"
                      : editable.total < 3
                        ? " · 元素偏少：先按单栏/单个子图裁切，或换一个更强的视觉模型"
                        : ""}
                </div>
              )}

              {logId && (
                <div className="hint mono" style={{ fontSize: 11 }}>
                  本次输出已记录：logs/ai/{logId}.tex（可对照面板内容排查）
                </div>
              )}

              {vector && (
                <div className="hint">
                  高保真层：{vector.rings} 个填充区域 · {vector.colors} 色 · {Math.round(vector.bytes / 1024)}KB
                  {vector.labels ? ` · ${vector.labels} 处文字` : ""} · 不可在画布上编辑（预览 / 导出正常）
                </div>
              )}

              {result.geometry && (
                <div className="hint">
                  墨迹比对（参考）：{Math.round((result.geometry.recall ?? 0) * 100)}% 覆盖 ·{" "}
                  {Math.round((result.geometry.precision ?? 0) * 100)}% 准确
                  {result.geometry.problems.length ? ` · ${result.geometry.problems.length} 个问题` : " · 通过"}
                </div>
              )}

              {result.versions && result.versions.length > 1 && (() => {
                const rounds = result.versions!;
                const scores = rounds.map((v) => (typeof v.score === "number" ? v.score : -1));
                const bestScore = Math.max(...scores);
                const best = rounds[scores.indexOf(bestScore)];
                return (
                  <div className="hint">
                    各轮评审分：
                    {rounds.map((v, i) => (
                      <span key={v.round}>
                        {i > 0 ? " → " : " "}
                        <span style={{ color: i === scores.indexOf(bestScore) ? "var(--ok)" : undefined }}>
                          {typeof v.score === "number" ? v.score : "—"}
                        </span>
                      </span>
                    ))}
                    {" "}
                    · 交付第 {best?.round ?? 1} 轮（评审分最高；覆盖 {Math.round((best?.recall ?? 0) * 100)}% 仅供参考）
                  </div>
                );
              })()}

              {result.trace &&
                (result.representation === "figure" ? (
                  <div className="hint">
                    图元重画：{result.trace.elements ?? 0} 个图元
                    {result.trace.kinds
                      ? "（" + Object.entries(result.trace.kinds).map(([k, n]) => (UNDERSTAND_LABEL[k] ?? k) + " " + n).join(" · ") + "）"
                      : ""}
                    {" · "}
                    {Math.round((result.trace.bytes ?? 0) / 1024)}KB
                    {result.trace.reconstruction === 'outline' ? ' · 按原图轮廓保留细节，文字以轮廓编辑' : result.trace.labelsAsOutlines ? ' · 曲线由像素拟合，文字和刻度保留为矢量轮廓' : ' · 可编辑图元重建'}
                  </div>
                ) : result.representation === "lines" || result.representation === "curves" ? (
                  <div className="hint">
                    {result.representation === "curves" ? "单值跟踪" : "骨架描线"}：{result.trace.curves ?? 0} 条曲线 ·{" "}
                    {result.trace.nodes ?? 0} 处文字 · {Math.round((result.trace.bytes ?? 0) / 1024)}KB
                  </div>
                ) : (
                  <div className="hint">
                    像素描摹：{result.trace.elements} 个轮廓 · {result.trace.points} 个点 · {result.trace.palette} 色
                    {result.trace.labels ? ` · ${result.trace.labels} 处文字` : ""}
                  </div>
                ))}

              {result.visual && (
                <div className="hint" style={{ color: result.visual.pass ? undefined : "var(--warn)" }}>
                  渲染回查：{result.visual.score} 分{result.visual.pass ? " · 通过" : " · 未通过"}
                  {result.visual.issues?.length ? `（${result.visual.issues[0].message}）` : ""}
                </div>
              )}

              {result.truncated && !result.ok && (
                <div className="hint">
                  模型输出超出长度上限（已自动要求简化 2 次仍未成功）。
                  {result.size
                    ? ` 最后一份 ${result.size.chars} 字符 / ${result.size.lines} 行` +
                      (result.size.coords > 0
                        ? `，其中 ${result.size.coords} 个坐标点（模型把函数画成了逐点列表，${
                            result.size.coords * 14
                          } 字符）。`
                        : "。")
                    : ""}
                  提示词已禁止"粘贴坐标点"，若仍超限请把需求拆成几张图。
                </div>
              )}

              {result.lintAccepted?.length ? (
                <div className="hint">
                  ⚠ 画布无法完整编辑：{result.lintAccepted.slice(0, 3).join("；")}
                  {result.lintAccepted.length > 3 ? " …" : ""}（预览与导出正常）
                </div>
              ) : null}

              {result.reviewAccepted === "non-blockers" && (
                <div className="hint">
                  时间优先：审核还剩 {review?.issues?.length ?? 0} 条非阻塞意见，已直接交付（没有阻塞问题）。
                </div>
              )}

              {diff && (
                <div className="hint">
                  改动 {diff.changed} / {diff.total} 行（保留 {diff.kept} 行，
                  {Math.round(diff.ratio * 100)}% 被重写）
                  {diff.ratio > 0.6 ? " · 改动偏大，可能被重画了" : ""}
                </div>
              )}

              {review && (
                <div className="review-block">
                  <div className="row row--between">
                    <span className="pill" data-ok={review.verdict === "pass"}>
                      {review.verdict === "pass" ? "审核通过" : "审核未通过"} · {review.score}
                    </span>
                    <span className="hint">{review.issues?.length ?? 0} 条意见</span>
                  </div>
                  {!!review.instructions && <div className="hint">{review.instructions}</div>}
                  {(review.issues?.length ?? 0) > 0 && (
                    <div className="ai-errors">
                      {review.issues!.slice(0, 8).map((i, k) => (
                        <div key={k} className="ai-error">
                          <span className="mono">{i.where ?? i.code}</span>
                          <span>
                            {i.message}
                            {i.fix ? " → " + i.fix : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {lint && lint.issues.length > 0 && (
                <details className="lint-block">
                  <summary>
                    静态检查：{lint.issues.filter((i) => i.severity === "blocker").length} 个 blocker ·{" "}
                    {lint.issues.length} 条
                  </summary>
                  <div className="ai-errors">
                    {lint.issues.slice(0, 8).map((i, k) => (
                      <div key={k} className="ai-error">
                        <span className="mono">{i.where ?? i.code}</span>
                        <span>{i.message}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {!result.ok && result.errors && result.errors.length > 0 && (
                <div className="ai-errors">
                  {result.errors.slice(0, 6).map((e, i) => (
                    <div key={i} className="ai-error">
                      <span className="mono">{e.line ?? "—"}</span>
                      <span>{e.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {code && (
                <>
                  <div className="row row--between">
                    <span className="section-label" style={{ margin: 0 }}>生成结果 · {code.split("\n").length} 行</span>
                    <div className="row" style={{ gap: 2 }}>
                      <button className="icon-btn" title={showCode ? "收起代码" : "展开代码"} onClick={() => setShowCode((v) => !v)}>
                        <SquarePen size={13} />
                      </button>
                      <button className="icon-btn" title="复制" onClick={() => { navigator.clipboard.writeText(code); toast("ok", "已复制"); }}>
                        <ClipboardCopy size={13} />
                      </button>
                    </div>
                  </div>
                  {showCode && <pre className="code-box" style={{ maxHeight: 240 }}>{code.slice(0, 6000)}</pre>}
                  <div className="ai-actions">
                    <button className="btn btn--primary" onClick={() => apply("replace")} style={{ flex: 1, justifyContent: "center", height: 34 }}>
                      <ArrowDownToLine size={13} /> 替换编辑器
                    </button>
                    <button className="btn" style={{ height: 34 }} onClick={() => apply("insert")}>
                      追加
                    </button>
                  </div>
                  <div className="hint">
                    替换后会自动编译；若结果落在画布支持的子集内，右侧画布也会同步成可编辑元素。
                  </div>
                </>
              )}
            </div>
          )}

          {diagnostics && !result && (
            <div className="hint">
              第 {diagnostics.attempt} 次编译失败：{diagnostics.errors[0]?.message}
            </div>
          )}

          <div className="hint" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            后端接口：<code className="mono">POST /api/ai/text2tikz</code>（SSE 流式，事件：step / code / diagnostics / done）。
            兼容 OpenAI Chat Completions，识图用 <code className="mono">image_url</code>。
          </div>
        </div>
      </aside>
    </>
  );
}
