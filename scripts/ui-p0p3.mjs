import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{amsmath}
\begin{document}
\begin{tikzpicture}
\draw[->, thick] (-1,0) -- (4,0) node[right] {$x$};
\draw[->, thick] (0,-0.5) -- (0,0.5) node[above] {$y$};
% y = sin(exp(x))
\draw[blue, thick] plot[domain=-1:2, samples=140, smooth] (\x, {sin(exp(\x) r)});
\node at (2.2,1.1) {y=\sin(e^x)};
\end{tikzpicture}
\end{document}`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

await page.evaluate((doc) => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.source = doc;
  st.state.figure = { elements: [] };
  st.state.bodyStamp = null;
  st.state.sourceOnly = false;
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, DOC);
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3500);

const state = await page.evaluate(() => ({
  layers: [...document.querySelectorAll(".layer-name")].map((n) => n.textContent.trim()),
  polys: document.querySelectorAll(".canvas-elements polyline").length,
  warn: document.querySelector(".pane-head .pill--warn")?.textContent?.trim() || null,
  nodeText: [...document.querySelectorAll(".canvas-node-text")].map((t) => t.textContent).join(" | "),
  italic: document.querySelector(".canvas-node-text--math") ? "yes" : "no",
}));
console.log("layers:", state.layers.join(", "));
console.log("polylines drawn:", state.polys, "| node text:", state.nodeText, "| italic:", state.italic);
console.log("out-of-range pill:", state.warn);
await page.screenshot({ path: ".shots/a1-plot-fixed.png" });

if (state.warn) {
  await page.evaluate(() => document.querySelector(".pane-head .pill--warn")?.click());
  await wait(3000);
  console.log("after fit -> pill:", await page.evaluate(() => document.querySelector(".pane-head .pill--warn")?.textContent || "none"));
  await page.screenshot({ path: ".shots/a2-axes-fitted.png" });
}
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
