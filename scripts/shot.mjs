import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://127.0.0.1:8788";
const out = process.argv[3] || ".shots/main.png";
const width = Number(process.env.W || 1680);
const height = Number(process.env.H || 1040);
const waitSelector = process.env.WAIT || "img.page";

mkdirSync(path.dirname(out), { recursive: true });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},${height}`],
});

const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
page.on("requestfailed", (r) => logs.push("requestfailed: " + r.url() + " " + (r.failure()?.errorText || "")));

await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });
if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 60_000 }).catch(() => logs.push("timeout waiting for " + waitSelector));
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: out });
console.log("shot ->", out);
if (logs.length) console.log(logs.slice(0, 40).join("\n"));
await browser.close();
