import { readFile } from "node:fs/promises";
import { runGeneration } from "../server/ai.mjs";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const image = "data:image/png;base64," + bytes.toString("base64");
const steps: string[] = [];
let done: any = null;
for await (const ev of runGeneration({
  mode: "image", image, apiKey: "mock-key", baseUrl: "http://127.0.0.1:8899/v1",
  model: "deepseek-flash", canvasMode: true, reviewer: false, budgetMs: 240000,
})) {
  if (ev.type === "step" && ev.label) steps.push(`${ev.status}:${ev.label}${ev.detail ? " (" + ev.detail + ")" : ""}`);
  if (ev.type === "done") done = ev;
}
console.log("steps:");
for (const s of steps) console.log("  " + s);
console.log("done:", JSON.stringify({ ok: done?.ok, representation: done?.representation, trace: done?.trace, visual: done?.visual }));