import puppeteer from "puppeteer-core";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(process.argv[2] || "http://127.0.0.1:5188", { waitUntil: "networkidle2", timeout: 90000 });
await page.waitForSelector(".canvas-svg", { timeout: 60000 });
await wait(4200);

// select the axes layer
await page.evaluate(() => [...document.querySelectorAll(".layer")].find((l) => l.textContent.includes("坐标轴"))?.click());
await wait(400);

const fieldInput = async (label) =>
  page.evaluateHandle((lab) => {
    const field = [...document.querySelectorAll(".inspector .field")].find((f) => f.textContent.includes(lab));
    return field?.querySelector("input") ?? null;
  }, label);

// type "-10" into x 起点
const input = await fieldInput("x 起点");
const handle = input.asElement();
if (!handle) {
  console.log("FAIL: no x 起点 input");
} else {
  await handle.click({ clickCount: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("-10");
  await wait(600);
  console.log("draft value while typing:", await page.evaluate((el) => el.value, handle));
  await page.keyboard.press("Tab");
  await wait(1500);
  console.log("committed value:", await page.evaluate((el) => el.value, handle));
}

const src = await page.evaluate(() => document.querySelector(".cm-content")?.textContent || "");
console.log("has (-10,0):", src.includes("(-10,0)"), "| tick list:", (src.match(/\\foreach \\t in \{([^}]*)\}/) || [])[1]);
await page.screenshot({ path: ".shots/50-negative-axes.png" });

// also check the delay field no longer clamps while typing
await page.click('[title="设置"]');
await wait(500);
const delay = await page.evaluateHandle(() => {
  const f = [...document.querySelectorAll(".drawer .field")].find((x) => x.textContent.includes("防抖延迟"));
  return f?.querySelector("input") ?? null;
});
const dEl = delay.asElement();
if (dEl) {
  await dEl.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("1500");
  await wait(300);
  console.log("delay draft:", await page.evaluate((el) => el.value, dEl));
  await page.keyboard.press("Tab");
  await wait(300);
  console.log("delay committed:", await page.evaluate((el) => el.value, dEl));
}
console.log(errs.length ? errs.slice(0, 6).join("\n") : "no page errors");
await browser.close();
