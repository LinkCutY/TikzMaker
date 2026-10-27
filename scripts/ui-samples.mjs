import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DOC = String.raw`\documentclass[tikz,border=8pt]{standalone}
\usepackage{ctex}
\begin{document}
\begin{tikzpicture}
\draw[->, thick] (-0.5,0) -- (7,0) node[below] {\(x\)};
\draw[->, thick] (0,-2) -- (0,2) node[left] {\(y\)};
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
  st.state.source = doc; st.state.figure = { elements: [] }; st.state.bodyStamp = null;
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
}, DOC);
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3000);

// select the plot
await page.evaluate(() => [...document.querySelectorAll(".layer")].find((l) => l.textContent.includes("函数"))?.click());
await wait(400);

const read = async () => page.evaluate(() => {
  const field = [...document.querySelectorAll(".inspector .field")].find((f) => (f.querySelector("label")?.textContent ?? "").includes("采样点"));
  const input = field?.querySelector("input");
  const path = document.querySelector(".canvas-elements path");
  const d = path?.getAttribute("d") || "";
  return { value: input?.value, segments: (d.match(/ C /g) || []).length };
});
console.log("before:", JSON.stringify(await read()));

// type a new count
const handle = await page.evaluateHandle(() => {
  const field = [...document.querySelectorAll(".inspector .field")].find((f) => (f.querySelector("label")?.textContent ?? "").includes("采样点"));
  return field?.querySelector("input") ?? null;
});
const el = handle.asElement();
if (!el) console.log("FAIL: no samples input");
else {
  await el.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(process.env.SAMPLES || "1200");
  await wait(400);
  console.log("while typing:", JSON.stringify(await read()));
  await page.keyboard.press("Tab");
  await wait(1500);
  console.log("after commit:", JSON.stringify(await read()));
}
const src = await page.evaluate(() => document.querySelector(".cm-content")?.textContent || "");
console.log("source has samples=300:", src.includes("samples=300"), "| coordinates form:", src.includes("coordinates"));
await page.screenshot({ path: ".shots/c1-samples.png" });
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
