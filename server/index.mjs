import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync, readdirSync, statSync } from "node:fs";
import { compileToPdf, detectEngines, run, ENGINES, cacheGet, cacheSet, wrapSource, mapErrorsToSource } from "./latex.mjs";
import { runGeneration, describeUpstream, requireBaseUrl, compareVision, recognizeLabels } from "./ai.mjs";
import { renderPreview } from "./render.mjs";
import { listLogs, readLog, logDir } from "./ailog.mjs";
import { lintTikz } from "./lint.mjs";
import { vectorizePng, vectorizerAvailable } from "./vectorize.mjs";
import { requireRepresentation, PolicyError } from "./policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8788);
const IS_PROD = process.env.NODE_ENV === "production";
const PYTHON = process.env.TIKZ_PYTHON || "python";
const RENDER_PY = path.join(__dirname, "python", "render.py");
const MAX_SOURCE = 2_000_000;
// When the process is older than server/*.mjs, the running code is stale —
// exactly the trap that makes a new route silently fall back to the old one.
const STARTED_AT = Date.now();

const app = express();
app.use(express.json({ limit: "24mb" }));

/* ---------------------------------------------------------------- helpers */

let queue = Promise.resolve();
let active = 0;
const MAX_ACTIVE = 2;

function withSlot(fn) {
  const tick = queue.then(async () => {
    while (active >= MAX_ACTIVE) await new Promise((r) => setTimeout(r, 40));
    active++;
    try {
      return await fn();
    } finally {
      active--;
    }
  });
  queue = tick.catch(() => {});
  return tick;
}

async function renderPdf(pdfPath, dir, { dpi = 192, wantPng = false } = {}) {
  return renderPreview(pdfPath, dir, { dpi, wantPng });
}

async function legacyRenderPdf(pdfPath, dir, { dpi = 192, wantPng = false } = {}) {
  const svgPath = path.join(dir, "preview.svg");
  const pngPath = wantPng ? path.join(dir, "preview.png") : null;
  const args = [RENDER_PY, "--pdf", pdfPath, "--svg", svgPath, "--dpi", String(dpi)];
  if (pngPath) args.push("--png", pngPath);
  const r = await run(PYTHON, args, { timeoutMs: 60_000 });
  if (r.code !== 0) {
    throw Object.assign(new Error("PDF 渲染失败：" + (r.stderr || r.stdout).slice(0, 400)), { code: "RENDER_FAILED" });
  }
  let meta = {};
  try {
    meta = JSON.parse(r.stdout.trim().split("\n").pop());
  } catch {}
  const svg = await readFile(svgPath, "utf8");
  return {
    svg,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    pages: meta.pages ?? 1,
    pngPath,
    pngAvailable: Boolean(pngPath && existsSync(pngPath)),
  };
}

function badRequest(res, message, code = "BAD_REQUEST") {
  return res.status(400).json({ ok: false, error: { code, message } });
}

function validateSource(src) {
  if (typeof src !== "string" || !src.trim()) return "源码为空";
  if (src.length > MAX_SOURCE) return "源码过长（上限 2 MB）";
  return null;
}

function normaliseEngine(engine) {
  return ENGINES.some((e) => e.name === engine) ? engine : "xelatex";
}

/* ------------------------------------------------------------------ health */

app.get("/api/health", async (_req, res) => {
  const engines = await detectEngines();
  const py = await run(PYTHON, ["-c", "import pymupdf; print(pymupdf.__doc__.splitlines()[0])"], { timeoutMs: 20_000 });
  const poppler = py.code === 0 ? null : await run("pdftocairo", ["-v"], { timeoutMs: 5000 });
  res.json({
    ok: true,
    version: "0.1.0",
    engines,
    renderer: py.code === 0 ? "pymupdf" : poppler?.code === 0 ? "poppler" : null,
    rendererInfo: py.code === 0 ? py.stdout.trim() : (py.stderr || "").slice(0, 200),
    python: PYTHON,
    vectorizer: await vectorizerAvailable(),
    startedAt: STARTED_AT,
    sourceUpdatedAt: newestServerSource(),
  });
});

/** Cheap process-freshness probe (no TeX/Python detection). */
app.get("/api/version", (_req, res) => {
  res.json({ ok: true, version: "0.1.0", startedAt: STARTED_AT, sourceUpdatedAt: newestServerSource() });
});

/* ----------------------------------------------------------------- compile */

