import { readFile } from "node:fs/promises";
import path from "node:path";
import { run } from "./latex.mjs";

/** Prefer PyMuPDF; Poppler keeps preview/export usable without Python on PATH. */
export async function renderPreview(pdfPath, dir, { dpi = 192, wantPng = false, signal } = {}) {
  const svgPath = path.join(dir, "preview.svg"), pngPath = path.join(dir, "preview.png");
  const python = process.env.TIKZ_PYTHON || "python";
  const args = [path.resolve("server/python/render.py"), "--pdf", pdfPath, "--svg", svgPath, "--dpi", String(dpi)];
  if (wantPng) args.push("--png", pngPath);
  const py = await run(python, args, { timeoutMs: 20_000, signal });
  if (py.code === 0) {
    const meta = JSON.parse(py.stdout.trim().split("\n").at(-1));
    return { ...meta, svg: await readFile(svgPath, "utf8"), pngPath: wantPng ? pngPath : null, pngAvailable: wantPng };
  }
  const vector = await run("pdftocairo", ["-svg", "-f", "1", "-l", "1", pdfPath, svgPath], { timeoutMs: 20_000, signal });
  if (vector.code !== 0) throw new Error("无法渲染 PDF，请安装 PyMuPDF 或 Poppler。");
  const svg = await readFile(svgPath, "utf8");
  const width = Number(/<svg[^>]*\bwidth="([\d.]+)/.exec(svg)?.[1] || 0);
  const height = Number(/<svg[^>]*\bheight="([\d.]+)/.exec(svg)?.[1] || 0);
  if (wantPng) {
    const png = await run("pdftoppm", ["-png", "-singlefile", "-r", String(dpi), pdfPath, path.join(dir, "preview")], { timeoutMs: 20_000, signal });
    if (png.code !== 0) throw new Error("PNG 渲染失败");
  }
  return { svg, width, height, pages: 1, pngPath: wantPng ? pngPath : null, pngAvailable: wantPng };
}
