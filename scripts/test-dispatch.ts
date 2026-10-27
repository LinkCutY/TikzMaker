import { readFile } from "node:fs/promises";
import { runGeneration } from "../server/ai.mjs";

const bytes = await readFile(".probe-tests/fixtures/paper.png");
const image = "data:image/png;base64," + bytes.toString("base64");
const labels: string[] = [];
let done: any = null;
for await (const ev of runGeneration({ mode: "image", image, apiKey: "mock-key", baseUrl: "http://127.0.0.1:8899/v1", model: "deepseek-flash", canvasMode: true, reviewer: false, budgetMs: 200000 })) {
  if (ev.type === "step" && ev.label) labels.push(ev.label);
  if (ev.type === "done") done = ev;
}
console.log("first steps:", labels.slice(0, 4).join(" | "));
console.log("representation:", done?.representation, "| chars:", (done?.code || "").length, "| ok:", done?.ok);