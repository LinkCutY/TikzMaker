import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4500);

const count = async () => page.evaluate(() => [...document.querySelectorAll(".pane-head .pill")].map((p) => p.textContent.trim()).find((x) => x.includes("个元素")) || "?");
const banner = async () => page.evaluate(() => Boolean(document.querySelector(".diverged-banner")));

console.log("before:", await count());

// load the tree template
await page.click('[title="模板库"]');
await wait(500);
await page.evaluate(() => [...document.querySelectorAll(".template")].find((x) => x.textContent.includes("树状结构"))?.click());
await wait(5000);
console.log("after template:", await count(), "banner:", await banner());

// reload: persisted source must rebuild the canvas
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4500);
console.log("after reload:", await count(), "banner:", await banner());
await page.screenshot({ path: ".shots/32-reload.png" });
console.log(errs.length ? errs.slice(0, 6).join("\n") : "no page errors");
await browser.close();
