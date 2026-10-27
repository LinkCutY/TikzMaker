/**
 * Figure understanding -> real TikZ primitives.
 *
 * Pixel tracing reproduces a circle as 200 sampled points: the result wobbles,
 * the stroke looks fuzzy and a font glyph turns into a hatched blob. A circle
 * is a circle: when the model has *understood* the picture we can emit
 * \circle / \ellipse / -- and the output is exact by construction.
 *
 * The model only describes geometry; this module validates it, converts
 * normalised coordinates (0..1000, origin top-left) to centimetres and writes
 * the document.
 */

import { cjkPreamble, safeNodeText } from "./textext.mjs";
import { catmullRom } from "./plotcurve.mjs";
import { monotoneSegments } from "./digitize.mjs";
import { chooseModel, segmentShape, fitPieces, fitAdaptive } from "./spline.mjs";
import { chooseFamily, familyTikz } from "./family.mjs";

const DEFAULT_WIDTH_CM = 12;
const MAX_ELEMENTS = 200;

const KINDS = new Set(["circle", "ellipse", "arc", "line", "polyline", "text"]);

function hexOrNull(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent") return null;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  return null;
}

/** "dashed" | true | 1 -> dashed; "dotted" as is; anything else solid. */
function dashOf(style) {
  const raw = style && (style.dash ?? style.dashed ?? style.lineStyle);
  if (raw === true || raw === 1) return "dashed";
  const v = String(raw == null ? "" : raw).toLowerCase();
  if (v === "dashed" || v === "dash") return "dashed";
  if (v === "dotted" || v === "dot") return "dotted";
  return "";
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01k(value) {
  return Math.max(-200, Math.min(1200, num(value, 0)));
}

function makeFormatter(precision) {
  const factor = Math.pow(10, precision);
  return function (v) {
    const r = Math.round(v * factor) / factor;
    return Object.is(r, -0) ? "0" : String(r);
  };
}

/** "#rrggbb" -> a TikZ colour expression ("#" is illegal in LaTeX). */
function rgbSpec(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return "{rgb,255:red," + r + ";green," + g + ";blue," + b + "}";
}

/**
 * An elliptical arc as a chain of cubic Beziers (one segment per <= 90 deg).
 *
 * The canvas model has circle / polyline / text but no arc element, so a native
 * `arc` disappears the moment the canvas rebuilds the source. Four cubics per
 * half turn are exact to ~0.02% and stay editable as a curve.
 * Hermite -> Bezier: c1 = p0 + (d/3)*P'(t0), c2 = p3 - (d/3)*P'(t1).
 */
function arcSegments(cx, cy, rx, ry, startDeg, endDeg) {
  const t0 = (startDeg * Math.PI) / 180;
  const t1 = (endDeg * Math.PI) / 180;
  const sweep = t1 - t0;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = t0 + (sweep * i) / steps;
    const b = t0 + (sweep * (i + 1)) / steps;
    const d = (b - a) / 3;
    const p0 = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    const p3 = [cx + rx * Math.cos(b), cy + ry * Math.sin(b)];
    const c1 = [p0[0] - d * rx * Math.sin(a), p0[1] + d * ry * Math.cos(a)];
    const c2 = [p3[0] + d * rx * Math.sin(b), p3[1] - d * ry * Math.cos(b)];
    out.push({ p0, c1, c2, p3 });
  }
  return out;
}

