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
await wait(4200);

const count = async () => {
  const t = await page.evaluate(() => [...document.querySelectorAll(".pane-head .pill")].map((p) => p.textContent.trim()).find((x) => x.includes("个元素")) || "?");
  return t;
};
const srcHas = async (needle) => page.evaluate((n) => document.querySelector(".cm-content")?.textContent?.includes(n) ?? false, needle);

console.log("start:", await count());
const box = await page.$eval(".canvas-svg", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

// --- create a rectangle by dragging ---
await page.click('[title^="矩形"]');
const a = { x: box.x + box.w * 0.15, y: box.y + box.h * 0.15 };
const b = { x: box.x + box.w * 0.4, y: box.y + box.h * 0.35 };
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(a.x + 20, a.y + 20, { steps: 3 });
await page.mouse.move(b.x, b.y, { steps: 8 });
await page.mouse.up();
await wait(900);
console.log("after rect:", await count(), "| source has rectangle:", await srcHas("rectangle"));

// --- undo / redo ---
await page.keyboard.down("Control");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Control");
await wait(600);
console.log("after undo:", await count(), "| still has rectangle:", await srcHas("rectangle"));

await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await wait(900);
console.log("after redo:", await count(), "| has rectangle:", await srcHas("rectangle"));

// --- delete with keyboard ---
await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
await wait(300);
await page.keyboard.press("Delete");
await wait(900);
console.log("after delete:", await count());

// --- divergence banner ---
await page.click(".cm-content");
await page.keyboard.down("Control");
await page.keyboard.press("End");
await page.keyboard.up("Control");
await page.keyboard.type("% manual edit");
await wait(900);
const banner = await page.evaluate(() => Boolean(document.querySelector(".diverged-banner")));
console.log("divergence banner:", banner);
await page.screenshot({ path: ".shots/27-diverged.png" });

if (banner) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".diverged-banner button")].find((b) => b.textContent.includes("用画布覆盖"));
    btn?.click();
  });
  await wait(1500);
  const stillThere = await page.evaluate(() => Boolean(document.querySelector(".diverged-banner")));
  const kept = await srcHas("% manual edit");
  console.log("banner after overwrite:", stillThere, "| manual edit kept:", kept);
}

await page.screenshot({ path: ".shots/28-final-canvas.png" });
console.log(errs.length ? errs.slice(0, 8).join("\n") : "no page errors");
await browser.close();
