import type { BezierEl, CircleEl, Element, EllipseEl, Figure, LineEl, NodeEl, PlotEl, PolyEl, Pt, RectEl, Style, AxesEl } from "./types";
import { COLORS, defaultStyle, elementLabel, uid } from "./types";
import { pgfmathToJs } from "./pgfmath";
import { normalizeCoordinates } from './coordinates';
import { splitOptions, colorToHex, colorDefinitions } from "./colors";

const NUM = "(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)";
// pgfmath allows braces around coordinates: (3,{2.6}) — accept both forms.
const P = `\\(\\s*\\{?\\s*${NUM}\\s*\\}?\\s*,\\s*\\{?\\s*${NUM}\\s*\\}?\\s*\\)`;

/** `$x$`, `\\(x\\)`, `x` all become `x`. */
function cleanTex(s: string): string {
  return (s || "").replace(/\\[()\[\]]/g, "").replace(/\$/g, "").trim();
}

function num(s: string | undefined): number {
  const n = Number(s);
  // A NaN here would end up as x="NaN" in SVG, which browsers silently ignore —
  // the element then freezes in place while the rest of the canvas pans.
  return Number.isFinite(n) ? n : 0;
}

/** TikZ lengths → cm (1pt = 2.54/72 cm). */
function toCm(value: number, unit?: string): number {
  if (unit === "pt") return (value * 2.54) / 72;
  if (unit === "mm") return value / 10;
  return value;
}

function parseStyle(opts: string, definitions: Record<string, string> = {}, inherited?: Style): Style {
  const style = inherited ? { ...inherited } : defaultStyle();
  const colorOf = (value: string) => !definitions[value] && /^(?:[a-z]+)(?:!\d+)?$/.test(value) && colorToHex(value, definitions) ? value : colorToHex(value, definitions) || value;
  const parts = splitOptions(opts);
  for (const p of parts) {
    if (!p) continue;
    if (p === "dashed" || p === "densely dashed" || p === "loosely dashed") style.dashed = true;
    if (p === "dotted" || p === "densely dotted" || p === "loosely dotted") style.dotted = true;
    if (/^line cap=(round|butt|rect)$/.test(p)) style.lineCap = p.slice(9) as Style['lineCap'];
    if (p.startsWith('dash pattern=')) {
      const lengths = [...p.matchAll(/(?:on|off)\s+([\d.]+)(pt|mm|cm)/g)];
      if (lengths.length >= 2) style.dashPattern = lengths.map(m => Number(m[1]) * (m[2] === 'cm' ? 72 / 2.54 : m[2] === 'mm' ? 72 / 25.4 : 1));
    }
    if (p === "thick" || p === "very thick" || p === "thin") style.thickness = p as Style["thickness"];
    if (p === "->" || p === "<-" || p === "<->") style.arrow = p;
    if (p.startsWith("fill=")) style.fill = p.slice(5) === "none" ? null : colorOf(p.slice(5));
    if (p === "draw=none") style.strokeNone = true;
    if ((p.startsWith("draw=") || p.startsWith("color=") || p.startsWith("text=")) && !p.endsWith("=none")) style.color = colorOf(p.slice(p.indexOf("=") + 1));
    // Preserve simple names for existing UI presets; normalize complex colors.
    if (COLORS.includes(p)) style.color = p;
    else if (/^[a-z]+!\d+$/.test(p)) style.color = p;
    else { const color = colorToHex(p, definitions); if (color) style.color = color; }
    const width = /^line width\s*=\s*([\d.]+)(pt|mm|cm)$/.exec(p);
    if (width) style.lineWidth = Number(width[1]) * (width[2] === "cm" ? 72 / 2.54 : width[2] === "mm" ? 72 / 25.4 : 1);
    const opacity = /^(?:draw )?opacity\s*=\s*([\d.]+)$/.exec(p);
    if (opacity) style.opacity = Math.max(0, Math.min(1, Number(opacity[1])));
  }
  return style;
}

const DRAW_RE = /^\\(draw|filldraw|fill|shade|shadedraw)(?:\[([^\]]*)\])?\s*([\s\S]*?);\s*$/;
// Optional "(name)" before "at": flowcharts glue everything to named nodes.
const NODE_RE = /^\\node(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\)\s*)?at\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*;\s*$/;

