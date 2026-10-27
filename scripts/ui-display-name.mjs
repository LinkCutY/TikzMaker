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

// user pastes the DISPLAY NAME from DeepSeek's picker
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "DeepSeek-V4.1-Flash 1017", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await wait(600);

// pull /models so display names are known
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".drawer button")].find((x) => x.textContent.includes("更换服务"));
  b?.click();
});
await wait(400);
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((x) => x.textContent.includes("保存并测试"))?.click());
await wait(1500);

const bar = await page.evaluate(() => {
  const input = document.querySelector(".connect-bar input.input--bare");
  const hint = [...document.querySelectorAll(".connect-bar .hint")].map((h) => h.textContent.trim()).join(" / ");
  return { value: input?.value, hint };
});
console.log("typed display name:", bar.value);
console.log("resolved hint:", bar.hint);

await page.type(".drawer textarea", "画一个 sin(e^x) 的图像");
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误");
}, { timeout: 120000 }).catch(() => errs.push("no result"));
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("model field now:", await page.evaluate(() => document.querySelector(".connect-bar input.input--bare")?.value));
await page.screenshot({ path: ".shots/99-display-name.png" });
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