app.post("/api/compile", async (req, res) => {
  const { source, engine, dpi } = req.body || {};
  const invalid = validateSource(source);
  if (invalid) return badRequest(res, invalid);
  const eng = normaliseEngine(engine);
  const key = eng + ":" + hashSource(source);
  const cached = cacheGet(key);
  if (cached) {
    return res.json({ ...cached.meta, cached: true, durationMs: 0, log: "", errors: [], warnings: [] });
  }

  const { tex, offset, wrapped } = wrapSource(source);

  try {
    const result = await withSlot(async () => {
      const job = await compileToPdf(tex, { engine: eng, timeoutMs: 60_000 });
      try {
        if (!job.ok) {
          const log = await readFile(path.join(job.dir, "main.log"), "utf8").catch(() => job.log);
          return {
            ok: false,
            wrapped,
            errors: mapErrorsToSource(
              job.errors.length ? job.errors : [{ line: null, message: job.timedOut ? "编译超时" : "编译失败", file: null }],
              offset
            ),
            warnings: job.warnings,
            log: tail(log, 24_000),
            durationMs: job.durationMs,
            engine: eng,
          };
        }
        const rendered = await renderPdf(job.pdfPath, job.dir, { dpi: Number(dpi) || 192 });
        const pdfBuffer = await readFile(job.pdfPath);
        return {
          ok: true,
          wrapped,
          svg: rendered.svg,
          width: rendered.width,
          height: rendered.height,
          pages: rendered.pages,
          errors: [],
          warnings: job.warnings,
          log: tail(await readFile(path.join(job.dir, "main.log"), "utf8").catch(() => job.log), 24_000),
          durationMs: job.durationMs,
          engine: eng,
          pdfBuffer,
        };
      } finally {
        await job.cleanup();
      }
    });

    if (!result.ok) {
      return res.json({ ...result, cached: false });
    }
    const { pdfBuffer, ...payload } = result;
    cacheSet(key, {
      meta: { ok: true, svg: payload.svg, width: payload.width, height: payload.height, pages: payload.pages, engine: eng },
      pdf: pdfBuffer,
    });
    return res.json({ ...payload, cached: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: { code: err.code || "INTERNAL", message: err.message } });
  }
});

/* ------------------------------------------------------------------ export */

