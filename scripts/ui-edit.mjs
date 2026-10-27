import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SPHERE = String.raw`\documentclass[tikz,border=8pt]{standalone}
\begin{document}
\begin{tikzpicture}
\draw[very thick] (0,0) circle (2);
\draw (0,0) ellipse (2 and 0.6);
\draw (0,0.9) ellipse (1.7 and 0.5);
\draw (0,-0.9) ellipse (1.7 and 0.5);
\draw (0,0) ellipse (0.6 and 2);
\draw (0,0) ellipse (1.2 and 2);
\fill[white] (0.5,1.1) ellipse (0.06 and 0.09);
\draw (0.5,1.1) ellipse (0.06 and 0.09);
\end{tikzpicture}
\end{document}`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await page.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1500);
await page.evaluate((doc) => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "deepseek-flash", engine: "xelatex" };
  st.state.source = doc; st.state.figure = { elements: [] }; st.state.bodyStamp = null;
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, SPHERE);
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);
console.log("before:", await page.evaluate(() => (document.querySelector(".cm-content")?.textContent || "").length), "chars,",
  await page.evaluate(() => [...document.querySelectorAll(".canvas-elements ellipse, .canvas-elements circle")].length), "round shapes");

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await page.waitForSelector(".drawer textarea", { timeout: 20000 });
await page.click(".drawer textarea");
await page.keyboard.type("把球上的洞去掉");
await wait(300);
const hasEditBtn = await page.evaluate(() => [...document.querySelectorAll(".drawer button")].some((b) => b.textContent.includes("修改当前 TikZ")));
console.log("edit button present:", hasEditBtn);
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("修改当前 TikZ"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 90000 }).catch(() => errs.push("no result"));
await wait(600);
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("diff line:", await page.evaluate(() => [...document.querySelectorAll(".card .hint")].map((h) => h.textContent.replace(/\s+/g, " ").trim()).find((t) => t.includes("改动")) || "none"));
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("替换编辑器"))?.click());
await wait(1500);
const after = await page.evaluate(() => document.querySelector(".cm-content")?.textContent || "");
console.log("after: has hole ellipse:", after.includes("0.06 and 0.09"), "| kept outer circle:", after.includes("circle (2)"));
await page.evaluate(() => [...document.querySelectorAll(".pane-head button")].find((b) => b.textContent.includes("画布"))?.click());
await wait(800);
await page.screenshot({ path: ".shots/g-edit-canvas.png" });
console.log(errs.length ? errs.join(" | ") : "no page errors");
await browser.close();
