import { readFile } from "node:fs/promises";
import { compileToPdf, wrapSource } from "./latex.mjs";
import { lintTikz } from "./lint.mjs";
import { autofixSource, annotateFunctions, splitBezierChains } from "./autofix.mjs";
import { analyzeSource, compactSource, shrinkCoordinates } from "./shrink.mjs";
import { logAttempt } from "./ailog.mjs";
import { renderPreview } from "./render.mjs";
import { decodePng } from "./trace.mjs";
import { primitivesToTikz } from "./primitives.mjs";
import { withGrid } from "./overlay.mjs";
import { encodePng } from "./pngwrite.mjs";
import { snapTextElements } from "./snaplabels.mjs";
import { evaluateModel, compareInk, pruneUnsupported, normalizeToInk, detectFrame, hasFrameElement, inkOffset, curveShapeIssues, cropRaster } from "./verify.mjs";
import { sampleCurve, alignRidgePeaks, snapRidgeColours } from "./plotcurve.mjs";

import { frameBands } from "./denoise.mjs";
import { textBlocks, matchLabels, mergeRuns, findAxis, numericLabels, pairNumericRow, detectLegend, detectDottedLegend } from "./groundtext.mjs";
import { proposeRegions, drawRegion } from "./decompose.mjs";

import { DIAGRAM_PROTOCOL, validateSemantic, layoutSemantic, compileSemantic } from "./semantic.mjs";
import { measureTexts } from "./metrics.mjs";
import { buildTicks, tickTikz, calibrateAxis, calibrateYFromFrame } from "./axis.mjs";
import { acceptance, checkComplexity, provenanceOf } from "./policy.mjs";
import { validatePlotModel, budgetSeries, selectControlPoints } from "./curve-landmarks.mjs";
import { evaluateRelations, relationFeedback, checkContinuity, planLocalReviews } from "./curve-relations.mjs";
import { fitJointSeries } from "./joint-fit.mjs";
import { normalizeSeries, isObservationSeries, compileSeriesGeometry, validateSeriesGeometry, sampleGeometry, evaluateGeometry } from './series-geometry.mjs';
import { fitPrintedMarkers, fitReferenceLine, measureOpenAxes } from './plot-observations.mjs';
import { fitAnalyticImage, colourDirection } from './analytic-image-fit.mjs';
import { runSceneGeneration } from './scene-workflow.mjs';
import { CURVE_BUDGET_PROMPT } from './curve-budget.mjs';

/** True when the class-specific structural checks passed (the reviewer is separate). */
function clsOk(gate) {
  return !gate.reasons.some((r) => r.startsWith("ink") || r.startsWith("only") || r.startsWith("no data"));
}

