import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3000);
await page.click('[title="AI 生成（文生图 / 识图）"]');
await wait(700);
console.log("chips:", await page.evaluate(() => [...document.querySelectorAll(".connect-card .provider-chip")].map((c) => c.textContent.trim())));
await page.evaluate(() => [...document.querySelectorAll(".connect-card .provider-chip")].find((c) => c.textContent.trim() === "自定义")?.click());
await wait(600);
const state = await page.evaluate(() => {
  const card = document.querySelector(".connect-card");
  return {
    hasCard: Boolean(card),
    labels: [...document.querySelectorAll(".connect-card .field label")].map((l) => l.textContent.trim()),
    activeChip: document.querySelector(".connect-card .provider-chip[data-active='true']")?.textContent?.trim(),
    inputs: [...document.querySelectorAll(".connect-card input")].map((i) => i.type + ":" + i.value),
  };
});
console.log(JSON.stringify(state, null, 1));
await browser.close();
