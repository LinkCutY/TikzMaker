import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.goto(process.argv[2] || "http://127.0.0.1:8788", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4200);

const count = async () => page.evaluate(() => [...document.querySelectorAll(".pane-head .pill")].map((p) => p.textContent.trim()).find((x) => x.includes("个元素")) || "?");
const srcHas = async (needle) => page.evaluate((n) => document.querySelector(".cm-content")?.textContent?.includes(n) ?? false, needle);
const box = await page.$eval(".canvas-svg", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

console.log("start:", await count());

// rectangle by drag
await page.click('[title^="矩形"]');
const a = { x: box.x + box.w * 0.15, y: box.y + box.h * 0.12 };
const b = { x: box.x + box.w * 0.42, y: box.y + box.h * 0.32 };
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(a.x + 20, a.y + 20, { steps: 3 });
await page.mouse.move(b.x, b.y, { steps: 8 });
await page.mouse.up();
await wait(1000);
console.log("after rect:", await count());

// click inside (unfilled) rectangle -> should select
await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
await wait(400);
const hasInspector = await page.evaluate(() => Boolean(document.querySelector(".inspector-body")));
console.log("rect selected (inspector):", hasInspector);

await page.keyboard.press("Delete");
await wait(900);
console.log("after delete:", await count());

// undo delete
await page.keyboard.down("Control");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Control");
await wait(900);
console.log("after undo:", await count());

// edit inside tikzpicture -> divergence banner
const lineBox = await page.evaluate(() => {
  const lines = [...document.querySelectorAll(".cm-line")];
  const target = lines.find((l) => l.textContent.includes("rectangle")) || lines[7];
  const r = target.getBoundingClientRect();
  return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 };
});
await page.mouse.click(lineBox.x, lineBox.y);
await page.keyboard.press("End");
await page.keyboard.type(" % manual");
await wait(1000);
const banner = await page.evaluate(() => Boolean(document.querySelector(".diverged-banner")));
console.log("divergence banner:", banner);
await page.screenshot({ path: ".shots/27-diverged.png" });

if (banner) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".diverged-banner button")].find((x) => x.textContent.includes("用画布覆盖"));
    btn?.click();
  });
  await wait(1600);
  console.log("banner gone:", !(await page.evaluate(() => Boolean(document.querySelector(".diverged-banner")))), "| manual text kept:", await srcHas("% manual"));
}
await page.screenshot({ path: ".shots/28-final-canvas.png" });
console.log(errs.length ? errs.slice(0, 8).join("\n") : "no page errors");
await browser.close();
