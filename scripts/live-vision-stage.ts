import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGeneration } from "../server/ai.mjs";
import { compileToPdf, run } from "../server/latex.mjs";
import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";
import { mergePanels, transformElement } from "../src/lib/figure/merge";
import { compileExpr } from "../src/lib/figure/expr";
import { type PlotEl } from "../src/lib/figure/types";
import assert from "node:assert/strict";

// Live acceptance only: credentials stay in memory, with no mock fallback.
const input = process.env.TEST_IMAGE;
const label = process.env.TEST_LABEL || "stage1";
assert.ok(input, "TEST_IMAGE is required");
let apiKey = process.env.TIKZ_AI_KEY || "";
if (!apiKey && process.env.TIKZ_AI_KEY_FILE) {
  const text = await readFile(process.env.TIKZ_AI_KEY_FILE, "utf8");
  apiKey = text.match(/sk-[A-Za-z0-9_-]+/)?.[0] || "";
}
assert.ok(apiKey, "A real TIKZ_AI_KEY or TIKZ_AI_KEY_FILE is required");
const baseUrl = process.env.TIKZ_AI_BASE_URL || "https://api.deepseek.com/v1";
const model = process.env.TIKZ_AI_MODEL || "deepseek-flash";
assert.ok(!/localhost|127\.0\.0\.1|mock/i.test(baseUrl + model), "Live test must use the actual model");
const outDir = resolve(".probe-tests/live", label);
await mkdir(outDir, { recursive: true });
const started = Date.now();
const events: unknown[] = [];
let result: any = null;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), Number(process.env.TEST_BUDGET_MS || 240000));
try {
  console.log(`LIVE ${label}: ${model}, ${new URL(baseUrl).hostname}`);
  const bytes = await readFile(input);
  for await (const event of runGeneration({ mode: "image", image: `data:image/png;base64,${bytes.toString("base64")}`, apiKey, baseUrl, model, perPanel: true, canvasMode: true, reviewer: false, maxAttempts: 1, budgetMs: Number(process.env.TEST_BUDGET_MS || 240000), signal: controller.signal })) {
    if (event.type === "code") continue;
    const safe = { ...event };
    delete safe.code;
    delete safe.log;
    events.push(safe);
    if (event.type === "step") console.log(`${Math.round((Date.now() - started) / 1000)}s ${event.label || event.id}: ${event.status}`);
    if (event.type === "error") throw new Error(String(event.message).replaceAll(apiKey, "[REDACTED]"));
    if (event.type === "done") result = event;
  }
  assert.ok(result?.ok && result.code, "Model must deliver a compiling result");
  await writeFile(resolve(outDir, "model-original.tex"), result.code);
  const fig = parseBody(result.code);
  assert.ok(fig.elements.length > 0, "Model result must be editable");
  const curves = fig.elements.filter((el): el is PlotEl => el.kind === "plot");
  const drawnCubics = (result.code.match(/\.\.\s*controls\b/g) || []).length;
  assert.equal(fig.elements.filter(el => el.kind === "bezier").length, drawnCubics, "Parser lost model-generated Bezier segments");
  if (process.env.TEST_REQUIRE_CURVES === "1") assert.ok(curves.length + drawnCubics >= 5, "Ridge plot must have multiple curves");
  assert.ok(fig.elements.length < 200, "Unbounded repeated elements");
  for (const el of curves) {
    const fn = compileExpr(el.expr);
    assert.ok(fn.ok, `Invalid curve: ${el.name}`);
    for (const scale of [0.2, 0.6, 1.7]) {
      const moved = transformElement(el, scale, 2.3, -0.8) as PlotEl;
      const transformed = compileExpr(moved.expr);
      assert.ok(transformed.ok);
      const reopened = parseBody(buildDocument({ elements: [moved] })).elements.find(e => e.kind === "plot") as PlotEl;
      assert.ok(reopened);
      const reopenedFn = compileExpr(reopened.expr);
      assert.ok(reopenedFn.ok);
      for (let j = 0; j <= 30; j++) {
        const x = el.xMin + (el.xMax - el.xMin) * j / 30;
        const expected = (fn.fn(x) + el.offset.y) * scale - 0.8;
        const actual = transformed.fn(x * scale) + moved.offset.y;
        const afterReopen = reopenedFn.fn(x * scale + moved.offset.x) + reopened.offset.y;
        assert.ok(Number.isFinite(expected) && Math.abs(actual - expected) < 1e-7 && Math.abs(afterReopen - expected) < 1e-7, "Live curve geometry changed during merge/export");
      }
    }
  }
  const merged = mergePanels([{ fig, box: { x: 34, y: 16, w: 321, h: 177 } }], 453, 336);
  const source = buildDocument(merged);
  await writeFile(resolve(outDir, "merged.tex"), source);
  for (const [name, tex] of [["original", result.code], ["merged", source]]) {
    const job = await compileToPdf(tex, { engine: "xelatex" });
    try {
      assert.ok(job.ok, `${name} compile failed: ${JSON.stringify(job.errors)}`);
      await copyFile(job.pdfPath, resolve(outDir, `${name}.pdf`));
      if (process.env.TIKZ_PYTHON) {
        const rendered = await run(process.env.TIKZ_PYTHON, ["server/python/render.py", "--pdf", job.pdfPath, "--png", resolve(outDir, `${name}.png`), "--dpi", "144"]);
        assert.equal(rendered.code, 0, rendered.stderr);
      } else {
        const rendered = await run("pdftoppm", ["-png", "-singlefile", "-r", "144", job.pdfPath, resolve(outDir, name)]);
        assert.equal(rendered.code, 0, rendered.stderr);
      }
    } finally { await job.cleanup(); }
  }
  const report = { passed: true, stage: label, model, host: new URL(baseUrl).hostname, durationMs: Date.now() - started, elements: fig.elements.length, curves: curves.length, rounds: result.rounds, events };
  await writeFile(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, events: undefined }));
} catch (err) {
  const message = String(err).replaceAll(apiKey, "[REDACTED]");
  await writeFile(resolve(outDir, "report.json"), JSON.stringify({ passed: false, model, durationMs: Date.now() - started, error: message, events }, null, 2));
  console.error(message);
  process.exitCode = 1;
} finally { clearTimeout(timeout); }
