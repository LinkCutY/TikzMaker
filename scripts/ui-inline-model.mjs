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
await wait(2200);

await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = {
    ...(st.state.settings || {}),
    provider: "custom",
    apiBaseUrl: "http://127.0.0.1:8899/v1",
    apiKey: "mock-key",
    apiModel: "deepseek-V4.1-flash",
    engine: "xelatex",
  };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await wait(600);

// the bar should expose an editable model field
const bar = await page.evaluate(() => {
  const input = document.querySelector(".connect-bar input.input--bare");
  return { exists: Boolean(input), value: input?.value, list: input?.getAttribute("list") };
});
console.log("inline model input:", JSON.stringify(bar));

// type the wrong id -> generate -> error -> one-click fix from inside the bar
await page.type(".drawer textarea", "画一个 sin(e^x)");
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => Boolean(document.querySelector(".drawer .notice")), { timeout: 60000 }).catch(() => errs.push("no notice"));
await wait(500);
console.log("suggestions:", await page.evaluate(() => [...document.querySelectorAll(".drawer .notice button")].map((b) => b.textContent.trim()).join(" | ")));
await page.screenshot({ path: ".shots/96-inline-model-error.png" });

await page.evaluate(() => [...document.querySelectorAll(".drawer .notice button")].find((b) => b.textContent.trim() === "deepseek-flash")?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 90000 }).catch(() => errs.push("no result"));
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("bar now:", await page.evaluate(() => document.querySelector(".connect-bar input.input--bare")?.value));
await page.screenshot({ path: ".shots/97-inline-model-fixed.png" });
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
