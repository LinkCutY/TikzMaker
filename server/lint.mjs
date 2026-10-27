/**
 * Static checks on generated TikZ. The reviewer agent gets these findings
 * instead of having to guess, and the generator gets them back as feedback.
 */
const FORBIDDEN = [
  { re: /\\foreach\b/, code: "SUBSET_VIOLATION", msg: "用了 \\foreach，画布无法解析", fix: "把循环展开成逐条图元" },
  { re: /\\path\b/, code: "SUBSET_VIOLATION", msg: "用了 \\path", fix: "改用 \\draw" },
  { re: /\\clip\b/, code: "SUBSET_VIOLATION", msg: "用了 \\clip", fix: "去掉裁剪，直接算好坐标" },
  { re: /\\matrix\b/, code: "SUBSET_VIOLATION", msg: "用了 \\matrix", fix: "改用逐个 \\node 摆放" },
  { re: /\\begin\{scope\}/, code: "SUBSET_VIOLATION", msg: "用了 scope 分组", fix: "去掉分组，样式写进每个图元" },
  { re: /decoration[s]?=/i, code: "SUBSET_VIOLATION", msg: "用了 decorations", fix: "改为普通线条" },
  { re: /pattern[s]?=/i, code: "SUBSET_VIOLATION", msg: "用了 patterns", fix: "改为纯色填充" },
  { re: /\\(def|newcommand|tikzset)\b/, code: "SUBSET_VIOLATION", msg: "自定义宏/样式", fix: "把样式展开写在每个图元里" },
];

function linesOf(code) {
  return code.split(/\r?\n/);
}

/** LaTeX commands that are fine outside maths mode. */
const TEXT_MODE_CMDS = new Set([
  "small", "footnotesize", "scriptsize", "tiny", "normalsize", "large", "Large", "LARGE", "huge", "Huge",
  "bfseries", "mdseries", "itshape", "slshape", "upshape", "scshape", "ttfamily", "rmfamily", "sffamily",
  "em", "textbf", "textit", "texttt", "textrm", "textsf", "textsc", "textsl", "textup", "text",
  "underline", "newline", "linebreak", "centering", "raggedright", "qquad", "quad", "par", "mbox",
]);

