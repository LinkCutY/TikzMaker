/**
 * Semantic intermediate representation for diagrams (nodes, edges, labels) and a
 * deterministic compiler to TikZ.
 *
 * The model provides structure and text only. Every coordinate is solved here, so
 * moving a node cannot break an edge, and a label follows the edge it belongs to.
 */

export const DIAGRAM_PROTOCOL = [
  "Describe this diagram as a GRAPH, not as coordinates. Return ONLY JSON:",
  '{"kind":"commutative_diagram|flowchart|other","nodes":[{"id":"A","label":{"mode":"math","tex":"A"}}],',
  '"edges":[{"id":"e1","from":"A","to":"X","route":"straight|arc","side":"above|below","arrow":"end|both|none",',
  '"dash":"solid|dashed|dotted"}],"labels":[{"owner":"e1","mode":"math|text","tex":"f","side":"below","position":0.5}],"constraints":[]}',
  "Rules for this figure:",
  "- Every label is either a NODE (a vertex of the diagram) or a LABEL on an EDGE. A word floating above an arrow is an edge label.",
  "- Node ids: the visible text, e.g. A, X, A^{(p)}.",
  "- Do NOT return coordinates. Do not return polygons, paths or pixel positions.",
  "- mode=math for variables and formulas, mode=text for ordinary words.",
  "- At most 12 nodes, 20 edges, 20 labels.",
].join("\n");

const isNum = (v) => Number.isFinite(Number(v));

const DIAGRAM_KINDS = new Set(["commutative_diagram", "flowchart", "network", "diagram"]);

export function validateSemantic(json) {
  const errors = [];
  // A plot is not a diagram: without this gate every picture was accepted as a
  // diagram and its curves were lost as "nodes".
  const kind = String(json && json.kind || "").toLowerCase();
  if (kind && !DIAGRAM_KINDS.has(kind)) errors.push("not a diagram class: " + kind);
  if (!json || typeof json !== "object") return { ok: false, errors: ["not an object"] };
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const edges = Array.isArray(json.edges) ? json.edges : [];
  const labels = Array.isArray(json.labels) ? json.labels : [];
  if (!nodes.length) errors.push("no nodes");
  if (nodes.length > 12) errors.push("too many nodes");
  // A diagram is a graph: nodes must be connected, otherwise the picture is a plot
  // or a chart and must take the other path.
  if (nodes.length >= 3 && edges.length === 0) errors.push("nodes without edges: not a graph");
  if (edges.length > 20) errors.push("too many edges");
  if (labels.length > 20) errors.push("too many labels");
  const ids = new Set();
  for (const n of nodes) {
    if (!n || !n.id) { errors.push("node without id"); continue; }
    if (ids.has(n.id)) errors.push("duplicate node id " + n.id);
    ids.add(n.id);
    const tex = n.label && (n.label.tex || n.label.text);
    if (!tex) errors.push("node " + n.id + " has no label");
  }
  const edgeIds = new Set();
  for (const e of edges) {
    if (!e || !e.id) { errors.push("edge without id"); continue; }
    if (edgeIds.has(e.id)) errors.push("duplicate edge id " + e.id);
    edgeIds.add(e.id);
    if (!ids.has(e.from)) errors.push("edge " + e.id + " starts at unknown node " + e.from);
    if (!ids.has(e.to)) errors.push("edge " + e.id + " ends at unknown node " + e.to);
  }
  for (const l of labels) {
    if (!l || !l.owner) { errors.push("label without owner"); continue; }
    if (!ids.has(l.owner) && !edgeIds.has(l.owner)) errors.push("label owner " + l.owner + " unknown");
  }
  return { ok: errors.length === 0, errors, nodes, edges, labels };
}

/** Rough TeX width in cm for a label; replaced by real metrics when available. */
function estimateWidth(entry, sizeCm) {
  const tex = String((entry && (entry.tex || entry.text)) || "");
  const visible = tex.replace(/\\[a-zA-Z]+/g, "x").replace(/[{}$^_]/g, "");
  let w = 0;
  for (const ch of visible) w += /[A-Z0-9mwMW]/.test(ch) ? 0.72 : /[il.,;:!|]/.test(ch) ? 0.3 : 0.52;
  return Math.max(0.3, w * sizeCm);
}

/**
 * Solve the node positions: one baseline, left to right, equal visual gaps.
 * The order is a hard constraint from the plan (x_A < x_X < x_B, y equal).
 */
export function layoutSemantic(model, options) {
  const opts = options || {};
  const size = opts.sizeCm || 0.62;      // ~1.2x the body font
  const gap = opts.gapCm || 1.15;
  const width = opts.widthCm || 12;
  const order = model.nodes.slice();
  const measured = opts.widths instanceof Map ? opts.widths : null;
  const widths = order.map((n) => {
    const w = measured && measured.get(n.id);
    return Number.isFinite(w) && w > 0.05 ? w + 0.12 : estimateWidth(n.label, size);
  });
  const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, order.length - 1);
  let x = (width - total) / 2;
  const y = (opts.heightCm || 4.2) * 0.45;
  const placed = new Map();
  order.forEach((node, i) => {
    const w = widths[i];
    placed.set(node.id, { x: x + w / 2, y, w, h: size * 1.15, order: i });
    x += w + gap;
  });
  return { placed, size, gap, width, height: opts.heightCm || 4.2, baseline: y };
}

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

