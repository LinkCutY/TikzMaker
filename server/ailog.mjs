/**
 * Generation log: every model reply is written to disk so a bad panel can be
 * inspected afterwards ("what did it actually write for panel 1?").
 * Plain files, no database: logs/ai/<id>.tex + logs/ai/index.jsonl
 */
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(process.cwd(), "logs", "ai");
const INDEX = join(DIR, "index.jsonl");
const enabled = process.env.AI_LOG !== "0";

let ready = null;
const ensure = () =>
  (ready ??= mkdir(DIR, { recursive: true }).catch(() => {
    /* logging must never break generation */
  }));

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let counter = 0;

/** Record one generated document plus how it fared. Returns the log id. */
export async function logAttempt(entry) {
  if (!enabled) return null;
  await ensure();
  const id = `${stamp()}-${String(++counter).padStart(2, "0")}`;
  const code = String(entry.code || "");
  try {
    await writeFile(join(DIR, id + ".tex"), code, "utf8");
    const meta = {
      id,
      at: new Date().toISOString(),
      mode: entry.mode ?? "text",
      perPanel: Boolean(entry.perPanel),
      panelIndex: entry.panelIndex ?? null,
      attempt: entry.attempt ?? 1,
      model: entry.model ?? "",
      chars: code.length,
      lines: code.split("\n").length,
      truncated: Boolean(entry.truncated),
      finishReason: entry.finishReason ?? null,
      compiled: entry.compile?.ok ?? null,
      compileErrors: (entry.compile?.errors || []).slice(0, 5).map((e) => (e.line ? `line ${e.line}: ` : "") + e.message),
      lintBlockers: (entry.lint?.issues || []).filter((i) => i.severity === "blocker").map((i) => i.message),
      durationMs: entry.durationMs ?? null,
    };
    await appendFile(INDEX, JSON.stringify(meta) + "\n", "utf8");
    return id;
  } catch {
    return null;
  }
}

export function logDir() {
  return DIR;
}

/** Newest first. */
export async function listLogs(limit = 20) {
  await ensure();
  let text = "";
  try {
    text = await readFile(INDEX, "utf8");
  } catch {
    return [];
  }
  const rows = text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return rows.slice(-limit).reverse();
}

export async function readLog(id) {
  if (!/^[\w.-]+$/.test(String(id))) throw new Error("bad id");
  await ensure();
  return readFile(join(DIR, id + ".tex"), "utf8");
}