/**
 * Parses the canonical TikZ that generate.ts emits. Anything it does not
 * recognise is ignored, so hand-written decorations are never mangled.
 */
const COMMAND_START =
  /^\\(draw|node|path|fill|filldraw|shade|shadedraw|clip|coordinate|matrix|begin|end|foreach|usetikzlibrary|tikzset|def|newcommand|pgfmathsetmacro)\b/;

/**
 * TikZ is routinely wrapped over several lines:
 *   \draw[blue, domain=0:4.6]
 *     plot ({\x},{...});
 * Join those back into one logical statement before matching.
 */
function toStatements(body: string): string[] {
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const raw of body.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%")) {
      // Keep comments: they carry the plot expression back to the canvas.
      flush();
      out.push(trimmed);
      continue;
    }
    // Drop trailing comments ("...; % note") so they do not break the statement.
    const line = trimmed.replace(/(?<!\\)%.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("\\foreach") || line.startsWith("\\begin") || line.startsWith("\\end") || line.startsWith("\\usetikzlibrary")) {
      flush();
      out.push(line);
      continue;
    }
    if (COMMAND_START.test(line)) {
      flush();
      buf = line;
    } else {
      buf = buf ? buf + " " + line : line;
    }
    if (buf.endsWith(";")) flush();
  }
  flush();
  return out;
}

