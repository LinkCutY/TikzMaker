import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ADDPLOT = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{tikzpicture}
\draw[->, thick] (-3.5,0) -- (3.5,0) node[right] {$x$};
\draw[->, thick] (0,-1.5) -- (0,1.5) node[above] {$y$};
\addplot[domain=-3.14:3.14, samples=200]{cos(sin(x))};
\node at (0,1.9) {$\cos(\sin x)$ 的图像};
\end{tikzpicture}
\end{document}`;

const BADEXPR = String.raw`\documentclass[tikz,border=8pt]{standalone}
\begin{document}
\begin{tikzpicture}
\draw[->, thick] (-3.5,0) -- (3.5,0) node[right] {$x$};
\draw[->, thick] (0,-1.5) -- (0,1.5) node[above] {$y$};
% y = cos(sin(deg(x)))
\draw plot[domain=-3:3, samples=100] (\x, {cos(sin(deg(\x)))});
\end{tikzpicture}
\end{document}`;

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });

const load = async (doc) => {
  await page.evaluate((d) => {
    const raw = localStorage.getItem("tikz-studio:v1");
    const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
    st.state.source = d; st.state.figure = { elements: [] }; st.state.bodyStamp = null;
    localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
  }, doc);
  await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
  await page.waitForSelector(".canvas-svg", { timeout: 60000 });
  await wait(3000);
  return page.evaluate(() => ({
    layers: [...document.querySelectorAll(".layer-name")].map((n) => n.textContent.trim()),
    curves: document.querySelectorAll(".canvas-elements path").length,
    marker: [...document.querySelectorAll(".canvas-elements text")].map((t) => t.textContent).find((t) => t.includes("表达式无效")) || null,
    pill: document.querySelector(".pane-head .pill--warn")?.textContent?.replace(/\s+/g, " ").trim() || null,
  }));
};

console.log("addplot  :", JSON.stringify(await load(ADDPLOT)));
await page.screenshot({ path: ".shots/c3-addplot.png" });
console.log("bad expr :", JSON.stringify(await load(BADEXPR)));
await page.screenshot({ path: ".shots/c4-badexpr.png" });
console.log(errs.length ? errs.slice(0, 4).join("\n") : "no page errors");
await browser.close();
