import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || "http://127.0.0.1:5188";

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4500);

const chips = async () => page.evaluate(() => [...document.querySelectorAll(".preset-chip")].map((c) => c.textContent.trim()).join(" | "));
const count = async () => page.evaluate(() => [...document.querySelectorAll(".pane-head .pill")].map((p) => p.textContent.trim()).find((x) => x.includes("个元素")) || "?");

// 1) grid
const grid = await page.evaluate(() => {
  const lines = [...document.querySelectorAll(".canvas-grid line")];
  if (!lines.length) return { lines: 0 };
  const l = lines[0];
  const cs = getComputedStyle(l);
  return { lines: lines.length, stroke: cs.stroke, width: l.getAttribute("stroke") };
});
console.log("grid:", JSON.stringify(grid));
console.log("default strip:", await chips());
await page.screenshot({ path: ".shots/40-strip-default.png" });

// 2) flowchart template -> its tools appear
await page.click('[title="模板库"]');
await wait(500);
await page.evaluate(() => [...document.querySelectorAll(".template")].find((x) => x.textContent.includes("流程图"))?.click());
await wait(4500);
console.log("flowchart strip:", await chips());
console.log("elements:", await count());
await page.screenshot({ path: ".shots/41-flowchart-tools.png" });

// 3) place a flow box from the strip
await page.evaluate(() => [...document.querySelectorAll(".preset-chip")].find((c) => c.textContent.includes("流程框"))?.click());
await wait(300);
const box = await page.$eval(".canvas-svg", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.62);
await wait(1200);
console.log("after placing preset:", await count());
await page.screenshot({ path: ".shots/42-flow-box.png" });

// 4) four-quadrant template -> negative axes
await page.click('[title="模板库"]');
await wait(500);
await page.evaluate(() => [...document.querySelectorAll(".template")].find((x) => x.textContent.includes("四象限"))?.click());
await wait(4500);
console.log("quadrant strip:", await chips());
await page.screenshot({ path: ".shots/43-quadrant.png" });

// 5) select axes, check inspector fields
await page.evaluate(() => [...document.querySelectorAll(".layer")].find((l) => l.textContent.includes("坐标轴"))?.click());
await wait(400);
const fields = await page.evaluate(() => [...document.querySelectorAll(".inspector .field label")].map((l) => l.textContent.trim()).join(" | "));
console.log("axes inspector:", fields);
await page.screenshot({ path: ".shots/44-axes-inspector.png" });

console.log(errs.length ? errs.slice(0, 8).join("\n") : "no page errors");
await browser.close();
