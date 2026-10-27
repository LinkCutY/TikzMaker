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
await wait(2500);

// reproduce the user's state: wrong model id (capital V), mock endpoint
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = {
    ...(st.state.settings || {}),
    provider: "custom",
    apiBaseUrl: "http://127.0.0.1:8899/v1",
    apiKey: "mock-key",
    apiModel: "deepseek-V4-flash",
    engine: "xelatex",
  };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2500);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await wait(600);
await page.type(".drawer textarea", "画一个 sin(exp(x)) 的图像");
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => Boolean(document.querySelector(".notice")), { timeout: 60000 }).catch(() => errs.push("no error notice"));
await wait(600);

const info = await page.evaluate(() => {
  const notice = [...document.querySelectorAll(".drawer .notice")].map((n) => n.textContent.replace(/\s+/g, " ").trim()).join(" | ");
  const chips = [...document.querySelectorAll(".drawer .notice button")].map((b) => b.textContent.trim());
  return { notice: notice.slice(0, 160), chips };
});
console.log("notice:", info.notice);
console.log("suggested buttons:", info.chips.join(" | "));
await page.screenshot({ path: ".shots/93-bad-model.png" });

// learned ids should now live in the datalist (and survive reload)
const learned = await page.evaluate(() => [...document.querySelectorAll("datalist#ai-model-options option")].map((o) => o.value));
console.log("datalist after error:", learned.join(" | "));

// click the suggested model -> should re-run and succeed
if (info.chips.length) {
  await page.evaluate((m) => [...document.querySelectorAll(".drawer .notice button")].find((b) => b.textContent.trim() === m)?.click(), info.chips[0]);
  await page.waitForFunction(() => {
    const t = document.querySelector(".card .pill")?.textContent || "";
    return t.includes("编译通过") || t.includes("仍有编译错误");
  }, { timeout: 90000 }).catch(() => errs.push("no result after fix"));
  console.log("after clicking suggestion:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
  console.log("model now:", await page.evaluate(() => document.querySelector(".connect-bar")?.textContent?.replace(/\s+/g, " ").trim()));
  await page.screenshot({ path: ".shots/94-bad-model-fixed.png" });
}
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2000);
await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await wait(600);
const persisted = await page.evaluate(() => ({
  list: [...document.querySelectorAll("datalist#ai-model-options option")].map((o) => o.value),
  stored: JSON.parse(localStorage.getItem("tikz-studio:v1") || "{}")?.state?.learnedModels || null,
}));
console.log("after reload datalist:", persisted.list.join(" | "));
console.log("persisted learnedModels:", JSON.stringify(persisted.stored));
console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
await browser.close();
