import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto("http://127.0.0.1:8788", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4000);

const pill = async () => (await page.evaluate(() => [...document.querySelectorAll(".pane-head .pill")].map((p) => p.textContent.trim()).join(" | ")));
console.log("初始 pill:", await pill());
await page.screenshot({ path: ".shots/21-canvas-default.png" });

const box = await page.$eval(".canvas-svg", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log("canvas box:", box);

// 1) drag to create a line
await page.click('[title^="直线"]');
const a = { x: box.x + box.w * 0.3, y: box.y + box.h * 0.35 };
const b = { x: box.x + box.w * 0.62, y: box.y + box.h * 0.6 };
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(a.x + 30, a.y + 20, { steps: 4 });
await page.mouse.move(b.x, b.y, { steps: 10 });
await page.mouse.up();
await wait(4500);
console.log("创建直线后 pill:", await pill());
await page.screenshot({ path: ".shots/22-canvas-line.png" });

// 2) select the line by clicking its midpoint, then change colour
await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
await wait(400);
const inspectorVisible = await page.evaluate(() => Boolean(document.querySelector(".inspector-body")));
console.log("属性面板:", inspectorVisible);
await page.screenshot({ path: ".shots/23-canvas-selected.png" });

const swatchClicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".inspector .swatch")];
  const target = btns.find((b) => (b.getAttribute("title") || "") === "blue");
  if (!target) return false;
  target.click();
  return true;
});
await wait(4200);
console.log("改为蓝色:", swatchClicked, "| pill:", await pill());
await page.screenshot({ path: ".shots/24-canvas-colored.png" });

// 3) load the flowchart template
await page.click('[title="模板库"]');
await wait(500);
await page.evaluate(() => {
  const t = [...document.querySelectorAll(".template")].find((x) => x.textContent.includes("流程图"));
  t?.click();
});
await wait(5000);
console.log("模板 pill:", await pill());
await page.screenshot({ path: ".shots/25-canvas-template.png" });

// 4) switch to preview tab, check the compiled result matches
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".tabs-inline button")].find((x) => x.textContent.includes("预览"));
  b?.click();
});
await page.waitForSelector("img.page", { timeout: 60000 }).catch(() => errs.push("no preview img"));
await wait(1200);
await page.screenshot({ path: ".shots/26-preview-from-canvas.png" });

console.log(errs.length ? errs.slice(0, 12).join("\n") : "no page errors");
await browser.close();
