import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

/*
 * Side-by-side screenshot of two PNGs (same height), for visual verification.
 * Usage: node scripts/shot-compare.mjs out.png height "labelA:pathA" "labelB:pathB" ...
 */
const out = process.argv[2] || ".shots/compare.png";
const height = Number(process.argv[3] || 336);
const panels = process.argv.slice(4).map(function (arg) {
  const at = arg.indexOf(":");
  return { label: arg.slice(0, at), file: resolve(arg.slice(at + 1)) };
});
if (panels.length < 2) throw new Error("need at least two label:path arguments");

await mkdir(".probe-tests", { recursive: true });
const html =
  '<html><body style="margin:0;background:#fff;font:12px system-ui,sans-serif;display:flex;gap:14px;padding:8px;align-items:flex-start">' +
  panels
    .map(function (p) {
      return '<div><div style="color:#555;padding-bottom:4px">' + p.label + '</div>' +
        '<img src="file:///' + p.file.replace(/\\/g, "/") + '" height="' + height + '" style="border:1px solid #ddd"></div>';
    })
    .join("") +
  "</body></html>";
const htmlPath = resolve(".probe-tests/compare.html");
await writeFile(htmlPath, html, "utf8");

const browser = await puppeteer.launch({
  executablePath: process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--no-sandbox", "--allow-file-access-from-files", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: height + 60 });
await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle2" });
const box = await page.evaluate(function () {
  const images = [...document.querySelectorAll("img")];
  const width = images.reduce(function (n, img) { return n + img.getBoundingClientRect().width; }, 0) + 14 * images.length + 24;
  return { width: Math.ceil(width), height: document.body.scrollHeight };
});
await page.setViewport({ width: Math.min(2400, box.width), height: box.height });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("wrote " + out);
