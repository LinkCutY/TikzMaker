import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runPanelJobs } from "../src/lib/panel-runner";
import { parseBody } from "../src/lib/figure/parse";
import { buildDocument } from "../src/lib/figure/generate";
import { mergePanels, type PanelPart } from "../src/lib/figure/merge";
import { runGeneration } from "../server/ai.mjs";
import { compileToPdf, run } from "../server/latex.mjs";
const keyFile = process.env.TIKZ_AI_KEY_FILE;
const apiKey = process.env.TIKZ_AI_KEY || (keyFile ? (await readFile(keyFile, "utf8")).match(/sk-[A-Za-z0-9_-]+/)?.[0] : "");
assert.ok(apiKey, "Real model credentials required");
const label = process.env.TEST_LABEL || "stage3-panels";
const outDir = resolve(".probe-tests/live", label);
await mkdir(outDir, { recursive: true });
const fixtures = JSON.parse(await readFile(".probe-tests/fixtures/panels.json", "utf8"));
const model = "deepseek-flash", baseUrl = "https://api.deepseek.com/v1";
const initial = new Map<number, PanelPart>();
if (process.env.TEST_RESUME_FROM) {
  for (let i = 0; i < fixtures.length; i++) {
    try {
      const code = await readFile(resolve(".probe-tests/live", process.env.TEST_RESUME_FROM, `panel-${i + 1}.tex`), "utf8");
      initial.set(i, { fig: parseBody(code), box: fixtures[i].box });
    } catch { /* Only successful previous panels are reused. */ }
  }
}
const ac = new AbortController();
const cancelTimer = process.env.TEST_CANCEL_MS ? setTimeout(() => ac.abort(), Number(process.env.TEST_CANCEL_MS)) : null;
let updates = 0;
console.log(`LIVE ${label}: ${model}, ${fixtures.length} panels`);
const report = await runPanelJobs<PanelPart>({ count: fixtures.length, initial, signal: ac.signal, concurrency: 2, budgetMs: 180000, panelBudgetMs: 75000, maxAttempts: 2,
  run: async (index, context) => {
    const bytes = await readFile(fixtures[index].path);
    let done: any;
    for await (const event of runGeneration({ mode: "image", image: `data:image/png;base64,${bytes.toString("base64")}`, apiKey, baseUrl, model, perPanel: true, panelIndex: index + 1, strict: context.strict, reviewer: false, maxAttempts: 1, budgetMs: context.budgetMs, signal: context.signal })) {
      if (event.type === "step") console.log(`panel${index + 1} ${event.label || event.id}: ${event.status}`);
      if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
      if (event.type === "done") done = event;
    }
    assert.ok(done?.ok && done.code, `Panel ${index + 1} did not compile`);
    await writeFile(resolve(outDir, `panel-${index + 1}.tex`), done.code);
    const fig = parseBody(done.code);
    assert.ok(fig.elements.length > 0, `Panel ${index + 1} is uneditable`);
    assert.equal(fig.elements.filter(e => e.kind === "bezier").length, (done.code.match(/\.\.\s*controls\b/g) || []).length, "Lost a curve");
    return { fig, box: fixtures[index].box };
  },
  onUpdate: states => {
    const completed = states.filter(s => s.status === "ok" && s.value).map(s => s.value!);
    if (completed.length) {
      updates++;
      writeFileSync(resolve(outDir, "partial.tex"), buildDocument(mergePanels(completed, 453, 336)));
    }
    console.log("panels: " + states.map(s => s.status).join(","));
  },
});
if (cancelTimer) clearTimeout(cancelTimer);
const parts = report.states.filter(s => s.status === "ok").map(s => s.value!);
await writeFile(resolve(outDir, "report.json"), JSON.stringify({ ...report, states: report.states.map(s => ({ ...s, value: s.value ? { elements: s.value.fig.elements.length } : undefined })), model, updates }, null, 2));
assert.ok(parts.length > 0, "At least one real-model result must be retained");
if (process.env.TEST_REQUIRE_ALL === "1") assert.equal(parts.length, fixtures.length, "Every panel must finish successfully");
assert.ok(report.states.every(s => s.status === "ok" || s.status === "fail"), "No panel may stay stuck in running status");
assert.ok(report.durationMs < 182000, "Whole-image deadline was exceeded");
const source = buildDocument(mergePanels(parts, 453, 336));
await writeFile(resolve(outDir, "merged.tex"), source);
const job = await compileToPdf(source, { engine: "xelatex" });
try {
  assert.ok(job.ok, JSON.stringify(job.errors));
  await copyFile(job.pdfPath, resolve(outDir, "merged.pdf"));
  const rendered = await run("pdftoppm", ["-png", "-singlefile", "-r", "144", job.pdfPath, resolve(outDir, "merged")]);
  assert.equal(rendered.code, 0, rendered.stderr);
} finally { await job.cleanup(); }
// Resume must reuse successful real-model outputs and make zero model calls.
const cached = new Map(report.states.filter(s => s.status === "ok").map(s => [s.index, s.value!]));
let resumeCalls = 0;
await runPanelJobs({ count: fixtures.length, initial: cached, maxAttempts: 1, run: async i => { assert.ok(!cached.has(i), "Successful panel was regenerated"); resumeCalls++; return { fig: { elements: [] }, box: fixtures[i].box }; } });
assert.equal(resumeCalls, fixtures.length - cached.size);
console.log(JSON.stringify({ passed: true, scope: "scheduler", allPanelsComplete: parts.length === fixtures.length, model, panels: parts.length, durationMs: report.durationMs, incrementalUpdates: updates, resumeCalls }));
