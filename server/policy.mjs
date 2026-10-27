/**
 * Image-to-TikZ policy.
 *
 * A picture is rebuilt from a SEMANTIC description (nodes, edges, labels, fitted
 * parameters). Tracing the pixels - outline walking, skeleton tracing, drawing the
 * residual as a pile of polygons - is forbidden on every entry point, including
 * retries and legacy fields. This module is the single place that decides.
 */

export class PolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 422;
  }
}

/** The only representation a picture may use. Anything else is refused. */
export const ALLOWED_REPRESENTATIONS = ["figure", "semantic"];

const FORBIDDEN = new Set(["trace", "legacy", "vectorize", "outline", "skeleton"]);

/**
 * Refuse any request that asks for a traced representation instead of quietly
 * falling back to it.
 */
export function requireRepresentation(value) {
  if (value == null || value === "") return "figure";
  const key = String(value).toLowerCase();
  if (FORBIDDEN.has(key)) {
    throw new PolicyError(
      "TRACING_DISABLED",
      "描摹表示已被禁用：请使用语义重建（representation=figure）。",
    );
  }
  if (!ALLOWED_REPRESENTATIONS.includes(key)) {
    throw new PolicyError("UNKNOWN_REPRESENTATION", "不支持的表示方式：" + value);
  }
  return key;
}

/**
 * Object-complexity budget per class. The limits do NOT scale with resolution:
 * a 4000 px screenshot must not buy more objects than a 400 px one.
 */
export const COMPLEXITY_BUDGET = {
  nodes: 60,
  edges: 120,
  labels: 80,
  curves: 24,
  controlPointsPerCurve: 12,
  totalElements: 220,
};

export function checkComplexity(counts) {
  const problems = [];
  for (const [key, limit] of Object.entries(COMPLEXITY_BUDGET)) {
    const value = Number(counts[key]) || 0;
    if (value > limit) problems.push(key + " " + value + " > " + limit);
  }
  return problems;
}

/**
 * Provenance is part of the contract: every generated document states where its
 * geometry came from, so a traced result can never pass as a reconstruction.
 */
export function provenanceOf(model) {
  const source = model && model.source ? String(model.source) : "model-semantic";
  const fitted = Boolean(model && model.fitted);
  return {
    source,
    traced: source === "trace" || source === "residual",
    fitted,
    generatedAt: new Date().toISOString(),
  };
}
export const ACCEPTANCE = {
  // Per class, because one number cannot describe a diagram and a plot at once:
  // a diagram is judged by its graph, a plot by ink coverage and its series.
  diagram: { minNodes: 2, minEdges: 1 },
  plot: { minRecall: 0.55, minPlots: 1 },
  generic: { minRecall: 0.5, minDraws: 1 },
};

/**
 * Acceptance gate (§7). The visual score alone must never pass a document: each
 * figure class is checked with the evidence that actually describes it.
 */
export function acceptance({ figureClass, recall, draws, plots, nodes, edges, score, pass }) {
  const cls = figureClass === "diagram" || figureClass === "plot" ? figureClass : "generic";
  const reasons = [];
  if (pass === false) reasons.push("reviewer rejected (" + (score == null ? "?" : score) + ")");
  if (cls === "diagram") {
    const rule = ACCEPTANCE.diagram;
    if ((nodes || 0) < rule.minNodes) reasons.push("only " + (nodes || 0) + " nodes < " + rule.minNodes);
    if ((edges || 0) < rule.minEdges) reasons.push("only " + (edges || 0) + " edges < " + rule.minEdges);
  } else if (cls === "plot") {
    const rule = ACCEPTANCE.plot;
    if (recall != null && recall < rule.minRecall) {
      reasons.push("ink coverage " + Math.round(recall * 100) + "% < " + Math.round(rule.minRecall * 100) + "%");
    }
    if ((plots || 0) < rule.minPlots) reasons.push("no data series drawn");
  } else {
    const rule = ACCEPTANCE.generic;
    if (recall != null && recall < rule.minRecall) {
      reasons.push("ink coverage " + Math.round(recall * 100) + "% < " + Math.round(rule.minRecall * 100) + "%");
    }
    if ((draws || 0) < rule.minDraws) reasons.push("only " + (draws || 0) + " drawn objects < " + rule.minDraws);
  }
  return { ok: reasons.length === 0, reasons, figureClass: cls };
}
