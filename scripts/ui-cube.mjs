import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\begin{document}
\begin{tikzpicture}
\draw[thick] (0,0) -- (3,0) -- (3,3) -- (0,3) -- cycle;
\draw[thick] (0,3) -- (1,4) -- (4,4) -- (3,3);
\draw[thick] (3,0) -- (4,1) -- (4,4);
\draw[dashed] (0,0) -- (1,1) -- (1,4);
\draw[dashed] (1,1) -- (4,1);
\node at (2,-0.9) {正方体};
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
console.log("layers:", await page.evaluate(() => [...document.querySelectorAll(".layer-name")].map((n) => n.textContent.trim()).join(", ")));
console.log("shapes:", await page.evaluate(() => ({ polygons: document.querySelectorAll(".canvas-elements polygon").length, polylines: document.querySelectorAll(".canvas-elements polyline").length, dashed: [...document.querySelectorAll(".canvas-elements polygon, .canvas-elements polyline")].filter((e) => e.getAttribute("stroke-dasharray")).length })));
await page.screenshot({ path: ".shots/i-cube.png" });
await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("编译"))?.click());
await page.waitForFunction(() => /编译成功|编译失败/.test(document.querySelector(".statusbar")?.textContent || ""), { timeout: 90000 }).catch(() => {});
await wait(1200);
await page.evaluate(() => [...document.querySelectorAll(".pane-head button")].find((b) => b.textContent.includes("预览"))?.click());
await wait(1500);
await page.screenshot({ path: ".shots/i-cube-preview.png" });
console.log(errs.length ? errs.join(" | ") : "no page errors");
await browser.close();
