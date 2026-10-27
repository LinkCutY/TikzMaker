/**
 * Real TeX metrics for labels: the layout must use the width TeX will typeset,
 * not a character-count guess.
 */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const PT2CM = 2.54 / 72.27;
const cache = new Map();

const keyOf = (entry) => String(entry.sizeCm || 0.62) + "|" + String(entry.tex || "");

function boxFor(entry, index) {
  const raw = String(entry.tex || "").trim();
  const size = Number(entry.sizeCm) || 0.62;
  const body = entry.mode === "text" ? raw : "$" + raw.replace(/^\$|\$$/g, "") + "$";
  // sizeCm is a FONT SIZE in cm: convert to pt for \fontsize.
  const pt = size * 28.4527;
  const decl = "\\fontsize{" + pt.toFixed(3) + "}{" + (pt * 1.2).toFixed(3) + "}\\selectfont";
  return decl + "\\setbox0=\\hbox{" + body + "}\\typeout{TIKZMETRIC:" + index + ":\\the\\wd0:\\the\\ht0:\\the\\dp0}";
}

/**
 * Measure a list of {tex, mode, sizeCm} in ONE TeX run. Returns cm per entry.
 */
export async function measureTexts(entries, options) {
  const opts = options || {};
  const list = entries || [];
  const missing = list.filter((e) => !cache.has(keyOf(e)));
  if (missing.length) {
    const dir = await mkdtemp(path.join(tmpdir(), "tikz-metrics-"));
    try {
      const lines = missing.map((e, i) => boxFor(e, i)).join("\n");
      const doc = [
        "\\documentclass[border=0pt]{standalone}",
        "\\usepackage{amsmath,amssymb}",
        "\\begin{document}",
        lines,
        "\\null",
        "\\end{document}",
        "",
      ].join("\n");
      await writeFile(path.join(dir, "main.tex"), doc, "utf8");
      await run(opts.engine || "xelatex", ["-interaction=nonstopmode", "-no-shell-escape", "main.tex"], {
        cwd: dir,
        timeout: opts.timeoutMs || 30_000,
        windowsHide: true,
      });
      const log = await readFile(path.join(dir, "main.log"), "utf8");
      for (const m of log.matchAll(/TIKZMETRIC:(\d+):([\d.]+)pt:([\d.]+)pt:([\d.]+)pt/g)) {
        const entry = missing[Number(m[1])];
        if (!entry) continue;
        cache.set(keyOf(entry), {
          w: Number(m[2]) * PT2CM,
          h: Number(m[3]) * PT2CM,
          d: Number(m[4]) * PT2CM,
        });
      }
    } catch {
      // Measurement is an optimisation: on failure the caller falls back to the
      // estimator, but it must never break the build.
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return list.map((e) => cache.get(keyOf(e)) || null);
}
