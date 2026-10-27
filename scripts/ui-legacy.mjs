import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LEGACY = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\usepackage{amsmath,amssymb}
\usetikzlibrary{arrows.meta,positioning,calc,shapes.geometric}

\begin{document}
\begin{tikzpicture}[font=\small, >=Stealth]
  \draw[->, thick] (-0.4,0) -- (5.2,0) node[right] {$t$};
  \draw[->, thick] (0,-0.4) -- (0,3.4) node[above] {$y$};
  \foreach \x in {1,2,3,4} { \draw[gray!45] (\x,0) -- (\x,0.08); \node[below, gray] at (\x,0) {$\x$}; }
  \draw[thick, blue, domain=0:4.6, smooth, samples=120, variable=\x]
    plot ({\x},{2.4*exp(-0.55*\x)+0.25});
  \draw[thick, orange, dashed, domain=0:4.6, smooth, samples=120, variable=\x]
    plot ({\x},{0.35*\x});
  \draw[gray!55, densely dashed] (2.47,0) -- (2.47,0.865) -- (0,0.865);
  \filldraw[red] (2.47,0.865) circle (2.4pt) node[above right, inner sep=3pt] {交点};
\end{tikzpicture}
\end{document}`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

const URL = process.argv[2] || "http://127.0.0.1:8788";
await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });

// simulate a browser that still holds the pre-canvas (feature #1) state
await page.evaluate((src) => {
  const settings = { engine: "xelatex", autoCompile: true, delay: 900, theme: "dark", previewBg: "checker", apiBaseUrl: "https://api.openai.com/v1", apiKey: "", apiModel: "gpt-4o" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify({ state: { docName: "figure.tex", source: src, settings, editorWidth: 46, dockHeight: 190 }, version: 1 }));
}, LEGACY);

await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4500);

const count = async () => page.evaluate(() => [...document.querySelectorAll(".pane-head .pill")].map((p) => p.textContent.trim()).find((x) => x.includes("个元素")) || "?");
const banner = async () => page.evaluate(() => Boolean(document.querySelector(".diverged-banner")));

const layers = async () => page.evaluate(() => [...document.querySelectorAll(".layer-name")].map((x) => x.textContent.trim()).join(", "));
console.log("legacy load -> elements:", await count(), "| banner:", await banner());
console.log("layers:", await layers());
const editables = await page.evaluate(() => document.querySelectorAll(".layer-name").length);
console.log("editable layer count:", editables);
await page.screenshot({ path: ".shots/33-legacy-load.png" });

// a real manual edit inside the picture must still be flagged
const lineBox = await page.evaluate(() => {
  const lines = [...document.querySelectorAll(".cm-line")];
  const target = lines.find((l) => l.textContent.includes("plot")) || lines[7];
  const r = target.getBoundingClientRect();
  return { x: r.x + 40, y: r.y + r.height / 2 };
});
await page.mouse.click(lineBox.x, lineBox.y);
await page.keyboard.press("End");
await page.keyboard.type(" % manual");
await wait(1000);
console.log("after manual edit -> banner:", await banner());

if (await banner()) {
  await page.evaluate(() => [...document.querySelectorAll(".diverged-banner button")].find((b) => b.textContent.includes("用源码重建"))?.click());
  await wait(1500);
  console.log("after rebuild-from-source -> elements:", await count(), "| banner:", await banner());
}
await page.screenshot({ path: ".shots/34-legacy-fixed.png" });
console.log(errs.length ? errs.slice(0, 6).join("\n") : "no page errors");
await browser.close();
