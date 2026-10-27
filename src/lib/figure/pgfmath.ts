import { compileExpr } from "./expr";

/**
 * pgfmath -> our JS expression dialect.
 *
 * Differences that used to make plots silently disappear:
 *  - pgfmath writes powers as x^2 (same as us) but the exponential as exp(x), never e^x
 *  - trig in pgfmath is DEGREES by default; a trailing "r" on the argument means radians
 *  - commands are written \\sin(...) etc.
 *
 * We translate both degree and radian forms into correct radians math, so a
 * hand-written \\draw plot (\\x, {sin(\\x r)}) and a model's
 * plot (\\x, {sin(\\x)}) both end up as the right curve.
 */
export interface ConvertedExpr {
  expr: string;
  ok: boolean;
  reason?: string;
}

const FN_WITH_ESCAPE = /\\(sin|cos|tan|cot|sec|csc|asin|acos|atan|ln|log|exp|sqrt|abs|min|max|floor|ceil|round|sign)\b/g;

function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Rewrite every trig call so the argument ends up in radians. */
function normaliseTrig(s: string): { out: string; ok: boolean } {
  const re = /\b(sin|cos|tan|cot|sec|csc)\s*\(/g;
  let out = "";
  let i = 0;
  let ok = true;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, m.index);
    const open = m.index + m[0].length - 1;
    const close = matchParen(s, open);
    if (close < 0) {
      ok = false;
      out += s.slice(m.index);
      break;
    }
    const inner = normaliseTrig(s.slice(open + 1, close));
    if (!inner.ok) ok = false;
    const isRadian = /\br\s*$/.test(inner.out);
    const arg = isRadian ? inner.out.replace(/\br\s*$/, "").trim() : `(${inner.out})*pi/180`;
    out += `${m[1]}(${arg})`;
    i = close + 1;
  }
  return { out, ok };
}

export function pgfmathToJs(raw: string): ConvertedExpr {
  let s = (raw || "").trim();
  if (!s) return { expr: "", ok: false, reason: "空表达式" };
  s = s.replace(/\\x\b/g, "x").replace(/\\/g, "");
  s = s.replace(FN_WITH_ESCAPE, "$1");

  if (/(^|[^a-z])e\s*\^/i.test(s)) {
    return { expr: s, ok: false, reason: "pgfmath 没有 e^，请写成 exp(...)" };
  }

  const trig = normaliseTrig(s);
  const expr = trig.out.replace(/\s+/g, "");
  if (!trig.ok) return { expr, ok: false, reason: "三角函数括号不匹配" };

  const compiled = compileExpr(expr);
  return compiled.ok ? { expr, ok: true } : { expr, ok: false, reason: compiled.error };
}

const PGF_FUNCS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "asin", "acos", "atan",
  "exp", "ln", "log", "sqrt", "abs", "min", "max", "floor", "ceil", "round", "sign", "pow",
]);

function addRadianSuffix(s: string): { out: string; ok: boolean } {
  const re = /\b(sin|cos|tan|cot|sec|csc)\s*\(/g;
  let out = "";
  let i = 0;
  let ok = true;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, m.index);
    const open = m.index + m[0].length - 1;
    const close = matchParen(s, open);
    if (close < 0) {
      ok = false;
      out += s.slice(m.index);
      break;
    }
    const inner = addRadianSuffix(s.slice(open + 1, close));
    if (!inner.ok) ok = false;
    out += `${m[1]}(${inner.out} r)`;
    i = close + 1;
  }
  return { out, ok };
}

/**
 * Inverse of pgfmathToJs: turn our JS expression back into pgfmath so the
 * document can use `plot[domain=a:b]` and let TeX do the sampling at full
 * precision — no quantised coordinates, much shorter source.
 */
export function jsToPgfmath(expr: string): { ok: boolean; pgf?: string; reason?: string } {
  const s = (expr || "").trim();
  if (!s) return { ok: false, reason: "空表达式" };
  const ids = s.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  for (const id of ids) {
    if (id === "x" || id === "pi" || id === "e" || id === "tau") continue;
    if (!PGF_FUNCS.has(id)) return { ok: false, reason: "不支持的函数 " + id };
  }
  const { out, ok } = addRadianSuffix(s);
  if (!ok) return { ok: false, reason: "括号不匹配" };
  return { ok: true, pgf: out.replace(/\bx\b/g, "\\x") };
}
