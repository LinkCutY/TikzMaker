export type Engine = "xelatex" | "pdflatex" | "lualatex";

export interface Diag {
  line: number | null;
  message: string;
  file?: string | null;
  kind?: "error" | "warning";
}

export interface CompileOk {
  ok: true;
  svg: string;
  width: number;
  height: number;
  pages: number;
  errors: Diag[];
  warnings: Diag[];
  log: string;
  durationMs: number;
  cached: boolean;
  engine: Engine;
  wrapped?: boolean;
}

export interface CompileFail {
  ok: false;
  errors: Diag[];
  warnings: Diag[];
  log: string;
  durationMs: number;
  cached?: boolean;
  engine?: Engine;
}

export type CompileResponse = CompileOk | CompileFail;

/** What the model saw in the picture, before it drew anything. */
export interface Understanding {
  type: string;
  summary: string;
  items: string[];
  kinds: Record<string, number>;
  elements: number;
}

export interface AiStreamEvent {
  refinement?: {target:number;completed:number;qualified:boolean;complete:boolean};
  stopReason?: string;
  type: "step" | "code" | "diagnostics" | "lint" | "review" | "diff" | "budget" | "log" | "understanding" | "done" | "error" | "end";
  id?: string;
  label?: string;
  status?: "running" | "ok" | "fail";
  detail?: string;
  attempt?: number;
  code?: string;
  ok?: boolean;
  errors?: Diag[];
  log?: string;
  attempts?: number;
  model?: string;
  durationMs?: number;
  message?: string;
  /** Generation log id (type: "log"). */
  logId?: string;
  /** Valid model ids reported by the gateway when it rejects ours. */
  supported?: string[];
  /** Static-analysis findings (see server/lint.mjs). */
  issues?: { code: string; severity: string; where?: string | null; message: string; fix?: string }[];
  /** Reviewer verdict (type: "review"). */
  verdict?: "pass" | "revise";
  score?: number;
  instructions?: string;
  stats?: Record<string, unknown>;
  /** Why the run stopped without a result. */
  reason?: "TIMEOUT" | "TIME_BUDGET" | "REVIEW_REJECTED" | "REVIEW_UNAVAILABLE" | "COMPILE_FAILED" | "GEOMETRY_REJECTED" | "SCENE_REJECTED" | "APPROXIMATION_REQUIRED" | "STUCK" | "COMPOSITION_FAILED" | "FIGURE_VALIDATION_FAILED" | "CANCELLED";
  checks?: {ok:boolean;composition?:{requirements:{id:string;text:string;objects:string[]}[]}};
  stuck?: boolean;
  /** The last reply hit the output limit (figure was cut off). */
  truncated?: boolean;
  /** Size breakdown of the last document. */
  size?: { chars: number; lines: number; coords: number; draws: number; nodes: number; biggest: string };
  /** Trace pipeline: render-vs-original check. */
  visual?: { score: number; pass: boolean; issues?: { severity: string; message: string }[] } | null;
  trace?: { elements: number; points: number; palette: number; labels: number } | null;
  representation?: string;
  /** Figure route: the parsed structure, shown in the UI before drawing. */
  understanding?: Understanding;
  /** Figure route: deterministic ink coverage of the compiled result. */
  geometry?: { recall: number | null; precision: number | null; problems: string[] } | null;
  /** Figure route: every round that was generated (the best one is delivered). */
  versions?: { round: number; recall: number | null; precision: number | null; problems: number; chars: number; compiled: boolean; score?: number | null }[];
  /** Delivered even though the reviewer wanted changes (only non-blockers left). */
  reviewAccepted?: "non-blockers";
  /** Delivered with lint blockers left (the canvas cannot edit every element). */
  lintAccepted?: string[];
  timedOut?: boolean;
  rounds?: number;
  /** Time budget announced at the start (type: "budget"). */
  limitMs?: number;
  /** Edit mode only: how much of the original document survived (type: "diff"). */
  total?: number;
  kept?: number;
  changed?: number;
  ratio?: number;
  [key: string]: unknown;
}

/** Filled-region vectorisation result (VTracer, no model involved). */
export interface VectorizeStats {
  widthPx: number;
  heightPx: number;
  widthCm: number;
  heightCm: number;
  /** <path> elements found in the traced SVG. */
  paths: number;
  /** Closed rings actually emitted (after the white/thin/area filters). */
  rings: number;
  colors: number;
  segments: number;
  dropped: number;
  arcs: number;
  labels: number;
  bytes: number;
}

export interface VectorizeResponse {
  ok: boolean;
  tikz: string;
  stats: VectorizeStats;
  durationMs: number;
}

/** A text box from the vision model — boxes are normalised 0..1000. */
export interface LabelBox {
  box: number[];
  tex: string;
  confidence?: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  engines: { name: Engine; label: string; hint: string; available: boolean; version: string }[];
  renderer: string | null;
  rendererInfo?: string;
  python?: string;
  /** VTracer WASM is installed and loadable. */
  vectorizer?: boolean;
  /** When the API process started (ms) and when server/*.mjs was last modified. */
  startedAt?: number;
  sourceUpdatedAt?: number | null;
}

const JSON_HEADERS = { "content-type": "application/json" };

export interface VisualReview { ok: boolean; compiled: boolean; pass: boolean; score: number; issues: { severity: string; message: string }[]; instructions?: string; }

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body?.error?.message || body?.message || `请求失败（HTTP ${res.status}）`;
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = body?.error?.code;
    err.status = res.status;
    throw err;
  }
  return (body ?? ({} as T)) as T;
}

