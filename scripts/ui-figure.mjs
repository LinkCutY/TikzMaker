import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
let sent = null;
page.on("request", (r) => { if (r.url().includes("/api/ai/text2tikz")) { try { sent = JSON.parse(r.postData() || "{}"); } catch {} } });

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
await input.uploadFile("D:\\FDU_AIagentDevelop\\.probe-tests\\fixtures\\sphere.png");
await wait(1800);
console.log("tracer default:", await page.evaluate(() => [...document.querySelectorAll(".drawer .seg button")].filter((b) => b.hasAttribute("data-active")).map((b) => b.textContent.trim()).join("|")));

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill[data-ok]")?.textContent || "";
  return t.includes("编译通过") || t.includes("视觉校验通过") || t.includes("仍有编译错误");
}, { timeout: 180000 }).catch(() => errs.push("no result"));
await wait(700);
console.log("sent representation:", sent?.representation);
console.log("steps:", await page.evaluate(() => [...document.querySelectorAll(".ai-step")].map((s) => s.textContent.replace(/\s+/g, " ").trim())));
console.log("understanding card:", await page.evaluate(() => {
  const card = [...document.querySelectorAll(".card")].find((c) => c.textContent.includes("图像理解"));
  return card ? card.textContent.replace(/\s+/g, " ").trim().slice(0, 180) : "none";
}));
console.log("pills:", await page.evaluate(() => [...document.querySelectorAll(".card .pill--muted")].map((p) => p.textContent.trim()).join(" | ")));
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill[data-ok]")?.textContent?.trim()));
console.log("card hints:", await page.evaluate(() => [...document.querySelectorAll(".card .hint")].map((h) => h.textContent.replace(/\s+/g, " ").trim()).filter((t) => t.includes("图元") || t.includes("可编辑"))));
await page.evaluate(() => { const b = document.querySelector(".drawer-body"); if (b) b.scrollTop = b.scrollHeight; });
await wait(400);
await page.screenshot({ path: ".shots/ui-understand.png" });
console.log(errs.length ? "errors: " + errs.slice(0, 3).join(" | ") : "no page errors");
await browser.close();