function acceptanceEvidence(model, code) {
  const source = String(code || "");
  const semantic = model && model.semantic;
  const curves = Array.isArray(model && model.curves) ? model.curves : [];
  const figureClass = semantic ? "diagram" : (curves.length || model?.type === "plot" ? "plot" : "generic");
  return {
    figureClass,
    draws: (source.match(/\\draw\b|plot\[/g) || []).length,
    plots: curves.length && /\\draw\b|plot\[/.test(source) ? curves.length : 0,
    nodes: semantic && Array.isArray(semantic.nodes) ? semantic.nodes.length : 0,
    edges: semantic && Array.isArray(semantic.edges) ? semantic.edges.length : 0,
  };
}

function modelComplexity(model) {
  if (model && model.semantic) {
    const nodes = Array.isArray(model.semantic.nodes) ? model.semantic.nodes.length : 0;
    const edges = Array.isArray(model.semantic.edges) ? model.semantic.edges.length : 0;
    const labels = Array.isArray(model.semantic.labels) ? model.semantic.labels.length : 0;
    return { nodes, edges, labels, totalElements: nodes + edges + labels };
  }
  const elements = Array.isArray(model && model.elements) ? model.elements.length : 0;
  const curves = Array.isArray(model && model.curves) ? model.curves : [];
  return {
    curves: curves.length,
    controlPointsPerCurve: curves.filter(c => !isObservationSeries(c)).reduce((max, curve) => Math.max(max, curve.points?.length || 0), 0),
    observationsPerSeries: curves.filter(isObservationSeries).reduce((max, curve) => Math.max(max, curve.points?.length || 0), 0),
    totalElements: elements + curves.length + curves.reduce((n,c) => n + (c.marker?.shape && c.marker.shape !== 'none' ? c.points.length : 0), 0),
  };
}

/**
 * Join pieces of the same sparse semantic series. Vision models sometimes split
 * a dotted curve at its deepest point or behind a label. This is deliberately
 * NOT pixel tracing: only sparse semantic control points are joined, and only
 * when two endpoints already coincide.
 */
export function mergeSparseCurveSegments(curves, options) {
  const opts = options || {};
  const tolerance = opts.tolerance == null ? 85 : Number(opts.tolerance);
  const cleanName = (c) => String(c && c.name || "").replace(/\s+/g, "").toLowerCase();
  const cleanColor = (c) => String(c && (c.color || c.style?.stroke) || "").toLowerCase();
  const cleanDash = (c) => String(c && (c.dash || c.style?.dash) || "solid").toLowerCase();
  const cleanPoints = (curve) => (Array.isArray(curve && curve.points) ? curve.points : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
    .map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
  const bound = (points, curve) => isObservationSeries(curve) ? normalizeSeries({ ...curve, points }).points
    : selectControlPoints(Object.assign({}, curve, { points }), opts).points;
  const prepared = (Array.isArray(curves) ? curves : []).map((curve) => Object.assign({}, curve, {
    points: bound(cleanPoints(curve), curve),
  })).filter((curve) => curve.points.length >= 2);
  const compatible = (a, b) => {
    if (isObservationSeries(a) || isObservationSeries(b)) return false;
    if (a.id && b.id && a.id !== b.id) return false;
    if (cleanColor(a) !== cleanColor(b) || cleanDash(a) !== cleanDash(b)) return false;
    const an = cleanName(a), bn = cleanName(b);
    return !an || !bn || an === bn;
  };
  const endpointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const merged = [];
  for (const curve of prepared) {
    let joined = false;
    for (let i = 0; i < merged.length; i++) {
      const prior = merged[i];
      if (!compatible(prior, curve)) continue;
      const ap = prior.points, bp = curve.points;
      const overlap = Math.min(ap.at(-1)[0], bp.at(-1)[0]) - Math.max(ap[0][0], bp[0][0]);
      if (overlap > 8) continue;
      const forward = endpointDistance(ap.at(-1), bp[0]);
      const backward = endpointDistance(bp.at(-1), ap[0]);
      if (Math.min(forward, backward) > tolerance) continue;
      const points = (forward <= backward ? ap.concat(bp) : bp.concat(ap))
        .sort((a, b) => a[0] - b[0])
        .filter((p, k, all) => !k || Math.hypot(p[0] - all[k - 1][0], p[1] - all[k - 1][1]) > 1e-6);
      const bounded = bound(points, prior);
      merged[i] = Object.assign({}, prior, {
        name: prior.name || curve.name || "",
        points: bounded,
      });
      joined = true;
      break;
    }
    if (!joined) merged.push(curve);
  }
  return merged;
}

/** Remove alternate model representations once authoritative plot objects exist. */
export function removePlotDuplicates(elements, curves, measuredFrame, raster, legend, axis) {
  const hasCurves = Array.isArray(curves) && curves.length > 0;
  const b = measuredFrame && measuredFrame.hasBox && measuredFrame.bounds && raster
    ? {
        x0: (measuredFrame.bounds.x0 / raster.w) * 1000,
        x1: (measuredFrame.bounds.x1 / raster.w) * 1000,
        y0: (measuredFrame.bounds.y0 / raster.h) * 1000,
        y1: (measuredFrame.bounds.y1 / raster.h) * 1000,
      }
    : null;
  const near = (a, c, tolerance) => Math.abs(Number(a) - Number(c)) <= tolerance;
  return (Array.isArray(elements) ? elements : []).filter((el) => {
    if (!el) return false;
    if (el.role === "frame") return false;
    // Curves own the data series. A second open polyline would draw the same
    // data twice and bypass family/spline fitting.
    if (hasCurves && el.kind === "polyline" && !el.closed && !['axis','legend','frame'].includes(el.role) && Array.isArray(el.points) && el.points.length >= 3) {
      if (el.role === 'data' || curves.some(c => (el.style?.stroke || '').toLowerCase() === (c.color || c.style?.stroke || '').toLowerCase() &&
        el.points.every(p => { const y=evaluateGeometry(c.geometry || compileSeriesGeometry(c),p[0]); return Number.isFinite(y) && Math.abs(y-p[1])<120; }))) return false;
    }
    // Reference strokes and markers are owned by their semantic series even on
    // an open two-axis plot; a rectangular frame is not a prerequisite.
    if (hasCurves && el.kind === 'line' && el.role !== 'axis' && el.role !== 'legend') {
      const color=el.style?.stroke || '#000000';
      const distanceColor=(a,b)=>Math.hypot(...[1,3,5].map(j=>parseInt(a.slice(j,j+2),16)-parseInt(b.slice(j,j+2),16)));
      if (curves.some(c => {
        if (c.role !== 'reference' || distanceColor(color,c.color || c.style?.stroke || '#000000')>40) return false;
        const g=c.geometry || compileSeriesGeometry(c);
        const lo=Math.max(Math.min(el.x1,el.x2),g.domain[0]), hi=Math.min(Math.max(el.x1,el.x2),g.domain[1]);
        if(hi<=lo || Math.abs(el.y2-el.y1)>20) return false;
        const mid=(lo+hi)/2;
        return Math.abs(evaluateGeometry(g,mid)-(Number(el.y1)+Number(el.y2))/2) <= 80 ||
          (c.referenceFit && (el.role==='reference' || el.style?.dash===c.dash) && hi-lo>=(g.domain[1]-g.domain[0])*0.6);
      })) return false;
    }
    if (hasCurves && el.kind === 'circle' && curves.some(c => c.marker?.shape === 'circle' && c.points.some(p =>
      Math.hypot((p[0]-el.cx)*(raster?.w || 1000)/1000,(p[1]-el.cy)*(raster?.h || 1000)/1000) < (c.marker.radiusPx || 3)))) return false;
    if (!b) return true;
    if (el.kind === "polyline" && el.closed && Array.isArray(el.points) && el.points.length >= 4) {
      const xs = el.points.map((p) => Number(p[0])), ys = el.points.map((p) => Number(p[1]));
      const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
      if (el.role !== 'annotation' && spanX >= (b.x1 - b.x0) * 0.7 &&
        (spanY >= (b.y1 - b.y0) * 0.7 || near(Math.min(...xs),b.x0,55))) return false;
    }
    if (el.kind === "line") {
      const x1 = Number(el.x1), x2 = Number(el.x2), y1 = Number(el.y1), y2 = Number(el.y2);
      if(axis && !['annotation','legend'].includes(el.role)) {
        const color=el.style?.stroke || '#000000';
        const black=/^#[0-5][0-9a-f][0-5][0-9a-f][0-5][0-9a-f]$/i.test(color);
        if(black && (Math.abs(x2-x1)>(b.x1-b.x0)*0.65 || Math.abs((x1+x2)/2-b.x0)<55 ||
          (Math.abs(x2-x1)<=160 && Math.abs(y2-y1)<=100))) return false;
      }
      const horizontal = Math.abs(y2 - y1) <= 25 && Math.abs(x2 - x1) >= (b.x1 - b.x0) * 0.65;
      const vertical = Math.abs(x2 - x1) <= 25 && Math.abs(y2 - y1) >= (b.y1 - b.y0) * 0.65;
      if (horizontal && (near((y1 + y2) / 2, b.y0, 55) || near((y1 + y2) / 2, b.y1, 55))) return false;
      if (vertical && (near((x1 + x2) / 2, b.x0, 55) || near((x1 + x2) / 2, b.x1, 55))) return false;
      const shortHorizontal = Math.abs(y2 - y1) <= 25 && Math.abs(x2 - x1) >= 20 && Math.abs(x2 - x1) <= 160;
      if (legend && shortHorizontal && Math.max(x1, x2) <= b.x0 + (b.x1 - b.x0) * 0.22) return false;
      const shortVertical = Math.abs(x2 - x1) <= 25 && Math.abs(y2 - y1) >= 8 && Math.abs(y2 - y1) <= 100;
      if (axis && shortVertical && Math.abs((y1 + y2) / 2 - b.y1) <= 100) return false;
    }
    return true;
  });
}

/** One preparation path for initial output, retries and object-level repairs. */
export function preparePlotModel(input, raster, frameInfo) {
  const raw = (input.curves || []).map((s,i) => normalizeSeries(s,i)).map(s=>fitReferenceLine(raster,fitPrintedMarkers(raster,s)));
  const pointBudgetOptions = {width:raster.w,height:raster.h};
  const curves = budgetSeries(mergeSparseCurveSegments(raw,pointBudgetOptions), pointBudgetOptions);
  const cal = input.yAxis?.calibration;
  // OCR calibration uses real pixels; the series contract uses normalised y.
  const yCalibration = cal?.ok ? { ...cal, toValue:y=>cal.toValue(y*raster.h/1000), toPixel:v=>cal.toPixel(v)*1000/raster.h } : null;
  let joint = null;
  let selected = curves;
  if (input.relations?.length) {
    joint = fitJointSeries(curves,input.relations,{yCalibration,imageWidthPx:raster.w,imageHeightPx:raster.h});
    selected = joint.series;
  }
  const frameDomain = frameInfo?.hasBox ? [frameInfo.bounds.x0/raster.w*1000,frameInfo.bounds.x1/raster.w*1000] : null;
  selected = selected.map(s => ({...s,geometry:compileSeriesGeometry(s,{frameDomain})}));
  const legendSamples=frameInfo?.hasBox ? detectDottedLegend(raster,frameInfo.bounds).concat(detectLegend(raster,frameInfo.bounds,{requireLabel:false,requireIsolation:false,maxXFraction:0.15})) : [];
  selected=selected.map(s=>{
    const a=colourDirection(s.color || s.style?.stroke);
    const shared=a && selected.some(other=>other!==s && (()=>{const b=colourDirection(other.color || other.style?.stroke);return b && a[0]*b[0]+a[1]*b[1]>0.96;})());
    return shared ? s : fitAnalyticImage(raster,s,{bounds:frameInfo?.bounds,legendSamples});
  });
  const geometryCheck = validateSeriesGeometry(selected);
  const relationResult = evaluateRelations({series:selected,relations:input.relations || [],yCalibration,
    options:{imageWidthPx:raster.w,imageHeightPx:raster.h}});
  const result = { ...input,curves:selected,joint,geometryCheck,relationResult,source:'model-semantic-series',fitted:true };
  result.elements = (input.elements || []).filter(el=>el?.role==='frame').concat(removePlotDuplicates(input.elements || [],selected,frameInfo,raster,input.legend,input.axis));
  // All data strokes and markers have one owner. The broad figure pass often
  // emits approximate duplicate circles/zigzags even when asked not to.
  result.elements=result.elements.filter(el=>{
    if(el?.kind==='text') return !(input.legend?.entries || []).some(entry=>legendLabelKey(el.tex)===legendLabelKey(entry.tex));
    if(['axis','frame','legend'].includes(el?.role)) return true;
    const color=el?.style?.fill || el?.style?.stroke;
    if(!/^#[0-9a-f]{6}$/i.test(color || '')) return true;
    return !selected.some(s=>s.role==='data' && /^#[0-9a-f]{6}$/i.test(s.color || '') && Math.hypot(...[1,3,5].map(j=>parseInt(color.slice(j,j+2),16)-parseInt(s.color.slice(j,j+2),16)))<70);
  });
  if(!frameInfo?.hasBox) {
    const horizontal=findAxis(raster),axes=measureOpenAxes(raster,horizontal);
    if(axes.length) {
      result.elements=result.elements.filter(el=>{
        if(el.kind==='text' || ['legend','annotation'].includes(el.role))return true;
        if(el.role==='axis') return false;
        if(el.kind==='polyline' && !el.closed) {const xs=el.points.map(p=>p[0]),ys=el.points.map(p=>p[1]);if(Math.max(...xs)-Math.min(...xs)>300 || Math.max(...ys)-Math.min(...ys)>300)return false;}
        if(el.kind==='line') {
          const x=(Number(el.x1)+Number(el.x2))/2,y=(Number(el.y1)+Number(el.y2))/2;
          if(Math.abs(x-horizontal.x0/raster.w*1000)<100 || Math.abs(y-horizontal.y/raster.h*1000)<100)return false;
        }
        return true;
      }).concat(axes);
    }
  }
  return result;
}

/** A plot revision replaces series, relations and calibration as one unit. */
export function applyPlotRevision(previous, plot, raster, frameInfo, labels) {
  let model={...previous,curves:plot.curves,relations:plot.relations || [],joint:null,relationResult:null,geometryCheck:null};
  if(labels?.length) {
    model.elements=(previous.elements || []).filter(el=>el?.kind!=='text').concat(labels.map(l=>({kind:'text',role:l.role,box:l.box,tex:l.tex,source:'text-recognition'})));
  }
  model=calibratePlotAxes(model,raster,frameInfo);
  return preparePlotModel(model,raster,frameInfo);
}

export function candidateRank(candidate) {
  const hard=candidate?.model?.geometryCheck?.ok !== false && candidate?.model?.relationResult?.ok !== false;
  const gate=acceptance({...candidate.evidence,recall:candidate.geometry?.recall,score:candidate.visual?.score,pass:candidate.visual?.pass});
  return (hard && candidate.compiled?.ok && gate.ok ? 1e9 : 0) + (hard ? 1e7 : 0) + (candidate.compiled?.ok ? 1e6 : 0)
    + (candidate.visual?.score ?? -1)*1000 + (candidate.geometry?.recall || 0);
}
import { pairLegendEntries, bindSeries, validateLegend, emitLegendTikz, legendLabelKey } from "./legend.mjs";
import { registerRegion, referenceFrame } from "./register.mjs";

import { reviewImageAtSourceSize } from "./review-image.mjs";

// Built at runtime so this file contains no literal code fences.
const BT = String.fromCharCode(96);
const FENCE = BT + BT + BT;
const FENCE_RE = new RegExp(FENCE + "(?:latex|tex|tikz)?\\s*\\n([\\s\\S]*?)" + FENCE, "i");

/* ------------------------------------------------------------------ prompts */

const COMMON_RULES = [
  "You are a senior LaTeX/TikZ engineer producing figures for academic papers.",
  "",
  "Output contract:",
  "- Reply with ONE fenced code block tagged latex, containing a complete standalone document.",
  "- Start with \\documentclass[tikz,border=8pt]{standalone}; load ctex when Chinese text appears, plus amsmath/amssymb and only the tikz libraries you use.",
  "- Available tikz libraries ONLY: arrows.meta, positioning, calc, shapes.geometric, shapes.symbols, decorations.pathreplacing, decorations.markings, patterns, plotmarks, shadows, intersections. Anything else is an 'Unknown library' error.",
  "- Flowchart shapes: use the built-in shapes (\\\\node[cloud, draw] {}, \\\\node[rectangle, rounded corners, draw] {}, \\\\node[diamond, draw] {}) instead of hand-drawing them with bezier curves — hand-drawn approximations look lumpy and eat your line budget.",
  "- The document MUST compile with XeLaTeX, without shell escape, in one pass.",
  "- Never use \\write18, external files, images or network resources.",
  "- Prefer semantic TikZ: named coordinates, a shared style or \\tikzset, no magic numbers when a coordinate name reads better.",
  "- Keep it tidy: one element per line, consistent indentation.",
  "- Be COMPACT: 25–45 body lines, at most 40 elements. No comments except the \"% y = …\" hint, no blank lines, no unused libraries.",
  "- If the figure would need more than 40 elements, SIMPLIFY the design — an oversized document gets cut off and is unusable.",
  "- The reply must be complete. Never stop mid-document.",
].join("\n");

const CANVAS_RULES = [
  "The figure will be re-opened in a graphical editor, so stay inside this subset:",
  "- Straight lines: \\draw[<opts>] (x1,y1) -- (x2,y2);",
  "- Rectangles: \\draw[<opts>] (x1,y1) rectangle (x2,y2);",
  "- Circles: \\draw[<opts>] (cx,cy) circle (r);  Ellipses: \\draw[<opts>] (cx,cy) ellipse (rx and ry);",
  "- Curves: \\draw[<opts>] (x0,y0) .. controls (x1,y1) and (x2,y2) .. (x3,y3);",
  "- Text: \\node[<opts>] at (x,y) {text};",
  "- Axes: exactly two draws, \\draw[->, thick] (x0,y0) -- (x1,y0) node[right] {$x$}; and \\draw[->, thick] (x0,y0) -- (x0,y1) node[above] {$y$};",
  "- Functions: \\draw[<opts>] plot[domain=a:b, samples=n, smooth] (\\x, {expression in \\x});",
  "- NEVER paste sampled coordinates (plot ... coordinates {(0.1,0.5) (0.2,0.6) ...}). One curve = one line with an expression. A 500-point list is 7 KB and gets the document cut off.",
  "- Do NOT draw tick numbers, tick marks or extra \\node labels for the axes: the editor renders ticks itself, so hand-written ones become duplicates.",
  "- One axis pair only — exactly two \\draw[->, thick] lines, labels {$x$} / {$y$}. Never a second coordinate system.",
  "- Do NOT draw dimension arrows like \\draw[->] (-0.05,0.5) -- (0,0.5) node[right] {$0.5$}; annotate with \\node instead.",
  "- Do NOT use picture-level scaling (\\begin{tikzpicture}[x=1.4cm,y=3.8cm]): the editor assumes 1cm units. Pick real coordinates.",
  "- Colours: only xcolor's named colours (black white red green blue cyan magenta yellow gray darkgray lightgray brown lime olive orange pink purple teal violet) or a mix such as blue!40. NEVER invent a name like leftcol — it must be defined or the document will not compile.",
  "- Expression whitelist: sin cos tan asin acos atan exp ln log sqrt abs min max floor ceil round sign pow deg rad, numbers, pi, e, x, + - * / ^, parentheses.",
  "  Angles: pgfmath trig is DEGREES by default — either append \" r\" to the argument (radians) or convert explicitly with deg()/rad().",
  "- Only ONE plot per function, domain inside the axis range; samples between 80 and 600.",
  "- If the figure needs something outside this list, simplify it rather than writing something the editor cannot read.",
  "Forbidden in this mode: \\foreach, decorations, matrices, \\path, \\clip, pattern fills, 3d/graph libraries, shape redefinitions.",
  "",
  "Structural template — stay close to this size and shape:",
  "\\begin{tikzpicture}",
  "  \\draw[->, thick] (-0.5,0) -- (6,0) node[right] {$x$};",
  "  \\draw[->, thick] (0,-1.5) -- (0,1.5) node[above] {$y$};",
  "  \\draw[blue, thick] plot[domain=0:5, samples=200, smooth] (\\x, {sin(\\x r)});",
  "  \\node at (3,2) {$y=\\sin x$};",
  "\\end{tikzpicture}",
  "Five to fifteen lines of body is a normal figure. Do not write more than 40 lines.",
  "Style options must stay short: \\draw[thick, blue] — not ten keys per element.",
].join("\n");

// Screenshots from papers: transcribe, do not redesign. The point is to get a
// figure that can be re-opened in the editor, so the primitive subset is strict.
const SCREENSHOT_RULES = [
  "The attached image is a figure captured from a paper or a screenshot.",
  "Transcribe it — do not redesign, restyle or 'improve' it.",
  "",
  "- Layout: keep relative positions, sizes, alignment and the overall aspect ratio.",
  "- Canvas: work in a 0–12cm box. Assume ~100px of the screenshot corresponds to 1cm.",
  "- Completeness: every visible element appears exactly once. No invented arrows, badges, shadows or gradients.",
  "- Editability: only the primitives listed below. No decorations, shadings, patterns, clipping, \\foreach or pgfplots.",
  "- Text: copy the words verbatim, wrap maths in $…$, and place each label with \\node at its position in the image.",
  "- Curves: use plot[...] when it is a function of x; otherwise approximate with bezier segments through sampled points.",
  "- Photos or hand-drawn strokes: approximate with the closest primitive instead of omitting them.",
  "",
  "Structure that models usually get wrong — check each one:",
  "- A family of curves (ridge/waterfall/density plot, e.g. 15 stacked slices) must be drawn as that many separate curves with the same shape offset vertically. One curve is NOT a transcription of a family.",
  "- A colorbar or gradient is 8–12 adjacent rectangles with graded fills (fill=blue!80, blue!70 …), never a single flat rectangle.",
  "- Curves must span the panel they belong to: if the axis runs -9…9, the domain is -9…9, not just the visible peak.",
  "- A well/step shape needs several segments (flat part + steep walls + flat bottom), not one cubic that rounds everything off.",
  "- Labels sit where the image puts them; if a label would collide with a line, nudge it 0.3cm, do not move it across the panel.",
  "- Keep the panel layout proportional: measure the boxes in the image and scale them into the 0–12cm canvas.",
  "- Count the panels in the image first. Every panel must appear — a missing colour-bar strip is a failed transcription.",
  "- Step functions are steps: a vertical segment between two horizontal ones, not a smooth decay.",
  "- Ridge/waterfall slices PEAK UPWARD at the centre (a bump above the baseline). If your curve dips downward you used the wrong sign or the wrong offset — check it before answering.",
  "- Every panel in the screenshot must produce content: an empty panel is a missing part of the figure, not a simplification.",
  "- Do not add vertical connector segments between curve points: a smooth curve is one plot/bezier, and its endpoints stop where the curve stops in the image.",
  "- Everything must stay INSIDE its panel frame: draw the rectangle first, then keep every curve, tick and label within those coordinates. Curves poking out of the frame is the most common layout error.",
  "- Check the extremes: the tallest peak must still be below the frame's top edge, the lowest point above the bottom edge.",
  "- Before answering, compare your TikZ with the image element by element: panel count, curve-family count, ticks, colour bar, labels. Fix what is missing, then answer.",
].join("\n");

function styleNote(canvasMode, screenshot = false, perPanel = false) {
  let canvas = CANVAS_RULES;
  if (screenshot) {
    // Fidelity is the point here: a 15-slice ridge plot + ticks + a colour bar
    // needs far more elements than a hand-written diagram.
    canvas = canvas
      .replace(/- 25–45 body lines, at most 40 elements[^\n]*\n/, "")
      .replace(/- If the figure would need more than 40 elements[^\n]*\n/, "")
      .replace(
        /Five to fifteen lines of body is a normal figure\. Do not write more than 40 lines\./,
        perPanel
          ? "This is ONE panel: up to 90 body lines. Reproduce its curves and ticks faithfully, but do not draw anything outside this crop. A ridge plot with 15+ slices needs one line per slice — that is expected here."
          : "Transcription budget: up to 70 body lines. If the image has several panels, use the panel-split workflow instead of cramming everything into one reply — an oversized reply gets cut off and is unusable."
      );
    // For a transcription the ticks ARE part of the figure — the editor's own
    // ticks would duplicate them, so we keep the image's ticks and drop ours.
    canvas = canvas
      .replace(
        /- Do NOT draw tick numbers[^\n]*\n/,
        "- Reproduce the axis ticks and their numbers exactly as in the image (position and value).\n"
      )
      .replace(/- One axis pair only[^\n]*\n/, "- Draw each panel border as a rectangle; draw axis arrows only where the image shows them.\n");
  }
  const rules = canvasMode ? COMMON_RULES + "\n\n" + canvas : COMMON_RULES;
  return screenshot ? SCREENSHOT_RULES + "\n\n" + rules : rules;
}

/** Extra rules used when a previous reply could not be parsed into elements. */
const STRICT_RULES = [
  "HARD CONSTRAINTS (the previous attempt used commands the editor cannot read):",
  "- Every mark must be a separate \\draw command: lines, rectangles, circles, ellipses, bezier curves.",
  "- NO \\foreach, NO \\path, NO \\clip, NO \\begin{scope}, NO \\matrix, NO styles, NO \\usetikzlibrary.",
  "- Text only through \\node at (x,y) {text}; coordinates must be plain numbers.",
  "- Repeat the shape N times by writing N lines — a ridge family of 15 slices is 15 \\draw lines.",
].join("\n");

function userMessage({ mode, prompt, canvasMode, perPanel = false, strict = false }) {
  if (mode === "image") return [
    "Transcribe the attached scientific figure faithfully as one complete standalone TikZ document in a latex code block.",
    perPanel ? "This is ONE cropped panel. Reproduce only this crop, including its labels and margins." : "Keep all panels and their relative positions and aspect ratios.",
    "Copy geometry, text, colors, line styles and curve counts. Do not redesign or add axes, arrows, grids or labels absent from the image.",
    "Use actual numeric coordinates in cm; preserve the image aspect ratio. Width about 12cm, height proportional to the image. No picture-level scale, x= or y= units.",
    "Draw each visible frame once. Fit the entire curve family inside that frame: measure baselines, peak locations, peak heights and widths separately. Slices need not be identical translations.",
    "Copy the visible axis labels and tick values; never substitute x/y or invented ticks. Labels outside a frame must remain outside.",
    "Trace uncertain curves with cubic Bezier segments; never claim an inferred formula is original scientific data. For a repeated ridge family, use one compact rational bump plot per slice with measured baseline, height and width (e.g. b+a/(1+((x-c)/w)^2)^2). Do not draw separate flat baseline lines underneath the curves.",
    "For function plots use plot[domain=a:b,samples=120] (\\x,{expression}); avoid large exponentials that overflow TeX. All baseline and peak values must fit the measured frame height. One curve per draw command.",
    "A colorbar is adjacent filled rectangles WITHOUT outlines, following sampled image colors. Use named xcolor colors or explicit RGB colors, never undefined color names.",
    "Reproduce dots/dashes, fills and line widths. Keep every visible label in a node at (x,y), with math inside $...$.",
    canvasMode ? "Editable commands: draw/fill lines (--), closed polygons (-- cycle), rectangles, circles, ellipses, single cubic Beziers (.. controls .. and .. ..), nodes and function plots. No macros, foreach, scope, clip, styles, pgfplots, decorations or external images." : "Use self-contained TikZ without external files or shell escape.",
    "No named coordinates or implicit positioning. Each command occupies one line, ends in a semicolon, and uses explicit coordinates. Avoid chained subpaths.",
    "Complete standalone document, with amsmath/amssymb; include ctex only for Chinese. At most 90 draw/node commands and 110 body lines. Count visible elements first and draw each exactly once. Never keep adding evenly spaced lines beyond the frame. End the document immediately after the final visible element. No explanatory prose.",
    strict ? STRICT_RULES : "",
    prompt ? "Additional user request: " + prompt : "",
  ].filter(Boolean).join("\n");
  const head = mode === "image" ? "Reproduce the attached figure as TikZ." : prompt;
  return [
    "Request: " + head,
    "",
    "Constraints:",
    "- Aesthetic: clean, publication-ready, comfortable whitespace, consistent line weights.",
    "- Use cm-based coordinates on a 6-12cm wide canvas.",
    "- Chinese labels are fine (ctex is loaded).",
    "",
    styleNote(canvasMode, mode === "image", perPanel),
    strict ? "\n" + STRICT_RULES : "",
  ].join("\n");
}

const REVIEWER_SYSTEM = [
  "You are a TikZ figure reviewer. You never write code and never rewrite the document — you only judge it.",
  "",
  "You receive: the user request, the generated document, the compile result, and static-analysis findings.",
  "Decide whether the figure is deliverable, then emit machine-readable findings.",
  "",
  "Blocking problems (any one => verdict \"revise\"):",
  "- COMPILE_ERROR      the document does not compile",
  "- EMPTY_FIGURE       no elements besides axes / every plot sampled to nothing",
  "- PLOT_EXPR          missing \"% y = <expr>\" comment, e^ instead of exp(), expression not evaluable",
  "- DEGREE_MODE        trig argument without the radian suffix r",
  "- MATH_MODE          LaTeX commands in node text without $...$ (compile fails)",
  "- AXIS_PLOT_MISMATCH curve leaves the coordinate system, or axis range is absurd for the data",
  "- SEMANTIC_MISMATCH  the figure is not what the user asked for (missing element, wrong count, wrong direction)",
  "",
  "Minor problems: labels overlapping, cramped spacing, inconsistent line weights.",
  "",
  "Sanity checks on plots (very common failure):",
  "- A curve that is a nearly horizontal line means the degrees/radians handling is wrong: pgfmath trig takes DEGREES, so sin(x) with a radian x needs the \" r\" suffix or an explicit deg()/rad() conversion.",
  "- The plotted range should cover the region the user asked about, and the function should visibly vary there.",
  "- If the request names a function, the document must plot exactly that function — not a flattened or rescaled variant.",
  "- EDIT requests: the user asked for a small change to an existing figure. If more than ~40% of the original lines disappeared, the generator redrew it — verdict \"revise\" and tell it to keep the original geometry and change only the requested part.",
  "",
  "Output ONLY a JSON object, no prose, no code fence:",
  "{\"verdict\":\"pass\"|\"revise\",\"score\":0-100,\"issues\":[{\"code\":\"...\",\"severity\":\"blocker\"|\"major\"|\"minor\",\"where\":\"line 12\",\"message\":\"...\",\"fix\":\"...\"}],\"instructions\":\"one short paragraph telling the generator what to change; empty when pass\"}",
  "",
  "Rules: every issue must point at a line and give a concrete fix. Never invent line numbers. " +
    "Judge only what you can see in the document, the compile output and the static findings.",
].join("\n");

const REVIEW_MARKER = "You are a TikZ figure reviewer.";

function reviewMessage({ request, code, compile, lint, edit }) {
  const lintLines = (lint.issues || [])
    .slice(0, 10)
    .map((i) => `- [${i.severity}] ${i.code} ${i.where ? i.where + ": " : ""}${i.message} (fix: ${i.fix})`)
    .join("\n");
  // A 6KB document costs the reviewer seconds of prefill; the head + tail is enough
  // to judge structure, and the lint findings cover the rest.
  const docLines = String(code || "").split("\n");
  const shown = docLines.length > 160 ? [...docLines.slice(0, 110), "… " + (docLines.length - 140) + " lines omitted …", ...docLines.slice(-30)] : docLines;
  const compileLines = compile.ok
    ? "compilation: OK"
    : "compilation: FAILED\n" +
      (compile.errors || [])
        .slice(0, 8)
        .map((e) => `- ${e.line ? "line " + e.line + ": " : ""}${e.message}`)
        .join("\n");
  return [
    "User request:",
    request,
    "",
    edit
      ? `This was an EDIT request, not a redraw. ${edit.changed} of ${edit.total} original lines changed (${Math.round(edit.ratio * 100)}%).`
      : "",
    compileLines,
    "",
    "Static analysis:",
    lintLines || "- none",
    "",
    "Document:",
    FENCE + "latex",
    shown.join("\n"),
    FENCE,
    "",
    "Answer with the JSON object only. At most 3 issues, instructions under 40 words.",
  ].join("\n");
}

/** Exposed for prompt tests / debugging. */
export function debugPrompt(opts) {
  return userMessage(opts);
}

/** Deterministic feedback when the reviewer is unavailable or its JSON is broken. */
/** Edit mode: hand the current document over and forbid redrawing. */
function editMessage({ current, prompt, canvasMode }) {
  return [
    "修改下面的 TikZ 文档。这是**局部编辑**，不是重画：",
    "",
    "- 只改动与需求相关的部分；其余元素的坐标、样式、标签、结构必须保持原样。",
    "- 不要重新设计版式，不要为了「更好看」而替换已有图形。",
    "- 返回完整可编译的文档（一个 latex 代码块），不要只给 diff。",
    "",
    "需要做的修改：" + (prompt || "(见上)"),
    "",
    "当前文档：",
    FENCE + "latex",
    current,
    FENCE,
    "",
    "规则：",
    styleNote(canvasMode),
  ].join("\n");
}

/** How much of the original survived? Used to catch "asked for a tweak, got a redraw". */
function lineDiff(before, after) {
  const norm = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const a = new Set(norm(before));
  const b = new Set(norm(after));
  if (!a.size) return { total: 0, kept: 0, changed: 0, ratio: 0 };
  let kept = 0;
  for (const line of a) if (b.has(line)) kept++;
  const changed = a.size - kept;
  return { total: a.size, kept, changed, ratio: changed / a.size };
}

function repairMessage({ prevCode, errors, attempt, lint, sweep = false }) {
  const sourceLines = String(prevCode || "").split("\n");
  const snippet = (lineNo) => {
    const text = sourceLines[Number(lineNo) - 1];
    return text ? "   >>> " + text.trim().slice(0, 120) : "";
  };
  // Group by message: TeX reports the same problem once per occurrence, and a
  // model that fixes only the first one burns a whole extra round. Say the count.
  const groups = new Map();
  for (const e of errors || []) {
    const key = String(e.message || "").trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { message: key, lines: [], sample: "" });
    const g = groups.get(key);
    if (e.line) {
      g.lines.push(e.line);
      if (!g.sample) g.sample = snippet(e.line);
    }
  }
  const list = [...groups.values()]
    .slice(0, 8)
    .map((g, i) => {
      const where = g.lines.length ? " — line " + g.lines.slice(0, 8).join(", ") + (g.lines.length > 8 ? " …" : "") : "";
      const many = g.lines.length > 1 ? ` [occurs ${g.lines.length}×, fix ALL of them]` : "";
      return `${i + 1}. ${g.message}${where}${many}${g.sample ? "\n" + g.sample : ""}`;
    })
    .join("\n");
  const lintList = (lint?.issues || [])
    .slice(0, 10)
    .map((i) => "- [" + i.severity + "] " + i.code + " " + (i.where || "") + ": " + i.message)
    .join("\n");
  return [
    "The document below failed to compile (attempt " + attempt + "). Fix EVERY listed error — including every occurrence of a repeated one — keep the design, and return the complete corrected document.",
    "",
    sweep
      ? [
          "IMPORTANT: this exact error came back after your previous fix. You patched one spot;",
          "there are more. Before answering, scan the ENTIRE document for the construct that causes",
          "each error and rewrite all of those places in this single pass. Then re-read your output",
          "once and check that no instance is left.",
          "",
        ].join("\n")
      : "",
    "Compilation errors:",
    list || "(none reported)",
    "",
    "Before answering, search the whole document for the construct behind each error and fix every",
    "occurrence — not just the reported line. Re-read your output once at the end and confirm no",
    "instance is left.",
    "",
    lintList ? "Static analysis findings:\n" + lintList + "\n" : "",
    "Document:",
    FENCE + "latex",
    prevCode,
    FENCE,
  ].join("\n");
}

function reviewRepairMessage({ prevCode, review }) {
  const issues = (review.issues || [])
    .slice(0, 12)
    .map((i, k) => `${k + 1}. [${i.severity}] ${i.code}${i.where ? " " + i.where : ""}: ${i.message}${i.fix ? " -> " + i.fix : ""}`)
    .join("\n");
  return [
    "The reviewer rejected the document below. Apply every blocker and major issue; keep everything that was not flagged.",
    "",
    "Review instructions:",
    review.instructions || "(see issues)",
    "",
    "Issues:",
    issues || "(none listed)",
    "",
    "Document:",
    FENCE + "latex",
    prevCode,
    FENCE,
  ].join("\n");
}

function parseReview(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    if (!obj || typeof obj !== "object") return null;
    const verdict = obj.verdict === "pass" ? "pass" : "revise";
    return {
      verdict,
      score: Number.isFinite(obj.score) ? obj.score : verdict === "pass" ? 85 : 55,
      issues: Array.isArray(obj.issues) ? obj.issues.filter((i) => i && i.message).slice(0, 20) : [],
      instructions: typeof obj.instructions === "string" ? obj.instructions : "",
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- calls */

export function extractCode(text) {
  const m = FENCE_RE.exec(text);
  const body = m ? m[1] : text;
  const start = body.search(/\\documentclass|\\begin\{tikzpicture\}/);
  return (start >= 0 ? body.slice(start) : body).trim();
}

/** Always hand back a compilable standalone document. */
export function ensureDocument(code) {
  const c = code.trim();
  if (/\\documentclass/.test(c)) {
    const hasTikz = /\\documentclass\[[^\]]*\btikz\b/.test(c) || /\\usepackage(?:\[[^\]]*\])?\{[^}]*\btikz\b/.test(c);
    return hasTikz ? c : c.replace(/\\begin\{document\}/, "\\usepackage{tikz}\n\\begin{document}");
  }
  return wrapSource(c).tex;
}

/** Turn an upstream HTTP failure into something a human can act on. */
export function describeUpstream(status, text, endpoint) {
  const where = endpoint ? " · " + endpoint : "";
  let detail = "";
  try {
    const j = JSON.parse(text);
    detail = j?.error?.message || j?.message || "";
  } catch {
    detail = String(text || "").slice(0, 240);
  }
  // Some gateways (DeepSeek included) list the valid ids right in the 400 body:
  // "the supported API model names are a, b, but you passed c".
  const supportedMatch = /supported API model names are ([^.;\n]+)/i.exec(detail);
  const supported = supportedMatch
    ? Array.from(
        new Set(
          supportedMatch[1]
            .split(/\s+but\s+/i)[0] // drop "…, but you passed X"
            .split(/,|\band\b/)
            .map((s) => s.trim().replace(/^[`'"(\[]+|[`'")'\]]+$/g, ""))
            // keep only things that look like an id, not sentence fragments
            .filter((s) => /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(s))
        )
      )
    : undefined;

  const hint =
    status === 401
      ? "API Key 无效或未授权"
      : status === 402
        ? "账户余额不足"
        : status === 403
          ? "没有该模型的权限"
          : status === 404
            ? "接口或模型不存在（检查 Base URL 与模型名）"
            : status === 429
              ? "请求过于频繁 / 额度用尽"
              : status >= 500
                ? "上游服务异常"
                : "请求被拒绝";
  return { message: hint + "（HTTP " + status + "）" + (detail ? "：" + detail : "") + where, detail, supported };
}

/** An empty base URL is a configuration bug — never fall back to a vendor silently. */
export function requireBaseUrl(baseUrl) {
  // People paste the full endpoint (".../v1/chat/completions") or a docs URL ending
  // in "/models" surprisingly often — accept both and strip back to the base.
  const base = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|models|completions)$/i, "");
  if (!base) {
    const e = new Error("没有配置 Base URL：服务商没选好，或地址被清空了。重新点一下服务商即可自动填回。");
    e.code = "NO_BASE_URL";
    throw e;
  }
  return base;
}

async function chat({ messages, apiKey, baseUrl, model, temperature, signal, maxTokens, timeoutMs = 180_000, thinking }) {
  const base = requireBaseUrl(baseUrl);
  const body = { model: model || "gpt-4o", messages };
  // DeepSeek's current vision model defaults to high-effort reasoning. Image
  // transcription needs an actual artifact within the response budget.
  if (thinking && new URL(base).hostname === "api.deepseek.com" && /^deepseek-(flash|v4-pro)$/.test(model || "")) {
    body.thinking = { type: thinking };
  }
  // Output tokens dominate latency: a 6KB figure takes ~1500 tokens to write.
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  // Reasoning models reject/ignore sampling knobs — do not send them.
  if (!/reasoner|deepseek-r1|o1|o3/i.test(String(model || ""))) body.temperature = temperature;
  const timer = new AbortController();
  const to = setTimeout(() => timer.abort(), timeoutMs);
  const onAbort = () => timer.abort();
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) timer.abort();
  let res;
  let text;
  try {
    res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify(body),
      signal: timer.signal,
    });
    text = await res.text();
  } catch (err) {
    const e = new Error(timer.signal.aborted ? "上游 API 超时或已取消" : "无法连接上游 API：" + err.message);
    e.code = "UPSTREAM_UNREACHABLE";
    throw e;
  } finally {
    clearTimeout(to);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!res.ok) {
    const info = describeUpstream(res.status, text, "POST " + base + "/chat/completions");
    const e = new Error(info.message);
    e.code = info.supported?.length
      ? "BAD_MODEL"
      : res.status === 401 || res.status === 403
        ? "BAD_KEY"
        : res.status === 402
          ? "NO_BALANCE"
          : "UPSTREAM_ERROR";
    e.supported = info.supported;
    e.status = res.status;
    throw e;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const e = new Error("上游返回了非 JSON 响应");
    e.code = "UPSTREAM_ERROR";
    throw e;
  }
  const msg = json.choices?.[0]?.message ?? {};
  // Reasoning is never the requested artifact, even when the answer is empty.
  const content = msg.content;
  if (typeof content !== "string" || !content.trim()) {
    const e = new Error("上游没有返回内容");
    e.code = "EMPTY_RESPONSE";
    throw e;
  }
  return {
    text: content,
    model: json.model || body.model,
    usage: json.usage || null,
    // "length" means the figure was cut mid-document — the resulting TikZ has a
    // half-written command, which looks like a random compile error every round.
    finishReason: json.choices?.[0]?.finish_reason ?? null,
  };
}

