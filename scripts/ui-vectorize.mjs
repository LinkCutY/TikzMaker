import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
let vecReq = null;
page.on("request", (r) => {
  if (r.url().includes("/api/vectorize")) { try { vecReq = JSON.parse(r.postData() || "{}"); } catch {} }
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
await wait(1500);

// switch to the high-fidelity route
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.trim() === "高保真还原")?.click());
await wait(300);
// turn on the model text layer
await page.evaluate(() => {
  const row = [...document.querySelectorAll(".drawer .row")].find((r) => r.textContent.includes("用模型补文字"));
  row?.querySelector(".switch")?.click();
});
await wait(200);
console.log("fidelity UI:", await page.evaluate(() => [...document.querySelectorAll(".drawer .row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()).filter((t) => t.includes("只保留") || t.includes("补文字"))));

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("高保真还原") && !b.closest(".seg"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 120000 }).catch(() => errs.push("no result card"));

await wait(800);
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("steps:", await page.evaluate(() => [...document.querySelectorAll(".ai-step")].map((s) => s.textContent.replace(/\s+/g, " ").trim())));
console.log("vector hint:", await page.evaluate(() => [...document.querySelectorAll(".card .hint")].map((h) => h.textContent.replace(/\s+/g, " ").trim()).find((t) => t.includes("高保真层")) || "none"));
console.log("request labels:", vecReq ? (vecReq.labels || []).length : "none", "minArea:", vecReq?.minAreaPx);
console.log("apply buttons:", await page.evaluate(() => [...document.querySelectorAll(".ai-actions button")].map((b) => b.textContent.replace(/\s+/g, " ").trim())));

// scroll the drawer to the result card for the screenshot
await page.evaluate(() => {
  const body = document.querySelector(".drawer-body");
  if (body) body.scrollTop = body.scrollHeight;
});
await wait(500);
await page.screenshot({ path: ".shots/ui-vectorize.png" });

// regression: the editable route must still be selectable and restore its options
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.trim() === "可编辑图元")?.click());
await wait(300);
console.log("editable route restored:", await page.evaluate(() => {
  const sw = [...document.querySelectorAll(".drawer .row")].some((r) => r.textContent.includes("补文字"));
  const primary = [...document.querySelectorAll(".drawer .btn--primary")].map((b) => b.textContent.trim()).join("|");
  return { textLayerRowHidden: !sw, primary };
}));
console.log(errs.length ? errs.slice(0, 3).join(" | ") : "no page errors");
await browser.close();
