// Real-model acceptance for the NEXT.md scientific-curve work (§11 阶段 F).
// Run: TEST_IMAGE=... TIKZ_AI_KEY_FILE=... node scripts/live-next.mjs
// The API key is read only at runtime and is never written to any report.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGeneration } from "../server/ai.mjs";

const imagePath = process.env.TEST_IMAGE;
if (!imagePath) throw new Error("TEST_IMAGE is required");
const keyFile = process.env.TIKZ_AI_KEY_FILE;
const rawKey = process.env.TIKZ_AI_KEY || (keyFile ? await readFile(keyFile, "utf8") : "");
const apiKey = rawKey.match(/sk-[A-Za-z0-9_-]+/)?.[0];
if (!apiKey) throw new Error("API credential missing");
const baseUrl = process.env.TIKZ_AI_BASE_URL || "https://api.deepseek.com/v1";
const model = process.env.TIKZ_AI_MODEL || "deepseek-flash";
if (/localhost|127\.0\.0\.1|mock/i.test(baseUrl + model)) throw new Error("live test must use the real model");

const label = process.env.TEST_LABEL || "next";
const outDir = resolve(".probe-tests/live", label);
await mkdir(outDir, { recursive: true });
const image = "data:image/png;base64," + (await readFile(imagePath)).toString("base64");
const started = Date.now();
const events = [];
let done = null;
const budgetMs = Number(process.env.TEST_BUDGET_MS || 240000);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), budgetMs + 5000);
try {
  for await (const event of runGeneration({
    mode: "image", image, apiKey, baseUrl, model, representation: "figure",
    canvasMode: true, reviewer: process.env.TEST_REVIEWER !== "0",
    maxAttempts: Number(process.env.TEST_ROUNDS || 2),
    budgetMs, signal: controller.signal,
  })) {
    if (event.type === "code") continue;
    const safe = { ...event };
    delete safe.code;
    delete safe.log;
    events.push(safe);
    if (event.type === "step") console.log(`${Math.round((Date.now() - started) / 1000)}s ${event.label || event.id}: ${event.status}${event.detail ? " · " + event.detail : ""}`);
    if (event.type === "error") throw new Error(String(event.message).replaceAll(apiKey, "[REDACTED]"));
    if (event.type === "done") done = event;
  }
  if (done?.code) await writeFile(resolve(outDir, "result.tex"), done.code);
  const report = {
    passed: Boolean(done?.ok),
    model, baseUrl, image: imagePath.split(/[\\/]/).pop(),
    elapsedMs: Date.now() - started,
    ok: done?.ok,
    reason: done?.reason,
    rounds: done?.rounds,
    visual: done?.visual || null,
    curves: done?.curves || [],
    relations: done?.relations || null,
    yAxis: done?.yAxis || null,
    joint: done?.joint || null,
    localReviews: done?.localReviews || 0,
    trace: done?.trace || null,
    events,
  };
  await writeFile(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outDir, passed: report.passed, reason: report.reason, rounds: report.rounds, visual: report.visual, curves: report.curves, relations: report.relations, yAxis: report.yAxis, joint: report.joint }));
} finally {
  clearTimeout(timeout);
}