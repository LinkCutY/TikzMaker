import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "deepseek", apiBaseUrl: "https://api.deepseek.com/v1", apiKey: "sk-x", apiModel: "deepseek-v4-pro" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

await page.click('[title="设置"]');
await wait(600);

const info = await page.evaluate(() => {
  const field = [...document.querySelectorAll(".drawer .field")].find((f) => (f.querySelector("label")?.textContent ?? "").trim() === "模型");
  const input = field?.querySelector("input");
  const options = [...document.querySelectorAll("datalist option")].map((o) => o.value);
  return { tag: input?.tagName, type: input?.type, list: input?.getAttribute("list"), options };
});
console.log("model field:", info.tag, "type=" + info.type, "datalist=" + info.list);
console.log("suggestions:", info.options.join(" | "));
console.log("still offers deepseek-flash:", info.options.includes("deepseek-flash"));

// type the beta id and confirm it sticks
const box = await page.evaluateHandle(() => {
  const field = [...document.querySelectorAll(".drawer .field")].find((f) => (f.querySelector("label")?.textContent ?? "").trim() === "模型");
  return field?.querySelector("input") ?? null;
});
const el = box.asElement();
if (!el) console.log("FAIL: no model input");
else {
  await el.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("deepseek-v4.1-flash-expires-on-0910");
  await page.keyboard.press("Tab");
  await wait(500);
  console.log("typed model:", await page.evaluate((e) => e.value, el));
}
await page.screenshot({ path: ".shots/95-model-free-text.png" });
await browser.close();
