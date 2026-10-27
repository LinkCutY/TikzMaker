import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPTS = [
  { key: "sine", text: "画一个 y=sin x 在 -2π 到 2π 之间的图像" },
  { key: "cos", text: "画一个 cos(sin x) 的图像" },
  { key: "net", text: "画一个三层神经网络结构图" },
  { key: "flow", text: "画一个 输入→处理→输出 的流程图" },
];

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });

await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

// point the app at the local mock model
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "deepseek-flash", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

const results = [];
for (const p of PROMPTS) {
  // fresh drawer each round: otherwise the previous result card satisfies the
  // "wait for result" condition and we re-apply the previous document.
  await page.keyboard.press("Escape");
  await wait(300);
  await page.evaluate(() => {
    if (document.querySelector(".drawer")) return;
    [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click();
  });
  await page.waitForSelector(".drawer textarea", { timeout: 20000 });
  await wait(400);
  await page.click(".drawer textarea");
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await wait(150);
  await page.type(".drawer textarea", p.text);
  await wait(300);
  const typed = await page.evaluate(() => document.querySelector(".drawer textarea")?.value ?? "");
  if (typed.trim() !== p.text) errs.push("prompt mismatch: " + JSON.stringify(typed));

  await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
  await page.waitForFunction(() => document.querySelectorAll(".ai-step").length > 0, { timeout: 30000 }).catch(() => errs.push(p.key + ": no steps"));
  await page.waitForFunction(() => {
    const t = document.querySelector(".card .pill")?.textContent || "";
    return t.includes("编译通过") || t.includes("仍有编译错误");
  }, { timeout: 120000 }).catch(() => errs.push(p.key + ": no result"));
  await wait(600);
  const verdict = await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim() || "-");
  const review = await page.evaluate(() => document.querySelector(".review-block .pill")?.textContent?.trim() || "-");

  await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("替换编辑器"))?.click());
  await wait(1200);
  // make sure the preview is fresh, not the previous compile
  await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("编译"))?.click());
  await page.waitForFunction(
    () => /编译成功|编译失败/.test(document.querySelector(".statusbar")?.textContent || ""),
    { timeout: 120000 }
  ).catch(() => errs.push(p.key + ": compile timeout"));
  await wait(1200);
  const status = await page.evaluate(() => document.querySelector(".statusbar")?.textContent?.replace(/\s+/g, " ").trim());
  if (!/编译成功/.test(status || "")) errs.push(p.key + ": " + status);

  await page.evaluate(() => [...document.querySelectorAll(".pane-head button")].find((b) => b.textContent.includes("画布"))?.click());
  await wait(900);
  const canvas = await page.evaluate(() => ({
    layers: [...document.querySelectorAll(".layer-name")].map((n) => n.textContent.trim()),
    pills: [...document.querySelectorAll(".pane-head .pill--warn")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
    markers: [...document.querySelectorAll(".canvas-elements text")].map((t) => t.textContent).filter((t) => t.includes("无效")),
  }));
  await page.screenshot({ path: `.shots/d-${p.key}-canvas.png` });

  await page.evaluate(() => [...document.querySelectorAll(".pane-head button")].find((b) => b.textContent.includes("预览"))?.click());
  await wait(2200);
  const preview = await page.evaluate(() => {
    const img = document.querySelector(".preview-img, .preview-pane img, .preview-pane svg");
    const err = document.querySelector(".diverged-banner, .compile-error-banner")?.textContent?.slice(0, 80) || null;
    const ok = !document.body.textContent.includes("还没有预览");
    return { kind: img?.tagName?.toLowerCase() ?? null, hasError: err, rendered: ok };
  });
  await page.screenshot({ path: `.shots/d-${p.key}-preview.png` });

  results.push({ prompt: p.text, key: p.key, verdict, review, canvas, preview });
}

console.log(JSON.stringify(results, null, 1));
console.log(errs.length ? "ERRORS: " + errs.slice(0, 6).join(" | ") : "no page errors");
await browser.close();
