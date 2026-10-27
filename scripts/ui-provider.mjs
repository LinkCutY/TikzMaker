import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || "http://127.0.0.1:5188";

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3500);

// A) fresh state: DeepSeek should already be selected
await page.click('[title="AI 生成（文生图 / 识图）"]');
await wait(700);
const connectCard = await page.evaluate(() => {
  const chips = [...document.querySelectorAll(".connect-card .provider-chip")].map((c) => c.textContent.trim() + (c.getAttribute("data-active") === "true" ? "*" : ""));
  const hint = document.querySelector(".connect-card .hint")?.textContent?.trim() || "";
  return { chips: chips.join(" | "), hint };
});
console.log("connect card chips:", connectCard.chips);
console.log("hint:", connectCard.hint.slice(0, 60));
await page.screenshot({ path: ".shots/70-connect-deepseek.png" });

// B) configure against the local mock and reload
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = {
    ...(st.state.settings || {}),
    provider: "deepseek",
    apiBaseUrl: "http://127.0.0.1:8899/v1",
    apiKey: "mock-key",
    apiModel: "deepseek-chat",
    engine: "xelatex",
  };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3000);
await page.click('[title="AI 生成（文生图 / 识图）"]');
await wait(600);

// switch to image tab -> should warn about vision and disable the run button
await page.evaluate(() => [...document.querySelectorAll(".drawer .seg button")].find((b) => b.textContent.includes("图片识别"))?.click());
await wait(400);
const visionState = await page.evaluate(() => {
  const notice = [...document.querySelectorAll(".drawer .notice")].map((n) => n.textContent.trim()).join(" | ");
  const btn = [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"));
  return { notice: notice.slice(0, 90), disabled: btn?.disabled };
});
console.log("image tab:", JSON.stringify(visionState));
await page.screenshot({ path: ".shots/71-vision-guard.png" });

// C) settings drawer: model dropdown should list provider models
await page.keyboard.press("Escape");
await wait(400);
await page.click('[title="设置"]');
await wait(700);
const models = await page.evaluate(() => [...document.querySelectorAll(".drawer select option")].map((o) => o.value));
console.log("model options:", models.join(", "));
await page.screenshot({ path: ".shots/72-settings-provider.png" });

console.log(errs.length ? errs.slice(0, 6).join("\n") : "no page errors");
await browser.close();
