import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PROMPT = process.argv[2] || "画一个三层神经网络结构图";

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("request", (r) => {
  if (r.url().includes("/api/ai/")) {
    try { const b = JSON.parse(r.postData() || "{}"); console.log("REQ", r.url().split("/api")[1], "prompt=", JSON.stringify(b.prompt)); } catch { console.log("REQ", r.url()); }
  }
});
await page.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2000);
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "deepseek-flash", engine: "xelatex" };
  st.state.source = "";
  st.state.figure = { elements: [] };
  st.state.bodyStamp = null;
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await page.waitForSelector(".drawer textarea", { timeout: 20000 });
await page.click(".drawer textarea");
await page.keyboard.type(PROMPT);
await wait(300);
console.log("typed:", await page.evaluate(() => document.querySelector(".drawer textarea")?.value));

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 120000 }).catch(() => errs.push("no result"));
await wait(800);
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("替换编辑器"))?.click());
await wait(1500);
const head = await page.evaluate(() => (document.querySelector(".cm-content")?.textContent || "").slice(0, 160));
console.log("source head:", JSON.stringify(head));
console.log("layers:", await page.evaluate(() => [...document.querySelectorAll(".layer-name")].map((n) => n.textContent.trim()).join(", ")));
await page.screenshot({ path: ".shots/e-one-canvas.png" });
console.log("boxes:", await page.evaluate(() => [...document.querySelectorAll(".canvas-elements g")].filter((g) => g.querySelector("rect") && g.querySelector("text")).map((g) => {
  const r = g.querySelector("rect");
  const t = g.querySelector("text");
  return `${t.textContent}: box=${Math.round(+r.getAttribute("width"))}x${Math.round(+r.getAttribute("height"))} text=${Math.round(t.getBBox().width)} font=${t.style.fontSize} fill=${r.getAttribute("fill")}`;
}).join(" | ")));
await page.evaluate(() => [...document.querySelectorAll(".pane-head button")].find((b) => b.textContent.includes("预览"))?.click());
await wait(2500);
await page.screenshot({ path: ".shots/e-one-preview.png" });
console.log(errs.length ? errs.join(" | ") : "no page errors");
await browser.close();
