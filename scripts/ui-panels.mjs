import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
let calls = 0;
const starts = [];
page.on("request", (r) => { if (r.url().includes("/api/ai/text2tikz")) { calls++; starts.push(Date.now()); } });

await page.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1500);
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "deepseek-flash", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await page.waitForSelector(".drawer textarea", { timeout: 20000 });
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("图片识别"))?.click());
await wait(400);

const input = await page.$('.drawer input[type="file"]');
await input.uploadFile("D:\\FDU_AIagentDevelop\\.shots\\panelb-orig.png");
await wait(2500);
console.log("panel notice:", await page.evaluate(() => [...document.querySelectorAll(".drawer .notice")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).find((t) => t.includes("面板")) || "none"));

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("逐块识别"))?.click());
await page.waitForFunction(() => [...document.querySelectorAll(".ai-step")].some((s) => s.textContent.includes("面板")), { timeout: 30000 }).catch(() => errs.push("no panel steps"));
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误") || t.includes("失败");
}, { timeout: 120000 }).catch(() => errs.push("no result"));
await wait(800);
console.log("steps:", await page.evaluate(() => [...document.querySelectorAll(".ai-step")].map((s) => s.getAttribute("data-status") + ":" + s.textContent.replace(/\s+/g, " ").trim()).join(" | ")));
console.log("pill:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("http calls:", calls, "| start offsets(ms):", starts.map((t) => t - starts[0]).join(", "));
const code = await page.evaluate(() => document.querySelector(".drawer .code-block, .drawer pre")?.textContent ?? "");
console.log("code lines:", code ? code.split("\n").length : 0);
await page.screenshot({ path: ".shots/m-panels.png" });
console.log(errs.length ? errs.slice(0, 3).join(" | ") : "no page errors");
await browser.close();
