import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8788";
const dir = ".shots";
mkdirSync(dir, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1040, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => {
  if (m.type() === "error") logs.push("console.error: " + m.text());
});
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log("shot:", name);
};
const clickTitle = async (title) => {
  const ok = await page.evaluate((t) => {
    const el = document.querySelector(`[title="${t}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, title);
  if (!ok) logs.push("missing selector title=" + title);
  await wait(350);
};

await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });
await page.waitForSelector("img.page", { timeout: 90_000 }).catch(() => logs.push("no preview image"));
await wait(800);
await shot("01-main");

await clickTitle("切换主题");
await shot("02-light");
await clickTitle("切换主题");

await clickTitle("模板库");
await shot("03-templates");
await page.keyboard.press("Escape");
await wait(250);

await clickTitle("AI 生成（文生图 / 识图）");
await shot("04-ai");
// switch to image tab
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".seg button")].find((x) => x.textContent.includes("图片识别"));
  b?.click();
});
await wait(300);
await shot("05-ai-image");
await page.keyboard.press("Escape");
await wait(250);

await clickTitle("设置");
await shot("06-settings");
await page.keyboard.press("Escape");
await wait(250);

const exportOk = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("导出"));
  if (!btn) return false;
  btn.click();
  return true;
});
await wait(350);
if (exportOk) await shot("07-export");

// force a compile error
await page.click(".cm-content");
await page.keyboard.down("Control");
await page.keyboard.press("KeyA");
await page.keyboard.up("Control");
await page.keyboard.type("\\documentclass{standalone}\n\\begin{document}\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,1)\n\\badcommandhere\n\\end{tikzpicture}\n\\end{document}");
await wait(6000);
await shot("08-error");

// fragment mode: a bare tikzpicture without \documentclass
await page.click(".cm-content");
await page.keyboard.down("Control");
await page.keyboard.press("KeyA");
await page.keyboard.up("Control");
await page.keyboard.type("\\begin{tikzpicture}\n\\node[draw, rounded corners, fill=blue!12, minimum width=4cm, minimum height=1.4cm] at (0,0) {片段模式：自动补全导言区};\n\\end{tikzpicture}");
await wait(6500);
await shot("09-fragment");

console.log(logs.length ? logs.slice(0, 20).join("\n") : "no console errors");
await browser.close();
