import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "deepseek-flash", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2000);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await wait(600);
// 仅校验 = maxAttempts 1, so the broken doc stays broken and lint is kept
await page.evaluate(() => [...document.querySelectorAll(".drawer .seg button")].find((b) => b.textContent.trim() === "仅校验")?.click());
await page.type(".drawer textarea", "随便画");
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => Boolean(document.querySelector(".card .pill")), { timeout: 90000 }).catch(() => {});
await wait(600);

console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("lint summary:", await page.evaluate(() => document.querySelector(".lint-block summary")?.textContent?.replace(/\s+/g, " ").trim() || "none"));
console.log("lint items:", await page.evaluate(() => [...document.querySelectorAll(".lint-block .ai-error")].map((e) => e.textContent.replace(/\s+/g, " ").trim()).join(" | ")));
await page.screenshot({ path: ".shots/a3-lint-panel.png" });
await browser.close();
