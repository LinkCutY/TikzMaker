import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\begin{document}
\begin{tikzpicture}
\node at (3,{2}) {函数 $y=\sin(e^x)$ 的图像};
\draw[->, thick] (-0.5,0) -- (7,0) node[below] {\(x\)};
\draw[->, thick] (0,-2) -- (0,2) node[left] {\(y\)};
% y = sin(exp(x))
\draw[blue, very thick] plot[domain=-0.5:5.5, samples=200, smooth] (\x, {sin(exp(\x) r)});
\end{tikzpicture}
\end{document}`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);
await page.evaluate((doc) => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.source = doc; st.state.figure = { elements: [] }; st.state.bodyStamp = null;
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, DOC);
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3200);

const box = async () => page.evaluate(() => {
  const t = document.querySelector(".canvas-node-text")?.getBoundingClientRect();
  const p = document.querySelector(".canvas-elements path")?.getBoundingClientRect();
  return {
    text: t ? { x: Math.round(t.x), y: Math.round(t.y) } : null,
    plot: p ? { x: Math.round(p.x), y: Math.round(p.y) } : null,
  };
});
const before = await box();
await page.mouse.move(1350, 180);
await page.mouse.down();
await page.mouse.move(1150, 260, { steps: 12 });
await page.mouse.up();
await wait(500);
const after = await box();
console.log("before:", JSON.stringify(before));
console.log("after :", JSON.stringify(after));
console.log("text delta:", before.text && after.text ? [after.text.x - before.text.x, after.text.y - before.text.y] : "?");
console.log("plot delta:", before.plot && after.plot ? [after.plot.x - before.plot.x, after.plot.y - before.plot.y] : "?");
await browser.close();
