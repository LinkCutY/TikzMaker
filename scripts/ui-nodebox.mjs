import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\begin{document}
\begin{tikzpicture}
\node[draw, rounded corners, fill=blue!10] at (0,0) {输入};
\node[draw, rounded corners, fill=orange!15] at (4,0) {处理器模块};
\node[draw] at (8,0) {A};
\end{tikzpicture}
\end{document}`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1500);
await page.evaluate((d) => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.source = d; st.state.figure = { elements: [] }; st.state.bodyStamp = null;
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, DOC);
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

const rows = await page.evaluate(() => {
  const out = [];
  for (const g of document.querySelectorAll(".canvas-elements g")) {
    const rect = g.querySelector("rect");
    const text = g.querySelector("text");
    if (!rect || !text) continue;
    const tb = text.getBBox();
    out.push({
      label: text.textContent,
      rectW: +rect.getAttribute("width"),
      rectH: +rect.getAttribute("height"),
      textW: Math.round(tb.width),
      textH: Math.round(tb.height),
      fill: rect.getAttribute("fill"),
      fontSize: text.style.fontSize,
    });
  }
  return out;
});
console.table(rows);
await page.screenshot({ path: ".shots/f-nodebox.png" });
await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("编译"))?.click());
await page.waitForFunction(() => /编译成功|编译失败/.test(document.querySelector(".statusbar")?.textContent || ""), { timeout: 90000 }).catch(() => {});
await wait(1200);
await page.evaluate(() => [...document.querySelectorAll(".pane-head button")].find((b) => b.textContent.includes("预览"))?.click());
await wait(1500);
await page.screenshot({ path: ".shots/f-nodebox-preview.png" });
await browser.close();