export function lintTikz(code, options = {}) {
  const issues = [];
  const request = String(options.request || "");
  const lines = linesOf(code || "");
  const add = (codeName, severity, lineNo, message, fix) =>
    issues.push({ code: codeName, severity, where: lineNo ? "line " + lineNo : null, message, fix });

  if (!/\\documentclass/.test(code)) add("NO_DOCUMENT", "blocker", null, "缺少 \\documentclass", "补齐 standalone 文档骨架");
  if (!/\\end\{document\}/.test(code)) add("NO_DOCUMENT", "blocker", null, "缺少 \\end{document}", "补齐文档尾部");
  if (!/\\begin\{tikzpicture\}/.test(code)) add("NO_TIKZPICTURE", "blocker", null, "没有 tikzpicture 环境", "把图形放进 \\begin{tikzpicture}…\\end{tikzpicture}");

  // Blocker, not major: these constructs are exactly what the canvas cannot
  // represent, and several of them (clip[even odd rule], custom 	ikzset keys)
  // also break the compile. Catching them before compiling saves a whole round.
  for (const f of FORBIDDEN) {
    lines.forEach((line, i) => {
      if (f.re.test(line)) add(f.code, "blocker", i + 1, f.msg, f.fix);
    });
  }

  const drawOrNode = (code.match(/\\(draw|node|filldraw|fill|addplot)\b/g) || []).length;
  if (drawOrNode === 0) add("EMPTY_FIGURE", "blocker", null, "除坐标轴外没有任何图元", "至少生成一条曲线或一个文本");

  // "plot" is an option of \draw (no backslash of its own), "addplot" has one.
  const hasPlot = /(?:addplot|plot)\s*(?:\[|\()/.test(code);
  // The user asked for a function plot, but the document draws no curve at all:
  // this compiles fine and therefore used to slip through every check.
  const wantsFunction = /\b(sin|cos|tan|cot|exp|ln|log|sqrt|abs)\b|函数|图像/i.test(request);
  if (wantsFunction && !hasPlot) {
    add(
      "FUNCTION_NO_PLOT",
      "blocker",
      null,
      "需求是函数图像，但文档里没有任何 plot / addplot",
      "用 \\draw[domain=a:b, samples=n, smooth] plot (\\x, {expr}); 画出曲线"
    );
  }
  const hasAxes = /node\[right\]\s*\{\$?x\$?\}/.test(code) && /node\[above\]\s*\{\$?y\$?\}/.test(code);
  if (hasPlot && !hasAxes && !options.screenshot) add("AXIS_MISSING", "major", null, "有函数曲线但缺少坐标轴", "补一对 \\draw[->, thick] 轴，并让范围覆盖曲线");

  lines.forEach((line, i) => {
    const m = /^\s*\\(draw|filldraw)\b[^\n]*plot\s*(?:\[[^\]]*\])?\s*\(/.exec(line);
    if (!m) return;
    const prev = (lines[i - 1] || "").trim();
    if (!/^%\s*y\s*=/.test(prev)) {
      add("PLOT_EXPR", "blocker", i + 1, "函数曲线前缺少 \"% y = <表达式>\" 注释", "在曲线上一行补 % y = sin(exp(x))");
    }
    const body = line.slice(line.indexOf("plot"));
    if (/(^|[^a-z])e\s*\^/i.test(body)) {
      add("PLOT_EXPR", "blocker", i + 1, "表达式里用了 e^，pgfmath 不认", "改成 exp(...)");
    }
    const trig = [...body.matchAll(/\b(sin|cos|tan)\s*\(/g)];
    for (const t of trig) {
      const open = body.indexOf("(", t.index);
      let depth = 0;
      let close = -1;
      for (let k = open; k < body.length; k++) {
        if (body[k] === "(") depth++;
        else if (body[k] === ")") {
          depth--;
          if (depth === 0) {
            close = k;
            break;
          }
        }
      }
      const arg = close > 0 ? body.slice(open + 1, close) : "";
      if (!/\br\s*$/.test(arg)) {
        add(
          "DEGREE_MODE",
          "major",
          i + 1,
          `${t[1]}() 未标注弧度`,
          "pgfmath 默认按角度；要画我们把 `" + t[1] + "(...)` 改成 `" + t[1] + "(... r)`，或者直接给采样坐标"
        );
        break;
      }
    }
  });

  lines.forEach((line, i) => {
    // node labels can hang off a \draw ("... -- (4,-1) node[below] {\result}"),
    // so scan for node specs anywhere in the line, not just line-leading \node.
    const specs = [...line.matchAll(/node\s*(?:\[[^\]]*\])?\s*(?:at\s*\([^)]*\)\s*)?\{([^{}]*)\}/g)];
    for (const m of specs) {
      const text = m[1];
      // Only maths commands need $…$. Font/shape commands (\small, \bfseries,
      // \text…) are legal in text mode — flagging them rejected valid figures
      // and made the generator redraw a completely different image.
      const cmds = [...text.matchAll(/\\([a-zA-Z]+)/g)].map((c) => c[1]);
      const mathsCmds = cmds.filter((c) => !TEXT_MODE_CMDS.has(c));
      if (mathsCmds.length && !/\$/.test(text)) {
        // Not cosmetic: TeX raises "Missing $ inserted" and the build fails.
        add(
          "MATH_MODE",
          "blocker",
          i + 1,
          "节点文本含数学命令 " + mathsCmds.map((c) => "\\" + c).join(" ") + " 但没有 $…$，编译会报 Missing $",
          "包成 $…$，或把字体命令换成 text 模式"
        );
      }
      const dollars = (text.match(/\$/g) || []).length;
      if (dollars % 2 === 1) add("MATH_MODE", "major", i + 1, "文本里 $ 不配对", "检查数学区间的起止");
    }
  });

  const blockers = issues.filter((x) => x.severity === "blocker").length;
  return {
    ok: blockers === 0,
    issues,
    stats: { lines: lines.length, elements: drawOrNode, plots: (code.match(/plot\s*(?:\[|\()/g) || []).length, hasAxes },
  };
}