export function parseBody(body: string, options?: { pictureOptions?: string }): Figure {
  const definitions = colorDefinitions(body);
  const pictureStyle = parseStyle(options?.pictureOptions || "", definitions);
  const styleOf = (opts: string) => parseStyle(opts, definitions, pictureStyle);
  const elements: Element[] = [];
  const lines = toStatements(body);
  // Picture-level style: nodes inherit the picture font, they do not each restate it.
  // The caller may pass the options it stripped from the source, otherwise the font
  // is lost and every node falls back to 10pt.
  const styleText = (options && options.pictureOptions ? options.pictureOptions : "") + "\n" + body;
  const pictureFont = Number(/font\s*=\s*\\fontsize\{([\d.]+)\}/.exec(styleText)?.[1] ?? /\\fontsize\{([\d.]+)\}/.exec(styleText)?.[1]) || 10;
  const counters: Record<string, number> = {};
  let pendingPlotExpr: string | null = null;
  let pendingOcr: PolyEl["ocr"];
  const axisCandidates: { origin: Pt; end: Pt; label: string; dir: "x" | "y" }[] = [];
  /** \node (name) at (x,y) / \coordinate (name) at (x,y) — later \draws use (name).
   *  The box is estimated from the text so (name.east) can be resolved instead of
   *  silently collapsing to the centre. */
  const nodeNames = new Map<string, { x: number; y: number; w: number; h: number }>();
  /** Coordinates / statements that could not be resolved. Never reported as success. */
  const parseErrors: string[] = [];
  /** \tikzset{edge/.style={...}} — models style edges this way all the time. */
  const styleAliases = new Map<string, string>();
  for (const m of body.matchAll(/([A-Za-z][\w-]*)\s*\/\.style\s*=\s*\{([^{}]*)\}/g)) {
    styleAliases.set(m[1], m[2]);
  }
  for (const m of body.matchAll(/\\tikzstyle\{([^}]+)\}\s*=\s*\[([^\]]*)\]/g)) {
    styleAliases.set(m[1].trim(), m[2]);
  }

  /** "edge, thick" -> "line width=0.6pt, thick" */
  const expandStyles = (opts: string): string => {
    if (!styleAliases.size || !opts) return opts;
    const parts = opts.split(",").map((s) => s.trim()).filter(Boolean);
    const out: string[] = [];
    for (const part of parts) {
      const alias = styleAliases.get(part);
      if (alias) out.push(alias);
      else out.push(part);
    }
    return out.join(", ");
  };

  const nextName = (kind: Element["kind"]) => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    return elementLabel(kind, counters[kind]);
  };

  for (const raw of lines) {
    const line = normalizeCoordinates(raw.trim());
    if (!line) continue;
    if (line.startsWith("%")) {
      if (line.startsWith("% @ocr ")) {
        try {
          const parsed = JSON.parse(line.slice(7));
          if (typeof parsed.text === "string" && parsed.text.length <= 1000 && Number.isFinite(parsed.at?.x) && Number.isFinite(parsed.at?.y) && Number.isFinite(parsed.fontSize)) pendingOcr = parsed;
        } catch { /* Ignore malformed metadata. */ }
      }
      const m = /^%\s*y\s*=\s*(.+)$/.exec(line);
      if (m) pendingPlotExpr = m[1].trim();
      continue;
    }
    // \coordinate (A) at (1,0.6);  — an anchor, not a drawable element
    const coord = /^\\coordinate\s*\(([^)]*)\)\s*at\s*\(([^)]*)\)\s*;\s*$/.exec(line);
    if (coord) {
      const c = coord[2].split(",").map((p) => p.replace(/[{}]/g, "").trim());
      if(c.length!==2||c.some(v=>!v||!Number.isFinite(Number(v)))){parseErrors.push('invalid coordinate: '+coord[2]);continue;}
      nodeNames.set(coord[1].trim(), { x: num(c[0]), y: num(c[1]), w: 0, h: 0 });
      continue;
    }

    if (line.startsWith("\\tikzset") || line.startsWith("\\tikzstyle")) continue;
    if (line.startsWith("\\foreach") || line.startsWith("\\usetikzlibrary") || line.startsWith("\\begin") || line.startsWith("\\end")) {
      if(line.startsWith('\\foreach')||/^\\begin\{scope\}\[/.test(line))parseErrors.push('unsupported canvas statement: '+line.slice(0,100));
      continue;
    }

    const nodeMatch = NODE_RE.exec(line);
    if (nodeMatch) {
      const opts = nodeMatch[1] ?? "";
      const nodeName = (nodeMatch[2] ?? "").trim();
      const c = nodeMatch[3].split(",").map((part) => part.replace(/[{}]/g, "").trim());
      if(c.length!==2||c.some(v=>!v||!Number.isFinite(Number(v)))){parseErrors.push('invalid node coordinate: '+nodeMatch[3]);continue;}
      // Keep $...$ intact: stripping it here made the regenerated TikZ lose the
      // maths delimiters and fail with "Missing $ inserted".
      const text = nodeMatch[4];
      const el: NodeEl = {
        id: uid("nd"),
        kind: "node",
        name: nextName("node"),
        at: { x: num(c[0]), y: num(c[1]) },
        text,
        style: styleOf(opts),
        boxed: /\bdraw\b/.test(opts),
        rounded: /rounded corners/.test(opts) ? 0.15 : 0,
        fontSize: Number(/\\fontsize\{([\d.]+)\}/.exec(opts)?.[1]) || pictureFont || (/\\Large\b/.test(opts) ? 14.4 : /\\large\b/.test(opts) ? 12 : /\\scriptsize\b/.test(opts) ? 7 : /\\footnotesize\b/.test(opts) ? 8 : /\\small\b/.test(opts) ? 9 : 10),
        anchor: (/anchor\s*=\s*(north west|north east|south west|south east|west|east|north|south|center)/.exec(opts)?.[1] || "center") as NodeEl["anchor"],
        rotate: Number(/rotate\s*=\s*(-?[\d.]+)/.exec(opts)?.[1]) || 0,
        fontFamily: /\\sffamily\b/.test(opts) ? 'sans' : 'serif',
        bold: /\\bfseries\b/.test(opts),
      };
      if (nodeName) {
        const chars = Math.max(1, (text || "").replace(/\\[a-zA-Z]+/g, "").replace(/[{}]/g, "").length);
        const em = el.fontSize / 28.4527;
        nodeNames.set(nodeName, { x: el.at.x, y: el.at.y, w: Math.max(0.2, chars * em * 0.55), h: em * 1.05 });
      }
      elements.push(el);
      continue;
    }

    // pgfplots style: \addplot[domain=a:b, samples=n]{expr};
    const addPlot = /^\\addplot\s*(?:\[([^\]]*)\])?\s*\{([\s\S]*)\}\s*;$/.exec(line);
    if (addPlot) {
      const aOpts = addPlot[1] ?? "";
      const domain = /domain\s*=\s*(-?[\d.]+)\s*:\s*(-?[\d.]+)/.exec(aOpts);
      const samples = /samples\s*=\s*(\d+)/.exec(aOpts);
      const converted = pgfmathToJs(addPlot[2].replace(/\\x\b/g, "x"));
      const el: PlotEl = {
        id: uid("pl"),
        kind: "plot",
        name: nextName("plot"),
        expr: converted.expr || "0",
        exprError: converted.ok ? undefined : converted.reason,
        raw: line,
        xMin: domain ? Number(domain[1]) : 0,
        xMax: domain ? Number(domain[2]) : 5,
        samples: samples ? Number(samples[1]) : 80,
        offset: { x: 0, y: 0 },
        style: styleOf(aOpts),
      };
      elements.push(el);
      pendingPlotExpr = null;
      continue;
    }

    const drawMatch = DRAW_RE.exec(line);
    if (!drawMatch) {if(/^\\(?:node|fill|draw|clip|path)\b/.test(line)&&!/^\\path\[use as bounding box\]/.test(line))parseErrors.push('unparsed canvas statement: '+line.slice(0,100));continue;}
    const command = drawMatch[1];
    const opts = expandStyles(drawMatch[2] ?? "");
    // Resolve named coordinates: (in) -- (mid) becomes (0,0) -- (4,0).
    const rest = drawMatch[3]
      .trim()
      .replace(/\(([^)]*)\)/g, (m, inner) => {
        if(/^plot\b/.test(drawMatch[3].trim())||/^\s*-?[\d.eE+-]+\s*(?:pt|cm|mm)?\s*$/.test(inner)||/\band\b/.test(inner))return m;
        // "(n1.east)" is a node plus an anchor. Names may contain dots, so split on
        // the last segment only when it is a known anchor word.
        // Plain coordinates are not node references.
        if (/^\s*-?[\d.eE+-]+\s*,\s*-?[\d.eE+-]+\s*$/.test(inner)) return m;
        const parts = inner.split(".");
        const anchorWords = /^(east|west|north|south|center|north east|north west|south east|south west|base|mid|text|inner sep)$/;
        let n = inner.trim();
        let anchor = "";
        if (parts.length > 1 && anchorWords.test(parts[parts.length - 1].trim())) {
          anchor = parts[parts.length - 1].trim();
          n = parts.slice(0, -1).join(".").trim();
        }
        const p = nodeNames.get(n);
        if (!p) {
          // Never silently fall back to (0,0): an unresolved coordinate is an error.
          parseErrors.push("unknown coordinate (" + inner + ")");
          return m;
        }
        const a = anchor || "center";
        const dx = /east/.test(a) ? p.w / 2 : /west/.test(a) ? -p.w / 2 : 0;
        const dy = /north/.test(a) ? p.h / 2 : /south/.test(a) ? -p.h / 2 : 0;
        return "(" + (p.x + dx) + "," + (p.y + dy) + ")";
      });
    // A label attached to a path ("... circle (2pt) node[above right] {A};")
    // is peeled off so the shape itself can be recognised. Axis labels are kept,
    // because the axis matcher needs "node[right] {$t$}".
    const attached = /\s+node\[[^\]]*\]\s*\{[^}]*\}\s*$/.exec(rest);
    const core = attached ? rest.slice(0, attached.index).trim() : rest;
    const style = styleOf(opts);
    if (command === "fill") style.strokeNone = true;
    // \filldraw / \fill paint the interior with the current colour.
    if (!style.fill && (command === "fill" || command === "filldraw" || command === "shade" || command === "shadedraw")) {
      style.fill = style.color;
    }

    // domain plot: \draw[domain=0:4.6, samples=120] plot ({\x},{2*exp(-0.55*\x)})
    const domainPlot =
      /^plot\s*(?:\[[^\]]*\])?\s*\(\s*\{?\\([a-zA-Z]+)(?:\s*[rR])?\}?\s*,\s*\{([\s\S]*)\}\s*\)$/.exec(rest) ||
      /^plot\s*(?:\[[^\]]*\])?\s*\(\s*\{?\\([a-zA-Z]+)(?:\s*[rR])?\}?\s*,\s*([^()]+)\s*\)$/.exec(rest) ||
      /^plot\s*(?:\[[^\]]*\])?\s*function\s*\{([\s\S]*)\}$/.exec(rest);
    if (domainPlot) {
      // plot function{...} has no variable capture; everything else names one.
      const usesFunction = domainPlot.length === 2;
      const varName = usesFunction ? "x" : domainPlot[1];
      const rawExpr = usesFunction ? domainPlot[1] : domainPlot[2];
      // Degrees/radians, \sin vs sin, e^ vs exp — all normalised here. A plot
      // that still fails to evaluate is kept as an element so the canvas can
      // show it as broken instead of silently drawing nothing.
      const normalised = varName === "x" ? rawExpr : rawExpr.replace(new RegExp("\\\\" + varName + "\\b", "g"), "\\x");
      const converted = pgfmathToJs(normalised);
      // domain/samples may sit on \draw[...] OR on plot[...] — models use both.
      const plotOpts = /^plot\s*\[([^\]]*)\]/.exec(rest)?.[1] ?? "";
      const allOpts = opts + "," + plotOpts;
      const domain = /domain\s*=\s*(-?[\d.]+)\s*:\s*(-?[\d.]+)/.exec(allOpts);
      const samples = /samples\s*=\s*(\d+)/.exec(allOpts);
      const el: PlotEl = {
        id: uid("pl"),
        kind: "plot",
        name: nextName("plot"),
        expr: converted.expr || "0",
        exprError: converted.ok ? undefined : converted.reason,
        raw: line,
        xMin: domain ? Number(domain[1]) : 0,
        xMax: domain ? Number(domain[2]) : 5,
        samples: samples ? Number(samples[1]) : 80,
        offset: { x: 0, y: 0 },
        style,
      };
      elements.push(el);
      pendingPlotExpr = null;
      continue;
    }

    // plot[smooth] coordinates {...}
    if (/^plot\b/.test(rest)) {
      const coords = [...rest.matchAll(/\((-?[\d.]+),\s*(-?[\d.]+)\)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      if (coords.length < 2) {parseErrors.push('unparsed plot coordinates: '+line.slice(0,100));continue;}
      if (!pendingPlotExpr) {
        elements.push({ id: uid("pg"), kind: "poly", name: nextName("poly"), points: coords, closed: /cycle/.test(rest), smooth: /smooth/.test(rest), style });
        continue;
      }
      const xs = coords.map((p) => p.x);
      const ys = coords.map((p) => p.y);
      const el: PlotEl = {
        id: uid("pl"),
        kind: "plot",
        name: nextName("plot"),
        expr: pendingPlotExpr ?? "sin(x)",
        xMin: Math.min(...xs),
        xMax: Math.max(...xs),
        samples: Math.max(20, coords.length),
        offset: { x: 0, y: 0 },
        style,
      };
      // Coordinates are stored absolute; re-basing keeps the expression plot usable.
      el.offset = { x: 0, y: 0 };
      el.xMin = Math.min(...xs);
      el.xMax = Math.max(...xs);
      elements.push(el);
      pendingPlotExpr = null;
      continue;
    }

    // chained cubics: (a) .. controls (c1) and (c2) .. (b) .. controls ...
    if (/^\s*\(/.test(core) && /\.\.\s*controls/.test(core)) {
      const startM = /^\s*\(([^)]*)\)/.exec(core);
      const segs = [...core.matchAll(/\.\.\s*controls\s*\(([^)]*)\)\s*and\s*\(([^)]*)\)\s*\.\.\s*\(([^)]*)\)/g)];
      if (startM && segs.length) {
        const readPt = (s: string) => {
          const parts = s.split(",").map((v: string) => v.replace(/[{}]/g, "").trim());
          return { x: num(parts[0]), y: num(parts[1]) };
        };
        const start = readPt(startM[1]);
        const path = segs.map((m) => ({ c1: readPt(m[1]), c2: readPt(m[2]), p: readPt(m[3]) }));
        // sample each cubic: points feed bbox/hit-test, path keeps the curve exact
        const points = [start];
        post: {
          let from = start;
          for (const seg of path) {
            for (let i = 1; i <= 6; i++) {
              const t = i / 6;
              const u = 1 - t;
              points.push({
                x: u * u * u * from.x + 3 * u * u * t * seg.c1.x + 3 * u * t * t * seg.c2.x + t * t * t * seg.p.x,
                y: u * u * u * from.y + 3 * u * u * t * seg.c1.y + 3 * u * t * t * seg.c2.y + t * t * t * seg.p.y,
              });
            }
            from = seg.p;
          }
        }
        const el: PolyEl = {
          id: uid("pg"),
          kind: "poly",
          name: nextName("poly"),
          points,
          start,
          path,
          closed: /--\s*cycle\s*$/.test(core),
          style,
        };
        elements.push(el);
        continue;
      }
    }

    // bezier
    const bez = new RegExp(`^${P}\\s*\\.\\.\\s*controls\\s*${P}\\s*and\\s*${P}\\s*\\.\\.\\s*${P}$`).exec(core);
    if (bez) {
      const el: BezierEl = {
        id: uid("bz"),
        kind: "bezier",
        name: nextName("bezier"),
        p0: { x: num(bez[1]), y: num(bez[2]) },
        c1: { x: num(bez[3]), y: num(bez[4]) },
        c2: { x: num(bez[5]), y: num(bez[6]) },
        p1: { x: num(bez[7]), y: num(bez[8]) },
        style,
      };
      elements.push(el);
      continue;
    }

    // rectangle
    const rect = new RegExp(`^${P}\\s*rectangle\\s*${P}$`).exec(core);
    if (rect) {
      const el: RectEl = {
        id: uid("rc"),
        kind: "rect",
        name: nextName("rect"),
        from: { x: num(rect[1]), y: num(rect[2]) },
        to: { x: num(rect[3]), y: num(rect[4]) },
        style,
        rounded: /rounded corners/.test(opts) ? 0.15 : 0,
      };
      elements.push(el);
      continue;
    }

    // circle, with optional unit: circle (2.4pt) / (0.3cm) / (3mm)
    const circ = new RegExp(`^${P}\\s*circle\\s*\\(\\s*${NUM}\\s*(pt|cm|mm)?\\s*\\)$`).exec(core);
    if (circ) {
      const el: CircleEl = {
        id: uid("ci"),
        kind: "circle",
        name: nextName("circle"),
        center: { x: num(circ[1]), y: num(circ[2]) },
        radius: toCm(num(circ[3]), circ[4]),
        style,
      };
      elements.push(el);
      continue;
    }

    // ellipse
    const ell = new RegExp(`^${P}\\s*ellipse\\s*\\(\\s*${NUM}\\s*and\\s*${NUM}\\s*\\)$`).exec(core);
    if (ell) {
      const el: EllipseEl = {
        id: uid("el"),
        kind: "ellipse",
        name: nextName("ellipse"),
        center: { x: num(ell[1]), y: num(ell[2]) },
        rx: num(ell[3]),
        ry: num(ell[4]),
        style,
      };
      elements.push(el);
      continue;
    }

    // Axis candidates: any two-point line with a trailing label node. The label
    // placement keyword ("node[right], node[above], node[below]…") differs a lot
    // between models, so orientation is decided by geometry instead.
    const axis = new RegExp(`^${P}\\s*--\\s*${P}\\s*node\\[([^\\]]*)\\]\\s*\\{([^}]*)\\}$`).exec(rest);
    if (axis) {
      const a = { x: num(axis[1]), y: num(axis[2]) };
      const b = { x: num(axis[3]), y: num(axis[4]) };
      const label = axis[6].trim();
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      const vertical = Math.abs(a.x - b.x) < 1e-6;
      // Only real axis labels qualify. Dimension arrows like "-- (0,0.5)
      // node[right] {$0.5$}" were being promoted to a second coordinate system.
      // Axis labels are a short word: x, y, t, pi, theta… Numbers ("0.5", "1")
      // belong to dimension arrows, which must not become a coordinate system.
      const letters = label.replace(/[^A-Za-z]/g, "").toLowerCase();
      const isAxisLabel = letters.length > 0 && letters.length <= 8 && !/[0-9]/.test(label);
      const longEnough = Math.hypot(b.x - a.x, b.y - a.y) >= 1;
      if ((horizontal || vertical) && isAxisLabel && longEnough) {
        axisCandidates.push({
          origin: a,
          end: b,
          label,
          dir: horizontal ? "x" : "y",
        });
        continue;
      }
    }

    // multi-segment path: "(a) -- (b) -- (c) [-- cycle]" (cube edges, polygons)
    if (/even odd rule/.test(opts) && /--\s*cycle/.test(core)) {
      const rings = core.split(/--\s*cycle\s*/).filter(s => s.trim()).map(part => part.trim().split(/\s*--\s*/).map(segment => {
        const m = new RegExp(`^${P}$`).exec(segment.trim());
        return m ? { x: num(m[1]), y: num(m[2]) } : null;
      }));
      if (rings.length && rings.every(ring => ring.length >= 3 && ring.every(Boolean))) {
        elements.push({ id: uid("pg"), kind: "poly", name: pendingOcr ? `文字：${pendingOcr.text}` : nextName("poly"), points: rings[0] as Pt[], rings: rings.slice(1) as Pt[][], closed: true, style, ocr: pendingOcr });
        pendingOcr = undefined;
        continue;
      }
    }
    if (/\s--\s/.test(core)) {
      const closed = /--\s*cycle\s*$/.test(core);
      const parts = core.replace(/\s*--\s*cycle\s*$/, "").split(/\s*--\s*/);
      if (parts.length >= 3) {
        const pts = parts.map((seg) => {
          const m = new RegExp(`^${P}$`).exec(seg.trim());
          return m ? { x: num(m[1]), y: num(m[2]) } : null;
        });
        if (pts.every((p): p is Pt => p !== null)) {
          const el: PolyEl = {
            id: uid("pg"),
            kind: "poly",
            name: nextName("poly"),
            points: pts,
            closed,
            style,
            ocr: pendingOcr,
          };
          pendingOcr = undefined;
          elements.push(el);
          continue;
        }
      }
    }

    // plain line: exactly one " -- "
    const segments = core.split(/\s*--\s*/);
    if (segments.length === 2) {
      const a = new RegExp(`^${P}$`).exec(segments[0]);
      const b = new RegExp(`^${P}$`).exec(segments[1]);
      if (a && b) {
        const el: LineEl = {
          id: uid("ln"),
          kind: "line",
          name: nextName("line"),
          from: { x: num(a[1]), y: num(a[2]) },
          to: { x: num(b[1]), y: num(b[2]) },
          style,
        };
        elements.push(el);
        continue;
      }
    }
    parseErrors.push('unparsed canvas path: '+line.slice(0,160));
  }

  // Pair a horizontal axis with a vertical one. They do not have to start at the
  // same point (hand-written TikZ often overlaps ticks/padding), so the crossing
  // point becomes the origin.
  const used = new Set<number>();
  for (let i = 0; i < axisCandidates.length; i++) {
    if (used.has(i)) continue;
    const a = axisCandidates[i];
    if (a.dir !== "x") continue;
    const j = axisCandidates.findIndex((b, k) => k !== i && !used.has(k) && b.dir === "y");
    if (j >= 0) {
      used.add(i);
      used.add(j);
      const b = axisCandidates[j];
      const origin = { x: b.origin.x, y: a.origin.y };
      // The labelled end is the positive direction; the other end may be negative.
      const xMaxV = a.end.x - origin.x;
      const xMinV = a.origin.x - origin.x;
      const yMaxV = b.end.y - origin.y;
      const yMinV = b.origin.y - origin.y;
      const el: AxesEl = {
        id: uid("ax"),
        kind: "axes",
        name: nextName("axes"),
        origin,
        xMin: Math.min(xMinV, xMaxV),
        xMax: Math.max(xMinV, xMaxV),
        yMin: Math.min(yMinV, yMaxV),
        yMax: Math.max(yMinV, yMaxV),
        xLabel: cleanTex(a.label),
        yLabel: cleanTex(b.label),
        tickStep: 1,
        showTicks: true,
        style: { ...defaultStyle(), thickness: "thick", arrow: "->" },
      };
      elements.push(el);
    }
  }

  let viewport = /%\s*@viewport\s+(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(body);
  if (!viewport) {
    // Consume the actual page declaration: \useasboundingbox (x,y) rectangle (x2,y2).
    const bb = /\\useasboundingbox\s*\(([-\d.]+),([-\d.]+)\)\s*rectangle\s*\(([-\d.]+),([-\d.]+)\)/.exec(body);
    if (bb) {
      const x0 = Number(bb[1]), y0 = Number(bb[2]), x1 = Number(bb[3]), y1 = Number(bb[4]);
      viewport = [bb[0], String(Math.min(x0, x1)), String(Math.min(y0, y1)), String(Math.abs(x1 - x0)), String(Math.abs(y1 - y0))] as unknown as RegExpExecArray;
    }
  }
  return { elements, parseErrors, ...(viewport ? { viewport: { x0: Number(viewport[1]), y0: Number(viewport[2]), w: Number(viewport[3]), h: Number(viewport[4]) } } : {}) };
}
