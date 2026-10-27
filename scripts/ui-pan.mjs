import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// axes whose labels use \\(x\\) and node[below]/node[left] — the shape that used to be dropped
const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\usepackage{amsmath}
\begin{document}
\begin{tikzpicture}
\node at (3,3.6) {函数 $y=\sin(e^x)$ 的图像};
\draw[->, thick] (-0.5,0) -- (7,0) node[below] {\(x\)};
\draw[->, thick] (0,-3) -- (0,3) node[left] {\(y\)};
% y = sin(exp(x))
\draw[blue, very thick] plot[domain=-0.5:5.5, samples=300, smooth] (\x, {sin(exp(\x) r)});
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
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, DOC);
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3200);

console.log("layers:", await page.evaluate(() => [...document.querySelectorAll(".layer-name")].map((n) => n.textContent.trim()).join(", ")));

const before = await page.evaluate(() => {
  const el = document.querySelector(".canvas-elements polyline");
  const r = el?.getBoundingClientRect();
  return r ? { x: Math.round(r.x), y: Math.round(r.y) } : null;
});

// drag on an empty patch to pan
await page.mouse.move(1350, 200);
await page.mouse.down();
await page.mouse.move(1250, 260, { steps: 8 });
await page.mouse.up();
await wait(400);
await page.mouse.move(1350, 200);
await page.mouse.down();
await page.mouse.move(1200, 300, { steps: 10 });
await page.mouse.up();
await wait(500);

const after = await page.evaluate(() => {
  const el = document.querySelector(".canvas-elements polyline");
  const r = el?.getBoundingClientRect();
  return r ? { x: Math.round(r.x), y: Math.round(r.y) } : null;
});
console.log("polyline before:", JSON.stringify(before), "after drag:", JSON.stringify(after));
console.log("panned:", before && after ? after.x !== before.x || after.y !== before.y : "?");
await page.screenshot({ path: ".shots/b2-pan.png" });
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
