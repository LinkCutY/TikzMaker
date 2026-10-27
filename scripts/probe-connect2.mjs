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
await wait(800);
await page.evaluate(() => [...document.querySelectorAll(".connect-card .provider-chip")].find((c) => c.textContent.trim() === "自定义")?.click());
await wait(900);
const dump = await page.evaluate(() => {
  const fields = [...document.querySelectorAll(".connect-card .field")];
  return fields.map((f, i) => ({
    i,
    label: f.querySelector("label")?.textContent?.trim(),
    hasInput: Boolean(f.querySelector("input")),
    hasSelect: Boolean(f.querySelector("select")),
    text: f.textContent.replace(/\s+/g, " ").slice(0, 70),
  }));
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
