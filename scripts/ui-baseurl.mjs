import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

// reproduce the user's state: deepseek selected, key present, base URL empty
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "deepseek", apiBaseUrl: "", apiKey: "sk-test-dummy", apiModel: "deepseek-flash" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

await page.click('[title="设置"]');
await wait(600);
const urlValue = await page.evaluate(() => {
  const field = [...document.querySelectorAll(".drawer .field")].find((f) => (f.querySelector("label")?.textContent ?? "").includes("Base URL"));
  return field?.querySelector("input")?.value ?? "(missing)";
});
console.log("base url after reload:", urlValue);

// click test and read the error (no network key, so expect a clear upstream message)
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("测试连接"))?.click());
await wait(4000);
const msg = await page.evaluate(() => {
  const hint = [...document.querySelectorAll(".drawer .hint")].map((h) => h.textContent.trim()).find((t) => t.includes("HTTP") || t.includes("Base URL"));
  return hint || "";
});
console.log("test result:", msg.slice(0, 200));
await page.screenshot({ path: ".shots/82-baseurl-healed.png" });
await browser.close();