async function compileCheck(code, engine, signal, timeoutMs = 60_000) {
  const { tex } = wrapSource(code);
  const job = await compileToPdf(tex, { engine, timeoutMs: Math.max(1, timeoutMs), signal });
  try {
    if (job.ok) return { ok: true, errors: [], warnings: job.warnings, log: "" };
    let log = job.log;
    try {
      log = await readFile(job.dir + "/main.log", "utf8");
    } catch {}
    return {
      ok: false,
      errors: job.errors.length ? job.errors : [{ line: null, message: job.timedOut ? "编译超时" : "编译失败" }],
      warnings: job.warnings || [],
      log: String(log).slice(-4000),
    };
  } finally {
    await job.cleanup();
  }
}

/** Compile and rasterise: the rendered PNG is what the geometry checks need. */
async function compileAndRender(code, engine, signal, timeoutMs) {
  const job = await compileToPdf(code, { engine, signal, timeoutMs });
  try {
    if (!job.ok) {
      let log = job.log;
      try { log = await readFile(job.dir + "/main.log", "utf8"); } catch {}
      return {
        ok: false,
        errors: job.errors.length ? job.errors : [{ line: null, message: job.timedOut ? "编译超时" : "编译失败" }],
        warnings: job.warnings || [],
        log: String(log).slice(-2000),
        png: null,
      };
    }
    const rendered = await renderPreview(job.pdfPath, job.dir, { dpi: 150, wantPng: true, signal });
    const png = await readFile(rendered.pngPath);
    return { ok: true, errors: [], warnings: job.warnings || [], log: "", png: "data:image/png;base64," + png.toString("base64") };
  } finally {
    await job.cleanup();
  }
}

/** The reviewer sees BOTH the source screenshot and the actual compiled result. */
export async function compareVision({ source, image, apiKey, baseUrl, model, engine = "xelatex", signal, renderedImage }) {
  let job;
  try {
    let preview = renderedImage;
    if (!preview) {
      job = await compileToPdf(source, { engine, signal, timeoutMs: 30_000 });
      if (!job.ok) return { ok: false, compiled: false, pass: false, score: 0, issues: job.errors.map(e => ({ severity: "blocker", message: e.message })) };
      const rendered = await renderPreview(job.pdfPath, job.dir, { wantPng: true, dpi: 120, signal });
      const png = await readFile(rendered.pngPath);
      preview = "data:image/png;base64," + png.toString("base64");
    }
    if (/^data:image\/png;/.test(image)) preview = reviewImageAtSourceSize(image, preview);
    const out = await chat({ apiKey, baseUrl, model, temperature: 0, thinking: "disabled", signal, maxTokens: 1200, timeoutMs: 45_000,
      messages: [{ role: "user", content: [
        { type: "text", text: 'Only require structures actually visible in image 1. Do not require axes, ticks, frames or a legend in a diagram that originally has none. Both images use the same comparison canvas; compare relative positions and shapes. Answer ONLY JSON: {"pass":true,"score":0,"issues":[{"severity":"minor|major|blocker","target":"object or region","box":[x,y,width,height],"message":"concrete visible defect"}],"instructions":"specific corrections"}. Score 0..100. Check filled regions, discrete markers, connections, panel count, shared legends and discontinuities as well as text. An approximation losing high-frequency signal details is not a faithful reconstruction. Empty output, omitted objects or changed topology are major errors.' },
        { type: "text", text: `Compare image 1 (original scientific figure) with image 2 (actual reconstruction). Judge only visible fidelity: panels and layout, curve counts and shapes, frame containment, labels, colors, dashed and dotted lines. Ignore anti-aliasing and small font differences. Check these by name and report them individually: (1) panel frame present and complete; (2) x axis and y axis lines; (3) tick marks; (4) every tick label, including values and minus signs; (5) axis labels; (6) legend - a short sample stroke plus its label for each curve, with the stroke matching that curve colour, width and dash. ALSO describe local shape defects with a location and magnitude, for example: curve 3 peak is too pointed (triangular) instead of a smooth Gaussian; shoulders of curve 5 have a kink at x around 62%; adjacent curves cross near the peak; the peak amplitude is about half of the original. Never say only that curves are wrong: name the curve, the place, and what is wrong with the shape.` },
        { type: "image_url", image_url: { url: image } },
        { type: "image_url", image_url: { url: preview } },
      ] }],
    });
    const extractJson = (t) => {
      const cleaned = String(t || "").replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      return JSON.parse(s >= 0 && e > s ? cleaned.slice(s, e + 1) : cleaned);
    };
    let json;
    try {
      json = extractJson(out.text);
    } catch {
      // One strict re-ask beats accepting a prose answer as a verdict.
      const retry = await chat({
        apiKey, baseUrl, model, temperature: 0, thinking: "disabled", signal, maxTokens: 800, timeoutMs: 45_000,
        messages: [{ role: "user", content: [
          { type: "text", text: "Answer ONLY with JSON: {\"pass\":true|false,\"score\":0-100,\"issues\":[{\"severity\":\"minor\",\"target\":\"other\",\"box\":[x,y,w,h],\"message\":\"...\"}],\"instructions\":\"...\"}. No prose." },
          { type: "image_url", image_url: { url: image } },
          { type: "image_url", image_url: { url: preview } },
        ] }],
      });
      json = extractJson(retry.text);
    }
    if (!Number.isFinite(json.score) || !Array.isArray(json.issues) || typeof json.pass !== "boolean") throw new Error("视觉审核返回的格式无效");
    // Every issue must carry a location. Accept the usual shapes, and put the
    // coordinate span into the message itself so it is visible in the step log.
    for (const issue of json.issues) {
      let box = issue.box || issue.bbox || issue.rect || issue.region;
      if (Array.isArray(box) && box.length === 4) {
        if (Array.isArray(box[0])) {
          // [[x1,y1],[x2,y2]]
          const x1 = Number(box[0][0]), y1 = Number(box[0][1]), x2 = Number(box[1][0]), y2 = Number(box[1][1]);
          box = [x1, y1, x2 - x1, y2 - y1];
        } else if (box[2] > box[0] && box[3] > box[1] && (box[2] - box[0]) > 30 && (box[3] - box[1]) > 30 && box[2] > 150 && box[3] > 150) {
          // [x1,y1,x2,y2]
          box = [box[0], box[1], box[2] - box[0], box[3] - box[1]];
        }
      }
      if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => Number.isFinite(Number(v)))) {
        const m = /\[?\s*(-?\d+)\s*,\s*(-?\d+)\s*\]?\s*[-–to]+\s*\[?\s*(-?\d+)\s*,\s*(-?\d+)/.exec(String(issue.message || ""));
        if (m) box = [Number(m[1]), Number(m[2]), Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])];
      }
      if (Array.isArray(box) && box.length === 4) {
        issue.box = box.map(Number);
        const [x, y, w, h] = issue.box;
        const span = "[" + Math.round(x) + "," + Math.round(y) + "]-[" + Math.round(x + w) + "," + Math.round(y + h) + "]";
        if (!String(issue.message || "").includes(span)) {
          issue.message = span + " " + String(issue.message || "").trim();
        }
      }
    }
    return { ok: true, compiled: true, pass: json.pass && json.score >= 80 && !json.issues.some(i => ["blocker", "major"].includes(i.severity)), score: json.score, issues: json.issues.slice(0, 5), instructions: String(json.instructions || "") };
  } finally { if (job) await job.cleanup(); }
}


export const FIGURE_PROTOCOL = "BEFORE DRAWING, FOLLOW THIS ORDER. It is not optional:\nSTEP 1 - Read the frame: find the panel border (the long horizontal and vertical lines). Output it as ONE closed polyline through its four corners, or as four line elements. Never emit it twice.\nSTEP 2 - Read the text: list every readable string with a tight box around the glyphs only (never the legend stroke, axis line or frame). Use the exact printed characters, minus signs included.\nSTEP 3 - Place the text: one element per string, one string per element. A string that appears once in the image appears ONCE in your output. Duplicated text is a fatal error.\nSTEP 4 - Then draw the data: curves, markers, ticks. Do not draw the text again as pixels, and do not leave a second copy of a string anywhere.\nRULE: if you cannot place a string confidently, still emit it once at your best estimate. NEVER emit it twice.";