app.post("/api/export", async (req, res) => {
  const { source, format = "tex", engine, dpi, filename } = req.body || {};
  const invalid = validateSource(source);
  if (invalid) return badRequest(res, invalid);
  const eng = normaliseEngine(engine);
  const base = (filename || "figure").replace(/[^\w\-\u4e00-\u9fa5.]+/g, "_").replace(/\.(tex|pdf|svg|png)$/i, "") || "figure";
  const key = eng + ":" + hashSource(source);

  try {
    if (format === "tex") {
      res.setHeader("content-type", "application/x-tex; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${encodeURIComponent(base)}.tex"`);
      // Magic comments so editors pick the right engine/encoding on open:
      // LaTeX Workshop's default recipe is pdflatex, which fails on ctex docs.
      const tex = wrapSource(source).tex;
      const hint = tex.startsWith("% !TEX") ? "" : "% !TEX program = xelatex\n% !TEX encoding = UTF-8\n";
      return res.send(hint + tex);
    }

    const cached = cacheGet(key);
    let pdf = cached?.pdf ?? null;
    let svg = cached?.meta?.svg ?? null;

    if (!pdf) {
      const out = await withSlot(async () => {
        const job = await compileToPdf(wrapSource(source).tex, { engine: eng, timeoutMs: 60_000 });
        try {
          if (!job.ok) {
            const log = await readFile(path.join(job.dir, "main.log"), "utf8").catch(() => job.log);
            return { ok: false, errors: job.errors, log: tail(log, 20_000) };
          }
          const rendered = await renderPdf(job.pdfPath, job.dir, { dpi: Number(dpi) || 192 });
          const buf = await readFile(job.pdfPath);
          return { ok: true, pdf: buf, svg: rendered.svg, width: rendered.width, height: rendered.height };
        } finally {
          await job.cleanup();
        }
      });
      if (!out.ok) {
        return res.status(422).json({ ok: false, error: { code: "COMPILE_FAILED", message: "编译失败，无法导出" }, errors: out.errors, log: out.log });
      }
      pdf = out.pdf;
      svg = out.svg;
      cacheSet(key, { meta: { ok: true, svg: out.svg, width: out.width, height: out.height, pages: 1, engine: eng }, pdf });
    }

    if (format === "pdf") {
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `attachment; filename="${encodeURIComponent(base)}.pdf"`);
      return res.send(pdf);
    }

    if (format === "svg") {
      res.setHeader("content-type", "image/svg+xml; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${encodeURIComponent(base)}.svg"`);
      return res.send(svg);
    }

    if (format === "png") {
      const dir = await mkdtemp(path.join(tmpdir(), "tikz-export-"));
      try {
        const pdfPath = path.join(dir, "main.pdf");
        await writeFile(pdfPath, pdf);
        const rendered = await renderPdf(pdfPath, dir, { dpi: Number(dpi) || 300, wantPng: true });
        if (!rendered.pngAvailable) throw Object.assign(new Error("PNG 生成失败"), { code: "PNG_FAILED" });
        const png = await readFile(rendered.pngPath);
        res.setHeader("content-type", "image/png");
        res.setHeader("content-disposition", `attachment; filename="${encodeURIComponent(base)}.png"`);
        return res.send(png);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }

    return badRequest(res, "不支持的导出格式：" + format);
  } catch (err) {
    return res.status(500).json({ ok: false, error: { code: err.code || "INTERNAL", message: err.message } });
  }
});

/* ----------------------------------------------------------------- AI/API */

function aiPayload(req) {
  const { mode = "text", prompt = "", current = "", perPanel = false, strict = false, panelIndex = 0, budgetMs, image, baseUrl, model, temperature, canvasMode = true, maxAttempts = 2, engine = "xelatex", reviewer = true, representation } = req.body || {};
  return {
    mode,
    prompt,
    current: typeof current === "string" ? current : "",
    perPanel: Boolean(perPanel),
    strict: Boolean(strict),
    panelIndex: Number(panelIndex) || 0,
    budgetMs: Number(budgetMs) > 0 ? Number(budgetMs) : 0,
    image,
    baseUrl,
    model,
    temperature,
    canvasMode: Boolean(canvasMode),
    // Tracing ("trace" / "legacy" / "lines") is disabled for pictures: a request for
    // it throws a PolicyError instead of silently falling back to a traced result.
    imageRepresentation: requireRepresentation(representation),
    reviewer: reviewer !== false,
    maxAttempts: Math.max(1, Math.min(6, Number(maxAttempts) || 1)),
    engine,
    apiKey: (req.get("x-ai-key") || "").trim() || String(req.body?.apiKey || "").trim(),
  };
}

function readAiPayload(req, res) {
  try {
    return aiPayload(req);
  } catch (err) {
    if (err instanceof PolicyError || err?.status) {
      res.status(err.status || 422).json({
        ok: false,
        error: { code: err.code || "POLICY", message: err.message },
      });
    } else {
      res.status(400).json({
        ok: false,
        error: { code: "BAD_REQUEST", message: String(err?.message || err) },
      });
    }
    return null;
  }
}

function validateAi(p) {
  if (!p.apiKey) return { code: "NO_API_KEY", message: "未配置 API Key。打开「设置 → API」填入密钥后即可使用文生图与识图。" };
  if (p.mode === "text" && !String(p.prompt).trim()) return { code: "EMPTY_PROMPT", message: "请先描述你想要的图形" };
  if (p.mode === "image" && !p.image) return { code: "NO_IMAGE", message: "请先上传图片" };
  return null;
}

/** Static TikZ checks — used by the generator/reviewer loop and by tests. */
// Generation log: inspect what a panel actually produced.
app.get("/api/logs", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const rows = await listLogs(limit);
  return res.json({ ok: true, dir: logDir(), rows });
});

app.get("/api/logs/:id", async (req, res) => {
  try {
    return res.json({ ok: true, code: await readLog(req.params.id) });
  } catch {
    return badRequest(res, "找不到该日志");
  }
});

app.post("/api/lint", (req, res) => {
  const { source, request } = req.body || {};
  if (typeof source !== "string" || !source.trim()) return badRequest(res, "源码为空");
  return res.json(lintTikz(source, { request }));
});

/**
 * Deterministic image -> TikZ for *filled* regions (VTracer WASM).
 * No API key, no model: this is the layer the stroke tracer cannot produce.
 * Text is not handled here -- vtracer turns glyphs into blobs, so labels must
 * still come from the vision model as \node.
 */
