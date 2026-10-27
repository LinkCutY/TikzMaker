import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const ENGINES = [
  { name: "xelatex", label: "XeLaTeX", hint: "UTF-8 / 中文" },
  { name: "pdflatex", label: "pdfLaTeX", hint: "最快" },
  { name: "lualatex", label: "LuaLaTeX", hint: "现代字体" },
];

const cache = new Map();
const CACHE_MAX = 24;

function cacheKey(engine, source) {
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (Math.imul(31, h) + source.charCodeAt(i)) | 0;
  return engine + ":" + source.length + ":" + h;
}

export function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        windowsHide: true,
        env: { ...process.env, ...(opts.env || {}) },
      });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err), durationMs: 0, timedOut: false });
      return;
    }
    const limit = 400_000;
    child.stdout.on("data", (d) => {
      if (stdout.length < limit) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < limit) stderr += d.toString();
    });
    let timedOut = false;
    const abort = () => { try { child.kill(); } catch {} };
    opts.signal?.addEventListener("abort", abort, { once: true });
    if (opts.signal?.aborted) abort();
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {}
    }, opts.timeoutMs ?? 60_000);
    const done = (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started, timedOut });
    };
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      resolve({ code: -1, stdout, stderr: stderr + "\n" + String(err), durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => done(code ?? -1));
  });
}

export async function detectEngines() {
  const out = [];
  for (const engine of ENGINES) {
    const r = await run(engine.name, ["--version"], { timeoutMs: 15_000 });
    const first = (r.stdout.split("\n")[0] || "").trim();
    out.push({ ...engine, available: r.code === 0, version: first.slice(0, 80) });
  }
  return out;
}

export function parseLatexLog(log, engine) {
  const errors = [];
  const warnings = [];
  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fileLine = line.match(/^(.+?\.(?:tex|sty|cls)):(\d+): (.+)$/);
    if (fileLine) {
      const message = fileLine[3].trim();
      if (/warning/i.test(message)) {
        warnings.push({ line: Number(fileLine[2]), message, file: fileLine[1] });
      } else {
        errors.push({ line: Number(fileLine[2]), message, file: fileLine[1] });
      }
      continue;
    }
    if (line.startsWith("! ")) {
      const message = line.slice(2).trim();
      let lineNo = null;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const l = lines[j].match(/^l\.(\d+)/);
        if (l) {
          lineNo = Number(l[1]);
          break;
        }
      }
      errors.push({ line: lineNo, message, file: null });
      continue;
    }
    if (/^(LaTeX|Package \w+|Class \w+) Warning:/.test(line)) {
      const text = line.trim();
      // Noise produced by our own -no-shell-escape hardening, not by the user's figure.
      if (/shell\s*escape|shellesc/i.test(text)) continue;
      if (/Font shape .* undefined/i.test(text)) continue;
      warnings.push({ line: null, message: text, file: null });
    }
  }
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter((e) => {
      const k = e.line + "|" + e.message;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return { errors: dedup(errors).slice(0, 40), warnings: dedup(warnings).slice(0, 40) };
}

export const PREAMBLE = [
  "\\documentclass[tikz,border=8pt]{standalone}",
  "\\usepackage{ctex}",
  "\\usepackage{amsmath,amssymb}",
  // A superset of what models reach for: an "Unknown library" error costs a whole
  // regeneration round, and these are all cheap to load.
  // shapes.symbols carries the flowchart shapes models reach for (cloud, starburst,
  // signal, tape). Without it "\\node[cloud]" is a fatal 'I do not know the key'.
  "\\usetikzlibrary{arrows.meta,positioning,calc,shapes.geometric,shapes.symbols,decorations.pathreplacing,decorations.markings,patterns,plotmarks,shadows,intersections}",
  "",
  "\\begin{document}",
];

/**
 * Users often paste just a tikzpicture (or a bare list of \draw commands).
 * Wrap those so the editor never dies on a missing document skeleton.
 */
export function wrapSource(source) {
  if (/\\documentclass/.test(source)) return { tex: source, offset: 0, wrapped: false };
  const tex = [...PREAMBLE, source, "\\end{document}", ""].join("\n");
  return { tex, offset: PREAMBLE.length, wrapped: true };
}

export function mapErrorsToSource(errors, offset) {
  if (!offset) return errors;
  return errors.map((e) => ({
    ...e,
    line: e.line && e.line > offset ? e.line - offset : null,
  }));
}

export async function compileToPdf(source, { engine = "xelatex", timeoutMs = 45_000, signal } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "tikz-studio-"));
  const texPath = path.join(dir, "main.tex");
  await writeFile(texPath, source, "utf8");
  const args = [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    "-no-shell-escape",
    "main.tex",
  ];
  const r = await run(engine, args, { cwd: dir, timeoutMs, signal });
  const log = (r.stdout || "") + (r.stderr ? "\n" + r.stderr : "");
  const pdfPath = path.join(dir, "main.pdf");
  let pdfOk = false;
  try {
    const st = await stat(pdfPath);
    pdfOk = st.size > 0;
  } catch {}

  const parsed = parseLatexLog(log, engine);
  const ok = r.code === 0 && pdfOk && !r.timedOut;
  return {
    ok,
    dir,
    pdfPath: pdfOk ? pdfPath : null,
    log,
    errors: parsed.errors,
    warnings: parsed.warnings,
    durationMs: r.durationMs,
    timedOut: r.timedOut,
    exitCode: r.code,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}

export async function readLogTail(dir, max = 20_000) {
  try {
    const log = await readFile(path.join(dir, "main.log"), "utf8");
    return log.length > max ? log.slice(-max) : log;
  } catch {
    return "";
  }
}
