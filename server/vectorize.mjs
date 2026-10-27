/**
 * Filled-region vectorisation: VTracer (WASM) + a small SVG -> TikZ writer.
 *
 * Why this exists: trace.mjs / lines.mjs follow *strokes* and emit open
 * polylines, so filled regions (colour bars, shaded areas, solid blobs) come
 * out as outlines instead of fills. VTracer solves exactly that half: it emits
 * closed, colour-filled regions. This module turns those into TikZ \fill
 * commands. No model, no API key, no GPU -- deterministic and instant.
 *
 * Coordinate convention matches traceDocument(): a 12 cm wide viewport, y axis
 * flipped, and a "% @viewport 0 0 w h" comment so the editor can parse it back.
 */

import { decodePng } from "./trace.mjs";
import { medianFilter, countSpecks } from "./denoise.mjs";
import { encodePng } from "./pngwrite.mjs";
import { cjkPreamble, safeNodeText } from "./textext.mjs";

const DEFAULT_WIDTH_CM = 12;

/* ------------------------------------------------------------------ colour */

const NAMED = new Map([
  ["black", [0, 0, 0]], ["white", [255, 255, 255]], ["red", [255, 0, 0]],
  ["green", [0, 128, 0]], ["blue", [0, 0, 255]], ["gray", [128, 128, 128]],
  ["grey", [128, 128, 128]],
]);

/** "#rgb" | "#rrggbb" | "#rrggbbaa" | "rgb(r,g,b)" | a few names. Returns [r,g,b] or null. */
export function parseColor(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "none" || v === "transparent") return null;
  const named = NAMED.get(v);
  if (named) return named;
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) return [0, 1, 2].map(function (i) { return parseInt(h[i] + h[i], 16); });
    if (h.length === 4) return [0, 1, 2].map(function (i) { return parseInt(h[i] + h[i], 16); });
    if (h.length === 6 || h.length === 8) {
      return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); });
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (rgb) return [1, 2, 3].map(function (i) { return Math.max(0, Math.min(255, Math.round(Number(rgb[i])))); });
  return null;
}

/* -------------------------------------------------------------- path parser */

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

/**
 * Parse an SVG path "d" string into subpaths of straight/curve segments.
 * Supports M L H V C S Q T A Z (absolute and relative) plus implicit repeats.
 * Arcs are approximated by a straight line -- vtracer never emits them, but
 * other SVG sources do, and a line beats a crash.
 */