app.post("/api/vectorize", async (req, res) => {
  // Closed on purpose: pixel tracing is no longer a product path for pictures.
  return res.status(410).json({
    error: "描摹入口已关闭：图片请走 semantic 重建（/api/ai/text2tikz，representation=figure）。",
    code: "TRACING_DISABLED",
  });
  // eslint-disable-next-line no-unreachable
  const body = req.body || {};
  const image = body.image;
  if (typeof image !== "string" || !/^data:image\/(png|jpe?g|gif|bmp);base64,/i.test(image)) {
    return badRequest(res, "需要 data URL 形式的图片（PNG / JPEG / GIF / BMP）");
  }
  const base64 = image.slice(image.indexOf(",") + 1);
  if (base64.length > 16_000_000) return badRequest(res, "图片过大（base64 上限 16MB）");
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  try {
    const started = Date.now();
    const vtracer = {
      mode: ["spline", "polygon", "pixel"].includes(body.mode) ? body.mode : "spline",
      simplify: num(body.simplify, 1.2),
      pathPrecision: num(body.precision, 2),
    };
    if (body.maxColors) vtracer.maxColors = num(body.maxColors, 0);
    if (Array.isArray(body.palette) && body.palette.length) vtracer.palette = body.palette;
    // Optional text layer: boxes are 0..1000 normalised, same as the semantics JSON.
    const labels = Array.isArray(body.labels)
      ? body.labels
          .filter((l) => l && typeof l.tex === "string" && Array.isArray(l.box) && l.box.length === 4)
          .slice(0, 40)
          .map((l) => ({ box: l.box.map(Number), tex: String(l.tex).trim() }))
          .filter((l) => l.tex && l.box.every(Number.isFinite))
      : [];
    const out = await vectorizePng(Buffer.from(base64, "base64"), {
      targetWidthCm: Math.max(2, Math.min(40, num(body.widthCm, 12))),
      precision: Math.max(0, Math.min(4, num(body.precision, 2))),
      dropWhite: body.dropWhite !== false,
      // Defaults that keep confetti out of the drawing; pass 0 to opt out.
      minAreaPx: Math.max(0, num(body.minAreaPx, 6)),
      minThicknessPx: Math.max(0, num(body.minThicknessPx, 2)),
      denoise: body.denoise !== false,
      labels,
      fontPt: Math.max(2, Math.min(20, num(body.fontPt, 5))),
      vtracer,
    });
    return res.json({ ok: true, tikz: out.document, stats: out.stats, durationMs: Date.now() - started });
  } catch (err) {
    const message = String(err?.message || err);
    const code = /vtracer/i.test(message) ? "VECTORIZER_UNAVAILABLE" : "VECTORIZE_FAILED";
    return res.status(500).json({ ok: false, error: { code, message } });
  }
});

