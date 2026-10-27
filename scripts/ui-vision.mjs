import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3000);

// configure against the mock through localStorage, then reload
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "deepseek-flash", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

await page.click('[title="设置"]');
await wait(600);
// pull the model list from the mock
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("测试连接"))?.click());
await wait(1500);
const options = await page.evaluate(() => [...document.querySelectorAll(".drawer select option")].map((o) => o.value));
console.log("models from /models:", options.join(", "));

const hintFor = async (model) => {
  await page.evaluate((m) => {
    const sel = document.querySelector(".drawer select");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, m);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, model);
  await wait(400);
  return page.evaluate(() => {
    const fields = [...document.querySelectorAll(".drawer .field")];
    const f = fields.find((x) => (x.querySelector("label")?.textContent ?? "").includes("模型"));
    return f?.querySelector(".hint")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  });
};
console.log("deepseek-flash:", await hintFor("deepseek-flash"));
console.log("deepseek-chat :", await hintFor("deepseek-chat"));
await page.screenshot({ path: ".shots/80-vision-meta.png" });

// image tab should explain but stay usable
await page.keyboard.press("Escape");
await wait(300);
await page.click('[title="AI 生成（文生图 / 识图）"]');
await wait(500);
await page.evaluate(() => [...document.querySelectorAll(".drawer .seg button")].find((b) => b.textContent.includes("图片识别"))?.click());
await wait(400);
const state = await page.evaluate(() => {
  const warn = [...document.querySelectorAll(".drawer .notice")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).join(" | ");
  const btn = [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"));
  return { warn: warn.slice(0, 80), disabled: btn?.disabled };
});
console.log("image tab:", JSON.stringify(state));
await page.screenshot({ path: ".shots/81-vision-notice.png" });
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