export function parsePathData(d) {
  const tokens = String(d || "").match(TOKEN) || [];
  const subpaths = [];
  let i = 0;
  let cmd = null;
  let x = 0, y = 0, startX = 0, startY = 0;
  let lastCubic = null, lastQuad = null;
  let arcs = 0;
  let current = null;

  const num = function () { return Number(tokens[i++]); };
  const isCommand = function (t) { return /^[A-Za-z]$/.test(t); };
  const startSubpath = function (sx, sy) {
    current = { x: sx, y: sy, segs: [] };
    subpaths.push(current);
    return current;
  };
  const ensure = function () { return current || startSubpath(x, y); };
  const line = function (to) { ensure().segs.push({ kind: "L", to: to }); x = to[0]; y = to[1]; };
  const cubic = function (c1, c2, to) { ensure().segs.push({ kind: "C", c1: c1, c2: c2, to: to }); x = to[0]; y = to[1]; };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) cmd = tokens[i++];
    if (!cmd) { i++; continue; }
    const op = cmd.toUpperCase();
    const rel = cmd !== op;

    if (op === "Z") {
      if (current) current.segs.push({ kind: "Z" });
      x = startX; y = startY;
      current = null;
      lastCubic = lastQuad = null;
      continue;
    }

    if (op === "M") {
      const nx = num(), ny = num();
      x = rel ? x + nx : nx;
      y = rel ? y + ny : ny;
      startX = x; startY = y;
      startSubpath(x, y);
      // Extra coordinate pairs after a moveto are implicit linetos.
      cmd = rel ? "l" : "L";
      lastCubic = lastQuad = null;
      continue;
    }

    if (op === "L") { const nx = num(), ny = num(); line([rel ? x + nx : nx, rel ? y + ny : ny]); lastCubic = lastQuad = null; continue; }
    if (op === "H") { const nx = num(); line([rel ? x + nx : nx, y]); lastCubic = lastQuad = null; continue; }
    if (op === "V") { const ny = num(); line([x, rel ? y + ny : ny]); lastCubic = lastQuad = null; continue; }

    if (op === "C") {
      const c1 = [rel ? x + num() : num(), rel ? y + num() : num()];
      const c2 = [rel ? x + num() : num(), rel ? y + num() : num()];
      const to = [rel ? x + num() : num(), rel ? y + num() : num()];
      cubic(c1, c2, to);
      lastCubic = c2; lastQuad = null;
      continue;
    }

    if (op === "S") {
      const c1 = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
      const c2 = [rel ? x + num() : num(), rel ? y + num() : num()];
      const to = [rel ? x + num() : num(), rel ? y + num() : num()];
      cubic(c1, c2, to);
      lastCubic = c2; lastQuad = null;
      continue;
    }

    if (op === "Q" || op === "T") {
      let q;
      if (op === "Q") q = [rel ? x + num() : num(), rel ? y + num() : num()];
      else q = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
      const to = [rel ? x + num() : num(), rel ? y + num() : num()];
      // quadratic -> cubic: c1 = p0 + 2/3(q-p0), c2 = p1 + 2/3(q-p1)
      const c1 = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
      const c2 = [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])];
      cubic(c1, c2, to);
      lastQuad = q; lastCubic = c2;
      continue;
    }

    if (op === "A") {
      num(); num(); num(); num(); num(); // rx ry rotation large-arc sweep
      const to = [rel ? x + num() : num(), rel ? y + num() : num()];
      line(to);
      arcs++;
      lastCubic = lastQuad = null;
      continue;
    }

    i++; // unknown token: skip defensively
  }

  return { subpaths: subpaths, arcs: arcs };
}

/* ----------------------------------------------------------------- SVG read */

/** Pull width/height/viewBox and every filled <path> out of an SVG document. */
export function parseSvg(svg) {
  const head = (/<svg\b[^>]*>/i.exec(svg) || [""])[0];
  const attr = function (name) {
    const m = new RegExp(name + '="([^"]*)"', "i").exec(head);
    return m ? m[1].trim() : "";
  };
  const numOr = function (s, d) {
    const n = Number.parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : d;
  };

  const viewBox = attr("viewBox").split(/[\s,]+/).filter(Boolean).map(Number);
  const hasBox = viewBox.length === 4 && viewBox.every(function (n) { return Number.isFinite(n); });
  const minX = hasBox ? viewBox[0] : 0;
  const minY = hasBox ? viewBox[1] : 0;
  const width = numOr(attr("width"), hasBox ? viewBox[2] : 0);
  const height = numOr(attr("height"), hasBox ? viewBox[3] : 0);
  // Path coordinates live in viewBox units when one is declared, otherwise in
  // the width/height units. Geometry must scale by the *unit* box, not the px box.
  const unitsW = hasBox ? viewBox[2] : width;
  const unitsH = hasBox ? viewBox[3] : height;

  const paths = [];
  const tag = /<path\b([^>]*?)\/?>/gi;
  let m;
  let arcs = 0;
  while ((m = tag.exec(svg))) {
    const attrs = m[1];
    const get = function (name) {
      const hit = new RegExp(name + '="([^"]*)"', "i").exec(attrs);
      return hit ? hit[1].trim() : "";
    };
    const d = get("d");
    if (!d) continue;
    const color = parseColor(get("fill") || "#000000");
    if (!color) continue;
    const opacity = Number.parseFloat(get("fill-opacity") || "1");
    if (Number.isFinite(opacity) && opacity === 0) continue;
    if (/^\s*none\s*$/i.test(get("display"))) continue;
    const parsed = parsePathData(d);
    arcs += parsed.arcs;
    if (!parsed.subpaths.length) continue;
    paths.push({ color: color, evenOdd: /evenodd/i.test(get("fill-rule")), subpaths: parsed.subpaths });
  }

  return { width: width, height: height, unitsW: unitsW, unitsH: unitsH, minX: minX, minY: minY, paths: paths, arcs: arcs };
}