export const api = {
  aiCompare(payload: { source: string; image: string; baseUrl: string; model: string; engine?: string }, apiKey: string, signal?: AbortSignal) {
    return request<VisualReview>("/api/ai/compare", { method: "POST", headers: { ...JSON_HEADERS, "x-ai-key": apiKey }, body: JSON.stringify(payload), signal });
  },
  health(signal?: AbortSignal) {
    return request<HealthResponse>("/api/health", { signal });
  },
  /** Cheap freshness probe: { startedAt, sourceUpdatedAt }. 404 on old servers. */
  version(signal?: AbortSignal) {
    return request<{ ok: boolean; startedAt?: number; sourceUpdatedAt?: number | null }>("/api/version", { signal });
  },
  compile(payload: { source: string; engine: Engine; dpi?: number }, signal?: AbortSignal) {
    return request<CompileResponse>("/api/compile", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal,
    });
  },
  async exportFile(payload: {
    source: string;
    format: "tex" | "pdf" | "svg" | "png";
    engine: Engine;
    dpi?: number;
    filename?: string;
  }): Promise<Blob> {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let message = `导出失败（HTTP ${res.status}）`;
      try {
        const body = await res.json();
        message = body?.error?.message || message;
      } catch {}
      throw new Error(message);
    }
    return res.blob();
  },
  aiGenerate(
    payload: {
      mode: "text" | "image" | "edit";
      prompt?: string;
      current?: string;
      image?: string;
      baseUrl?: string;
      model?: string;
      temperature?: number;
    },
    apiKey: string
  ) {
    return request<{ ok: boolean; tikz: string; raw: string; model: string; usage?: any }>("/api/ai/generate", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-ai-key": apiKey },
      body: JSON.stringify(payload),
    });
  },
  /**
   * Streaming generate -> compile -> repair loop (SSE). Events arrive as the
   * server works, so the UI can show progress instead of a frozen spinner.
   */
  async aiText2Tikz(
    payload: {
      mode: "text" | "image" | "edit";
      prompt?: string;
      /** Current document, required for edit mode. */
      current?: string;
      /** This image is one cropped panel (tighter output budget). */
      perPanel?: boolean;
      /** Hard time cap for this call in ms (default 5 minutes). */
      budgetMs?: number;
      /** Ask for the strictest primitive-only rendering (retry after a parse failure). */
      strict?: boolean;
      /** 1-based panel number, recorded in the generation log. */
      panelIndex?: number;
      image?: string;
      baseUrl?: string;
      model?: string;
      temperature?: number;
      canvasMode?: boolean;
      maxAttempts?: number;
      refinementPasses?: number;
      engine?: string;
      reviewer?: boolean;
      /**
       * Image routes: "figure" = understand the picture, then redraw it with
       * primitives; "trace" = contour fill (no understanding step).
       */
      representation?: "figure" | "trace" | "legacy";
    },
    apiKey: string,
    onEvent: (event: AiStreamEvent) => void,
    signal?: AbortSignal
  ) {
    const res = await fetch("/api/ai/text2tikz", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-ai-key": apiKey, accept: "text/event-stream" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message || `生成请求失败（HTTP ${res.status}）`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("当前浏览器不支持流式响应");
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let event: AiStreamEvent;
        try {
          event = JSON.parse(line.slice(5).trim()) as AiStreamEvent;
        } catch {
          continue; // malformed frame — skip it, but never swallow handler errors
        }
        // Deliberately outside the try: an error thrown by the caller's handler
        // (e.g. an upstream failure) must abort the stream and reach them.
        onEvent(event);
      }
    }
  },
  /**
   * Deterministic fills: image -> TikZ with closed \fill regions. No API key,
   * no model. Optional labels (from aiLabels) are re-typeset as \node.
   */
  vectorize(
    payload: {
      image: string;
      widthCm?: number;
      mode?: "spline" | "polygon" | "pixel";
      simplify?: number;
      precision?: number;
      minAreaPx?: number;
      minThicknessPx?: number;
      maxColors?: number;
      dropWhite?: boolean;
      labels?: { box: number[]; tex: string }[];
      fontPt?: number;
    },
    signal?: AbortSignal
  ) {
    return request<VectorizeResponse>("/api/vectorize", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal,
    });
  },
  /** Text-only vision pass (needs the user's key) — boxes + strings for \node. */
  aiLabels(payload: { image: string; baseUrl?: string; model?: string }, apiKey: string, signal?: AbortSignal) {
    return request<{ ok: boolean; labels: LabelBox[]; model?: string }>("/api/ai/labels", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-ai-key": apiKey },
      body: JSON.stringify(payload),
      signal,
    });
  },
  aiLogs(limit = 20) {
    return request<{ ok: boolean; dir: string; rows: any[] }>(`/api/logs?limit=${limit}`, { method: "GET" });
  },
  aiLog(id: string) {
    return request<{ ok: boolean; code: string }>(`/api/logs/${encodeURIComponent(id)}`, { method: "GET" });
  },
  aiCheck(payload: { baseUrl?: string }, apiKey: string) {
    return request<{ ok: boolean; models: string[]; meta: { id: string; name?: string; inputModalities?: string[] }[] }>("/api/ai/check", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-ai-key": apiKey },
      body: JSON.stringify(payload),
    });
  },
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
