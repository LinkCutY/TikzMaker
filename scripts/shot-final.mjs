import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4500);

// select the function layer to show the plot inspector
await page.evaluate(() => {
  const l = [...document.querySelectorAll(".layer")].find((x) => x.textContent.includes("函数 1"));
  l?.click();
});
await wait(600);
await page.screenshot({ path: ".shots/30-final.png" });

// also capture the template drawer
await page.click('[title="模板库"]');
await wait(600);
await page.screenshot({ path: ".shots/31-templates.png" });
await browser.close();
console.log("done");