/* ---------------------------------------------------------------- TikZ write */

function makeFormatter(precision) {
  const factor = Math.pow(10, precision);
  return function (v) {
    const rounded = Math.round(v * factor) / factor;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  };
}

/**
 * Convert SVG text into a standalone TikZ document.
 *
 * options.targetWidthCm  final width (default 12, same as traceRaster)
 * options.precision      decimals per coordinate (default 2 -> 0.01 cm)
 * options.dropWhite      skip the page-coloured background path (default true)
 * options.whiteThreshold drop fills whose darkest channel is >= this (250)
 * options.minAreaPx      drop subpaths whose bbox area is below this (0 = keep)
 * options.minThicknessPx drop subpaths thinner than this in either axis -- the
 *                        double contour around a 1px stroke has a 1px bbox and
 *                        belongs to the stroke layer, not the fill layer
 * options.labels         [{ box: [x, y, w, h], tex }] with box normalised 0..1000
 *                        (same contract as the semantics JSON). Glyphs traced by
 *                        VTracer are mush, so text is re-typeset as \node on top.
 * options.fontPt         node font size in points (default 5)
 */
export function svgToTikz(svg, options) {
  const opts = options || {};
  const targetWidthCm = opts.targetWidthCm == null ? DEFAULT_WIDTH_CM : opts.targetWidthCm;
  const precision = opts.precision == null ? 2 : opts.precision;
  const dropWhite = opts.dropWhite !== false;
  const whiteThreshold = opts.whiteThreshold == null ? 250 : opts.whiteThreshold;
  const minAreaPx = opts.minAreaPx || 0;
  const minThicknessPx = opts.minThicknessPx || 0;
  const labels = Array.isArray(opts.labels) ? opts.labels : [];
  const fontPt = opts.fontPt == null ? 5 : Number(opts.fontPt);

  const parsed = parseSvg(svg);
  const unitsW = parsed.unitsW || 1;
  const unitsH = parsed.unitsH || 1;
  const k = targetWidthCm / unitsW;
  const heightCm = unitsH * k;
  const fmt = makeFormatter(precision);

  const point = function (p) {
    const px = (p[0] - parsed.minX) * k;
    const py = heightCm - (p[1] - parsed.minY) * k;
    return "(" + fmt(px) + "," + fmt(py) + ")";
  };

  const colors = [];
  const colorIndex = new Map();
  const colorOf = function (rgb) {
    const key = rgb.join(",");
    let index = colorIndex.get(key);
    if (index === undefined) {
      index = colors.length;
      colors.push(rgb);
      colorIndex.set(key, index);
    }
    return index;
  };

  const body = [];
  let ringCount = 0;
  let segments = 0;
  let dropped = 0;

  for (const path of parsed.paths) {
    if (dropWhite && Math.min.apply(null, path.color) >= whiteThreshold) { dropped++; continue; }
    const commands = [];
    for (const sp of path.subpaths) {
      if (!sp.segs.length) { dropped++; continue; }

      if (minAreaPx > 0 || minThicknessPx > 0) {
        let x0 = sp.x, x1 = sp.x, y0 = sp.y, y1 = sp.y;
        for (const seg of sp.segs) {
          const pts = seg.kind === "C" ? [seg.c1, seg.c2, seg.to] : (seg.to ? [seg.to] : []);
          for (const p of pts) {
            x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
            y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
          }
        }
        const bw = x1 - x0, bh = y1 - y0;
        if (minAreaPx > 0 && bw * bh < minAreaPx) { dropped++; continue; }
        if (minThicknessPx > 0 && Math.min(bw, bh) < minThicknessPx) { dropped++; continue; }
      }

      let out = point([sp.x, sp.y]);
      let closed = false;
      for (const seg of sp.segs) {
        segments++;
        if (seg.kind === "Z") {
          if (!closed) { out += " -- cycle"; closed = true; }
          continue;
        }
        if (seg.kind === "L") { out += " -- " + point(seg.to); continue; }
        out += " .. controls " + point(seg.c1) + " and " + point(seg.c2) + " .. " + point(seg.to);
      }
      if (!closed) out += " -- cycle";
      commands.push(out);
      ringCount++;
    }
    if (!commands.length) continue;
    const index = colorOf(path.color);
    const rule = path.evenOdd || commands.length > 1 ? ", even odd rule" : "";
    body.push("\\fill[vt" + index + rule + "] " + commands.join(" ") + ";");
  }

  // Text goes on top as re-typeset nodes: VTracer turns glyphs into blobs.
  const nodes = [];
  let placed = 0;
  for (const label of labels) {
    const box = Array.isArray(label && label.box) ? label.box.map(Number) : null;
    const tex = label && typeof label.tex === "string" ? label.tex.trim() : "";
    if (!box || box.length !== 4 || box.some(function (n) { return !Number.isFinite(n); }) || !tex) continue;
    const cx = ((box[0] + box[2] / 2) / 1000) * unitsW * k;
    const cy = heightCm - ((box[1] + box[3] / 2) / 1000) * unitsH * k;
    const safe = safeNodeText(tex);
    nodes.push("\\node[anchor=center, inner sep=0pt, font=\\fontsize{" + fontPt + "}{" + fmt(fontPt * 1.2) + "}\\selectfont] at (" + fmt(cx) + "," + fmt(cy) + ") {" + safe + "};");
    placed++;
  }

  const defines = colors.map(function (c, i) {
    return "\\definecolor{vt" + i + "}{RGB}{" + c[0] + "," + c[1] + "," + c[2] + "}";
  });
  const w = fmt(targetWidthCm);
  const h = fmt(heightCm);
  const bodyText = defines.concat(body, nodes).join("\n");
  const textBlob = labels.map(function (l) { return l && typeof l.tex === "string" ? l.tex : ""; }).join(" ");
  const document = [
    "\\documentclass[tikz,border=0pt]{standalone}",
  ].concat(cjkPreamble(textBlob)).concat([
    "\\begin{document}",
    "\\begin{tikzpicture}",
    "% @viewport 0 0 " + w + " " + h,
    "\\useasboundingbox (0,0) rectangle (" + w + "," + h + ");",
    bodyText,
    "\\end{tikzpicture}",
    "\\end{document}",
  ]).join("\n");

  return {
    document: document,
    body: bodyText,
    stats: {
      widthPx: parsed.width || unitsW,
      heightPx: parsed.height || unitsH,
      unitsW: unitsW,
      unitsH: unitsH,
      widthCm: Number(w),
      heightCm: Number(h),
      paths: parsed.paths.length,
      rings: ringCount,
      colors: colors.length,
      segments: segments,
      dropped: dropped,
      arcs: parsed.arcs,
      labels: placed,
      bytes: document.length,
    },
  };
}

