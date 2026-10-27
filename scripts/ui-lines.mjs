import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
let sent = null;
page.on("request", (r) => {
  if (r.url().includes("/api/ai/text2tikz")) { try { sent = JSON.parse(r.postData() || "{}"); } catch {} }
});

await page.goto("http://127.0.0.1:8791", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1200);
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8898/v1", apiKey: "mock-key", apiModel: "mock-tikz", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1500);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await page.waitForSelector(".drawer textarea", { timeout: 20000 });
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("图片识别"))?.click());
await wait(400);
const input = await page.$('.drawer input[type="file"]');
await input.uploadFile("D:\\FDU_AIagentDevelop\\.shots\\panelb-orig.png");
await wait(1800);

// crop to the main panel so the per-panel runner stays out of the way
const box = await page.evaluate(() => {
  const el = document.querySelector(".drawer .crop-wrap");
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(box.x + box.w * 0.02, box.y + box.h * 0.05);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.78, box.y + box.h * 0.55, { steps: 12 });
await page.mouse.up();
await wait(1500);
console.log("crop:", await page.evaluate(() => document.querySelector(".drawer .crop-wrap")?.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)));
console.log("panel notice:", await page.evaluate(() => [...document.querySelectorAll(".drawer .notice")].some((n) => n.textContent.includes("逐块识别"))));

// choose the skeleton tracer
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.trim() === "单值跟踪")?.click());
await wait(300);
console.log("tracer hint:", await page.evaluate(() => [...document.querySelectorAll(".drawer .hint")].map((h) => h.textContent.trim()).find((t) => t.includes("单值")) || "none"));

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误") || t.includes("时间上限");
}, { timeout: 220000 }).catch(() => errs.push("no result card"));
await wait(800);
console.log("sent representation:", sent?.representation, "mode:", sent?.mode, "perPanel:", sent?.perPanel);
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("steps:", await page.evaluate(() => [...document.querySelectorAll(".ai-step")].map((s) => s.textContent.replace(/\s+/g, " ").trim())));
console.log("trace hint:", await page.evaluate(() => [...document.querySelectorAll(".card .hint")].map((h) => h.textContent.replace(/\s+/g, " ").trim()).find((t) => t.includes("曲线") && t.includes("KB")) || "none"));
await page.evaluate(() => { const b = document.querySelector(".drawer-body"); if (b) b.scrollTop = b.scrollHeight; });
await wait(400);
await page.screenshot({ path: ".shots/ui-lines.png" });
console.log(errs.length ? errs.slice(0, 3).join(" | ") : "no page errors");
await browser.close();
