import type { AxesEl, BezierEl, CircleEl, EllipseEl, Element, Figure, LineEl, NodeEl, PlotEl, PolyEl, Pt, RectEl, Style } from "./types";
import { compileExpr, samplePlot } from "./expr";
import { jsToPgfmath } from "./pgfmath";
import { simplifyPath } from "./simplify";
import { tikzColor } from "./colors";

export const PICTURE_PREAMBLE = [
  "\\documentclass[tikz,border=10pt]{standalone}",
  "\\usepackage{ctex}",
  "\\usepackage{amsmath,amssymb}",
  "\\usetikzlibrary{arrows.meta,positioning,calc,shapes.geometric,decorations.pathreplacing}",
  "",
  "\\begin{document}",
  "\\begin{tikzpicture}[>=Stealth, line join=round]",
];

export const PICTURE_POSTAMBLE = ["\\end{tikzpicture}", "\\end{document}", ""];

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

const pt = (p: Pt) => `(${fmtNum(p.x)},${fmtNum(p.y)})`;

function fmt2(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

function fmt4(n: number): string {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
}

function styleOpts(s: Style, closed: boolean, extra: string[] = []): string {
  const opts: string[] = [];
  if (s.color && s.color !== "black") opts.push(`draw=${tikzColor(s.color)}`);
  if (s.strokeNone) opts.push("draw=none");
  if (s.thickness === "thin") opts.push("thin");
  if (s.thickness === "thick") opts.push("thick");
  if (s.thickness === "very thick") opts.push("very thick");
  if (s.dashed) opts.push("dashed");
  if (s.dotted) opts.push("dotted");
  if (s.lineCap) opts.push(`line cap=${s.lineCap}`);
  if (s.dashPattern?.length) opts.push('dash pattern=' + s.dashPattern.map((v,i) => `${i % 2 ? 'off' : 'on'} ${fmtNum(v)}pt`).join(' '));
  if (s.lineWidth !== undefined) opts.push(`line width=${fmtNum(s.lineWidth)}pt`);
  if (s.opacity !== undefined) opts.push(`opacity=${fmtNum(s.opacity)}`);
  if (closed && s.fill) opts.push(`fill=${tikzColor(s.fill)}`);
  if (!closed && s.arrow && s.arrow !== "none") opts.push(s.arrow);
  opts.push(...extra);
  return opts.length ? `[${opts.join(", ")}]` : "";
}

function escapeText(text: string): string {
  // Leave math alone; escape the characters that break plain TeX text.
  if (/\$/.test(text)) return text;
  return text.replace(/([%#&])/g, "\\$1");
}

function labelContent(label: string): string {
  const t = label.trim();
  if (!t) return "";
  return /\$/.test(t) ? t : `$${t}$`;
}

function fontOpt(fontSize: number): string | null {
  return `font=\\fontsize{${fmtNum(fontSize)}}{${fmtNum(fontSize * 1.2)}}\\selectfont`;
}

export function elementToTikz(el: Element): string[] {
  switch (el.kind) {
    case "line": {
      const e = el as LineEl;
      return [`\\draw${styleOpts(e.style, false)} ${pt(e.from)} -- ${pt(e.to)};`];
    }
    case "rect": {
      const e = el as RectEl;
      const extra = e.rounded > 0 ? [`rounded corners=${fmtNum(e.rounded)}cm`] : [];
      const a = { x: Math.min(e.from.x, e.to.x), y: Math.min(e.from.y, e.to.y) };
      const b = { x: Math.max(e.from.x, e.to.x), y: Math.max(e.from.y, e.to.y) };
      return [`\\draw${styleOpts(e.style, true, extra)} ${pt(a)} rectangle ${pt(b)};`];
    }
    case "circle": {
      const e = el as CircleEl;
      return [`\\draw${styleOpts(e.style, true)} ${pt(e.center)} circle (${fmtNum(e.radius)});`];
    }
    case "ellipse": {
      const e = el as EllipseEl;
      return [`\\draw${styleOpts(e.style, true)} ${pt(e.center)} ellipse (${fmtNum(e.rx)} and ${fmtNum(e.ry)});`];
    }
    case "bezier": {
      const e = el as BezierEl;
      return [`\\draw${styleOpts(e.style, false)} ${pt(e.p0)} .. controls ${pt(e.c1)} and ${pt(e.c2)} .. ${pt(e.p1)};`];
    }
    case "poly": {
      const e = el as PolyEl;
      if (e.rings?.length) {
        const loops = [e.points, ...e.rings].map(ring => ring.map(pt).join(" -- ") + " -- cycle").join(" ");
        return [...(e.ocr ? [`% @ocr ${JSON.stringify(e.ocr)}`] : []), `\\draw${styleOpts(e.style, true, ["even odd rule"])} ${loops};`];
      }
      if (e.start && e.path?.length) {
        const chain = e.path.map((s) => `.. controls ${pt(s.c1)} and ${pt(s.c2)} .. ${pt(s.p)}`).join(" ");
        return [`\\draw${styleOpts(e.style, e.closed)} ${pt(e.start)} ${chain}${e.closed ? ' -- cycle' : ''};`];
      }
      const path = e.smooth
        ? `plot[${e.closed ? "smooth cycle" : "smooth"}] coordinates {${e.points.map(pt).join(" ")}}`
        : e.points.map(pt).join(" -- ") + (e.closed ? " -- cycle" : "");
      return [...(e.ocr ? [`% @ocr ${JSON.stringify(e.ocr)}`] : []), `\\draw${styleOpts(e.style, e.closed)} ${path};`];
    }
    case "node": {
      const e = el as NodeEl;
      const extra: string[] = [];
      if (e.boxed) {
        extra.push("draw");
        if (e.style.fill) extra.push(`fill=${tikzColor(e.style.fill)}`);
        if (e.rounded > 0) extra.push(`rounded corners=${fmtNum(e.rounded)}cm`);
        extra.push("inner sep=4pt");
      }
      if (e.anchor !== "center") extra.push(`anchor=${e.anchor}`);
      const f = fontOpt(e.fontSize);
      if (f) extra.push(f + (e.fontFamily === 'sans' ? '\\sffamily' : '') + (e.bold ? '\\bfseries' : ''));
      if (e.rotate) extra.push(`rotate=${fmtNum(e.rotate)}`);
      // LaTeX commands outside $…$ always break the build ("Missing $ inserted").
      // Legacy documents lost their delimiters before the parser kept them, so
      // wrap bare markup here rather than emitting uncompilable code.
      let text = e.text;
      if (/\\(?:frac|sqrt|sum|int|sin|cos|tan|alpha|beta|gamma|delta|theta|pi|sigma|omega|langle|rangle)\b/.test(text) && !/\$/.test(text)) text = `$${text}$`;
      // Nodes use text= for glyph color; draw= only colors their border.
      extra.push(`text=${tikzColor(e.style.color)}`);
      return [`\\node${styleOpts({ ...e.style, fill: null, arrow: "none" }, false, extra)} at ${pt(e.at)} {${escapeText(text)}};`];
    }
    case "axes": {
      const e = el as AxesEl;
      const o = e.origin;
      const out: string[] = [];
      const arrow = e.style.arrow === "none" ? "->" : e.style.arrow;
      out.push(
        `\\draw[${arrow}, thick] ${pt({ x: o.x + e.xMin, y: o.y })} -- ${pt({ x: o.x + e.xMax, y: o.y })} node[right] {${labelContent(e.xLabel)}};`
      );
      out.push(
        `\\draw[${arrow}, thick] ${pt({ x: o.x, y: o.y + e.yMin })} -- ${pt({ x: o.x, y: o.y + e.yMax })} node[above] {${labelContent(e.yLabel)}};`
      );
      if (e.showTicks && e.tickStep > 0) {
        const xt = tickValues(e.xMin, e.xMax, e.tickStep).map((v) => fmtNum(v));
        const yt = tickValues(e.yMin, e.yMax, e.tickStep).map((v) => fmtNum(v));
        if (xt.length) {
          out.push(
            `\\foreach \\t in {${xt.join(", ")}} { \\draw[gray!60] (${fmtNum(o.x)}+\\t, ${fmtNum(o.y)}) -- ++(0,-0.07); \\node[below, font=\\scriptsize, gray] at (${fmtNum(o.x)}+\\t, ${fmtNum(o.y)}) {$\\t$}; }`
          );
        }
        if (yt.length) {
          out.push(
            `\\foreach \\t in {${yt.join(", ")}} { \\draw[gray!60] (${fmtNum(o.x)}, ${fmtNum(o.y)}+\\t) -- ++(-0.07,0); \\node[left, font=\\scriptsize, gray] at (${fmtNum(o.x)}, ${fmtNum(o.y)}+\\t) {$\\t$}; }`
          );
        }
      }
      return out;
    }
    case "plot": {
      const e = el as PlotEl;
      const compiled = compileExpr(e.expr);
      // Sampled coordinates below are absolute. Their expression hint must be
      // absolute too, otherwise reopening a merged panel loses its translation.
      const absoluteExpr = e.offset.x === 0 && e.offset.y === 0
        ? e.expr
        : `(${e.expr.replace(/\bx\b/g, `(x-(${e.offset.x}))`)})+(${e.offset.y})`;
      const out: string[] = [`% y = ${absoluteExpr}`];

      // Preferred: let TeX sample the function itself (full precision, tiny source).
      // Coordinates are only emitted when the expression has no pgfmath equivalent.
      // We cannot evaluate it: never silently drop the curve — keep the author's
      // original statement so the document still compiles and looks the same.
      if (!compiled.ok && e.raw) {
        out.push(e.raw);
        return out;
      }

      const pgf = e.offset.x === 0 && e.offset.y === 0 ? jsToPgfmath(e.expr) : { ok: false as const };
      if (compiled.ok && pgf.ok && pgf.pgf) {
        out.push(
          `\\draw${styleOpts(e.style, false)} plot[domain=${fmtNum(e.xMin)}:${fmtNum(e.xMax)}, samples=${e.samples}, smooth] (\\x, {${pgf.pgf}});`
        );
        return out;
      }

      const runs = samplePlot(compiled.fn, e.xMin, e.xMax, e.samples);
      for (const run of runs) {
        // Douglas–Peucker: the wave keeps its shape with fewer points, so the
        // source stays small even when "samples" is high.
        const kept = simplifyPath(
          run.map((p) => ({ x: p.x + e.offset.x, y: p.y + e.offset.y })),
          0.004
        );
        // 4 decimals: 2 was coarse enough to quantise dense samples into stairs.
        const coords = kept.map((p) => `(${fmt4(p.x)},${fmt4(p.y)})`).join(" ");
        out.push(`\\draw${styleOpts(e.style, false)} plot[smooth] coordinates {${coords}};`);
      }
      if (!runs.length) out.push(`% (表达式无有效采样点)`);
      return out;
    }
  }
  return [];
}

/** Tick positions in [min, max] at every step, skipping the origin. */
function tickValues(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  if (step <= 0) return out;
  const start = Math.ceil(Math.min(min, max) / step - 1e-9) * step;
  const end = Math.max(min, max);
  for (let v = start; v <= end + 1e-9 && out.length < 40; v += step) {
    const r = Math.round(v * 1000) / 1000;
    if (Math.abs(r) < 1e-9) continue;
    out.push(r);
  }
  return out;
}

export function generateBody(fig: Figure): string {
  const lines: string[] = [];
  if (fig.viewport) {
    lines.push(`% @viewport ${fig.viewport.x0} ${fig.viewport.y0} ${fig.viewport.w} ${fig.viewport.h}`);
    lines.push(`\\useasboundingbox (${fmtNum(fig.viewport.x0)},${fmtNum(fig.viewport.y0)}) rectangle (${fmtNum(fig.viewport.x0 + fig.viewport.w)},${fmtNum(fig.viewport.y0 + fig.viewport.h)});`);
  }
  for (const el of fig.elements) lines.push(...elementToTikz(el));
  return lines.join("\n");
}

export function buildDocument(fig: Figure): string {
  return [...PICTURE_PREAMBLE.map(line => fig.viewport ? line.replace("border=10pt", "border=0pt") : line), generateBody(fig), ...PICTURE_POSTAMBLE].join("\n");
}

const BLOCK_RE = /(\\begin\{tikzpicture\})(\[[^\]]*\])?([\s\S]*?)(\\end\{tikzpicture\})/;

export function extractBody(source: string): string | null {
  const m = BLOCK_RE.exec(source);
  if (!m) return null;
  return m[3].replace(/^\r?\n/, "").replace(/\s+$/, "");
}

/** Replace the tikzpicture body in a document, or build a fresh document. */
export function upsertBody(source: string, body: string): string {
  if (BLOCK_RE.test(source)) {
    return source.replace(
      BLOCK_RE,
      (_m, begin: string, opts: string | undefined, _inner: string, end: string) => `${begin}${opts ?? ""}\n${body}\n${end}`
    );
  }
  return [...PICTURE_PREAMBLE, body, ...PICTURE_POSTAMBLE].join("\n");
}