const UNDERSTAND_PROMPT = [
  FIGURE_PROTOCOL,
  "",
  "Study this figure and describe it as EXACT geometric primitives. Do not write TikZ and do not list pixel coordinates.",
  'Return ONLY compact JSON: {"type":"geometry|plot|diagram|flowchart|table|mixed|other","summary":"one short sentence, Chinese","elements":[{"kind":"circle","cx":0,"cy":0,"r":0,"style":{"stroke":"#rrggbb","width":2,"fill":"#rrggbb or null","dash":"solid|dashed|dotted"}},{"kind":"ellipse","cx":0,"cy":0,"rx":0,"ry":0,"rotate":0,"style":{...}},{"kind":"line","x1":0,"y1":0,"x2":0,"y2":0,"style":{...}},{"kind":"polyline","points":[[0,0]],"closed":false,"style":{...}},{"kind":"text","box":[0,0,0,0],"tex":"visible text","rotate":0}]}',
  "Coordinates are normalised 0..1000, origin top-left, x right, y down.",
  "Rules:",
  "- A ball or disc outline is a CIRCLE; the same circle seen in perspective (an equator, a rim, a base) is an ELLIPSE.",
  "- Straight edges and frames are lines or closed polylines. Never approximate a circle, ellipse or straight edge with many sampled points.",
  "- Every visible string is ONE text element with a tight box around the glyphs; never draw glyphs as strokes.",
  "- Keep painting order: background fill first, then outlines, text last.",
  "- style.width is the stroke width in SOURCE PIXELS of the screenshot (a normal outline is 2-3 px, a dashed helper line 1-2 px).",
  "- A sphere or ball: one circle for the silhouette, and the equator split into TWO arcs — the front half solid, the back half dashed — not two full ellipses.",
  "- Every text box must lie fully inside 0..1000 on both axes.",
  "- NEVER replace a circle, ellipse or arc with a polyline, however imperfect the first attempt was: adjust the parameters of the same primitive instead.",
  "- Example of the sphere idiom: {\"kind\":\"circle\",\"cx\":500,\"cy\":480,\"r\":430,\"style\":{\"stroke\":\"#000000\",\"width\":3,\"fill\":\"#f4f4f4\"}} plus {\"kind\":\"arc\",\"cx\":500,\"cy\":470,\"rx\":430,\"ry\":90,\"start\":180,\"end\":360,\"style\":{\"dash\":\"dashed\",\"width\":2}} and {\"kind\":\"arc\",\"cx\":500,\"cy\":470,\"rx\":430,\"ry\":90,\"start\":0,\"end\":180,\"style\":{\"width\":3}}.",
  "- Never emit the same element twice (no repeated identical lines/polylines). If unsure, emit fewer, well-placed elements.",
  '- For a PLOT return type="plot". Axes, ticks and labels go in elements. A dedicated pass owns all data series, markers and reference lines: do not also draw those as polylines, circles or duplicate line elements. A plot with discrete vertices is not a smooth function.',
  "- Do not invent elements that are not visible. At most 60 elements.",
  "Vocabulary. Name these structures and emit them exactly like this:",
  "- PANEL FRAME: the outer rectangle bounding the plot -> ONE closed polyline through its four corners.",
  "- X AXIS / Y AXIS: the baseline lines of the plot (usually the bottom and left frame edges) -> line elements; when they coincide with the frame, do not duplicate them.",
  '- On plots give every non-text element a role: "axis", "tick", "frame", "legend" or "annotation". Only use annotation for a real symbol/arrow/shape inside the plot. Measured axes/frame/ticks are regenerated by the server.',
  "- TICK: the short marks crossing an axis (2-6 px) -> line elements; 4-8 per axis, only at the labelled values.",
  "- TICK LABEL: the number beside a tick -> one text element with the exact string, minus sign included.",
  "- AXIS LABEL: e.g. \"z/l_0\" or \"t/tau_0\" -> one text element each, outside the frame where the image shows it.",
  "- LEGEND: the key that maps a line style to a name. Emit each entry as ONE short sample line (same colour, width and dash as its curve, ~8-12% of the plot width) plus ONE text element immediately to its right. A legend is a sample stroke + label, never just a word floating in the data area.",
].join("\n");

/** Close any brackets the model left open (a reply cut off by max_tokens). */
function balanceJson(text) {
  const s = String(text);
  let inString = false;
  let escaped = false;
  const stack = [];
  let lastComplete = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      stack.pop();
      if (!stack.length) { lastComplete = i; break; }
    }
  }
  if (lastComplete > 0) return s.slice(0, lastComplete + 1);
  // Truncated. Drop the half-written tail, then close what is still open.
  let head = s;
  if (inString) head = head.slice(0, head.lastIndexOf('"'));
  head = head.replace(/,\s*$/, "");
  const opens = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") opens.push("}");
    else if (c === "[") opens.push("]");
    else if (c === "}" || c === "]") opens.pop();
  }
  let out = head;
  // A trailing partial member (e.g. ',"kind":"line","x1":') must go.
  for (let guard = 0; guard < 6; guard++) {
    try {
      return JSON.parse(out + opens.slice().reverse().join(""));
    } catch {
      const cut = Math.max(out.lastIndexOf("},"), out.lastIndexOf("],"));
      if (cut <= 0) break;
      out = out.slice(0, cut + 1);
    }
  }
  return null;
}

/** Loose JSON extraction: models wrap JSON in prose, fences, or cut it short. */
/**
 * Put a labelled 10x10 ruler on the image before the model reads coordinates.
 * "Reads" beat "estimates" — this is the cheapest accuracy win available.
 */
function gridImage(dataUrl) {
  try {
    const raster = decodePng(dataUrl);
    const png = encodePng(withGrid(raster));
    return "data:image/png;base64," + png.toString("base64");
  } catch {
    return dataUrl;
  }
}

function parseJsonObject(text) {
  const raw = String(text);
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("模型没有返回 JSON 结构");
  const candidate = raw.slice(start);
  const end = candidate.lastIndexOf("}");
  if (end > 0) {
    try { return JSON.parse(candidate.slice(0, end + 1)); } catch { /* fall through */ }
  }
  const repaired = balanceJson(candidate);
  if (repaired) {
    try { return JSON.parse(repaired); } catch { /* fall through */ }
  }
  throw new Error("模型返回的 JSON 无法解析");
}

/**
 * Step 1 of the figure route: read the picture before drawing it.
 * Returns the primitive model plus a compact description for the UI.
 */
function elementArea(el) {
  if (!el) return 0;
  if (el.kind === "line") return Math.abs((el.x2 || 0) - (el.x1 || 0)) + Math.abs((el.y2 || 0) - (el.y1 || 0));
  if (el.box) return (el.box[2] || 0) * (el.box[3] || 0);
  if (el.r) return Math.PI * el.r * el.r;
  if (el.points) return (el.points.length || 0) * 10;
  return 1;
}

/**
 * Repair ONE region the reviewer pointed at.
 *
 * The reviewer names an area; the model is shown that area twice (original vs.
 * current drawing) and must say what belongs there. The result is not trusted:
 * the region's ink coverage is measured before and after, so a repair that does
 * not actually fill the hole is rejected.
 */
/**
 * Repair ONE region the reviewer pointed at.
 *
 * Same architecture as a sub-agent: the model gets the crop plus an explicit
 * coordinate window, answers in its own units, and its answer is then registered
 * onto the ink by key points. Nothing is trusted until the key points line up.
 */
async function repairRegion(ctx) {
  const { raster, issue, apiKey, baseUrl, model, signal } = ctx;
  const box = issue.box.map(Number);
  const region = {
    kind: issue.target || "region",
    box,
    note: (issue.target || "区域") + "；评审意见：" + String(issue.message || "").slice(0, 160),
  };
  const drawn = await drawRegion({ raster, region, apiKey, baseUrl, model, signal, chat, parseJsonObject, encodePng });
  const reg = registerRegion(raster, region, drawn.elements, { tolerancePx: 8 });
  const elements = reg.ok ? reg.elements : [];
  return {
    elements,
    rawCount: drawn.elements.length + (drawn.dropped || 0),
    dropped: (drawn.dropped || 0) + (reg.dropped || 0),
    residual: reg.residual,
    registered: reg.ok,
  };
}

/* ------------------------------------------------------------------ figure */

const DIVERSE_HINT =
  "Give a DIFFERENT but equally faithful reading of this figure: vary the decomposition (merge or split shapes), " +
  "but keep every visible feature. Do not repeat a previous answer; start from the image.";

/** Structural inventory of a region: how many strokes and text runs it holds. */
function inventoryInBox(raster, box) {
  try {
    const crop = cropRaster(raster, box, 0.05);
    const bounds = { x0: 1, y0: 1, x1: crop.w - 2, y1: crop.h - 2 };
    const strokes = detectLegend(crop, bounds).length + detectDottedLegend(crop, bounds).length;
    const texts = textBlocks(crop).length;
    return { strokes, texts };
  } catch {
    return { strokes: 0, texts: 0 };
  }
}

/** Region ink coverage (0..1) of the drawn page inside a normalised box. */
function regionCoverage(raster, renderedDataUrl, box) {
  try {
    const rendered = decodePng(renderedDataUrl);
    const src = cropRaster(raster, box, 0.05);
    const dst = cropRaster(rendered, box, 0.05);
    return compareInk(src, "data:image/png;base64," + encodePng(dst).toString("base64")).recall;
  } catch {
    return null;
  }
}

/** Compose the measured curves, the frame and the residual marks into one document. */
/** Width of a text element in source pixels. */
function boxWidthPx(el, widthPx) {
  return Array.isArray(el.box) ? (el.box[2] / 1000) * widthPx : 0;
}

