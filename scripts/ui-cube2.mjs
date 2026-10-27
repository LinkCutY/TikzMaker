import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\begin{document}
\begin{tikzpicture}[line cap=round, line join=round]
\tikzset{
  edge/.style = {line width=0.6pt},
  hidden/.style = {dashed, line width=0.5pt}
}
\coordinate (A) at (1.0, 0.6);
\coordinate (B) at (5.0, 0.6);
\coordinate (C) at (5.0, 4.6);
\coordinate (D) at (1.0, 4.6);
\coordinate (E) at (3.4, 2.4);
\coordinate (F) at (7.4, 2.4);
\coordinate (G) at (7.4, 6.4);
\coordinate (H) at (3.4, 6.4);
\draw[hidden] (E) -- (A);
\draw[hidden] (E) -- (F);
\draw[hidden] (E) -- (H);
\draw[edge] (A) -- (B);
\draw[edge] (B) -- (C);
\draw[edge] (C) -- (D);
\draw[edge] (D) -- (A);
\draw[edge] (B) -- (F);
\draw[edge] (C) -- (G);
\draw[edge] (D) -- (H);
\draw[edge] (F) -- (G);
\draw[edge] (G) -- (H);
\node at (4.2, -0.6) {正方体};
\end{tikzpicture}
\end{document}`;
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
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
await wait(3000);
console.log("layers:", await page.evaluate(() => document.querySelectorAll(".layer").length), "| first:", await page.evaluate(() => [...document.querySelectorAll(".layer-name")].slice(0, 3).map((n) => n.textContent.trim()).join(", ")));
console.log("drawn:", await page.evaluate(() => ({ lines: document.querySelectorAll(".canvas-elements line").length, dashed: [...document.querySelectorAll(".canvas-elements line")].filter((l) => l.getAttribute("stroke-dasharray")).length })));
console.log("pills:", await page.evaluate(() => [...document.querySelectorAll(".pane-head .pill--warn")].map((p) => p.textContent.replace(/\s+/g, " ").trim()).join(" | ") || "none"));
await page.screenshot({ path: ".shots/j-cube2.png" });
await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("编译"))?.click());
await page.waitForFunction(() => /编译成功|编译失败/.test(document.querySelector(".statusbar")?.textContent || ""), { timeout: 90000 }).catch(() => {});
await wait(1200);
await page.evaluate(() => [...document.querySelectorAll(".pane-head button")].find((b) => b.textContent.includes("预览"))?.click());
await wait(1500);
await page.screenshot({ path: ".shots/j-cube2-preview.png" });
console.log(errs.length ? errs.join(" | ") : "no page errors");
await browser.close();