/* ----------------------------------------------------------------- VTracer */

let vtracerPromise = null;

function loadVtracer() {
  if (!vtracerPromise) {
    vtracerPromise = import("@visioncortex/vtracer").catch(function (err) {
      vtracerPromise = null;
      throw new Error("未安装 @visioncortex/vtracer（npm i @visioncortex/vtracer）：" + (err && err.message ? err.message : err));
    });
  }
  return vtracerPromise;
}

/** True when the optional VTracer WASM build can be loaded. */
export async function vectorizerAvailable() {
  try {
    await loadVtracer();
    return true;
  } catch (err) {
    return false;
  }
}

/** PNG/JPEG bytes -> SVG string, via the VTracer WASM build. */
export async function rasterToSvg(bytes, vtOptions) {
  const vt = await loadVtracer();
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const merged = Object.assign({ mode: "spline", simplify: 1.2, pathPrecision: 2 }, vtOptions || {});
  return vt.convertBuffer(buffer, merged);
}

/**
 * Paint the label boxes white before tracing.
 *
 * Re-typesetting text as \node is not enough on its own: VTracer has already
 * turned the original glyphs into blobs, so the result shows sharp text sitting
 * on a grey ghost of itself. Masking the boxes removes the ghost.
 * Boxes are normalised 0..1000; padding catches anti-aliased edges.
 */
