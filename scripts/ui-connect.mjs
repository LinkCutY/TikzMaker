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

const typeInto = async (label, text) => {
  const ok = await page.evaluate((lab) => {
    const fields = [...document.querySelectorAll(".connect-card .field")];
    // match on the label only: hints also mention "Base URL"
    const field = fields.find((f) => (f.querySelector("label")?.textContent ?? "").includes(lab));
    const input = field?.querySelector("input");
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  }, label);
  if (!ok) return false;
  await page.keyboard.type(text);
  await wait(250);
  return true;
};

await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(3200);

await page.click('[title="AI 生成（文生图 / 识图）"]');
await wait(800);

// 1) custom provider so we can point at the local mock
await page.evaluate(() => [...document.querySelectorAll(".connect-card .provider-chip")].find((c) => c.textContent.trim() === "自定义")?.click());
await wait(800);
console.log("typed base url:", await typeInto("Base URL", "http://127.0.0.1:8899/v1"));
console.log("typed key:", await typeInto("API Key", "mock-key"));
console.log("key value length:", await page.evaluate(() => {
  const fields = [...document.querySelectorAll(".connect-card .field")];
  const f = fields.find((x) => (x.querySelector("label")?.textContent ?? "").includes("API Key"));
  return f?.querySelector("input")?.value?.length ?? -1;
}));
await wait(400);

const cardStillOpen = await page.evaluate(() => Boolean(document.querySelector(".connect-card")));
console.log("card open while typing:", cardStillOpen);

// 2) save & test against the mock
await page.evaluate(() => [...document.querySelectorAll(".connect-card button")].find((b) => b.textContent.includes("保存并测试"))?.click());
await wait(1800);
console.log("after connect:", JSON.stringify(await page.evaluate(() => ({
  card: Boolean(document.querySelector(".connect-card")),
  bar: document.querySelector(".connect-bar")?.textContent?.replace(/\s+/g, " ").trim() || "",
  msg: document.querySelector(".connect-card .hint")?.textContent?.trim() || "",
}))));
await page.screenshot({ path: ".shots/73-connected.png" });

// 3) generate
await page.type(".drawer textarea", "数据 -> 模型 -> 结果 的流程图");
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 90000 }).catch(() => errs.push("no result card"));
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
await page.screenshot({ path: ".shots/74-generated.png" });
console.log(errs.length ? errs.slice(0, 6).join("\n") : "no page errors");
await browser.close();