/** Text payload for TikZ, keeping the math/text distinction. */
function texOf(entry) {
  const mode = entry && entry.mode === "text" ? "text" : "math";
  const raw = String((entry && (entry.tex || entry.text)) || "").trim();
  if (!raw) return "";
  if (mode === "math") {
    if (/^\$.*\$$/.test(raw)) return raw;
    return "$" + raw.replace(/^\$|\$$/g, "") + "$";
  }
  return raw;
}

/**
 * Compile the solved layout to TikZ: named nodes, native arrows, one cubic arc and
 * labels placed on the curve they belong to.
 */
export function compileSemantic(model, layout) {
  const lines = [];
  const { placed, size } = layout;
  // TikZ node names must be identifier-like: "A^{(p)}" is a LABEL, not a name.
  const names = new Map();
  model.nodes.forEach((n, i) => names.set(n.id, "n" + (i + 1)));
  const ref = (id) => names.get(id) || "n0";
  const pt = size * 28.4527;
  const fontDecl = "font=\\fontsize{" + fmt(pt) + "}{" + fmt(pt * 1.2) + "}\\selectfont";
  lines.push("\\begin{tikzpicture}[>=stealth, line width=0.9pt, " + fontDecl + "]");
  // The bounding box must live INSIDE the picture, or it is an undefined control
  // sequence at top level.
  lines.push("  \\useasboundingbox (0,0) rectangle (" + fmt(layout.width) + "," + fmt(layout.height) + ");");
  for (const node of model.nodes) {
    const p = placed.get(node.id);
    if (!p) continue;
    lines.push("  \\node (" + ref(node.id) + ") at (" + fmt(p.x) + "," + fmt(p.y) + ") {" + texOf(node.label) + "};");
  }
  const mid = model.nodes.map((n) => placed.get(n.id)).filter(Boolean);
  for (const edge of model.edges) {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    if (!a || !b) continue;
    const spec = edge.arrow === "none" ? "" : edge.arrow === "both" ? "<->" : "->";
    const style = [spec, edge.dash && edge.dash !== "solid" ? edge.dash : ""].filter(Boolean).join(", ");
    const opt = style ? "[" + style + "]" : "";
    if (edge.route === "arc") {
      const above = edge.side !== "below";
      const y0 = above ? a.y + a.h / 2 : a.y - a.h / 2;
      const y1 = above ? b.y + b.h / 2 : b.y - b.h / 2;
      // The arc clears every node between its endpoints on the requested side.
      let peak = above ? Math.max(y0, y1) + 0.9 : Math.min(y0, y1) - 0.9;
      for (const p of mid) {
        if (p.x <= Math.min(a.x, b.x) || p.x >= Math.max(a.x, b.x)) continue;
        peak = above
          ? Math.max(peak, p.y + p.h / 2 + 0.55)
          : Math.min(peak, p.y - p.h / 2 - 0.55);
      }
      const c1 = [a.x + (b.x - a.x) * 0.28, peak];
      const c2 = [a.x + (b.x - a.x) * 0.72, peak];
      const anchor = above ? ".north" : ".south";
      lines.push("  \\draw" + opt + " (" + ref(edge.from) + anchor + ") .. controls (" + fmt(c1[0]) + "," + fmt(c1[1]) + ") and (" + fmt(c2[0]) + "," + fmt(c2[1]) + ") .. (" + ref(edge.to) + anchor + ");");
      edge.__curve = { a: [a.x, y0], b: [b.x, y1], c1, c2 };
    } else {
      const dir = b.x > a.x ? 1 : -1;
      lines.push("  \\draw" + opt + " (" + ref(edge.from) + (dir > 0 ? ".east" : ".west") + ") -- (" + ref(edge.to) + (dir > 0 ? ".west" : ".east") + ");");
    }
  }
  for (const label of model.labels) {
    const body = texOf(label);
    if (!body) continue;
    const t = isNum(label.position) ? Math.min(0.9, Math.max(0.1, Number(label.position))) : 0.5;
    const owner = model.edges.find((e) => e.id === label.owner);
    let px = 0, py = 0;
    let tangent = [1, 0];
    if (owner && owner.__curve) {
      const { a, c1, c2, b } = owner.__curve;
      const u = 1 - t;
      px = u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0];
      py = u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1];
      tangent = [
        3 * u * u * (c1[0] - a[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (b[0] - c2[0]),
        3 * u * u * (c1[1] - a[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (b[1] - c2[1]),
      ];
    } else if (owner) {
      const a = placed.get(owner.from), b = placed.get(owner.to);
      if (!a || !b) continue;
      px = a.x + (b.x - a.x) * t;
      py = a.y + (b.y - a.y) * t;
      tangent = [b.x - a.x, b.y - a.y];
    } else {
      const node = placed.get(label.owner);
      if (!node) continue;
      px = node.x;
      py = node.y - node.h / 2 - 0.3;
      lines.push("  \\node at (" + fmt(px) + "," + fmt(py) + ") {" + body + "};");
      continue;
    }
    const side = label.side === "below" ? -1 : 1;
    const off = 0.34 + size * 0.35;
    const length = Math.max(1e-9, Math.hypot(tangent[0], tangent[1]));
    let normal = [-tangent[1] / length, tangent[0] / length];
    // Define "above" in page coordinates, independently of edge direction.
    if (normal[1] < 0) normal = [-normal[0], -normal[1]];
    lines.push("  \\node at (" + fmt(px + side * off * normal[0]) + "," + fmt(py + side * off * normal[1]) + ") {" + body + "};");
  }
  lines.push("\\end{tikzpicture}");
  return lines.join("\n");
}