export function eraseLabels(raster, labels, padding) {
  const pad = padding == null ? 2 : padding;
  const { w, h, rgb } = raster;
  let erased = 0;
  for (const label of labels) {
    const box = label && Array.isArray(label.box) ? label.box.map(Number) : null;
    if (!box || box.length !== 4 || box.some(function (n) { return !Number.isFinite(n); })) continue;
    const x0 = Math.max(0, Math.floor((box[0] / 1000) * w) - pad);
    const y0 = Math.max(0, Math.floor((box[1] / 1000) * h) - pad);
    const x1 = Math.min(w, Math.ceil(((box[0] + box[2]) / 1000) * w) + pad);
    const y1 = Math.min(h, Math.ceil(((box[1] + box[3]) / 1000) * h) + pad);
    if (x1 <= x0 || y1 <= y0) continue;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 3;
        rgb[i] = 255; rgb[i + 1] = 255; rgb[i + 2] = 255;
      }
    }
    erased++;
  }
  return erased;
}

/**
 * PNG/JPEG bytes -> standalone TikZ document made of filled regions.
 *
 * vtOptions are forwarded to VTracer (mode, simplify, colorPrecision,
 * filterSpeckle, maxColors, palette, hierarchical ...). Geometry options are
 * the svgToTikz ones. When labels are given, eraseLabels defaults to true, so
 * the traced glyph blobs disappear and only the re-typeset \node remains.
 * Returns { document, body, svg, stats }.
 */
export async function vectorizePng(bytes, options) {
  const opts = options || {};
  const labels = Array.isArray(opts.labels) ? opts.labels : [];
  const erase = opts.eraseLabels !== false && labels.length > 0;

  // Clean the pixels before anything traces them: JPEG ringing and isolated
  // dark pixels would each become their own filled path.
  let rasterForTrace = null;
  let bytesForTrace = bytes;
  let denoise = null;
  try {
    const dataUrl = "data:image/png;base64," + Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
    const decoded = decodePng(dataUrl);
    if (opts.denoise !== false) {
      const before = countSpecks(decoded);
      const cleaned = medianFilter(decoded, opts.denoiseRadius == null ? 1 : opts.denoiseRadius);
      const after = countSpecks(cleaned);
      rasterForTrace = cleaned;
      bytesForTrace = encodePng(cleaned);
      denoise = { specksBefore: before.specks, specksAfter: after.specks, radius: opts.denoiseRadius == null ? 1 : opts.denoiseRadius };
    } else {
      rasterForTrace = decoded;
    }
  } catch {
    rasterForTrace = null; // JPEG or unusual PNG: trace the original bytes
  }

  let svg = null;
  if (erase) {
    const vt = await loadVtracer();
    if (typeof vt.convertPixels === "function") {
      const raster = rasterForTrace;
      if (raster) {
        const erased = eraseLabels(raster, labels, 2);
        const rgba = new Uint8Array(raster.w * raster.h * 4);
        for (let i = 0, j = 0; i < raster.rgb.length; i += 3, j += 4) {
          rgba[j] = raster.rgb[i]; rgba[j + 1] = raster.rgb[i + 1]; rgba[j + 2] = raster.rgb[i + 2]; rgba[j + 3] = 255;
        }
        // filterSpeckle: VTracer's own noise gate (px area, default 4). Eight
        // removes confetti the median leaves behind without eating thin lines.
        const merged = Object.assign({ mode: "spline", simplify: 1.2, pathPrecision: 2, filterSpeckle: 8 }, opts.vtracer || {});
        svg = vt.convertPixels(rgba, raster.w, raster.h, merged);
        opts.erasedLabels = erased;
      }
    }
  }
  if (svg == null) svg = await rasterToSvg(bytesForTrace, Object.assign({ filterSpeckle: 8 }, opts.vtracer || {}));

  const result = svgToTikz(svg, opts);
  if (opts.erasedLabels != null) result.stats.erasedLabels = opts.erasedLabels;
  if (denoise) result.stats.denoise = denoise;
  return { document: result.document, body: result.body, stats: result.stats, svg: svg };
}
