import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3500);

const label = await page.evaluate(() => [...document.querySelectorAll(".topbar button")].map((b) => b.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | "));
console.log("topbar buttons:", label);
await page.screenshot({ path: ".shots/90-entry-topbar.png" });

// Ctrl+K should open the drawer
await page.keyboard.down("Control");
await page.keyboard.press("KeyK");
await page.keyboard.up("Control");
await wait(700);
console.log("drawer open via Ctrl+K:", await page.evaluate(() => Boolean(document.querySelector(".drawer"))));
await page.screenshot({ path: ".shots/91-entry-drawer.png" });
await page.keyboard.press("Escape");
await wait(300);

// empty canvas CTA: clear the figure via template "空白画布"
await page.click('[title="模板库"]');
await wait(500);
await page.evaluate(() => [...document.querySelectorAll(".template")].find((x) => x.textContent.includes("空白画布"))?.click());
await wait(2500);
const cta = await page.evaluate(() => document.querySelector(".canvas-empty")?.textContent?.replace(/\s+/g, " ").trim() || "");
console.log("empty canvas CTA:", cta);
await page.screenshot({ path: ".shots/92-entry-empty.png" });
await browser.close();
