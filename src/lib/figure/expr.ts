/**
 * Tiny, dependency-free math expression evaluator used by the plot tool.
 * Deliberately not `eval`: the expression comes from user input and ends up
 * in a compiled LaTeX document, so it is tokenised and interpreted here.
 */

type Node =
  | { t: "num"; v: number }
  | { t: "x" }
  | { t: "neg"; a: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: (x) => Math.log10(x),
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  // pgfmath conversions — models write these constantly, so support them
  // rather than rejecting the curve.
  deg: (x) => (x * 180) / Math.PI,
  rad: (x) => (x * Math.PI) / 180,
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

const ARITY: Record<string, number> = { min: 2, max: 2, pow: 2, atan2: 2 };

export interface CompiledExpr {
  ok: boolean;
  error?: string;
  fn: (x: number) => number;
  source: string;
}

type Tok =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "("; v: "(" }
  | { k: ")"; v: ")" }
  | { k: ","; v: "," };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new Error(`无法识别的数字：${src.slice(i, i + 6)}`);
      out.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ k: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ k: "(", v: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ k: ")", v: ")" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ k: ",", v: "," });
      i++;
      continue;
    }
    throw new Error(`表达式包含不支持的字符「${c}」`);
  }
  return out;
}

function parse(tokens: Tok[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (k: string, v?: string) => {
    const t = tokens[pos];
    if (!t || t.k !== k || (v !== undefined && (t as any).v !== v)) return null;
    pos++;
    return t;
  };

  function parseExpr(): Node {
    let a = parseTerm();
    for (;;) {
      const t = peek();
      if (t && t.k === "op" && (t.v === "+" || t.v === "-")) {
        pos++;
        a = { t: "bin", op: t.v as "+" | "-", a, b: parseTerm() };
      } else break;
    }
    return a;
  }

  function parseTerm(): Node {
    let a = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.k === "op" && (t.v === "*" || t.v === "/")) {
        pos++;
        a = { t: "bin", op: t.v as "*" | "/", a, b: parseUnary() };
      } else break;
    }
    return a;
  }

  function parseUnary(): Node {
    const t = peek();
    if (t && t.k === "op" && t.v === "-") {
      pos++;
      return { t: "neg", a: parseUnary() };
    }
    if (t && t.k === "op" && t.v === "+") {
      pos++;
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower(): Node {
    const base = parseAtom();
    const t = peek();
    if (t && t.k === "op" && t.v === "^") {
      pos++;
      return { t: "bin", op: "^", a: base, b: parseUnary() };
    }
    return base;
  }

  function parseAtom(): Node {
    const t = peek();
    if (!t) throw new Error("表达式不完整");
    if (t.k === "num") {
      pos++;
      return { t: "num", v: t.v };
    }
    if (t.k === "(") {
      pos++;
      const inner = parseExpr();
      if (!eat(")")) throw new Error("缺少右括号");
      return inner;
    }
    if (t.k === "id") {
      pos++;
      const name = t.v.toLowerCase();
      if (name === "x") return { t: "x" };
      if (name in CONSTS) return { t: "num", v: CONSTS[name] };
      if (name in FUNCS) {
        if (!eat("(")) throw new Error(`函数 ${name} 缺少括号`);
        const args: Node[] = [parseExpr()];
        while (eat(",")) args.push(parseExpr());
        if (!eat(")")) throw new Error("缺少右括号");
        const arity = ARITY[name] ?? 1;
        if (args.length !== arity) throw new Error(`函数 ${name} 需要 ${arity} 个参数`);
        return { t: "call", name, args };
      }
      throw new Error(`未知函数或变量「${t.v}」`);
    }
    throw new Error(`表达式在「${t.v}」处无法解析`);
  }

  const ast = parseExpr();
  if (pos < tokens.length) throw new Error(`表达式末尾有多余内容「${(tokens[pos] as any).v}」`);
  return ast;
}

function evaluate(n: Node, x: number): number {
  switch (n.t) {
    case "num":
      return n.v;
    case "x":
      return x;
    case "neg":
      return -evaluate(n.a, x);
    case "bin": {
      const a = evaluate(n.a, x);
      const b = evaluate(n.b, x);
      switch (n.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return Math.pow(a, b);
      }
      break;
    }
    case "call": {
      const args = n.args.map((arg) => evaluate(arg, x));
      return FUNCS[n.name](...args);
    }
  }
  return NaN;
}

export function compileExpr(source: string): CompiledExpr {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "表达式为空", fn: () => NaN, source };
  try {
    const ast = parse(tokenize(trimmed));
    return {
      ok: true,
      fn: (x: number) => {
        try {
          const v = evaluate(ast, x);
          return Number.isFinite(v) ? v : NaN;
        } catch {
          return NaN;
        }
      },
      source,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || "表达式无效", fn: () => NaN, source };
  }
}

/** Sample a compiled expression into break-free polyline runs. */
export function samplePlot(fn: (x: number) => number, xMin: number, xMax: number, samples: number) {
  const n = Math.max(2, Math.min(2000, Math.round(samples)));
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let prevY = NaN;
  const clamp = 1e4;
  for (let i = 0; i <= n; i++) {
    const x = xMin + ((xMax - xMin) * i) / n;
    let y = fn(x);
    if (!Number.isFinite(y) || Math.abs(y) > clamp) {
      if (current.length > 1) runs.push(current);
      current = [];
      prevY = NaN;
      continue;
    }
    // Keep asymptotes from connecting across the whole canvas.
    if (Number.isFinite(prevY) && Math.abs(y - prevY) > 40) {
      if (current.length > 1) runs.push(current);
      current = [];
    }
    current.push({ x, y });
    prevY = y;
  }
  if (current.length > 1) runs.push(current);
  return runs;
}