/** Streaming (SSE) generate -> compile -> repair loop. */
app.post("/api/ai/text2tikz", async (req, res) => {
  // Policy validation must finish before SSE headers are written. Keep this shared
  // with the non-streaming routes so no endpoint can turn a rejected request into
  // an unhandled async rejection.
  const payload = readAiPayload(req, res);
  if (!payload) return;
  const invalid = validateAi(payload);
  if (invalid) return res.status(400).json({ ok: false, error: invalid });

  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();

  // NOTE: req "close" fires as soon as the request body has been read — using it
  // as "client disconnected" silently swallowed every event. Only the response
  // closing means the peer is gone.
  const ac = new AbortController();
  let closed = false;
  res.on("close", () => {
    closed = true;
    ac.abort();
  });
  const send = (event) => {
    if (closed || res.writableEnded) return;
    res.write("data: " + JSON.stringify(event) + "\n\n");
  };

  try {
    for await (const event of runGeneration({ ...payload, signal: ac.signal })) {
      send(event);
      if (event.type === "end") break;
    }
  } catch (err) {
    send({ type: "error", code: "AI_ERROR", message: String(err?.message || err) });
    send({ type: "end" });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

app.post("/api/ai/compare", async (req, res) => {
  const payload = readAiPayload(req, res);
  if (!payload) return;
  if (!payload.apiKey || !payload.image || typeof req.body.source !== "string") return badRequest(res, "需要原图、TikZ 源码和 API Key");
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  try {
    const review = await compareVision({ ...payload, source: req.body.source, signal: ac.signal });
    res.json(review);
  } catch (err) { res.status(500).json({ ok: false, error: { message: err.message } }); }
});

/** Same pipeline without streaming — handy for scripts and curl. */
app.post("/api/ai/generate", async (req, res) => {
  const payload = readAiPayload(req, res);
  if (!payload) return;
  const invalid = validateAi(payload);
  if (invalid) return res.status(400).json({ ok: false, error: invalid });

  const events = [];
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    for await (const event of runGeneration({ ...payload, signal: ac.signal })) {
      if (event.type !== 'code') events.push(event);
      if (event.type === "end") break;
    }
  } catch (err) {
    return res.status(502).json({ ok: false, error: { code: "AI_ERROR", message: String(err?.message || err) } });
  }
  const done = events.find((e) => e.type === "done");
  const failure = events.find((e) => e.type === "error");
  if (failure && !done) {
    return res.status(502).json({ ok: false, error: { code: failure.code || "AI_ERROR", message: failure.message } });
  }
  return res.json({
    ok: Boolean(done?.ok),
    tikz: done?.code ?? null,
    // the LAST attempt is the one being delivered
    lint: [...events].reverse().find((e) => e.type === "lint") ?? null,
    review: done?.review ?? null,
    visual: done?.visual ?? null,
    geometry: done?.geometry ?? null,
    trace: done?.trace ?? null,
    reason: done?.reason ?? null,
    attempts: done?.attempts ?? 0,
    model: done?.model ?? null,
    durationMs: done?.durationMs ?? 0,
    errors: done?.errors ?? [],
    steps: events.filter((e) => e.type === "step" || e.type === "error"),
  });
});

/** Text-only pass: the \node strings + boxes for the vectorize/trace routes. */
app.post("/api/ai/labels", async (req, res) => {
  const apiKey = (req.get("x-ai-key") || "").trim() || String(req.body?.apiKey || "").trim();
  if (!apiKey) return res.status(400).json({ ok: false, error: { code: "NO_API_KEY", message: "未配置 API Key" } });
  const image = req.body?.image;
  if (typeof image !== "string" || !/^data:image\//i.test(image)) return badRequest(res, "需要 data URL 形式的图片");
  let base;
  try {
    base = requireBaseUrl(req.body?.baseUrl);
  } catch (err) {
    return res.status(400).json({ ok: false, error: { code: "NO_BASE_URL", message: err.message } });
  }
  try {
    const out = await recognizeLabels({ image, apiKey, baseUrl: base, model: req.body?.model });
    return res.json({ ok: true, labels: out.labels, model: out.model, usage: out.usage });
  } catch (err) {
    return res.status(502).json({ ok: false, error: { code: err?.code || "LABEL_FAILED", message: String(err?.message || err) } });
  }
});

app.post("/api/ai/check", async (req, res) => {
  const apiKey = (req.get("x-ai-key") || "").trim() || (req.body?.apiKey || "").trim();
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: { code: "NO_API_KEY", message: "未配置 API Key" } });
  }
  let base;
  try {
    base = requireBaseUrl(req.body?.baseUrl);
  } catch (err) {
    return res.status(400).json({ ok: false, error: { code: "NO_BASE_URL", message: err.message } });
  }
  try {
    const r = await fetch(base + "/models", { headers: { authorization: "Bearer " + apiKey } });
    const text = await r.text();
    if (!r.ok) {
      const info = describeUpstream(r.status, text, "GET " + base + "/models");
      return res.status(502).json({ ok: false, error: { code: "UPSTREAM_ERROR", message: info.message } });
    }
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {}
    const data = Array.isArray(json.data) ? json.data : [];
    const models = data.map((m) => m.id).filter(Boolean);
    const meta = data
      .filter((m) => m && m.id)
      .map((m) => ({
        id: m.id,
        name: m.name || undefined,
        // DeepSeek / OpenAI expose "input_modalities"; some gateways use other names.
        inputModalities: m.input_modalities || m.inputModalities || m.modalities?.input || undefined,
      }));
    return res.json({ ok: true, models, meta });
  } catch (err) {
    return res.status(502).json({ ok: false, error: { code: "UPSTREAM_UNREACHABLE", message: err.message } });
  }
});

/* ------------------------------------------------------------------ static */

if (IS_PROD || process.env.SERVE_DIST === "1") {
  const dist = path.join(ROOT, "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
}

app.use((err, _req, res, _next) => {
  console.error("[api]", err);
  res.status(500).json({ ok: false, error: { code: "INTERNAL", message: String(err?.message || err) } });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[tikz-studio] api on http://127.0.0.1:${PORT}  (prod=${IS_PROD})`);
});

/* ------------------------------------------------------------------ utils */

function hashSource(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return s.length + ":" + h;
}

function tail(text, n) {
  if (!text) return "";
  return text.length > n ? text.slice(-n) : text;
}

/** Newest mtime among server/*.mjs — compared with STARTED_AT by the UI. */
function newestServerSource() {
  try {
    let newest = 0;
    for (const name of readdirSync(__dirname)) {
      if (!name.endsWith(".mjs")) continue;
      const at = statSync(path.join(__dirname, name)).mtimeMs;
      if (at > newest) newest = at;
    }
    return Math.round(newest);
  } catch {
    return null;
  }
}
