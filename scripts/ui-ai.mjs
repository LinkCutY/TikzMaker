import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || "http://127.0.0.1:5188";

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });

// point the app at the mock OpenAI-compatible endpoint
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = {
    ...(st.state.settings || {}),
    engine: "xelatex",
    apiBaseUrl: "http://127.0.0.1:8899/v1",
    apiKey: "mock-key",
    apiModel: "mock-tikz",
  };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3500);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await wait(600);
await page.type(".drawer textarea", "数据 → 模型 → 结果 的三段流程图");
await wait(200);
await page.screenshot({ path: ".shots/60-ai-panel.png" });

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());

// wait for the result card
await page.waitForFunction(() => Boolean(document.querySelector(".ai-steps")) , { timeout: 30000 }).catch(() => errs.push("no steps"));
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 120000 }).catch(() => errs.push("no result"));

const steps = await page.evaluate(() => [...document.querySelectorAll(".ai-step")].map((s) => `${s.getAttribute("data-status")}:${s.textContent.trim()}`));
console.log("steps:", steps.join(" | "));
const verdict = await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim());
console.log("verdict:", verdict);
console.log("lint block:", await page.evaluate(() => document.querySelector(".lint-block summary")?.textContent?.trim() || "none"));
await page.screenshot({ path: ".shots/61-ai-result.png" });

// apply and check the editor
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("替换编辑器"))?.click());
await wait(3000);
const src = await page.evaluate(() => document.querySelector(".cm-content")?.textContent || "");
console.log("source has 结果 node:", src.includes("结果"), "| has broken \\result:", src.includes("\\result"));
await page.screenshot({ path: ".shots/62-ai-applied.png" });

console.log(errs.length ? errs.slice(0, 8).join("\n") : "no page errors");
await browser.close();
