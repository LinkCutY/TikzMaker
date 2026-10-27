import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\begin{document}
\begin{tikzpicture}
\draw[thick] (0,0) -- (3,0) -- (3,3) -- (0,3) -- cycle;
\draw[thick] (0,3) -- (1,4) -- (4,4) -- (3,3);
\draw[thick] (3,0) -- (4,1) -- (4,4);
\draw[dashed] (0,0) -- (1,1) -- (1,4);
\node at (2,-0.9) {正方体};
\end{tikzpicture}
\end{document}`;
const b = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const p = await b.newPage();
await p.setViewport({ width: 1680, height: 1040 });
await p.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await p.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1500);
await p.evaluate((d) => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.source = d; st.state.figure = { elements: [] }; st.state.bodyStamp = null;
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, DOC);
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await p.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3000);
// select a layer so the inspector is populated
await p.evaluate(() => [...document.querySelectorAll(".layer")].find((l) => l.textContent.includes("多边形"))?.click());
await wait(700);
console.log("inspector visible:", await p.evaluate(() => Boolean(document.querySelector(".inspector"))));
console.log("layers:", await p.evaluate(() => [...document.querySelectorAll(".layer-name")].map((n) => n.textContent.trim()).join(", ")));
await p.screenshot({ path: ".shots/n-sidebar.png" });
await b.close();