function escapeTex(text) {
  return String(text).replace(/([%#&])/g, "\\$1");
}

/**
 * Validate a model reply and emit a standalone document.
 * Returns { code, stats, items } — items are short human-readable lines the UI shows.
 */
export function primitivesToTikz(model, options) {
  const opts = options || {};
  const widthCm = opts.targetWidthCm == null ? DEFAULT_WIDTH_CM : opts.targetWidthCm;
  // The model reports the canvas aspect; fall back to the image aspect if given.
  const aspect = num(opts.aspect, num(model && model.aspect, 1)) || 1;
  const heightCm = widthCm * aspect;
  const fmt = makeFormatter(opts.precision == null ? 2 : opts.precision);
  // The model reports stroke width in source pixels; 1 px at 12 cm over N px is
  // (12/N) cm = (12/N)*28.3465 pt. Fall back to ~0.5 pt/px for a 700 px image.
  const pxToPt = opts.imageWidthPx ? (widthCm / opts.imageWidthPx) * 28.3465 : 0.5;

  const X = function (v) { return fmt((clamp01k(v) / 1000) * widthCm); };
  const Y = function (v) { return fmt(heightCm - (clamp01k(v) / 1000) * heightCm); };
  const L = function (v, axis) { return fmt((clamp01k(v) / 1000) * (axis === "x" ? widthCm : heightCm)); };

  const raw = Array.isArray(model && model.elements) ? model.elements.slice(0, MAX_ELEMENTS) : [];
  // Text is painted last, so it stays readable on top of frames and curves.
  const shapes = raw.filter(function (el) { return !(el && el.kind === "text"); });
  let dropped = 0;
  const texts = [];
  const seenText = new Set();
  for (const el of raw) {
    if (!el || el.kind !== "text" || !Array.isArray(el.box)) continue;
    // One string, one node: a model that lists "−6" twice must not draw it twice.
    const key = String(el.tex || "").replace(/\s+/g, "").toLowerCase();
    if (key) {
      if (seenText.has(key)) { dropped++; continue; }
      seenText.add(key);
    }
    // A box that is (almost) off-canvas cannot be read back: dropping it beats
    // clamping it to the border, where every such label piles up on one spot.
    const bx = Number(el.box[0]), by = Number(el.box[1]), bw = Number(el.box[2]), bh = Number(el.box[3]);
    if (![bx, by, bw, bh].every(Number.isFinite)) { dropped++; continue; }
    const cxNorm = bx + bw / 2, cyNorm = by + bh / 2;
    if (cxNorm < -50 || cxNorm > 1050 || cyNorm < -50 || cyNorm > 1050) { dropped++; continue; }
    if (texts.some(function (o) {
      const ox = Number(o.box[0]) + Number(o.box[2]) / 2, oy = Number(o.box[1]) + Number(o.box[3]) / 2;
      return Math.abs(ox - cxNorm) < 12 && Math.abs(oy - cyNorm) < 12;
    })) { dropped++; continue; }
    // Overlapping labels mean the model duplicated one; the second is noise.
    const c = [el.box[0] + el.box[2] / 2, el.box[1] + el.box[3] / 2];
    const clash = texts.some(function (other) {
      const o = [other.box[0] + other.box[2] / 2, other.box[1] + other.box[3] / 2];
      return Math.abs(o[0] - c[0]) < 25 && Math.abs(o[1] - c[1]) < 25;
    });
    if (clash) { dropped++; continue; }
    texts.push(el);
  }
  const curves = Array.isArray(model && model.curves) ? model.curves.slice(0, 60) : [];
  const body = [];
  const items = [];
  const kinds = {};
  let textsEmitted = 0;

  // One size pass for the whole document: a label is bounded by its box, by the
  // canvas, and by its neighbours (labels of one figure do not differ 3x).
  const textSizes = new Map();
  {
    const cap = heightCm * 28.3465 * 0.08;
    const raw = texts.map(function (item) {
      const b = item.box;
      const t = typeof item.tex === "string" ? item.tex : "";
      const fromBox = (b[3] / 1000) * heightCm * 28.3465 * 0.72;
      const boxWidthCm = (b[2] / 1000) * widthCm;
      const chars = Math.max(1, t.replace(/\$[^$]*\$/g, "xx").length);
      const fromWidth = (boxWidthCm * 28.3465) / (chars * 0.62);
      return Math.max(4, Math.min(28, cap, fromBox, fromWidth));
    });
    const sorted = raw.slice().sort(function (a, b) { return a - b; });
    const median = sorted.length ? sorted[sorted.length >> 1] : 10;
    texts.forEach(function (item, i) {
      const clamped = Math.min(Math.max(raw[i], median * 0.75), median * 1.6);
      textSizes.set(item, Math.max(4, Math.min(28, cap, clamped)));
    });
  }

  for (const el of shapes.concat(texts)) {
    const kind = el && typeof el.kind === "string" ? el.kind.toLowerCase() : "";
    if (!KINDS.has(kind)) { dropped++; continue; }
    const style = el.style || {};
    const stroke = hexOrNull(style.stroke) || "#000000";
    const fill = hexOrNull(style.fill);
    const width = Math.max(0.2, Math.min(2.5, num(style.width, 2) * pxToPt));
    const dash = dashOf(style);
    const optionsList = [
      "draw=" + rgbSpec(stroke),
      "line width=" + width + "pt",
      "line cap=round",
      "line join=round",
    ];
    if (fill) optionsList.push("fill=" + rgbSpec(fill));
    if (dash) optionsList.push(dash);
    const opt = optionsList.join(", ");

    if (kind === "text") {
      // A label box lives inside the picture: clamp it to the canvas, not to the
      // looser geometry range, or the node ends up outside the page.
      const box = Array.isArray(el.box)
        ? el.box.map(function (v, i) { return Math.max(0, Math.min(1000, num(v, 0))); })
        : null;
      const tex = typeof el.tex === "string" ? safeNodeText(el.tex) : "";
      if (!box || box.length !== 4 || box.some(function (n) { return !Number.isFinite(n); }) || !tex) { dropped++; continue; }
      // Clamp the CENTRE, not just the edges: a box spanning 1000..1720 would
      // otherwise put the node below the page.
      const cx = Math.max(0, Math.min(widthCm, (box[0] + box[2] / 2) / 1000 * widthCm));
      const cy = Math.max(0, Math.min(heightCm, heightCm - (box[1] + box[3] / 2) / 1000 * heightCm));
      const size = textSizes.get(el) || 10;
      const rotate = Number.isFinite(Number(el.rotate)) && Number(el.rotate) !== 0 ? ", rotate=" + fmt(Number(el.rotate)) : "";
      // safeNodeText already escaped LaTeX specials and wrapped maths.
      body.push("\\node[anchor=center, inner sep=0pt, font=\\fontsize{" + fmt(size) + "}{" + fmt(size * 1.2) + "}\\selectfont" + rotate + "] at (" + fmt(cx) + "," + fmt(cy) + ") {" + tex + "};");
      items.push("文字「" + tex + "」");
      kinds.text = (kinds.text || 0) + 1;
      textsEmitted++;
      continue;
    }

    if (kind === "circle") {
      const r = num(el.r, 0);
      if (!(r > 1)) { dropped++; continue; }
      body.push("\\draw[" + opt + "] (" + X(el.cx) + "," + Y(el.cy) + ") circle (" + L(r, "x") + ");");
      items.push("圆 · 半径 " + Math.round(r / 10) + "%");
      kinds.circle = (kinds.circle || 0) + 1;
      continue;
    }

    if (kind === "ellipse") {
      const rx = num(el.rx, 0), ry = num(el.ry, 0);
      if (!(rx > 1) || !(ry > 0.5)) { dropped++; continue; }
      const rotate = Number.isFinite(Number(el.rotate)) ? Number(el.rotate) : 0;
      const rot = rotate ? "rotate around={" + fmt(rotate) + ":(" + X(el.cx) + "," + Y(el.cy) + ")}, " : "";
      if (opts.nativeCurves) {
        body.push("\\draw[" + rot + opt + "] (" + X(el.cx) + "," + Y(el.cy) + ") ellipse (" + L(rx, "x") + " and " + L(ry, "y") + ");");
      } else {
        // Keep it editable: a closed cubic chain instead of a native ellipse.
        const segs = arcSegments(num(el.cx, 0), num(el.cy, 0), rx, ry, 0, 360);
        const chain = ["(" + X(segs[0].p0[0]) + "," + Y(segs[0].p0[1]) + ")"]
          .concat(segs.map(function (s) {
            return ".. controls (" + X(s.c1[0]) + "," + Y(s.c1[1]) + ") and (" + X(s.c2[0]) + "," + Y(s.c2[1]) + ") .. (" + X(s.p3[0]) + "," + Y(s.p3[1]) + ")";
          }))
          .join(" ");
        body.push("\\draw[" + opt + "] " + chain + " -- cycle;");
      }
      items.push("椭圆 · " + Math.round(rx / 10) + "% × " + Math.round(ry / 10) + "%" + (dash ? "（" + dash + "）" : ""));
      kinds.ellipse = (kinds.ellipse || 0) + 1;
      continue;
    }

    if (kind === "arc") {
      const rx = num(el.rx, 0), ry = num(el.ry, 0);
      const a0 = num(el.start, 0), a1 = num(el.end, 360);
      if (!(rx > 1) || !(ry > 0.5)) { dropped++; continue; }
      // Model space has y pointing down, TikZ has y up: angles are negated.
      if (opts.nativeCurves) {
        const rad = (a0 * Math.PI) / 180;
        const sx = num(el.cx, 0) + rx * Math.cos(rad);
        const sy = num(el.cy, 0) + ry * Math.sin(rad);
        body.push(
          "\\draw[" + opt + "] (" + X(sx) + "," + Y(sy) + ") arc[start angle=" + fmt(-a0) + ", end angle=" + fmt(-a1) +
            ", x radius=" + L(rx, "x") + ", y radius=" + L(ry, "y") + "];"
        );
      } else {
        const segs = arcSegments(num(el.cx, 0), num(el.cy, 0), rx, ry, a0, a1);
        const chain = ["(" + X(segs[0].p0[0]) + "," + Y(segs[0].p0[1]) + ")"]
          .concat(segs.map(function (s) {
            return ".. controls (" + X(s.c1[0]) + "," + Y(s.c1[1]) + ") and (" + X(s.c2[0]) + "," + Y(s.c2[1]) + ") .. (" + X(s.p3[0]) + "," + Y(s.p3[1]) + ")";
          }))
          .join(" ");
        body.push("\\draw[" + opt + "] " + chain + ";");
      }
      items.push("弧 · " + fmt(a0) + "°→" + fmt(a1) + "°" + (dash ? "（" + dash + "）" : ""));
      kinds.arc = (kinds.arc || 0) + 1;
      continue;
    }

    if (kind === "line") {
      body.push("\\draw[" + opt + "] (" + X(el.x1) + "," + Y(el.y1) + ") -- (" + X(el.x2) + "," + Y(el.y2) + ");");
      items.push("线段");
      kinds.line = (kinds.line || 0) + 1;
      continue;
    }

    // polyline
    const pts = Array.isArray(el.points) ? el.points.filter(function (p) { return Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])); }) : [];
    if (pts.length < 2) { dropped++; continue; }
    // 点数预算：密集采样点不得改写成一串 Bézier 来规避禁描点（§1）。模型给的
    // 稀疏控制点（<= 12 个）才允许平滑，超过就丢弃并记录。
    if (pts.length > 12) {
      dropped++;
      items.push("折线被拒（" + pts.length + " 点超过预算 12）");
      continue;
    }
    let turn = 0;
    for (let i = 1; i + 1 < pts.length; i++) {
      const a1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const a2 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      turn = Math.max(turn, d);
    }
    const smooth = !el.closed && pts.length >= 4 && turn < (35 * Math.PI) / 180 && el.smooth !== false;
    const fit = smooth ? catmullRom(pts) : null;
    if (fit && fit.segments.length) {
      let out = "\\draw[" + opt + "] (" + X(fit.segments[0].p1[0]) + "," + Y(fit.segments[0].p1[1]) + ")";
      for (const s of fit.segments) {
        out += " .. controls (" + X(s.c1[0]) + "," + Y(s.c1[1]) + ") and (" + X(s.c2[0]) + "," + Y(s.c2[1]) + ") .. (" + X(s.p2[0]) + "," + Y(s.p2[1]) + ")";
      }
      body.push(out + ";");
      items.push("平滑折线 · " + pts.length + " 点");
    } else {
      const chain = pts.map(function (p) { return "(" + X(p[0]) + "," + Y(p[1]) + ")"; }).join(" -- ");
      body.push("\\draw[" + opt + "] " + chain + (el.closed ? " -- cycle" : "") + ";");
      items.push("折线 · " + pts.length + " 点");
    }
    kinds.polyline = (kinds.polyline || 0) + 1;
  }

  const w = fmt(widthCm), h = fmt(heightCm);
  // Curves sit between the frame and the text.
  const curveBody = [];
  let curveCount = 0;
  const frameElement = raw.find((el) => el && el.role === "frame" && el.kind === "polyline" && Array.isArray(el.points));
  const frameXs = frameElement ? frameElement.points.map((p) => Number(p[0])).filter(Number.isFinite) : [];
  const frameDomain = frameXs.length ? [Math.min(...frameXs), Math.max(...frameXs)] : null;
  if (curves.length) {
    const insertAt = body.length; // curves go last among shapes: text was appended after them
    for (const curve of curves) {
      // The curve's own draw options. They used to be computed further down, so the
      // family / split-path emitters referenced an `opt` that did not exist.
      const curveStyle = (curve && curve.style) || {};
      const curveStroke = hexOrNull(curveStyle.stroke || curve.color) || "#000000";
      const curveWidth = Math.max(0.2, Math.min(2.5, num(curveStyle.width == null ? curve.width : curveStyle.width, 2) * pxToPt));
      const curveDash = dashOf(curveStyle.dash != null ? curveStyle : curve);
      const curveOpt = ["draw=" + rgbSpec(curveStroke), "line width=" + curveWidth + "pt", "line cap=round", "line join=round"]
        .concat(curveDash ? [curveDash] : []).join(", ");
      // §11: a curve given by many points is reduced to a FINITE parameter set
      // (<= 8 spline parameters) instead of being chained into dozens of Béziers.
      let fit = curve?.interpolation === 'monotone' ? monotoneSegments(curve.points) : catmullRom(curve && curve.points);
      if (Array.isArray(curve?.points) && curve.points.length >= 4) {
        try {
          const pts = curve.points.map((p) => [Number(p[0]), Number(p[1])]);
          // Sparse scientific curves are continuous by default. A steep peak is
          // not a discontinuity; split only when the semantic recogniser marks
          // a real printed gap explicitly.
          const maySplit = curve.continuous === false || curve.discontinuous === true;
          const split = maySplit ? segmentShape(pts, {}) : { pieces: [{ points: pts }], corners: 0, jumps: 0 };
          const pieces = split.pieces.length > 1 ? fitPieces(split.pieces, { tolerance: 6, maxK: 8 }) : null;
          if (pieces && pieces.length > 1) {
            fit = { pieces: pieces.filter((m) => m && m.segments).map((m) => ({ segments: m.segments.map((s) => ({ p1: s.p0, c1: s.p1, c2: s.p2, p2: s.p3 })) })) };
            items.push("分段拟合 · " + pieces.length + " 段（拐角 " + split.corners + " · 跳变 " + split.jumps + "）");
          } else {
            // §10.3: try a compact family first. It is used only when it explains
            // the evidence better than the spline with fewer parameters.
            let splineFit = null;
            try { splineFit = fitAdaptive(pts, { tolerance: 6, maxK: 8 }); } catch (err) { splineFit = null; }
            const family = chooseFamily(pts, {
              tolerance: 8,
              spline: splineFit ? { params: splineFit.params, rmse: splineFit.rmse } : null,
            });
            if (family) {
              const evidenceDomain = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
              const reachesFrame = frameDomain && evidenceDomain[0] - frameDomain[0] <= 150 && frameDomain[1] - evidenceDomain[1] <= 150;
              fit = { family, domain: reachesFrame ? frameDomain : evidenceDomain };
              items.push("参数族拟合 · " + family.family + " · " + family.params.length + " 参数 · 残差 " + family.rmse.toFixed(1));
            } else {
            const model = chooseModel(pts, { tolerance: 6, maxK: 8 });
            if (model && model.ok && model.kind === "spline" && model.segments && model.segments.length) {
              fit = { segments: model.segments.map((s) => ({ p1: s.p0, c1: s.p1, c2: s.p2, p2: s.p3 })) };
              items.push("样条拟合 · " + model.params + " 参数 · 残差 " + model.rmse.toFixed(1) + (model.ok ? "" : "（未达误差要求）"));
            } else if (model && model.ok && model.kind === "line") {
              fit = { segments: model.segments.map((s) => ({ p1: s.p0, c1: s.p1, c2: s.p2, p2: s.p3 })) };
              items.push("该曲线判定为直线");
            } else if (model && !model.ok) {
              // Retain the sparse evidence interpolation, but never present a
              // rejected regression as an accepted fit.
              items.push("稀疏控制点插值 · 拟合未过残差门槛");
            }
            }
          }
        } catch (err) { /* fall back to the sparse interpolation */ }
      }
      if (!fit) { dropped++; continue; }
      // A compact family is emitted as a function plot, not as points.
      if (fit.family) {
        const stmt = familyTikz(
          fit.family,
          [fit.domain[0] / 1000 * widthCm, fit.domain[1] / 1000 * widthCm],
          {
            style: curveOpt,
            inputExpression: "(1000*\\x/" + widthCm + ")",
            outputScale: -heightCm / 1000,
            outputOffset: heightCm,
          },
        );
        if (stmt) { body.push(stmt); curveCount++; continue; }
      }
      // A split curve is drawn as independent paths: a jump must not be bridged.
      if (fit.pieces) {
        for (const piece of fit.pieces) {
          if (!piece.segments || !piece.segments.length) continue;
          let out = "\\draw[" + curveOpt + "] (" + X(piece.segments[0].p1[0]) + "," + Y(piece.segments[0].p1[1]) + ")";
          for (const s of piece.segments) {
            out += " .. controls (" + X(s.c1[0]) + "," + Y(s.c1[1]) + ") and (" + X(s.c2[0]) + "," + Y(s.c2[1]) + ") .. (" + X(s.p2[0]) + "," + Y(s.p2[1]) + ")";
          }
          body.push(out + ";");
          curveCount++;
        }
        continue;
      }
      const style = (curve && curve.style) || {};
      const stroke = hexOrNull(style.stroke || curve.color) || "#000000";
      const width = Math.max(0.2, Math.min(2.5, num(style.width == null ? curve.width : style.width, 2) * pxToPt));
      const dash = dashOf(style.dash != null ? style : curve);
      const head = ["draw=" + rgbSpec(stroke), "line width=" + width + "pt", "line cap=round", "line join=round"];
      if (dash) head.push(dash);
      const segmentCode = s => {
          return ".. controls (" + X(s.c1[0]) + "," + Y(s.c1[1]) + ") and (" + X(s.c2[0]) + "," + Y(s.c2[1]) + ") .. (" + X(s.p2[0]) + "," + Y(s.p2[1]) + ")";
      };
      const groups = [];
      for (let i = 0; i < fit.segments.length; i++) {
        const color = hexOrNull(curve.colors?.[i]) || stroke;
        const last = groups.at(-1);
        const difference = last ? Math.hypot(...[1, 3, 5].map(j => parseInt(color.slice(j, j + 2), 16) - parseInt(last.color.slice(j, j + 2), 16))) : Infinity;
        const segmentWidth = curve.widths?.[i] != null ? curve.widths[i] * pxToPt : width;
        if (difference < 24 && Math.abs(last.width - segmentWidth) < 0.2) last.segments.push(fit.segments[i]);
        else groups.push({ color, width: segmentWidth, segments: [fit.segments[i]] });
      }
      for (const group of groups) {
        const start = group.segments[0].p1;
        const chain = ["(" + X(start[0]) + "," + Y(start[1]) + ")", ...group.segments.map(segmentCode)].join(' ');
        const options = ['draw=' + rgbSpec(group.color), 'line width=' + group.width + 'pt', ...head.slice(2)];
        if (curve.dashPeriodPx > 0) options.push('dash pattern=on 0pt off ' + (curve.dashPeriodPx * pxToPt) + 'pt');
        curveBody.push("\\draw[" + options.join(", ") + "] " + chain + ";");
      }
      curveCount++;
      kinds.curve = (kinds.curve || 0) + 1;
    }
    if (curveBody.length) body.splice(Math.max(0, body.length - textsEmitted), 0, ...curveBody);
  }

  const textBlob = raw.map(function (el) { return el && typeof el.tex === "string" ? el.tex : ""; }).join(" ");
  const head = [
    "\\documentclass[tikz,border=0pt]{standalone}",
  ].concat(cjkPreamble(textBlob)).concat([
    "\\begin{document}",
    "\\begin{tikzpicture}",
    "% @viewport 0 0 " + w + " " + h,
    "\\useasboundingbox (0,0) rectangle (" + w + "," + h + ");",
  ]);
  const document = head.concat(body, ["\\end{tikzpicture}", "\\end{document}"]).join("\n");

  const total = Object.keys(kinds).reduce(function (n, k) { return n + kinds[k]; }, 0);
  return {
    code: document,
    items: items.slice(0, 24),
    stats: {
      type: typeof (model && model.type) === "string" ? model.type : "other",
      summary: typeof (model && model.summary) === "string" ? model.summary.slice(0, 200) : "",
      elements: total,
      curves: curveCount,
      kinds: kinds,
      dropped: dropped,
      bytes: document.length,
      widthCm: Number(w),
      heightCm: Number(h),
    },
  };
}