/** Centre of any element kind, in normalised coordinates (null if unknown). */
function elementCenter(el) {
  if (!el) return null;
  if (el.kind === "text" && Array.isArray(el.box)) return [el.box[0] + el.box[2] / 2, el.box[1] + el.box[3] / 2];
  if (el.kind === "line") return [(el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2];
  if (el.kind === "polyline" && Array.isArray(el.points) && el.points.length) {
    const n = el.points.length;
    return [el.points.reduce((s, p) => s + p[0], 0) / n, el.points.reduce((s, p) => s + p[1], 0) / n];
  }
  if (Number.isFinite(Number(el.cx))) return [Number(el.cx), Number(el.cy)];
  return null;
}

function composeFigure(ctx) {
  const { model, raster, aspect, frameInfo, pixelMeasurement, textBlockList } = ctx;
  const keep = (model.elements || []).filter((el) => el && (el.kind === "text" || el.role === "frame" || el.role === "legend" || el.role === "axis"));
  if (!pixelMeasurement || !pixelMeasurement.applied) {
    // No pixel measurement: the optional legend / tick objects still belong in the
    // document, so they are composed here instead of after a dead return.
    return appendDecorations(primitivesToTikz(model, { aspect, imageWidthPx: raster.w }), model, raster, aspect);
  }
  const textRegions = keep.filter((el) => el.kind === "text" && Array.isArray(el.box)).map((el) => ({ box: el.box }));
  // The pixel-measurement branch no longer traces anything; it composes the same
  // way as the semantic path and only adds the optional decorations.
  return appendDecorations(primitivesToTikz(Object.assign({}, model, { elements: keep }), { aspect, imageWidthPx: raster.w }), model, raster, aspect);
}

/** Append the optional tick strokes and legend entries to a composed document. */
function appendDecorations(result, model, raster, aspect) {
  let tickCode = "";
  if (model.axis && Array.isArray(model.axis.ticks) && model.axis.ticks.length) {
    tickCode = tickTikz(model.axis.ticks.concat(model.yAxis?.ticks || []), { widthPx: raster.w, heightPx: raster.h, widthCm: 12, heightCm: Math.max(2.2, 12 * aspect) });
  }
  let legendCode = "";
  if (model.legend && Array.isArray(model.legend.entries) && model.legend.entries.length) {
    const heightCm = Math.max(2.2, 12 * aspect);
    legendCode = emitLegendTikz(model.legend.entries, { widthCm: 12, heightCm, widthPx: raster.w, sizeCm: 0.42, gapCm: 0.18 });
  }
  if (tickCode || legendCode) {
    result.code = result.code.replace("\\end{tikzpicture}", [tickCode, legendCode].filter(Boolean).join("\n") + "\n\\end{tikzpicture}");
  }
  result.stats = Object.assign({}, result.stats, { bytes: result.code.length });
  return result;
}

/** Build a y-axis calibration from numeric labels sitting left of the frame (§6). */
function calibrateYAxisFromLabels(raster, frameInfo, labels) {
  const axisLine = findAxis(raster);
  const frameLeft = frameInfo?.hasBox ? frameInfo.bounds.x0 : axisLine?.x0 || 0;
  const numeric = (labels || []).filter((el) => el && el.kind === "text" && /^-?\d+(\.\d+)?$/.test(String(el.tex || "").replace(/\$/g, "").replace(/\u2212/g, "-").trim()));
  const left = numeric.filter((el) => {
    const c = elementCenter(el);
    if (!c) return false;
    const cx = (c[0] / 1000) * raster.w;
    const cy = (c[1] / 1000) * raster.h;
    // y-axis numbers sit left of the vertical axis and ABOVE the horizontal axis;
    // the x-axis tick numbers below the axis must not be mistaken for y ticks.
    return cx < frameLeft + 4 && (!axisLine || cy < axisLine.y - 2);
  });
  if (left.length < 2) {
    // A frame alone carries no numeric range. Do not invent a 0..1 y-axis.
    return { ok: false, count: left.length, source: "labels" };
  }
  const pairs = left.map((el) => {
    const c = elementCenter(el);
    return { py: (c[1] / 1000) * raster.h, value: Number(String(el.tex || "").replace(/\$/g, "").replace(/\u2212/g, "-").trim()) };
  });
  const calibration = calibrateAxis(pairs, { pixelDirection: "y", minTicks: 2 });
  return { ok: calibration.ok, calibration, count: left.length, source: "labels" };
}

export function calibratePlotAxes(input, raster, frameInfo, sourceTexts) {
  const axisLine=findAxis(raster);
  if(!axisLine) return input;
  const labels=groundPlotTickLabels(sourceTexts || (input.elements || []).filter(el=>el?.kind==='text'),raster,axisLine);
  const number=el=>Number(String(el.tex || '').replace(/\$/g,'').replace(/\u2212/g,'-').trim());
  const numeric=labels.filter(el=>/^-?\d+(\.\d+)?$/.test(String(el.tex || '').replace(/\$/g,'').replace(/\u2212/g,'-').trim()));
  const xLabels=numeric.filter(el=>{const c=elementCenter(el);return c && c[1]/1000*raster.h>axisLine.y+3 && c[0]/1000*raster.w>=axisLine.x0-8 && c[0]/1000*raster.w<=axisLine.x1+8;});
  const built=buildTicks(xLabels.map(el=>({px:elementCenter(el)[0]/1000*raster.w,py:elementCenter(el)[1]/1000*raster.h,value:number(el)})),axisLine,{tickLengthPx:4});
  const y=calibrateYAxisFromLabels(raster,frameInfo,labels);
  const isNumeric=el=>el?.kind==='text' && /^-?\d+(\.\d+)?$/.test(String(el.tex || '').replace(/\$/g,'').replace(/\u2212/g,'-').trim());
  const restored=numeric.filter(el=>{
    if(!built.ok || !xLabels.includes(el)) return true;
    return built.ticks.some(t=>t.value===number(el) && Math.abs(t.px-elementCenter(el)[0]/1000*raster.w)<3);
  }).filter((el,i,all)=>!all.slice(0,i).some(old=>old.tex===el.tex && Math.hypot(elementCenter(old)[0]-elementCenter(el)[0],elementCenter(old)[1]-elementCenter(el)[1])<10));
  return {...input,elements:(input.elements || []).filter(el=>el?.kind!=='text').concat(labels.filter(el=>!isNumeric(el)),restored),
    axis:built.ok ? {ticks:built.ticks,axis:axisLine,calibration:built.calibration,rmse:built.calibration.rmsePx} : input.axis,
    yAxis:y.ok ? {calibration:y.calibration,source:y.source,rmse:y.calibration.rmsePx,ticks:y.calibration.ticks.map(t=>({value:t.value,
      stroke:{x1:axisLine.x0-3,x2:axisLine.x0+3,y1:t.py,y2:t.py}}))} : undefined};
}

/** Bind model-read numbers to a finite row/column of glyph boxes, not data pixels. */
function groundPlotTickLabels(labels,raster,axis) {
  const numeric=el=>/^-?\d+(\.\d+)?$/.test(String(el.tex || '').replace(/\$/g,'').replace(/\u2212/g,'-').trim());
  const words=textBlocks(raster), left=words.filter(b=>b.x+b.w/2<axis.x0-3 && b.y<=axis.y+2);
  const yLabels=labels.filter(l=>numeric(l) && (l.role==='y-tick' || (elementCenter(l)[0]/1000*raster.w<axis.x0-2 && l.role!=='x-tick')));
  const xLabels=labels.filter(l=>numeric(l) && !yLabels.includes(l));
  const sizes=words.filter(b=>b.y>axis.y+2 && b.w<raster.w*0.15).map(b=>b.h).sort((a,b)=>a-b);
  const height=left.length ? left.map(b=>b.h).sort((a,b)=>a-b)[left.length>>1] : sizes[sizes.length>>1];
  const below=words.filter(b=>b.y>axis.y+2 && b.y<axis.y+raster.h*0.35 && b.x>=axis.x0 && b.x<=axis.x1 && b.h>=height*0.55 && b.h<=height*1.25 && b.w<=height*3.5);
  const updates=new Map();
  const box=b=>[(b.x-b.w/2-1)/raster.w*1000,(b.y-b.h/2-1)/raster.h*1000,(b.w+2)/raster.w*1000,(b.h+2)/raster.h*1000];
  if(left.length===yLabels.length) {
    const ls=yLabels.slice().sort((a,b)=>elementCenter(a)[1]-elementCenter(b)[1]);
    left.sort((a,b)=>a.y-b.y).forEach((b,i)=>updates.set(ls[i],{...ls[i],box:box(b),role:'y-tick',grounded:true}));
  }
  const paired=pairNumericRow(xLabels.map((label,index)=>({label,index})),below,{h:raster.h,rowTolerance:5});
  for(const m of paired.matches) updates.set(xLabels[m.labelIndex],{...xLabels[m.labelIndex],box:box(m.block),role:'x-tick',grounded:true});
  const tickBlocks=new Set(paired.matches.map(m=>m.block));
  const xlabelWords=words.filter(b=>!tickBlocks.has(b) && b.y>axis.y+height*1.3 && b.y<axis.y+raster.h*0.5 && b.h>=height*0.8 && b.w>b.h*1.2);
  for(const l of labels.filter(l=>l.role==='axis-label')) {
    const c=elementCenter(l);
    if(c[0]/1000*raster.w<axis.x0 || c[1]/1000*raster.h<axis.y*0.7 || !xlabelWords.length) continue;
    const chosen=xlabelWords.slice().sort((a,b)=>Math.abs(a.x-c[0]/1000*raster.w)-Math.abs(b.x-c[0]/1000*raster.w))[0];
    updates.set(l,{...l,box:box(chosen),grounded:true});
  }
  const titles=labels.filter(l=>l.role==='title');
  const titleWords=words.filter(b=>b.y<axis.y*0.3 && b.x>axis.x0+10 && b.h>height*1.2);
  if(titles.length===1 && titleWords.length) {
    const x0=Math.min(...titleWords.map(b=>b.x-b.w/2)),x1=Math.max(...titleWords.map(b=>b.x+b.w/2));
    const y0=Math.min(...titleWords.map(b=>b.y-b.h/2)),y1=Math.max(...titleWords.map(b=>b.y+b.h/2));
    updates.set(titles[0],{...titles[0],box:box({x:(x0+x1)/2,y:(y0+y1)/2,w:x1-x0,h:y1-y0}),grounded:true});
  }
  return labels.map(l=>updates.get(l) || {...l});
}

async function* runFigureGeneration(opts) {
  const started = Date.now();
  const remaining = () => opts.budgetMs - (Date.now() - started);
  yield { type: "budget", limitMs: opts.budgetMs };
  const raster = decodePng(opts.image);
  const aspect = raster.h / raster.w;
  const frameInfo = detectFrame(raster);
  let measureFrame = frameInfo;
  if (!frameInfo.hasBox) {
    const axisGuess = findAxis(raster);
    if (axisGuess && axisGuess.len > raster.w * 0.3) {
      let top = raster.h;
      for (let y = 0; y < axisGuess.y && top === raster.h; y++) {
        for (let x = axisGuess.x0; x <= axisGuess.x1; x++) {
          const i = (y * raster.w + x) * 3;
          if ((raster.rgb[i] * 299 + raster.rgb[i + 1] * 587 + raster.rgb[i + 2] * 114) / 1000 < 200) { top = y; break; }
        }
      }
      if (top < axisGuess.y - 10) {
        measureFrame = { hasBox: true, hLines: 1, vLines: 1, bounds: { x0: axisGuess.x0, y0: top, x1: axisGuess.x1, y1: axisGuess.y }, width: raster.w, height: raster.h, synthetic: true };
      }
    }
  }
  yield { type: "step", id: "understand", label: "理解图像内容", status: "running" };
  let model = null;
  let measured = { applied: false };
  let textBlockList = [];
  try {
    // 曲线不再来自像素描点：不调用 digitizePlot（见 policy.mjs）。
    measured = { applied: false, curves: [], count: 0 };
    if (measured.applied) {
      const recognized = await recognizeLabels({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal });
      const grounded = groundText(raster, recognized.labels.map((l) => ({ kind: "text", box: l.box, tex: l.tex })), {
        frameLeft: measureFrame.bounds ? measureFrame.bounds.x0 : 0, frame: measureFrame, axis: findAxis(raster),
      });
      textBlockList = grounded.blocks;
      yield {
        type: "step", id: "text", label: "文字定位",
        status: grounded.pairedCount ? "ok" : "fail",
        detail: "识别 " + recognized.labels.length + " 条 · 刻度 " + grounded.pairedCount + "/" + grounded.numericCount,
      };
      const labels = grounded.elements;
      const legendBounds = measureFrame.bounds || frameInfo.bounds;
      // §10.3: ticks are objects built from ONE calibration; numbers and geometry
      // cannot drift apart afterwards.
      try {
        const axisLine = findAxis(raster);
        const numeric = labels.filter((el) => el && el.kind === "text" && /^-?\d+(\.\d+)?$/.test(String(el.tex || "").replace(/\$/g, "").replace(/\u2212/g, "-").trim()));
        const below = axisLine ? numeric.filter((el) => {
          const c = elementCenter(el);
          return c && (c[1] / 1000) * raster.h > axisLine.y + 4;
        }) : [];
        if (below.length >= 2) {
          const ticks = buildTicks(below.map((el) => {
            const c = elementCenter(el);
            return { px: (c[0] / 1000) * raster.w, value: Number(String(el.tex || "").replace(/\$/g, "").replace(/\u2212/g, "-").trim()), py: (c[1] / 1000) * raster.h };
          }), axisLine, { tickLengthPx: 5 });
          if (ticks.ok) {
            model = Object.assign({}, model, { axis: { calibration: { a: ticks.calibration.a, b: ticks.calibration.b, rmse: ticks.calibration.rmse }, ticks: ticks.ticks, axis: axisLine } });
            yield {
              type: "step", id: "axis", label: "轴标定与刻度",
              status: ticks.calibration.rmse < 2 ? "ok" : "fail",
              detail: ticks.ticks.length + " 个刻度 · 线性残差 " + ticks.calibration.rmse.toFixed(2) + "px" + (ticks.calibration.dropped ? " · 剔除 " + ticks.calibration.dropped : ""),
            };
          } else {
            yield { type: "step", id: "axis", label: "轴标定与刻度", status: "fail", detail: ticks.reason };
          }
        }
      } catch (err) {
        yield { type: "step", id: "axis", label: "轴标定与刻度", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
      }
      const legends = legendBounds ? detectDottedLegend(raster, legendBounds).concat(detectLegend(raster, legendBounds)) : [];
      for (const entry of legends) {
        const hex = "#" + entry.color.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
        labels.push({
          kind: "line", role: "legend",
          x1: (entry.x0 / raster.w) * 1000, y1: ((entry.y0 + entry.y1) / 2 / raster.h) * 1000,
          x2: (entry.x1 / raster.w) * 1000, y2: ((entry.y0 + entry.y1) / 2 / raster.h) * 1000,
          style: { stroke: hex, width: Math.max(1, entry.y1 - entry.y0 + 1), dash: entry.dotted ? "dotted" : undefined },
        });
      }
      if (legends.length) {
        yield { type: "step", id: "legend", label: "图例样例线", status: "ok", detail: legends.length + " 条" };
      }
      const regions = proposeRegions(raster, measureFrame, findAxis(raster), textBlockList.slice());
      yield {
        type: "step", id: "split", label: "拆分图元区域", status: "ok",
        detail: regions.map((r) => r.kind + "(" + Math.round(r.box[0]) + "," + Math.round(r.box[1]) + ")").join(" · "),
      };
      for (const region of regions) {
        if (region.kind === "plot" || region.kind === "frame") continue;
        if (remaining() < 70_000) break;
        try {
          const drawn = await drawRegion({ raster, region, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal, chat, parseJsonObject, encodePng });
          const reg = registerRegion(raster, region, drawn.elements, { tolerancePx: 8 });
          const accepted = reg.ok ? reg.elements : [];
          yield {
            type: "step", id: "register", label: "关键点配准 · " + region.kind, status: reg.ok ? "ok" : "fail",
            detail: reg.ok ? "残差 " + (reg.residual == null ? "?" : Math.round(reg.residual * 10) / 10) + "px" + (reg.dropped ? " · 丢弃 " + reg.dropped : "") : "配准失败",
          };
          let added = 0;
          const box = region.box;
          const inBox = (el) => {
            const c = elementCenter(el);
            if (!c) return false;
            return c[0] >= box[0] - 20 && c[0] <= box[0] + box[2] + 20 && c[1] >= box[1] - 20 && c[1] <= box[1] + box[3] + 20;
          };
          // Replace, do not append — but a text label the sub-agent did not re-emit
          // must survive: it was deleted from its region, not replaced (this is how
          // V(z) disappeared). Keep the removed texts aside and put them back.
          const removed = [];
          for (let i = labels.length - 1; i >= 0; i--) {
            const el = labels[i];
            if (el && (el.role === "frame" || el.role === "axis")) continue;
            if (inBox(el)) {
              if (el) removed.push(el);
              labels.splice(i, 1);
            }
          }
          const seenText = new Set(labels.filter((el) => el.kind === "text").map((el) => String(el.tex || "").replace(/\s+/g, "")));
          for (const el of accepted) {
            if (el.kind === "text") {
              const key = String(el.tex || "").replace(/\s+/g, "");
              if (!key || seenText.has(key)) continue;
              seenText.add(key);
            }
            labels.push(el);
            added++;
          }
          // Anything the sub-agent did NOT redraw goes back: it was removed only
          // because it sat inside this region, not because it was replaced. This
          // is how the solid legend sample vanished while its label survived.
          const added2 = labels.slice(labels.length - added);
          for (const old of removed) {
            const oc = elementCenter(old);
            const replaced = added2.some((n) => {
              if (!n || n.kind !== old.kind) return false;
              if (old.kind === "text") return String(n.tex || "").replace(/\s+/g, "") === String(old.tex || "").replace(/\s+/g, "");
              const nc = elementCenter(n);
              return nc && oc && Math.hypot(nc[0] - oc[0], nc[1] - oc[1]) < 30;
            });
            if (replaced) continue;
            if (old.kind === "text") {
              const key = String(old.tex || "").replace(/\s+/g, "");
              if (!key || seenText.has(key)) continue;
              seenText.add(key);
            }
            labels.push(old);
          }
          yield { type: "step", id: "subagent", label: "子智能体 · " + region.kind, status: added ? "ok" : "fail", detail: added + " 个元素" };
        } catch (err) {
          yield { type: "step", id: "subagent", label: "子智能体 · " + region.kind, status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
        }
      }
      // A legend label must sit on its swatch's row: the vision model's box for
      // V(z) was ~45 px too high, which made the pair read as swapped. Snap AFTER
      // the region merges, which can re-insert labels with their old boxes.
      if (legends.length) {
        for (const el of labels) {
          if (!el || el.kind !== "text" || !Array.isArray(el.box)) continue;
          const c = elementCenter(el);
          if (!c) continue;
          let best = null, bestD = Infinity;
          for (const lg of legends) {
            const ly = (((lg.y0 + lg.y1) / 2) / raster.h) * 1000;
            const d = Math.abs(ly - c[1]);
            if (d < bestD) { bestD = d; best = lg; }
          }
          // Only the left column holds legend text, and the row gap can be ~45 px
          // (≈140 normalised units), so the window has to be generous.
          // Legend text lives INSIDE the frame, to the right of its left edge; the
          // y-axis numbers sit outside it and must not be dragged in.
          const frameLeftNorm = measureFrame.bounds ? (measureFrame.bounds.x0 / raster.w) * 1000 : 0;
          if (c[0] < frameLeftNorm + 8 || c[0] > 420) continue;
          if (!best || bestD >= 200 || bestD <= 2) continue;
          // Sit on the swatch row, starting just right of the swatch itself.
          el.box[1] = (((best.y0 + best.y1) / 2) / raster.h) * 1000 - el.box[3] / 2;
          const wPx = boxWidthPx(el, raster.w);
          el.box[0] = ((best.x1 + 7) / raster.w) * 1000;
        }
      }
      model = { type: "plot", summary: "从像素测得 " + measured.count + " 条曲线，保留原图的文字、刻度和图例", elements: labels, curves: measured.curves };
      yield {
        type: "step", id: "digitize", label: "从像素提取曲线并拟合", status: "ok",
        detail: measured.count + " 条曲线 · " + measured.method + (measured.rmse != null ? " · 轮廓误差 " + measured.rmse.toFixed(2) + "px" : ""),
      };
    } else {
      // Diagrams are rebuilt from SEMANTICS (nodes/edges/labels), not from pixels.
      // A long lower axis inside a frame is strong plot evidence; route it directly
      // to the plot protocol instead of first asking a graph-only model to invent
      // nodes from tick labels.
      const axisEvidence = findAxis(raster);
      const likelyPlot = Boolean(
        axisEvidence &&
        axisEvidence.len > raster.w * 0.4 && axisEvidence.y > raster.h * 0.55
      );
      let semanticOk = false;
      try {
        if (likelyPlot) throw Object.assign(new Error("plot evidence: framed lower axis"), { code: "PLOT_CLASS" });
        const sem = await understandDiagram({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal });
        // A plot detected by the frame/axis measurement is never a diagram.
        const looksLikePlot = frameInfo.hasBox && sem.check.nodes.length > 6 && sem.check.edges.length <= 2;
        if (looksLikePlot) sem.check.ok = false, sem.check.errors.push("frame + many nodes and few edges: a plot, not a diagram");
        if (sem.check.ok) {
          model = { type: "diagram", semantic: sem.semantic, elements: [], source: "semantic" };
          semanticOk = true;
          yield {
            type: "step", id: "semantic", label: "语义结构识别",
            status: "ok",
            detail: sem.semantic.nodes.length + " 节点 · " + sem.semantic.edges.length + " 边 · " + sem.semantic.labels.length + " 标签",
          };
        } else {
          yield { type: "step", id: "semantic", label: "语义结构识别", status: "fail", detail: sem.check.errors.slice(0, 2).join("；") };
        }
      } catch (err) {
        yield {
          type: "step", id: "semantic", label: "图类分派",
          status: err && err.code === "PLOT_CLASS" ? "ok" : "fail",
          detail: String((err && err.message) || err).slice(0, 60),
        };
      }
      if (!semanticOk) {
      const res = await understandFigure({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal });
      model = res.model;
      // Plot text is a separate recognition problem. The general figure pass is
      // good at topology but its approximate boxes can swap tick values. Replace
      // only the text layer with the dedicated transcription pass; geometry and
      // sparse curves remain untouched.
      if (String(model && model.type || "").toLowerCase() === "plot") {
        try {
          const recognized = await recognizeLabels({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal });
          if (recognized.labels.length) {
            const nonTexts = (model.elements || []).filter((el) => !(el && el.kind === "text"));
            const texts = recognized.labels.map((label) => ({ kind: "text", role:label.role, box: label.box, tex: label.tex, source: "text-recognition" }));
            model = Object.assign({}, model, { elements: nonTexts.concat(texts) });
            yield { type: "step", id: "transcribe", label: "独立文字转录", status: "ok", detail: texts.length + " 条文字" };
          }
        } catch (err) {
          yield { type: "step", id: "transcribe", label: "独立文字转录", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
        }
      }
      // Geometry comes from FITTING the ink (lines / arcs / quadratic curves with a
      // measured residual), not from the model's coordinates: those were off by tens
      // of pixels and there is no pixel fallback on a diagram.
      let fittedInfo = null;
      try {
        const exclude = textBlocks(raster).map((b) => ({
          x0: b.x - b.w / 2 - 3, x1: b.x + b.w / 2 + 3,
          y0: b.y - b.h / 2 - 3, y1: b.y + b.h / 2 + 3,
        }));
        // 骨架行走已禁用：不调用 fitFigure（见 policy.mjs）。
        const fitted = { elements: [], stats: { line: 0, arc: 0, quad: 0, path: 0 } };
        fittedInfo = fitted.stats;
        const originalElements = Array.isArray(model.elements) ? model.elements : [];
        const texts = originalElements.filter((el) => el && el.kind === "text");
        const nonTexts = originalElements.filter((el) => el && el.kind !== "text");
        const blocks = textBlocks(raster);
        const anchored = String(model.type || "").toLowerCase() === "plot" ? texts : texts.map((el) => {
          const c = elementCenter(el);
          if (!c) return el;
          const cx = (c[0] / 1000) * raster.w, cy = (c[1] / 1000) * raster.h;
          let best = null, bestD = Infinity;
          for (const blk of blocks) {
            const d = Math.hypot(blk.x - cx, blk.y - cy);
            if (d < bestD) { bestD = d; best = blk; }
          }
          if (!best || bestD > 140) return el;
          return Object.assign({}, el, {
            grounded: true,
            box: [
              ((best.x - best.w / 2 - 2) / raster.w) * 1000,
              ((best.y - best.h / 2 - 2) / raster.h) * 1000,
              ((best.w + 4) / raster.w) * 1000,
              ((best.h + 4) / raster.h) * 1000,
            ],
          });
        });
        model = Object.assign({}, model, {
          elements: (fitted.elements.length ? fitted.elements : nonTexts).concat(anchored),
        });
        if (fitted.elements.length) {
          yield {
            type: "step", id: "fitcurve", label: "按曲线拟合重建",
            status: "ok",
            detail: fitted.elements.length + " 个图元（直线 " + fitted.stats.line + " · 圆弧 " + fitted.stats.arc + " · 二次曲线 " + fitted.stats.quad + "）",
          };
        }
      } catch (err) {
        yield { type: "step", id: "fitcurve", label: "按曲线拟合重建", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
      }
      }
      if (Array.isArray(model.elements) && model.elements.some((el) => el && el.kind === "text")) {
        const sourceTexts = model.elements.filter((el) => el && el.kind === "text");
        const grounded = groundText(raster, sourceTexts, {
          frameLeft: frameInfo.bounds ? frameInfo.bounds.x0 : 0, frame: frameInfo, axis: findAxis(raster),
        });
        textBlockList = grounded.blocks;
        model = Object.assign({}, model, { elements: model.elements.filter((el) => !(el && el.kind === "text")).concat(grounded.elements) });
        // §10.3: build tick objects from ONE calibration (numbers + strokes together).
        try {
          model=calibratePlotAxes(model,raster,frameInfo,sourceTexts);
          if(model.axis) {
            yield {type:'step',id:'axis',label:'轴标定与刻度',status:model.axis.rmse<2?'ok':'fail',
              detail:model.axis.ticks.length+' 个刻度 · 线性残差 '+model.axis.rmse.toFixed(2)+'px · 剔除 '+model.axis.calibration.dropped};
          }
          if(model.yAxis) {
            yield {type:'step',id:'yaxis',label:'纵轴标定',status:'ok',detail:model.yAxis.calibration.inliers+' 个纵轴刻度 · 线性残差 '+model.yAxis.rmse.toFixed(2)+'px'};
          }
        } catch (err) {
          yield { type: "step", id: "axis", label: "轴标定与刻度", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
        }
        yield {
          type: "step", id: "text", label: "文字定位",
          status: grounded.pairedCount || !grounded.numericCount ? "ok" : "fail",
          detail: grounded.numericCount
            ? "刻度 " + grounded.pairedCount + "/" + grounded.numericCount + " 条落在真实刻度行上"
            : "无刻度数字 · " + grounded.elements.length + " 条文字已按墨迹定位",
        };
      }
    }
  } catch (err) {
    yield { type: "step", id: "understand", status: "fail", detail: String((err && err.message) || err).slice(0, 90) };
    yield {
      type: "done", ok: false, code: "",
      errors: [{ line: null, message: "图像理解失败：" + String((err && err.message) || err) }],
      reason: "COMPILE_FAILED", model: opts.model, attempts: 0, rounds: 0, representation: "figure",
      trace: null, visual: null, durationMs: Date.now() - started,
    };
    yield { type: "end" };
    return;
  }
  // Plots receive their sparse semantic control points before legend binding; the
  // legend entries need series identities and styles in order to bind safely.
  // Curves get their own constrained pass even when the general figure model
  // supplied some. That broad pass often splits a dotted line into two objects
  // or confuses a legend swatch with data. The dedicated contract is one series
  // per curve and a bounded adaptive set of semantic control points.
  if (String(model.type || "").toLowerCase() === "plot") {
    try {
      const plot = await extractPlotCurves({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal });
      if (plot.curves.length) {
        model = Object.assign({}, model, { curves: plot.curves, relations: plot.relations || [], source: "model-sparse-control-points", fitted: true });
        yield { type: "step", id: "curves", label: "独立数据序列识别", status: "ok", detail: plot.curves.length + " 条 · 关系 " + (plot.relations || []).length + " 条 · 保留观测点与连接方式" };
      }
    } catch (err) {
      yield { type: "step", id: "curves", label: "独立稀疏曲线识别", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
      yield {type:'done',ok:false,code:'',reason:'SERIES_REJECTED',errors:[{message:err.message}]};
      yield {type:'end'}; return;
    }
  }
  if (Array.isArray(model.curves) && model.curves.length) {
    const beforeMerge = model.curves.length;
    try {
      model = preparePlotModel(model,raster,frameInfo);
      if (model.curves.length < beforeMerge) {
        yield {type:'step',id:'mergecurves',label:'合并同一曲线的稀疏分段',status:'ok',detail:beforeMerge+' 段 → '+model.curves.length+' 条曲线'};
      }
      const joint = model.joint;
      if (joint) {
        yield { type: "step", id: "jointfit", label: "联合约束拟合", status: joint.ok ? "ok" : "fail", detail: "拟合 " + joint.terms.fit.toFixed(1) + " · 次序 " + joint.terms.order.toFixed(1) + " · 轴接触 " + joint.terms.axis.toFixed(1) + (joint.relation && joint.relation.failures.length ? " · " + joint.relation.failures.length + " 个关系失败" : "") };
      }
    } catch (err) {
      yield {type:'step',id:'series',label:'序列协议校验',status:'fail',detail:err.message};
      yield {type:'done',ok:false,code:'',reason:'SERIES_REJECTED',errors:[{message:err.message}]};
      yield {type:'end'}; return;
    }
  }
  // §10.2: build ATOMIC legend entries from the detected samples, bind them to the
  // series and remember them on the model. They are emitted as one object per
  // entry, so a stroke can never survive its label.
  if (Array.isArray(model.curves) && model.curves.length && frameInfo.hasBox && !model.legend) {
    try {
      const bounds = frameInfo.bounds;
      const textElements = (model.elements || []).filter((el) => el.kind === "text" && Array.isArray(el.box));
      const modelSamples = (model.elements || []).filter((el) => el && el.kind === "line" && el.role === "legend").map((el) => ({
        x0: (Number(el.x1) / 1000) * raster.w,
        x1: (Number(el.x2) / 1000) * raster.w,
        y0: (Number(el.y1) / 1000) * raster.h,
        y1: (Number(el.y2) / 1000) * raster.h,
        color: el.style?.stroke || el.color || "#000000",
        width: Number(el.style?.width) || 2,
        dash: el.style?.dash || "solid",
      }));
      let rawSamples = detectDottedLegend(raster, bounds)
        .concat(detectLegend(raster, bounds, { requireLabel: false, requireIsolation: false, maxXFraction: 0.15 }));
      if (rawSamples.length < model.curves.length) rawSamples = rawSamples.concat(modelSamples);
      const samples = rawSamples.filter((sample, i, all) => !all.slice(0, i).some((old) =>
        Math.abs((old.x0 + old.x1) / 2 - (sample.x0 + sample.x1) / 2) < 12 &&
        Math.abs((old.y0 + old.y1) / 2 - (sample.y0 + sample.y1) / 2) < 10
      ));
      if (samples.length) {
        // Label text comes from each model text object exactly once. The previous
        // loop duplicated the entire list once per detected OCR block.
        const grouped = textElements.map((el) => {
          const c = elementCenter(el);
          return c ? { x: (c[0] / 1000) * raster.w, y: (c[1] / 1000) * raster.h, w: (el.box[2] / 1000) * raster.w, h: (el.box[3] / 1000) * raster.h, tex: el.tex, mode: el.mode } : null;
        }).filter(Boolean);
        const entries = pairLegendEntries(
          samples.map((s) => ({
            x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1,
            color: Array.isArray(s.color)
              ? "#" + s.color.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")
              : String(s.color || "#000000"),
            width: Number(s.width) || 5,
            dash: s.dash || (s.dotted ? "dotted" : s.dashed ? "dashed" : "solid"),
          })),
          grouped,
        );
        const series = (model.curves || []).map((c, i) => ({ id: c.id || "curve" + i, name: c.name || "", color: c.color || c.style?.stroke, dash: c.dash || c.style?.dash || "solid" }));
        const bound = bindSeries(entries, series).map((entry) => {
          if (String(entry.tex || "").trim() || !entry.seriesId) return entry;
          const owner = series.find((item) => item.id === entry.seriesId);
          const tex = String(owner && owner.name || "").trim();
          return tex ? Object.assign({}, entry, { tex, mode: "math", confidence: Math.min(entry.confidence || 0.8, 0.9) }) : entry;
        });
        const problems = validateLegend(bound, { series });
        let usable = bound.filter((e) => e.seriesId && String(e.tex || "").trim()).map((entry) => ({
          ...entry,
          baseline: (Number(entry.baseline) / raster.h) * 1000,
          sample: entry.sample ? {
            ...entry.sample,
            x0: (Number(entry.sample.x0) / raster.w) * 1000,
            x1: (Number(entry.sample.x1) / raster.w) * 1000,
            y0: (Number(entry.sample.y0) / raster.h) * 1000,
            y1: (Number(entry.sample.y1) / raster.h) * 1000,
          } : null,
        }));
        // One series owns exactly one legend entry; duplicated samples of the same
        // curve must not emit two swatches and two labels.
        const bySeries = new Map();
        for (const entry of usable) {
          if (!entry.seriesId) continue;
          const prev = bySeries.get(entry.seriesId);
          if (!prev || (Number(entry.confidence) || 0) > (Number(prev.confidence) || 0)) bySeries.set(entry.seriesId, entry);
        }
        usable = [...bySeries.values()];
        if (usable.length) {
          const legendKey = (value) => String(value || "")
            .replace(/\\gamma/g, "γ").replace(/\\Gamma/g, "Γ")
            .replace(/^\$|\$$/g, "").replace(/[{}]/g, "").replace(/\s+/g, "");
          const legendNames = new Set(usable.map((entry) => legendKey(entry.tex)));
          const elements = (model.elements || []).filter((el) => {
            if (el && el.kind === "line" && el.role === "legend") return false;
            if (!(el && el.kind === "text")) return true;
            const key = legendKey(el.tex);
            return !legendNames.has(key);
          });
          model = Object.assign({}, model, { elements, legend: { entries: usable } });
        }
        yield {
          type: "step", id: "legend", label: "图例条目",
          status: usable.length ? "ok" : "fail",
          detail: usable.length + " 条 · " + usable.map((e) => e.tex + "→" + e.seriesId).join(" · ") + (problems.length ? " · " + problems.length + " 个问题" : ""),
        };
      }
    } catch (err) {
      yield { type: "step", id: "legend", label: "图例条目", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
    }
  }
  // Snapping exists for PLOT tick labels, where the ink really is the ground truth.
  // On a diagram it drags "A" onto the cluster of "f" and ruins a good box, so it
  // only runs when the pixel measurement path is in charge.
  const beforeSnap = !measured.applied || (model.elements || []).some((el) => el && el.grounded);
  if (!beforeSnap) {
    const snapped = snapTextElements(raster, model.elements || []);
    model = Object.assign({}, model, { elements: snapped.elements });
  }
  if (frameInfo.hasBox && frameInfo.bounds) {
    const b = frameInfo.bounds;
    const nx = (v) => (v / raster.w) * 1000;
    const ny = (v) => (v / raster.h) * 1000;
    const frame = { kind: "polyline", closed: true, role: "frame", points: [[nx(b.x0), ny(b.y0)], [nx(b.x1), ny(b.y0)], [nx(b.x1), ny(b.y1)], [nx(b.x0), ny(b.y1)]], style: { stroke: "#333333", width: 1.2 } };
    const rest = removePlotDuplicates(model.elements || [], model.curves || [], frameInfo, raster, model.legend, model.axis);
    model = Object.assign({}, model, { elements: [frame].concat(rest) });
    yield { type: "step", id: "frame", label: "按像素补坐标框", status: "ok", detail: "从 " + frameInfo.hLines + " 横 / " + frameInfo.vLines + " 竖长线测得" };
  }
  // Drop elements the model made up (no ink under them) and verbatim repeats
  // before anything is drawn.
  try {
    const pre = evaluateModel(model, aspect, raster);
    const pruned = pruneUnsupported(model, pre);
    if (pruned.removed.length) {
      model = pruned.model;
      yield { type: "step", id: "prune", label: "剔除无墨迹 / 重复图元", status: "ok", detail: pruned.removed.length + " 个" };
    }
  } catch (err) { /* pruning is best effort */ }
  // A ridge family shares one peak centre and usually one colour.
  if (!measured.applied && Array.isArray(model.curves) && model.curves.length >= 4) {
    const colours = snapRidgeColours(model.curves);
    if (colours.snapped) model = Object.assign({}, model, { curves: colours.curves });
    const aligned = alignRidgePeaks(model.curves);
    if (aligned.aligned) {
      model = Object.assign({}, model, { curves: aligned.curves });
      yield { type: "step", id: "alignpeaks", label: "统一峰心", status: "ok", detail: aligned.aligned + " 条曲线平移，峰心散布 " + Math.round(aligned.spread) + " → 0" };
    }
  }
  const provenance = provenanceOf(model);
  const complexityProblems = checkComplexity(modelComplexity(model));
  if (provenance.traced || complexityProblems.length) {
    const detail = provenance.traced ? "检测到禁止的描摹来源" : complexityProblems.join(" · ");
    yield { type: "step", id: "policy", label: "表示与复杂度校验", status: "fail", detail };
    yield {
      type: "done", ok: false, code: "", errors: [{ line: null, message: detail }],
      reason: "POLICY_REJECTED", model: opts.model, attempts: 0, rounds: 0,
      representation: "figure", provenance, durationMs: Date.now() - started,
    };
    yield { type: "end" };
    return;
  }
  yield { type: "step", id: "policy", label: "表示与复杂度校验", status: "ok", detail: provenance.source };
  let built = model && model.semantic
    ? await buildSemantic(model, aspect)
    : composeFigure({ model, raster, aspect, frameInfo, pixelMeasurement: measured, textBlockList });
  yield { type: "step", id: "understand", status: "ok", detail: (built.stats.type || "图形") + " · " + built.stats.elements + " 个图元" };
  yield {
    type: "understanding",
    understanding: {
      type: built.stats.type, summary: built.stats.summary, items: built.items,
      kinds: built.stats.kinds, elements: built.stats.elements,
    },
  };
  let code = built.code;
  let stats = built.stats;
  let best = null;
  let visual = null;
  let lastCompiled = null;
  let compileFeedback = "";
  let geometryFeedback = "";
  let lastGeometry = null;
  let lastAttempt = 0;
  const versions = [];
  const maxRounds = Math.max(1, Math.min(6, Number(opts.maxAttempts) || 2));
  for (let attempt = 0; attempt < maxRounds; attempt++) {
    lastAttempt = attempt;
    const previousVisual = visual;
    visual = null;
    const isDiverse = attempt > 0 && attempt % 2 === 0;
    if (attempt > 0) {
      if (remaining() < 30_000) break;
      if (model.type === 'plot' || model.curves?.length) {
        yield {type:'step',id:'repair',label:'序列与刻度修复',status:'running',detail:'按评审重新读取连接方式、观测点和刻度'};
        const feedback=[geometryFeedback,compileFeedback,...(previousVisual?.issues || []).map(i=>i.message),previousVisual?.instructions,
          'Current series IDs and types: '+JSON.stringify((model.curves || []).map(c=>({id:c.id,color:c.color,connection:c.connection,pointCount:c.points.length,marker:c.marker})))+
          '. Return ALL complete corrected series and relations; preserve IDs. Correct connection type/markers/counts using the original image.'].filter(Boolean).join('\n');
        try {
          const [plot,texts]=await Promise.all([
            extractPlotCurves({image:opts.image,apiKey:opts.apiKey,baseUrl:opts.baseUrl,model:opts.model,signal:opts.signal,feedback}),
            recognizeLabels({image:opts.image,apiKey:opts.apiKey,baseUrl:opts.baseUrl,model:opts.model,signal:opts.signal}),
          ]);
          model=applyPlotRevision(model,plot,raster,frameInfo,texts.labels);
          built=composeFigure({model,raster,aspect,frameInfo,pixelMeasurement:measured,textBlockList});
          code=built.code; stats=built.stats;
          yield {type:'step',id:'repair',status:'ok',detail:model.curves.length+' 条序列 · 重新生成并进入完整验收'};
        } catch(err) {
          yield {type:'step',id:'repair',status:'fail',detail:err.message}; break;
        }
      } else if (measured.applied) {
        yield { type: "step", id: "understand", label: isDiverse ? "重读文字（探索）" : "重读文字（利用）", status: "running" };
        try {
          const relabel = await recognizeLabels({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal });
          const g2 = groundText(raster, relabel.labels.map((l) => ({ kind: "text", box: l.box, tex: l.tex })), {
            frameLeft: measureFrame.bounds ? measureFrame.bounds.x0 : 0, frame: measureFrame, axis: findAxis(raster),
          });
          const keepFrame = (model.elements || []).filter((el) => el && (el.role === "frame" || el.role === "legend"));
          model = Object.assign({}, model, { elements: keepFrame.concat(g2.elements), curves: measured.curves });
          textBlockList = g2.blocks;
          built = composeFigure({ model, raster, aspect, frameInfo, pixelMeasurement: measured, textBlockList });
          code = built.code;
          stats = built.stats;
          yield { type: "step", id: "text", label: "文字定位", status: g2.pairedCount ? "ok" : "fail", detail: "重读 " + relabel.labels.length + " 条 · 刻度 " + g2.pairedCount + "/" + g2.numericCount };
        } catch (err) {
          yield { type: "step", id: "understand", status: "fail", detail: String((err && err.message) || err).slice(0, 80) };
          break;
        }
      } else {
        yield { type: "step", id: "understand", label: isDiverse ? "多样化候选（探索）" : "按评审意见修正理解（利用）", status: "running" };
        const feedback = isDiverse ? "" : [geometryFeedback, compileFeedback, (previousVisual && previousVisual.issues || []).map((i) => i.message).join("; "), previousVisual && previousVisual.instructions || ""].filter(Boolean).join(" ");
        try {
          const previous = model;
          const again = await understandFigure({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal, feedback, temperature: isDiverse ? 0.55 : 0, variant: isDiverse ? DIVERSE_HINT : "" });
          const retained = (previous.elements || []).filter((el) => el && (el.role === "frame" || el.role === "axis" || el.role === "legend"));
          model = Object.assign({}, again.model, {
            elements: retained.concat((again.model.elements || []).filter((el) => !el || !el.role)),
            axis: previous.axis,
            legend: previous.legend,
          });
          if (String(model.type || "").toLowerCase() === "plot") {
            const plot = await extractPlotCurves({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal, feedback });
            if (plot.curves.length) model = applyPlotRevision(model,plot,raster,frameInfo);
          }
          const snappedAgain = snapTextElements(raster, model.elements || []);
          model = Object.assign({}, model, { elements: snappedAgain.elements });
          built = composeFigure({ model, raster, aspect, frameInfo, pixelMeasurement: measured, textBlockList });
          code = built.code;
          stats = built.stats;
        } catch (err) {
          yield { type: "step", id: "understand", status: "fail", detail: String((err && err.message) || err).slice(0, 80) };
          break;
        }
      }
    }
    yield { type: "code", code };
    yield { type: "step", id: "rebuild", label: "按图元重画", status: "ok", detail: stats.elements + " 个图元 · " + Math.round(code.length / 1024) + "K 字符" };
    yield { type: "step", id: "compile", label: "编译校验", status: "running" };
    const compiled = await compileAndRender(code, opts.engine || "xelatex", opts.signal, Math.max(20_000, Math.min(40_000, remaining())));
    yield { type: "step", id: "compile", status: compiled.ok ? "ok" : "fail", detail: compiled.ok ? undefined : compiled.errors.length + " 个错误" };
    lastCompiled = compiled;
    if (!compiled.ok) {
      if (!best) best = { code, compiled, stats, visual: null, geometry: null, evidence: acceptanceEvidence(model, code), model };
      compileFeedback = "A previous answer produced a document that failed to compile: " + (compiled.errors || []).map((e) => e.message).join("; ").slice(0, 200) + ". Fix the LaTeX, keep the geometry identical.";
      if (attempt + 1 < maxRounds && remaining() > 60_000) continue;
      break;
    }
    let problems = [];
    let recall = null;
    let precision = null;
    let minCell = null;
    yield { type: "step", id: "geometry", label: "墨迹比对（参考，不作判定）", status: "running" };
    try {
      const geom = evaluateModel(model, aspect, raster);
      problems = geom.problems.slice(0, 6);
      if (!measured.applied) {
        for (const issue of curveShapeIssues((model.curves || []).filter(c=>c.connection==='smooth')).slice(0, 4)) problems.push(issue.message);
        // Per-curve offset: a direction is actionable, "40% off" is not.
        (model.curves || []).forEach((curve, i) => {
          const support = geom.support.find((s) => s.index === "curve" + i);
          if (!support || support.ratio >= 0.6) return;
          const off = inkOffset(curve.geometry ? sampleGeometry(curve.geometry) : sampleCurve(curve && curve.points), raster);
          if (off && (Math.abs(off.dx) > 2 || Math.abs(off.dy) > 2)) {
            problems.push("曲线#" + i + " 整体偏移约 (" + off.dx.toFixed(0) + ", " + off.dy.toFixed(0) + ") 像素，请按这个方向移动控制点");
          }
        });
        // §8: structural relations are a hard gate, independent of the soft
        // whole-image ink coverage.
        if (Array.isArray(model.relations) && model.relations.length) {
          const relationResult = model.relationResult;
          for (const failure of relationResult.failures) problems.unshift(failure.message);
          for (const curve of (model.curves || [])) for (const gap of checkContinuity(curve).gaps) problems.push("曲线存在可疑断点：x 间距比例 " + gap.ratio.toFixed(2));
          model = Object.assign({}, model, { relationResult, localReviews: planLocalReviews(model.curves, model.relations, {}) });
        }
      }
      if (compiled.png) {
        const ink = compareInk(raster, compiled.png);
        recall = ink.recall;
        precision = ink.precision;
        minCell = ink.minCell;
        if (recall < 0.75) problems.unshift("整图只覆盖了 " + Math.round(recall * 100) + "% 的原图墨迹（漏画）");
      }
    } catch (err) { /* verification must never take the run down */ }
    yield {
      type: "step", id: "geometry", status: "ok",
      detail: (recall == null ? "" : Math.round(recall * 100) + "% 覆盖 · ") + (minCell == null ? "" : "最差区域 " + Math.round(minCell * 100) + "% · ") + problems.length + " 个问题",
    };
    lastGeometry = { recall, precision, minCell, problems };
    versions.push({ round: attempt + 1, recall, precision, problems: problems.length, chars: code.length, compiled: true, score: null, kind: attempt === 0 ? "initial" : (isDiverse ? "explore" : "exploit") });
    geometryFeedback = problems.length ? "A deterministic pixel check reported: " + problems.slice(0, 3).join("；") + "。" : "";
    if (opts.reviewer !== false && remaining() > 10_000) {
      yield { type: "step", id: "visual", label: "渲染回查", status: "running" };
      try {
        visual = await compareVision({ source: code, image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, engine: opts.engine || "xelatex", signal: opts.signal, renderedImage: compiled.png });
        yield {
          type: "step", id: "visual", status: visual.pass ? "ok" : "fail",
          detail: visual.score + " 分" + (visual.issues && visual.issues.length ? " · " + (visual.issues.find((i) => Array.isArray(i.box)) || visual.issues[0]).message.slice(0, 90) : ""),
        };
      } catch (err) {
        visual = null;
        yield { type: "step", id: "visual", status: "fail", detail: String(err.message).slice(0, 60) };
      }
    }
    const current = versions[versions.length - 1];
    if (current) current.score = visual && typeof visual.score === "number" ? visual.score : null;
    const candidate = { code, compiled, stats, visual, geometry: { recall, precision, minCell, problems }, evidence: acceptanceEvidence(model, code), model };
    const scoreOf = candidateRank;
    if (!best || scoreOf(candidate) > scoreOf(best)) best = candidate;
    if (current) current.rank=candidateRank(candidate);
    if (visual && visual.pass && model.geometryCheck?.ok !== false && model.relationResult?.ok !== false && acceptance({...candidate.evidence,recall,pass:visual.pass}).ok) break;
    if (!visual) break;
    // A degenerate box ([0,0]-[1,1] or a sliver) cannot be repaired: skip it
    // instead of running the repairer on a meaningless region.
    // Stage 4: object-level repair. The reviewer names an object ("node:X",
    // "edge:e3"); only the structure is re-asked, and the candidate replaces the
    // current one only if the reviewer actually scores it better.
    if (model.semantic && remaining() > 70_000) {
      const target = (visual.issues || [])[0];
      if (target) {
        yield {
          type: "step", id: "repair", label: "对象级修复·" + (target.target || "结构"), status: "running",
          detail: String(target.message || "").slice(0, 70),
        };
        try {
          const feedback = "Target object: " + (target.target || "diagram") + ". Problem: " + target.message +
            ". Current structure: " + JSON.stringify(model.semantic).slice(0, 900) +
            ". Return the corrected structure with the SAME ids where possible.";
          const fixed = await understandDiagram({ image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal, feedback });
          if (fixed.check.ok) {
            const candidate = Object.assign({}, model, { semantic: fixed.semantic });
            const rebuilt = await buildSemantic(candidate, aspect);
            const recompiled = await compileAndRender(rebuilt.code, opts.engine || "xelatex", opts.signal, Math.max(20_000, Math.min(40_000, remaining())));
            if (recompiled.ok) {
              const again = await compareVision({ source: rebuilt.code, image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, engine: opts.engine || "xelatex", signal: opts.signal, renderedImage: recompiled.png });
              const better = (again && typeof again.score === "number" && again.score > (visual.score || 0));
              yield {
                type: "step", id: "repair", status: better ? "ok" : "fail",
                detail: "评审 " + (visual.score || 0) + " → " + (again && again.score) + " 分" + (better ? " · 采纳" : " · 保持原结构"),
              };
              if (better) {
                model = candidate;
                built = rebuilt;
                code = rebuilt.code;
                stats = rebuilt.stats;
                lastCompiled = recompiled;
                visual = again;
              }
            } else {
              yield { type: "step", id: "repair", status: "fail", detail: "修复后编译失败" };
            }
          } else {
            yield { type: "step", id: "repair", status: "fail", detail: "结构校验未通过：" + fixed.check.errors.slice(0, 1).join("") };
          }
        } catch (err) {
          yield { type: "step", id: "repair", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
        }
      }
    }
    const boxed = model.semantic || model.curves?.length ? [] : (visual.issues || []).filter((i) => Array.isArray(i.box) && Number(i.box[2]) >= 30 && Number(i.box[3]) >= 30);
    if (boxed.length && remaining() > 60_000) {
      const issue = boxed[0];
      const before = regionCoverage(raster, compiled.png, issue.box);
      yield { type: "step", id: "repair", label: "定点修复·" + (issue.target || "区域"), status: "running", detail: "区域覆盖 " + (before == null ? "?" : Math.round(before * 100) + "%") + " · " + String(issue.message || "").slice(0, 60) };
      try {
        const rep = await repairRegion({ raster, renderedPng: compiled.png, issue, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal });
        if (rep.elements.length) {
          const box = issue.box;
          const inBox = (el) => {
            const c = elementCenter(el);
            if (!c) return false;
            return c[0] >= box[0] - 15 && c[0] <= box[0] + box[2] + 15 && c[1] >= box[1] - 15 && c[1] <= box[1] + box[3] + 15;
          };
          // Repairing a region REPLACES it: keeping the broken version next to the
          // repaired one is how legends ended up doubled.
          // Build the candidate WITHOUT touching the current model: a repair that
          // fails verification must leave the previous drawing untouched.
          const merged = (model.elements || []).filter((el) => !el || el.role === "frame" || el.role === "axis" || !inBox(el));
          for (const el of rep.elements) merged.push(el);
          const candidateModel = Object.assign({}, model, { elements: merged });
          const rebuilt = composeFigure({ model: candidateModel, raster, aspect, frameInfo, pixelMeasurement: measured, textBlockList });
          const recompiled = await compileAndRender(rebuilt.code, opts.engine || "xelatex", opts.signal, Math.max(20_000, Math.min(40_000, remaining())));
          if (recompiled.ok) {
            const after = regionCoverage(raster, recompiled.png, issue.box);
            const stockBefore = inventoryInBox(raster, issue.box);
            const stockAfter = inventoryInBox(decodePng(recompiled.png), issue.box);
            // A repair only counts if the region had something to fix and the
            // structure did not get worse (0 -> 0 is not a fix).
            const hadContent = stockBefore.strokes + stockBefore.texts > 0;
            const notWorse = stockAfter.strokes >= stockBefore.strokes && stockAfter.texts >= stockBefore.texts;
            const better = (after != null && before != null && after > before + 0.01) || stockAfter.texts > stockBefore.texts || stockAfter.strokes > stockBefore.strokes;
            const fixed = notWorse && (hadContent ? better : true);
            yield {
              type: "step", id: "repair", status: fixed ? "ok" : "fail",
              detail: rep.elements.length + " 个元素 · 区域覆盖 " + (before == null ? "?" : Math.round(before * 100) + "%") + " → " + (after == null ? "?" : Math.round(after * 100) + "%") + " · 结构 线" + stockBefore.strokes + "→" + stockAfter.strokes + " 字" + stockBefore.texts + "→" + stockAfter.texts,
            };
            if (fixed) { model = candidateModel; lastCompiled = recompiled; code = rebuilt.code; stats = rebuilt.stats; }
          } else {
            yield { type: "step", id: "repair", status: "fail", detail: "修复后编译失败" };
          }
        } else {
          yield { type: "step", id: "repair", status: "fail", detail: "修复模型没有给出可用元素" };
        }
      } catch (err) {
        yield { type: "step", id: "repair", status: "fail", detail: String((err && err.message) || err).slice(0, 60) };
      }
    }
  }
  const final = best || { code, compiled: lastCompiled, stats, visual, geometry: lastGeometry, evidence: acceptanceEvidence(model, code) };
  if (versions.length > 1) {
    const ranked = versions.slice().sort((a, b) => (b.rank ?? -Infinity)-(a.rank ?? -Infinity));
    const winner = ranked[0];
    const last = versions[versions.length - 1];
    if (winner.round !== last.round) {
      yield { type: "step", id: "rollback", label: "回退到第 " + winner.round + " 轮", status: "ok", detail: "第 " + last.round + " 轮得分更低（" + (last.score ?? "?") + " 分 vs " + (winner.score ?? "?") + " 分）" };
    }
  }
  const logId = await logAttempt({ code: final.code || "", mode: "image-figure", perPanel: opts.perPanel, panelIndex: opts.panelIndex, attempt: 1, model: opts.model, compile: final.compiled, durationMs: Date.now() - started,
    reconstruction:final.model ? {elements:final.model.elements,curves:final.model.curves,relations:final.model.relations,axis:final.model.axis,yAxis:final.model.yAxis,geometryCheck:final.model.geometryCheck,relationResult:final.model.relationResult,versions} : null });
  if (logId) yield { type: "log", logId };
  const reportModel = final && final.model ? final.model : model;
  const recall = final.geometry && typeof final.geometry.recall === "number" ? final.geometry.recall : null;
  const visualOk = !final.visual || final.visual.pass !== false;
  const relationOk = (!reportModel.relationResult || reportModel.relationResult.ok) && reportModel.geometryCheck?.ok !== false;
  // §7: the visual score alone must not decide. A document that covers almost none
  // of the source ink is a failure even if the reviewer likes it, and an empty
  // document cannot pass on its text alone.
  const evidence = final.evidence || acceptanceEvidence(reportModel, final.code);
  const gate = acceptance({
    figureClass: evidence.figureClass,
    recall,
    draws: evidence.draws,
    plots: evidence.plots,
    nodes: evidence.nodes,
    edges: evidence.edges,
    score: final.visual && final.visual.score,
    pass: final.visual ? final.visual.pass : undefined,
  });
  const geometryOk = clsOk(gate);
  const ok = Boolean(final.compiled && final.compiled.ok) && gate.ok && relationOk;
  if (Boolean(final.compiled && final.compiled.ok) && !relationOk) {
    yield { type: "step", id: "relations", label: "结构关系门禁", status: "fail", detail: relationFeedback(reportModel.relationResult) };
  }
  if (Boolean(final.compiled && final.compiled.ok) && !gate.ok && visualOk) {
    yield { type: "step", id: "accept", label: "验收闸门", status: "fail", detail: gate.reasons.join(" · ") };
  }
  if (!visualOk && final.compiled && final.compiled.ok) {
    yield { type: "step", id: "visual", status: "fail", detail: "评审 " + (final.visual && final.visual.score != null ? final.visual.score : "?") + " 分，判为未通过（不自动套用）" };
  }
  yield {
    type: "done", ok, code: final.code,
    errors: (final.compiled && final.compiled.errors) || [],
    reason: ok ? undefined : (!relationOk ? "RELATION_REJECTED" : (!visualOk ? "REVIEW_REJECTED" : (!geometryOk ? "GEOMETRY_REJECTED" : "COMPILE_FAILED"))),
    model: opts.model, attempts: 0, rounds: Math.max(1, lastAttempt + 1), representation: "figure", provenance,
    versions,
    search: { candidates: versions.length, explore: versions.filter((v) => v.kind === "explore").length, bestRound: versions.length ? versions.slice().sort((a, b) => (b.rank ?? -Infinity)-(a.rank ?? -Infinity))[0].round : null },
    geometry: final.geometry || lastGeometry,
    understanding: { type: final.stats ? final.stats.type : "other", summary: final.stats ? final.stats.summary : "", items: built.items, kinds: final.stats ? final.stats.kinds : {}, elements: final.stats ? final.stats.elements : 0 },
    trace: final.stats,
    visual: final.visual ? { score: final.visual.score, pass: final.visual.pass, issues: final.visual.issues } : null,
    curves: (reportModel && reportModel.curves || []).map((c) => ({ id: c.id, name: c.name, role:c.role,connection:c.connection,dataKind:c.dataKind,marker:c.marker,expectedPointCount:c.expectedPointCount,geometryKind:c.geometry?.kind, points: Array.isArray(c.points) ? c.points.length : 0, landmarks: Array.isArray(c.landmarks) ? c.landmarks.length : 0, preservedKinds: c.preservedKinds || [], dropped: c.dropped || 0, candidate: c.candidate ? { kind: c.candidate.kind, family: c.candidate.family, k: c.candidate.k, rmse: c.candidate.rmse } : null })),
    seriesGeometry:reportModel.geometryCheck || null,
    axisTicks:reportModel.axis?.ticks?.map(t=>({value:t.value,px:t.px,py:t.py})) || [],
    relations: reportModel && reportModel.relationResult ? { ok: reportModel.relationResult.ok, failures: reportModel.relationResult.failures, checks: reportModel.relationResult.checks, space: reportModel.relationResult.space } : null,
    yAxis: reportModel && reportModel.yAxis ? { ok: true, rmse: reportModel.yAxis.rmse, source: reportModel.yAxis.source } : null,
    joint: reportModel && reportModel.joint ? { ok: reportModel.joint.ok, loss: reportModel.joint.loss, terms: reportModel.joint.terms, assignment: reportModel.joint.assignment, relation: reportModel.joint.relation ? { ok: reportModel.joint.relation.ok, failures: reportModel.joint.relation.failures } : null } : null,
    localReviews: reportModel && Array.isArray(reportModel.localReviews) ? reportModel.localReviews.length : 0,
    durationMs: Date.now() - started,
  };
  yield { type: "end" };
}

/* ------------------------------------------------------------------- text */

async function* runGenerationInner(opts) {
  const started = Date.now();
  const remaining = () => opts.budgetMs - (Date.now() - started);
  yield { type: "budget", limitMs: opts.budgetMs };
  const maxAttempts = Math.max(1, Math.min(6, Number(opts.maxAttempts) || 2));
  const base = userMessage(opts);
  let attempt = 0;
  let code = "";
  let lastCompiled = null;
  let lastVisual = null;
  let best = null;
  const versions = [];
  let feedback = "";
  while (attempt < maxAttempts && remaining() > 20_000) {
    attempt++;
    yield { type: "step", id: "generate", label: attempt === 1 ? "生成 TikZ" : "按评审意见修正", status: "running" };
    let text = base + (feedback ? "\n\nPrevious problems to fix:\n" + feedback.slice(0, 800) : "");
    let out;
    try {
      out = await chat({
        apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, signal: opts.signal,
        temperature: 0.2, maxTokens: 4096, timeoutMs: Math.max(30_000, Math.min(120_000, remaining())),
        messages: [
          { role: "system", content: COMMON_RULES.join("\n") },
          { role: "user", content: text },
        ],
      });
    } catch (err) {
      yield { type: "done", ok: false, code: "", errors: [{ line: null, message: String(err.message || err) }], reason: "COMPILE_FAILED", model: opts.model, attempts: attempt, rounds: attempt, durationMs: Date.now() - started };
      yield { type: "end" };
      return;
    }
    code = ensureDocument(extractCode(out.text));
    yield { type: "code", code };
    yield { type: "step", id: "compile", label: "编译校验", status: "running" };
    const compiled = await compileAndRender(code, opts.engine || "xelatex", opts.signal, Math.max(20_000, Math.min(60_000, remaining())));
    lastCompiled = compiled;
    yield { type: "step", id: "compile", status: compiled.ok ? "ok" : "fail", detail: compiled.ok ? undefined : compiled.errors.length + " 个错误" };
    versions.push({ round: attempt, recall: null, precision: null, problems: (compiled.errors || []).length, chars: code.length, compiled: Boolean(compiled.ok), score: null, kind: attempt === 1 ? "initial" : "exploit" });
    if (!compiled.ok) {
      feedback = (compiled.errors || []).map((e) => e.message).join("; ");
      continue;
    }
    if (opts.reviewer !== false && remaining() > 15_000) {
      yield { type: "step", id: "visual", label: "渲染回查", status: "running" };
      try {
        lastVisual = await compareVision({ source: code, image: opts.image, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, engine: opts.engine || "xelatex", signal: opts.signal, renderedImage: compiled.png });
        yield { type: "step", id: "visual", status: lastVisual.pass ? "ok" : "fail", detail: lastVisual.score + " 分" };
      } catch (err) {
        lastVisual = null;
        yield { type: "step", id: "visual", status: "fail", detail: String(err.message).slice(0, 60) };
      }
    }
    const candidate = { code, compiled, visual: lastVisual, geometry: null };
    const scoreOf = (c) => (c.visual && typeof c.visual.score === "number" ? c.visual.score : -1) * 1000;
    if (!best || scoreOf(candidate) > scoreOf(best)) best = candidate;
    const v = versions[versions.length - 1];
    if (v) v.score = lastVisual && typeof lastVisual.score === "number" ? lastVisual.score : null;
    if (lastVisual && lastVisual.pass) break;
    if (!lastVisual) break;
    if (attempt >= maxAttempts) break;
    feedback = ((lastVisual.issues || []).map((i) => (i.where ? i.where + ": " : "") + i.message).join("; ") + " " + (lastVisual.instructions || "")).slice(0, 800);
  }
  const final = best || { code, compiled: lastCompiled, visual: lastVisual, geometry: null };
  const logId = await logAttempt({ code: final.code || "", mode: opts.mode || "text", perPanel: opts.perPanel, panelIndex: opts.panelIndex, attempt, model: opts.model, compile: final.compiled, durationMs: Date.now() - started });
  if (logId) yield { type: "log", logId };
  const visualOk = !final.visual || final.visual.pass !== false;
  const ok = Boolean(final.compiled && final.compiled.ok) && visualOk;
  yield {
    type: "done", ok, code: final.code,
    errors: (final.compiled && final.compiled.errors) || [],
    reason: ok ? undefined : (!visualOk ? "REVIEW_REJECTED" : "COMPILE_FAILED"),
    model: opts.model, attempts: attempt, rounds: attempt, representation: opts.representation || "native",
    versions, geometry: null,
    visual: final.visual ? { score: final.visual.score, pass: final.visual.pass, issues: final.visual.issues } : null,
    curves: (reportModel && reportModel.curves || []).map((c) => ({ id: c.id, name: c.name, points: Array.isArray(c.points) ? c.points.length : 0, landmarks: Array.isArray(c.landmarks) ? c.landmarks.length : 0, preservedKinds: c.preservedKinds || [], dropped: c.dropped || 0, candidate: c.candidate ? { kind: c.candidate.kind, family: c.candidate.family, k: c.candidate.k, rmse: c.candidate.rmse } : null })),
    relations: reportModel && reportModel.relationResult ? { ok: reportModel.relationResult.ok, failures: reportModel.relationResult.failures, checks: reportModel.relationResult.checks, space: reportModel.relationResult.space } : null,
    yAxis: reportModel && reportModel.yAxis ? { ok: true, rmse: reportModel.yAxis.rmse, source: reportModel.yAxis.source } : null,
    joint: reportModel && reportModel.joint ? { ok: reportModel.joint.ok, loss: reportModel.joint.loss, terms: reportModel.joint.terms, assignment: reportModel.joint.assignment, relation: reportModel.joint.relation ? { ok: reportModel.joint.relation.ok, failures: reportModel.joint.relation.failures } : null } : null,
    localReviews: reportModel && Array.isArray(reportModel.localReviews) ? reportModel.localReviews.length : 0,
    durationMs: Date.now() - started,
  };
  yield { type: "end" };
}

/* ----------------------------------------------------------------- driver */

export async function* runGeneration(opts) {
  const rounds = Math.max(1, Math.min(6, Number(opts.maxAttempts) || 1));
  const auto = opts.perPanel ? 75_000 : Math.max(180_000, Math.min(300_000, rounds * 45_000 + 30_000));
  const requested = Number(opts.budgetMs) || Number(process.env.TIKZ_AI_BUDGET_MS) || auto;
  const budgetMs = Math.max(1, Math.min(300_000, requested));
  const merged = Object.assign({}, opts, { budgetMs });
  const representation = String(opts.imageRepresentation || opts.representation || "native");
  const isImage = opts.mode === "image" && Boolean(opts.image);
  if (isImage && representation === "figure") {
    if(opts.pipeline==='legacy' || (opts.pipeline!=='scene' && process.env.TIKZ_FIGURE_PIPELINE==='legacy')) yield* runFigureGeneration(merged);
    else yield* runSceneGeneration(merged,{chat,parseJsonObject,compileAndRender,compareVision});
    return;
  }
  yield* runGenerationInner(merged);
}

/* ------------------------------------------------------------- understanding */

/** Place the y-axis numbers and the axis label from the frame geometry. */
function arrangeAxisLabels(raster, frameInfo, axis, labels, paired) {
  const pairedSet = paired instanceof Map ? new Set(paired.keys()) : (paired instanceof Set ? paired : new Set());
  if (!frameInfo || !frameInfo.bounds) return labels;
  const b = frameInfo.bounds;
  const w = raster.w, h = raster.h;
  const toNum = (t) => { const m = /^-?\d+(\.\d+)?$/.exec(String(t || "").replace(/\$/g, "").replace(/\u2212/g, "-").trim()); return m ? Number(m[0]) : null; };
  const yNums = labels.filter((l, i) => {
    if (toNum(l.tex) == null) return false;
    if (pairedSet.size) return !pairedSet.has(i);
    const box = l.box || [0, 0, 0, 0];
    return ((box[0] || 0) + (box[2] || 0) / 2) / 1000 * w < b.x0;
  });
  if (yNums.length >= 2) {
    const values = yNums.map((l) => toNum(l.tex));
    const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    for (const label of yNums) {
      const t = hi === lo ? 0.5 : (toNum(label.tex) - lo) / (hi - lo);
      const yPx = b.y1 - t * (b.y1 - b.y0);
      const xPx = Math.max(0, b.x0 - w * 0.045);
      label.box = [(xPx / w) * 1000, ((yPx - h * 0.02) / h) * 1000, (w * 0.05 / w) * 1000, (h * 0.04 / h) * 1000];
    }
  }
  for (const label of labels) {
    const tex = String(label.tex || "");
    if (!/\//.test(tex) || /\d/.test(tex.replace(/\$[^$]*\$/g, ""))) continue;
    const current = label.box || [0, 0, 0, 0];
    const currentYPx = ((current[1] || 0) + (current[3] || 0) / 2) / 1000 * h;
    // Preserve a plausible dedicated-OCR position. The former fixed fraction
    // moved z/l_0 upward into empty space on short, wide panels.
    if (currentYPx > (axis ? axis.y : b.y1) + 8 && currentYPx < h) continue;
    const xPx = (b.x0 + b.x1) / 2;
    const yPx = (axis ? axis.y : b.y1) + (b.y1 - b.y0) * 0.18;
    label.box = [((xPx - w * 0.05) / w) * 1000, ((yPx - h * 0.02) / h) * 1000, (w * 0.1 / w) * 1000, (h * 0.05 / h) * 1000];
  }
  return labels;
}

/** Ground every string on the ink it occupies (ticks by row, labels by width). */
function groundText(raster, labels, options) {
  const opts = options || {};
  const words = textBlocks(raster);
  const axis = opts.axis || findAxis(raster);
  const band = axis ? words.filter((w) => w.y > axis.y + 2 && w.y < axis.y + raster.h * 0.3) : [];
  const frameLeft = opts.frameLeft == null ? 0 : opts.frameLeft;
  const numeric = numericLabels(labels).filter((item) => {
    const box = item.label.box || [0, 0, 0, 0];
    const cx = ((box[0] || 0) + (box[2] || 0) / 2) / 1000 * raster.w;
    const cy = ((box[1] || 0) + (box[3] || 0) / 2) / 1000 * raster.h;
    const insideLeft = cx >= frameLeft + Math.max(3, raster.w * 0.008);
    const belowAxis = !axis || cy > axis.y + 2;
    return insideLeft && belowAxis;
  });
  const paired = pairNumericRow(numeric, band, { h: raster.h });
  const byIndex = new Map(paired.matches.map((m) => [m.labelIndex, m.block]));
  const rest = (labels || []).map((_, i) => i).filter((i) => !byIndex.has(i));
  const maxD = Math.hypot(raster.w, raster.h) * 0.22;
  const candidates = mergeRuns(words, 4).concat(words).filter((block) => rest.some((i) => {
    const box = labels[i].box || [0, 0, 10, 10];
    const cx = ((box[0] || 0) + (box[2] || 0) / 2) / 1000 * raster.w;
    const cy = ((box[1] || 0) + (box[3] || 0) / 2) / 1000 * raster.h;
    return Math.hypot(block.x - cx, block.y - cy) <= maxD;
  }));
  const grounded = matchLabels(rest.map((i) => labels[i]), candidates, { w: raster.w, h: raster.h });
  for (const m of grounded.matches) byIndex.set(rest[m.labelIndex], candidates[m.blockIndex]);
  const yAxisOnly = new Set();
  (labels || []).forEach((label, i) => {
    const box = label.box || [0, 0, 0, 0];
    const cx = ((box[0] || 0) + (box[2] || 0) / 2) / 1000 * raster.w;
    if (cx < frameLeft + Math.max(3, raster.w * 0.008)) { yAxisOnly.add(i); byIndex.delete(i); }
  });
  const pad = 2;
  const elements = (labels || []).map((label, i) => {
    if (yAxisOnly.has(i)) return label;
    const block = byIndex.get(i);
    if (!block) return label;
    return Object.assign({}, label, {
      grounded: true,
      box: [
        ((block.x - block.w / 2 - pad) / raster.w) * 1000,
        ((block.y - block.h / 2 - pad) / raster.h) * 1000,
        ((block.w + 2 * pad) / raster.w) * 1000,
        ((block.h + 2 * pad) / raster.h) * 1000,
      ],
    });
  });
  const kept = elements.filter(Boolean);
  arrangeAxisLabels(raster, opts.frame || null, axis || null, kept, byIndex);
  return { elements: kept, blocks: words, numericCount: numeric.length, pairedCount: paired.matches.length, rowCount: paired.row ? paired.row.count : 0 };
}

const LABEL_PROMPT = 'Transcribe EVERY printed text label and locate the glyphs. No description, no TikZ. '+
  'Return ONLY JSON {"labels":[{"role":"x-tick|y-tick|axis-label|title|legend|annotation","bounds":{"left":100,"top":200,"right":140,"bottom":240},"tex":"visible text, math in $...$"}]}. '+
  'bounds uses four NAMED EDGES in normalised 0..1000 full-image coordinates, origin top-left, y down. right/bottom are coordinates, NOT width/height. '+
  'A tight glyph box has right>left and bottom>top. Return each separate occurrence of a number, including both zero labels if x and y axes each print 0. '+
  'Keep every positive, negative and zero tick exactly as printed. Do not include graph strokes in text boxes. At most 40 labels.';

export function normalizeRecognizedLabels(json) {
  const labels=[];
  for(const item of json.labels || []) {
    if(!item || typeof item.tex!=='string' || !item.tex.trim()) continue;
    const b=item.bounds;
    if(!b) throw new Error('OCR_BOX_PROTOCOL: named bounds.left/top/right/bottom required');
    const box=[Number(b.left),Number(b.top),Number(b.right)-Number(b.left),Number(b.bottom)-Number(b.top)];
    if(box.some(n=>!Number.isFinite(n)) || box[2]<=0 || box[3]<=0 || box[0]<0 || box[1]<0 || Number(b.right)>1000 || Number(b.bottom)>1000 || box[3]>250) {
      throw new Error('OCR_BOX_PROTOCOL: invalid tight text bounds for '+item.tex.slice(0,20));
    }
    labels.push({box,tex:item.tex.trim(),role:item.role});
  }
  return labels.slice(0,40);
}

/** Read the strings (not their positions: those come from the ink). */
export async function recognizeLabels({ image, apiKey, baseUrl, model, signal }) {
  const out = await chat({
    apiKey, baseUrl, model, signal, temperature: 0, thinking: "disabled", maxTokens: 2000, timeoutMs: 60_000,
    messages: [{ role: "user", content: [{ type: "text", text: LABEL_PROMPT }, { type: "image_url", image_url: { url: image } }] }],
  });
  const start = out.text.indexOf("{");
  const end = out.text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("文字识别返回的不是 JSON，请重试");
  let json;
  try { json = JSON.parse(out.text.slice(start, end + 1)); } catch { throw new Error("文字识别返回的 JSON 无法解析，请重试"); }
  const labels=normalizeRecognizedLabels(json);
  return { labels, model: out.model, usage: out.usage };
}

const PLOT_CURVES_PROMPT = [
  "Read the scientific plot as SEMANTIC DATA SERIES. FIRST identify straight connections, corners, visible markers, steps, and smooth curves. Then enumerate observations or sparse smooth-curve landmarks. Never infer a sine wave from an alternating discrete sequence. No TikZ, no pixel tracing.",
  'Return ONLY JSON: {"curves":[{"id":"curve-1","role":"data|reference","name":"legend text or empty","dataKind":"discrete|continuous","connection":"linear|step|none|smooth","expectedPointCount":null,"marker":{"shape":"none|circle|square|triangle|diamond","radiusPx":3,"filled":true},"color":"#rrggbb","width":2,"dash":"solid|dashed|dotted","continuous":true,"points":[[x,y],[x,y]],"landmarks":[{"id":"minimum-1","kind":"minimum","point":[x,y],"confidence":0.9}]}],"relations":[]}',
  "Rules:",
  "- One entry per visible curve, in the order they appear from the bottom of the plot to the top. Give every curve a stable id and refer to ids in landmarks/relations, never array positions or label text.",
  "- Visible isolated filled/hollow markers are DISCRETE observations. Count ALL visible markers first in expectedPointCount, then give EXACTLY one point per marker, left to right, preserving every local height and increasing/decreasing amplitude. Do not regularise them to equal heights, equal periods or a theoretical formula. Budget: at most 80 actual observations, not 12; never omit alternate observations.",
  "- Straight segments joining observations require connection=linear, even if the chain is continuous or resembles an oscillation. Do not add shoulders around discrete vertices. Unconnected scatter: connection=none. Visible stairs: connection=step (stepPosition=pre|post|mid).",
  "- Smooth curves ONLY: connection=smooth; expectedPointCount=null, marker.shape=none unless actual observation markers exist. " + CURVE_BUDGET_PROMPT,
  "- A dashed/dotted baseline or threshold is ONE separate role=reference series with connection=linear and two endpoints; marker.shape=none. Dash dots are a stroke pattern, not observation markers. Do not output another copy as a primitive.",
  "- Mark high-confidence endpoints, local minima/maxima, crossings, plateau edges and inflections as landmarks; include confidence and reuse the exact id of the other curve for crossings.",
  "- Only add a relation when the image clearly shows it. vertical-order means the below series is lower in data space at the extremum; axis-contact means a curve extremum reaches an axis value.",
  "- continuous describes gaps only; it does NOT mean smooth. A sharp zigzag is continuous=true AND connection=linear.",
  "- Coordinates are normalised 0..1000 over the WHOLE image, origin top-left, x right, y DOWN.",
  "- Read the actual numeric y ticks: zero may be at the centre, bottom, top or absent. NEVER assume a 0..1 range. minimum/maximum refer to DATA values, so on a conventional y axis a data minimum has larger image y.",
  "- In vertical-order, the below series has the LARGER y coordinate (it sits lower in the image) at the referenced extremum.",
  "- width is the stroke width in SOURCE PIXELS; use dash=dashed or dotted only when the curve really is.",
  "- Relations are optional: return [] unless clearly evidenced. For oscillating lines use crossing with seriesId,withSeriesId,count, or vertical-order at {seriesId,kind,point:[x,y]}; never assert a global vertical order for two crossing series. Do not invent axis contact at zero for an oscillation trough.",
  "- Do not include axes, ticks, frames, text or legend swatches. Include actual reference lines once as role=reference.",
].join("\n");

/** Secondary pass for plots: curves as sparse points plus landmarks/relations. */
export async function extractPlotCurves({ image, apiKey, baseUrl, model, signal, feedback }) {
  const raster=decodePng(image), axis=findAxis(raster);
  const anchor=axis ? '\nMeasured horizontal x-axis in full-image 0..1000 coordinates: left='+Math.round(axis.x0/raster.w*1000)+', right='+Math.round(axis.x1/raster.w*1000)+', y='+Math.round(axis.y/raster.h*1000)+'. This is NOT the zero reference line. Keep each observation at its actual full-image position, not a convenient uniform grid.' : '';
  const text = PLOT_CURVES_PROMPT + anchor + (feedback ? "\n\nA previous attempt was rejected:\n" + String(feedback).slice(0, 1800) : "");
  const out = await chat({
    apiKey, baseUrl, model, signal, temperature: 0, thinking: "disabled", maxTokens: 5000, timeoutMs: 90_000,
    messages: [{ role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: image } }] }],
  });
  const json = parseJsonObject(out.text);
  const curves = (Array.isArray(json.curves) ? json.curves : []).filter((c) => c && Array.isArray(c.points) && c.points.length >= 2).map((c,i)=>{
    if(!c.connection || !c.dataKind || !c.marker) throw new Error('SERIES_PROTOCOL: connection, dataKind and marker are required');
    return normalizeSeries(fitReferenceLine(raster,fitPrintedMarkers(raster,{...c,id:c.id || 'curve-'+(i+1)})),i);
  });
  const relations = Array.isArray(json.relations) ? json.relations : [];
  const validation = validatePlotModel({ curves, relations }, { strict: false });
  if (validation.errors.length) {
    throw new Error("曲线协议错误：" + validation.errors.slice(0, 3).join("; "));
  }
  return { curves, relations, usage: out.usage, warnings: validation.warnings };
}

/** Ask for the SEMANTIC structure of a diagram (nodes / edges / labels). */
export async function understandDiagram({ image, apiKey, baseUrl, model, signal, feedback }) {
  const text = DIAGRAM_PROTOCOL + (feedback ? "\n\nA previous attempt was rejected:\n" + String(feedback).slice(0, 600) : "");
  const out = await chat({
    apiKey, baseUrl, model, signal, temperature: 0, thinking: "disabled", maxTokens: 2000, timeoutMs: 90_000,
    messages: [{ role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: image } }] }],
  });
  const json = parseJsonObject(out.text);
  const check = validateSemantic(json);
  return { semantic: json, check, usage: out.usage };
}

/** Compile a validated semantic diagram into a document. */
async function buildSemantic(model, aspect) {
  const widthCm = 12;
  const heightCm = Math.max(2.2, Math.min(9, widthCm * aspect));
  const sizeCm = 0.62;
  // Measure the node labels with TeX so the layout uses real widths.
  let widths = null;
  try {
    const measured = await measureTexts(model.semantic.nodes.map((n) => ({
      tex: (n.label && (n.label.tex || n.label.text)) || "",
      mode: n.label && n.label.mode,
      sizeCm,
    })));
    widths = new Map();
    model.semantic.nodes.forEach((n, i) => {
      const m = measured[i];
      if (m && m.w > 0) widths.set(n.id, m.w);
    });
  } catch {
    widths = null;
  }
  const layout = layoutSemantic(model.semantic, { widthCm, heightCm, sizeCm, widths });
  const body = compileSemantic(model.semantic, layout);
  const withBox = body.replace(
    "\\begin{tikzpicture}",
    "\\begin{tikzpicture}",
  );
  const doc = wrapSource(withBox).tex;
  const stats = {
    type: "diagram",
    summary: "语义结构：" + model.semantic.nodes.length + " 个节点 · " + model.semantic.edges.length + " 条边 · " + model.semantic.labels.length + " 个标签",
    elements: model.semantic.nodes.length + model.semantic.edges.length + model.semantic.labels.length,
    kinds: { nodes: model.semantic.nodes.length, edges: model.semantic.edges.length, labels: model.semantic.labels.length },
  };
  return { code: doc, stats, items: [] };
}

/** One understanding pass: the figure as geometric primitives. */
export async function understandFigure({ image, apiKey, baseUrl, model, signal, feedback, temperature = 0, variant = "" }) {
  const base = String(UNDERSTAND_PROMPT) +
    (feedback ? "\n\nA previous reconstruction of this same image had these visible problems. Fix exactly these, keep everything else:\n" + String(feedback).slice(0, 800) : "") +
    (variant ? "\n\n" + variant : "");
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = attempt === 0 ? base : base + "\n\nYour previous reply was cut off or could not be parsed. Return ONLY the JSON object, at most " + (attempt === 1 ? "30" : "12") + " elements.";
    const out = await chat({
      apiKey, baseUrl, model, signal, temperature, thinking: "disabled", maxTokens: 6000, timeoutMs: 120_000,
      messages: [{ role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: image } }] }],
    });
    try {
      const json = parseJsonObject(out.text);
      if (!Array.isArray(json.elements)) throw new Error("模型没有返回图元列表");
      if (json.elements.length > 80) {
        json.elements = json.elements.map((el) => ({ el, area: elementArea(el) })).sort((a, b) => b.area - a.area).slice(0, 80).map((x) => x.el);
      }
      return { model: json, usage: out.usage, raw: out.text };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("图像理解失败");
}
