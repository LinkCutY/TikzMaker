/**
 * Mechanical fixes for compile errors we have seen before. These are not worth a
 * 60-second regeneration: they are deterministic text edits. Running them costs a
 * local compile (~3s) instead of a full model round.
 */
export function splitBezierChains(code) {
  const p = String.raw`\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)`;
  const segment = String.raw`\s*\.\.\s*controls\s*(${p})\s*and\s*(${p})\s*\.\.\s*(${p})`;
  const whole = new RegExp(String.raw`^(\s*\\draw(?:\[[^\]]*\])?\s*)(${p})((?:${segment})+)\s*;\s*$`);
  return String(code).split(/\r?\n/).flatMap(line => {
    const m = whole.exec(line);
    if (!m) return [line];
    const matches = [...m[3].matchAll(new RegExp(segment, "g"))];
    if (matches.length < 2) return [line];
    let from = m[2];
    return matches.map(part => {
      const next = `${m[1]}${from} .. controls ${part[1]} and ${part[2]} .. ${part[3]};`;
      from = part[3];
      return next;
    });
  }).join("\n");
}

export function annotateFunctions(code) {
  const out = [];
  for (const line of String(code).split(/\r?\n/)) {
    const match = /\bplot\s*(?:\[[^\]]*\])?\s*\(\s*\{?\\x\}?\s*,\s*\{(.*)\}\s*\)\s*;/.exec(line);
    if (match && !/^\s*%\s*y\s*=/.test(out.at(-1) || "")) {
      out.push("% y = " + match[1].replace(/\\x\b/g, "x"));
    }
    out.push(line);
  }
  return out.join("\n");
}

export function autofixSource(code, errors) {
  let out = String(code || "");
  const fixes = [];
  const messages = (errors || []).map((e) => String(e.message || ""));
  const has = (re) => messages.some((m) => re.test(m));

  // pgf rejects \clip[<opts>] — drop the options, keep the clipping path.
  if (has(/Extra options not allowed for clipping path/i)) {
    const before = out;
    out = out.replace(/\\clip\s*\[[^\]]*\]/g, "\\clip");
    if (out !== before) fixes.push("去掉 \\clip 的选项");
  }

  // Unknown tikz library: the preamble already loads a superset, so drop the rest.
  const missing = new Set();
  for (const m of messages) {
    const a = /Unknown library '([^']+)'/i.exec(m);
    if (a) missing.add(a[1]);
    // TeX wordings differ between engines/versions, so match the file name itself.
    const b = /tikzlibrary([\w.\-]+?)\.code\.tex/.exec(m);
    if (b) missing.add(b[1]);
  }
  if (missing.size) {
    const before = out;
    out = out.replace(/\\usetikzlibrary\{([^}]*)\}/g, (_, list) => {
      const kept = String(list)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !missing.has(s));
      return kept.length ? `\\usetikzlibrary{${kept.join(",")}}` : "";
    });
    if (out !== before) fixes.push("移除不存在的 tikz 库：" + [...missing].join(", "));
  }

  // Undefined colour: the model used a name from the original figure's preamble
  // (`definecolor{leftcol}) without carrying the definition over.
  const undefColors = new Set();
  for (const m of messages) {
    const a = /Undefined color ['`]?([\w-]+)/i.exec(m);
    if (a) undefColors.add(a[1]);
    const b = /color named ['`]?([\w-]+)['`]? (?:undefined|is not defined)/i.exec(m);
    if (b) undefColors.add(b[1]);
  }
  if (undefColors.size) {
    const before = out;
    for (const name of undefColors) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Fill contexts get a light neutral, everything else falls back to black.
      out = out.replace(new RegExp(`fill\\s*=\\s*${esc}\\b`, "g"), "fill=gray!30");
      out = out.replace(new RegExp(`\\b${esc}\\b`, "g"), "black");
    }
    if (out !== before) fixes.push("未定义的颜色替换为灰色/黑色：" + [...undefColors].join(", "));
  }

  // Unknown TikZ option, typically an invented colour name used as a key:
  // "I do not know the key '/tikz/leftcol'". A colour becomes a neutral fill or
  // black stroke; any other unknown key is dropped so the file compiles again.
  const unknownKeys = new Set();
  for (const m of messages) {
    const a = /I do not know the key '\/tikz\/([^']+)'/i.exec(m);
    if (a) unknownKeys.add(a[1].split("/").pop());
  }
  if (unknownKeys.size) {
    const before = out;
    for (const name of unknownKeys) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`fill\\s*=\\s*${esc}\\b`, "g"), "fill=gray!30");
      out = out.replace(new RegExp(`([,[])\\s*${esc}\\s*(?=[,\\]])`, "g"), "$1");
      out = out.replace(new RegExp(`\\b${esc}\\b`, "g"), "black");
      out = out.replace(/\[\s*,/g, "[");
    }
    if (out !== before) fixes.push("移除/改写未知 TikZ 选项：" + [...unknownKeys].join(", "));
  }

  // "Missing $ inserted" from a node whose text contains LaTeX but no math mode.
  if (has(/Missing \$ inserted/i)) {
    const before = out;
    out = out.replace(
      /node\s*(\[[^\]]*\])?\s*(at\s*\([^)]*\)\s*)?\{([^{}]*)\}/g,
      (whole, opts, at, text) => {
        if (/\$/.test(text) || !/\\[a-zA-Z]+/.test(text)) return whole;
        return `node${opts ?? ""}${at ? " " + at : ""} {$${text}$}`;
      }
    );
    if (out !== before) fixes.push("把含 LaTeX 命令的节点文本包进 $…$");
  }

  return { code: out, fixes };
}
