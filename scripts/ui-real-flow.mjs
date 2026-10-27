import puppeteer from "puppeteer-core";
import { readFile } from "node:fs/promises";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const KEY_FILE = "C:\\Users\\Lenovo\\Desktop\\Study\\Other Document\\Others\\新建 文本文档.txt";
const key = (await readFile(KEY_FILE, "utf8")).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
let sent = null;
page.on("request", (r) => { if (r.url().includes("/api/ai/text2tikz")) { try { sent = JSON.parse(r.postData() || "{}"); } catch {} } });

await page.goto("http://127.0.0.1:8791", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1000);
await page.evaluate((k) => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "https://api.deepseek.com/v1", apiKey: k, apiModel: "deepseek-flash", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, key);
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1500);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await page.waitForSelector(".drawer textarea", { timeout: 20000 });
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("图片识别"))?.click());
await wait(400);
const input = await page.$('.drawer input[type="file"]');
await input.uploadFile("D:\\FDU_AIagentDevelop\\.probe-tests\\fixtures\\sphere.png");
await wait(1600);
console.log("stale banner:", await page.evaluate(() => (document.querySelector(".drawer")?.innerText || "").includes("服务端进程比代码旧")));
console.log("primary:", await page.evaluate(() => [...document.querySelectorAll(".drawer .btn--primary")].map((b) => b.textContent.trim()).join("|")));

const t0 = Date.now();
await page.evaluate(() => [...document.querySelectorAll(".drawer .btn--primary")].find((b) => b.textContent.includes("理解并生成"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill[data-ok]")?.textContent || "";
  return t.includes("编译通过") || t.includes("视觉校验通过") || t.includes("仍有编译错误");
}, { timeout: 200000 }).catch(() => errs.push("no result"));
await wait(900);
console.log("elapsed", Math.round((Date.now() - t0) / 1000) + "s", "| representation:", sent?.representation);
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill[data-ok]")?.textContent?.trim()));
console.log("steps:", await page.evaluate(() => [...document.querySelectorAll(".ai-step")].map((x) => x.textContent.replace(/\s+/g, " ").trim())));
console.log("understanding:", await page.evaluate(() => {
  const card = [...document.querySelectorAll(".card")].find((c) => c.textContent.includes("图像理解"));
  return card ? card.textContent.replace(/\s+/g, " ").trim().slice(0, 150) : "none";
}));
await page.evaluate(() => { const b = document.querySelector(".drawer-body"); if (b) b.scrollTop = b.scrollHeight; });
await wait(400);
await page.screenshot({ path: ".shots/ui-real-flow.png" });

// apply to the editor and capture the preview
await page.evaluate(() => [...document.querySelectorAll(".ai-actions button")].find((b) => b.textContent.includes("替换编辑器"))?.click());
await wait(4500);
await page.screenshot({ path: ".shots/ui-real-applied.png" });
console.log("errors:", errs.length ? errs.slice(0, 3).join(" | ") : "none");
await browser.close();
