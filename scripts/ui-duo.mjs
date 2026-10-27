import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
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
console.log("reviewer toggle:", await page.evaluate(() => {
  const row = [...document.querySelectorAll(".drawer .row")].find((r) => r.textContent.includes("生成器 + 审核器"));
  return row?.querySelector(".switch")?.getAttribute("data-on");
}));

await page.type(".drawer textarea", "数据 → 模型 → 结果 的三段流程图");
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());

await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 120000 }).catch(() => errs.push("no result"));
await wait(500);

console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("steps:", await page.evaluate(() => [...document.querySelectorAll(".ai-step")].map((s) => s.getAttribute("data-status") + ":" + s.textContent.replace(/\s+/g, " ").trim()).join(" | ")));
console.log("review card:", await page.evaluate(() => document.querySelector(".review-block")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) || "none"));
await page.screenshot({ path: ".shots/b1-duo.png" });
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
