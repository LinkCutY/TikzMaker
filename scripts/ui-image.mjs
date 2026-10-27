import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
let sent = "";
page.on("request", (r) => {
  if (r.url().includes("/api/ai/text2tikz")) {
    try {
      const b = JSON.parse(r.postData() || "{}");
      if (b.image) sent = `mode=${b.mode} image≈${Math.round(b.image.length / 1365)}KB`;
    } catch {}
  }
});

await page.goto("http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(1500);
await page.evaluate(() => {
  const raw = localStorage.getItem("tikz-studio:v1");
  const st = raw ? JSON.parse(raw) : { state: {}, version: 1 };
  st.state.settings = { ...(st.state.settings || {}), provider: "custom", apiBaseUrl: "http://127.0.0.1:8899/v1", apiKey: "mock-key", apiModel: "deepseek-flash", engine: "xelatex" };
  localStorage.setItem("tikz-studio:v1", JSON.stringify(st));
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(2200);

await page.evaluate(() => [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("文生 TikZ"))?.click());
await page.waitForSelector(".drawer textarea", { timeout: 20000 });
await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("图片识别"))?.click());
await wait(400);

// real paper screenshot through the hidden file input
const input = await page.$('.drawer input[type="file"]');
await input.uploadFile("D:\\FDU_AIagentDevelop\\.shots\\paper-figure.png");
await wait(1500);
console.log("thumb:", await page.evaluate(() => Boolean(document.querySelector(".drawer .thumb"))));
console.log("caption:", await page.evaluate(() => document.querySelector(".drawer .crop-wrap")?.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 90)));

// drag-crop a single panel (left third of the figure)
const box = await page.evaluate(() => {
  const el = document.querySelector(".drawer .crop-wrap");
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(box.x + box.w * 0.02, box.y + box.h * 0.05);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.34, box.y + box.h * 0.95, { steps: 10 });
await page.mouse.up();
await wait(1200);
console.log("after crop:", await page.evaluate(() => document.querySelector(".drawer .crop-wrap")?.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 110)));
await page.screenshot({ path: ".shots/k-image-crop.png" });

await page.evaluate(() => [...document.querySelectorAll(".drawer button")].find((b) => b.textContent.includes("生成并校验"))?.click());
await page.waitForFunction(() => {
  const t = document.querySelector(".card .pill")?.textContent || "";
  return t.includes("编译通过") || t.includes("仍有编译错误") || t.includes("时间上限");
}, { timeout: 120000 }).catch(() => errs.push("no result"));
await wait(700);
console.log("request:", sent || "(no image sent)");
console.log("verdict:", await page.evaluate(() => document.querySelector(".card .pill")?.textContent?.trim()));
console.log("editable:", await page.evaluate(() => [...document.querySelectorAll(".card .hint")].map((h) => h.textContent.replace(/\s+/g, " ").trim()).find((t) => t.includes("可编辑元素")) || "none"));
await page.screenshot({ path: ".shots/k-image.png" });
console.log(errs.length ? errs.slice(0, 4).join(" | ") : "no page errors");
await browser.close();
