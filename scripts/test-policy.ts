import { requireRepresentation, checkComplexity, provenanceOf, COMPLEXITY_BUDGET, PolicyError, acceptance as require_acceptance } from "../server/policy.mjs";
let failed = 0;
const ok = (n, c, e) => { if (c) console.log("  ok   " + n); else { failed++; console.log("  FAIL " + n + (e === undefined ? "" : " :: " + JSON.stringify(e))); } };

console.log("representation policy");
ok("figure is allowed", requireRepresentation("figure") === "figure");
ok("empty defaults to figure", requireRepresentation(undefined) === "figure");
for (const bad of ["trace", "legacy", "vectorize", "outline", "skeleton", "TRACE"]) {
  let threw = null;
  try { requireRepresentation(bad); } catch (err) { threw = err; }
  ok("rejects " + bad, threw instanceof PolicyError && threw.code === "TRACING_DISABLED", threw && threw.message);
}
let unknown = null;
try { requireRepresentation("nonsense"); } catch (err) { unknown = err; }
ok("rejects unknown values", unknown && unknown.code === "UNKNOWN_REPRESENTATION");

console.log("complexity budget");
ok("limits are resolution independent", COMPLEXITY_BUDGET.totalElements === 220 && COMPLEXITY_BUDGET.nodes === 60);
ok("accepts a small diagram", checkComplexity({ nodes: 3, edges: 3, labels: 2, totalElements: 8 }).length === 0);
ok("rejects too many nodes", checkComplexity({ nodes: 61 }).length === 1);
ok("rejects too many elements", checkComplexity({ totalElements: 221 }).length === 1);

console.log("provenance");
ok("model output is not traced", provenanceOf({ source: "model" }).traced === false);
ok("residual output is traced", provenanceOf({ source: "residual" }).traced === true);
ok("semantic output records its source", provenanceOf({ source: "semantic" }).source === "semantic");


import { readFile, readdir } from "node:fs/promises";

console.log("no-tracing source scan");
// The image pipeline must not import or call the tracing primitives.
const PIPELINE = ["ai.mjs", "index.mjs", "decompose.mjs", "primitives.mjs", "semantic.mjs", "metrics.mjs", "policy.mjs", "curve-landmarks.mjs", "curve-relations.mjs", "joint-fit.mjs", "axis.mjs", "family.mjs", "spline.mjs"];
const FORBIDDEN = ["digitizePlot", "plotResidual", "fitFigure", "traceRaster", "traceDocument", "skeletonize", "traceSkeleton", "coloredCurves"];
const files = await readdir("server");
const problems = [];
for (const name of PIPELINE) {
  if (!files.includes(name)) { problems.push("missing " + name); continue; }
  const src = await readFile("server/" + name, "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  for (const bad of FORBIDDEN) {
    if (new RegExp("\\b" + bad + "\\s*\\(").test(code) || new RegExp("import[^;]*\\b" + bad + "\\b").test(code)) {
      problems.push(name + " still uses " + bad);
    }
  }
}
ok("pipeline has no tracing calls", problems.length === 0, problems);
ok("fitcurve module is gone", !files.includes("fitcurve.mjs"));
const traceSrc = await readFile("server/trace.mjs", "utf8");
ok("trace.mjs is only used for decoding now", /export function decodePng/.test(traceSrc));


console.log("acceptance gate (§7)");
ok("a good drawing passes", require_acceptance({ figureClass: "generic", recall: 0.86, draws: 12, score: 92, pass: true }).ok);
ok("a high score cannot carry an empty document", !require_acceptance({ figureClass: "generic", recall: 0.2, draws: 3, score: 95, pass: true }).ok);
ok("a high score cannot carry an ink-less document", !require_acceptance({ recall: 0.9, draws: 0, score: 95, pass: true }).ok);
ok("a reviewer rejection fails", !require_acceptance({ recall: 0.9, draws: 12, score: 40, pass: false }).ok);

console.log("per-class acceptance (§7)");
const A = require_acceptance;
ok("diagram judged by its graph", A({ figureClass: "diagram", nodes: 3, edges: 3, recall: 0.18, score: 95, pass: true }).ok);
ok("diagram without edges fails", !A({ figureClass: "diagram", nodes: 3, edges: 0, score: 95, pass: true }).ok);
ok("plot needs coverage and a series", A({ figureClass: "plot", recall: 0.86, plots: 2, score: 90, pass: true }).ok);
ok("plot without a series fails", !A({ figureClass: "plot", recall: 0.86, plots: 0, score: 95, pass: true }).ok);
ok("low-coverage plot fails", !A({ figureClass: "plot", recall: 0.3, plots: 2, score: 95, pass: true }).ok);
ok("a single-curve figure passes as generic", A({ figureClass: "generic", recall: 0.7, draws: 1, score: 88, pass: true }).ok);
ok("an empty document fails as generic", !A({ figureClass: "generic", recall: 0.2, draws: 0, score: 95, pass: true }).ok);
console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
if (failed) process.exitCode = 1;