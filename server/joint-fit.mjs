/**
 * Joint candidate selection for multiple scientific curves (§7).
 *
 * Every series keeps its own candidate family/spline/line, but the FINAL
 * assignment is scored jointly: landmark fit, extremum shape, vertical order,
 * axis contact and complexity are all part of one loss. A low per-curve
 * residual that violates a high-confidence relation must lose.
 */

import { fitAdaptive, evalPower, slopePower } from "./spline.mjs";
import { fitFamily, familyValue, familyExpression } from "./family.mjs";
import { evaluateRelations } from "./curve-relations.mjs";
import { normalizeSeries, isObservationSeries, compileSeriesGeometry, evaluateGeometry, polylineGeometry } from './series-geometry.mjs';

function attachGeometry(candidate, series) {
  if (!candidate.geometry) {
    if (candidate.kind === 'family') candidate.geometry = { kind:'family', fit:candidate.fit, domain:[series.points[0][0],series.points.at(-1)[0]] };
    else if (candidate.kind === 'spline') candidate.geometry = { kind:'bezier', paths:[candidate.fit.segments], domain:candidate.fit.domain };
    else if (candidate.kind === 'line') candidate.geometry = polylineGeometry([series.points[0],series.points.at(-1)].map(p=>[p[0],candidate.evalPixel(p[0])]));
  }
  candidate.evalPixel = x => evaluateGeometry(candidate.geometry,x);
  return candidate;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function linearFit(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of points) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const rmse = Math.sqrt(points.reduce((s, [x, y]) => s + (intercept + slope * x - y) ** 2, 0) / n);
  return { kind: "line", k: 2, rmse, slope, intercept, evalPixel: (x) => intercept + slope * x };
}

function splineCandidate(points, options) {
  const opts = options || {};
  const fit = fitAdaptive(points, { tolerance: opts.tolerance == null ? 6 : opts.tolerance, maxK: opts.maxK == null ? 8 : opts.maxK });
  if (!fit) return null;
  return { kind: "spline", k: fit.params, rmse: fit.rmse, fit, evalPixel: (x) => evalPower(fit, x), derivative: (x) => slopePower(fit, x) };
}

function familyCandidates(points, options) {
  const opts = options || {};
  const names = opts.families || ["tanhPlateau", "genDip", "gauss"];
  const out = [];
  for (const name of names) {
    const fit = fitFamily(points, name, opts);
    if (!fit || !fit.ok || !Number.isFinite(fit.rmse)) continue;
    out.push({
      kind: "family", family: name, k: fit.params.length, rmse: fit.rmse, fit,
      evalPixel: (x) => familyValue(name, fit.params, x),
      derivative: (x) => {
        const h = 1e-3;
        return (familyValue(name, fit.params, x + h) - familyValue(name, fit.params, x - h)) / (2 * h);
      },
    });
  }
  return out;
}

/** All candidates for one series, always including line and spline fallbacks. */
export function candidatesForSeries(series, options) {
  const opts = options || {};
  const points = (series.points || []).slice().sort((a, b) => a[0] - b[0]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length < 2) return [];
  series = normalizeSeries({ ...series, points });
  if (isObservationSeries(series)) {
    return [attachGeometry({kind:series.connection, k:points.length, rmse:0, geometry:compileSeriesGeometry(series)},series)];
  }
  const cands = [];
  const line = linearFit(points);
  if (Number.isFinite(line.rmse)) cands.push(line);
  cands.push(...familyCandidates(points, opts));
  const spline = splineCandidate(points, opts);
  if (spline) cands.push(spline);
  // A sparse-interpolation fallback: exact through points, penalised heavily by
  // complexity so it only wins when the compact models genuinely cannot fit.
  if (points.length >= 2) {
    cands.push({ kind:'sparse', k:Math.max(12,points.length), rmse:0, geometry:compileSeriesGeometry(series) });
  }
  return cands.map(c=>attachGeometry(c,series));
}

function landmarkWeights(series) {
  const pts = (series.points || []).slice();
  const weights = pts.map(() => 1);
  (series.landmarks || []).forEach((l) => {
    if (!l || !Array.isArray(l.point)) return;
    let best = -1, bestD = Infinity;
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - l.point[0], p[1] - l.point[1]); if (d < bestD) { bestD = d; best = i; } });
    if (best >= 0) weights[best] = 6;
  });
  return weights;
}

function assignmentSeries(series, candidate, yCalibration, coordinateSpace) {
  const toValue = yCalibration && yCalibration.ok ? yCalibration.toValue : null;
  const evalPixel = candidate.evalPixel;
  return Object.assign({}, series, {
    points: series.points,
    geometry: candidate.geometry,
    evalPixel,
    evalData: toValue ? (x) => toValue(evalPixel(x)) : undefined,
    coordinateSpace,
  });
}

function derivativeAt(candidate, x) {
  if (candidate.derivative) return candidate.derivative(x);
  const h = 1e-3;
  return (candidate.evalPixel(x + h) - candidate.evalPixel(x - h)) / (2 * h);
}

function extremumX(series) {
  const pts = (series.points || []).slice().sort((a, b) => a[0] - b[0]);
  if (!pts.length) return null;
  const lm = (series.landmarks || []).find((l) => l && (l.kind === "minimum" || l.kind === "maximum") && Array.isArray(l.point));
  if (lm) return lm.point[0];
  let best = pts[0];
  for (const p of pts) if (p[1] < best[1]) best = p;
  return best[0];
}

/**
 * Choose the joint assignment. Returns { ok, assignment, loss, terms, series }.
 * `assignment[i]` is the chosen candidate index for `series[i]`.
 */
export function fitJointSeries(series, relations, options) {
  const opts = options || {};
  const yCalibration = opts.yCalibration || null;
  const coordinateSpace = opts.coordinateSpace || (yCalibration && yCalibration.ok ? "data" : "pixel");
  const wFit = opts.wFit == null ? 1 : opts.wFit;
  const wExt = opts.wExt == null ? 1.5 : opts.wExt;
  const wOrder = opts.wOrder == null ? 20 : opts.wOrder;
  const wAxis = opts.wAxis == null ? 20 : opts.wAxis;
  const wComplex = opts.wComplex == null ? 0.35 : opts.wComplex;
  const hardConfidence = opts.hardConfidence == null ? 0.85 : opts.hardConfidence;

  const per = series.map((s) => ({ series: s, candidates: candidatesForSeries(s, opts), weights: landmarkWeights(s) }));
  if (per.some((p) => !p.candidates.length)) return { ok: false, assignment: [], loss: Infinity, terms: {}, series };

  const score = (indices) => {
    const chosen = indices.map((ci, i) => per[i].candidates[ci]);
    const models = indices.map((ci, i) => assignmentSeries(per[i].series, chosen[i], yCalibration, coordinateSpace));
    let fit = 0;
    indices.forEach((ci, i) => {
      const pts = per[i].series.points;
      const cand = chosen[i];
      pts.forEach((pt, k) => {
        const r = cand.evalPixel(pt[0]) - pt[1];
        fit += per[i].weights[k] * r * r;
      });
    });
    let ext = 0;
    indices.forEach((ci, i) => {
      if (isObservationSeries(per[i].series)) return;
      for (const landmark of per[i].series.landmarks || []) {
        if (!['minimum','maximum'].includes(landmark.kind)) continue;
        const x = landmark.point?.[0];
        if (!Number.isFinite(x) || x <= per[i].series.points[0][0] || x >= per[i].series.points.at(-1)[0]) continue;
        ext += derivativeAt(chosen[i], x) ** 2;
      }
    });

    const rel = evaluateRelations({ series: models, relations, yCalibration, coordinateSpace, options: { ...opts, allowMissing: indices.length < per.length } });
    let order = 0, axis = 0;
    for (const check of rel.checks) {
      if (check.kind === "vertical-order" && !check.ok) order += Math.max(0, check.margin - check.gap) ** 2;
      if (check.kind === "axis-contact" && !check.ok && Number.isFinite(check.actual)) axis += Math.abs(check.actual - check.expected) ** 2;
    }

    const complexity = chosen.reduce((s, c) => s + c.k, 0);
    const hardFail = rel.failures.some((f) => {
      const r = relations.find((r,i) => (r.id || `relations[${i}]`) === f.tag);
      return !r || (r.confidence == null ? true : r.confidence >= hardConfidence);
    });

    const loss = wFit * fit + wExt * ext + wOrder * order + wAxis * axis + wComplex * complexity + (hardFail ? 1e9 : 0);
    return { loss, terms: { fit: wFit * fit, ext: wExt * ext, order: wOrder * order, axis: wAxis * axis, complexity: wComplex * complexity, hardFail: hardFail ? 1e9 : 0 }, relation: rel, hardFail, chosen };
  };

  // Beam search: keep the best `beam` partial assignments at each series.
  const beam = opts.beam == null ? 8 : opts.beam;
  let states = [{ idx: [], loss: 0, meta: null }];
  for (let i = 0; i < per.length; i++) {
    const next = [];
    for (const state of states) {
      for (let c = 0; c < per[i].candidates.length; c++) {
        const idx = state.idx.concat(c);
        const meta = score(idx);
        next.push({ idx, loss: meta.loss, meta });
      }
    }
    next.sort((a, b) => a.loss - b.loss);
    states = next.slice(0, beam);
  }
  const bestState = states[0];
  const meta = bestState ? bestState.meta : null;
  if (!meta) return { ok: false, assignment: [], loss: Infinity, terms: {}, series };
  const chosen = meta.chosen.map((c) => ({ kind: c.kind, family: c.family, k: c.k, rmse: c.rmse, fit: c.fit, geometry:c.geometry, evalPixel: c.evalPixel }));
  const outSeries = series.map((s, i) => Object.assign({}, s, {
    evalPixel: chosen[i].evalPixel,
    geometry: chosen[i].geometry,
    evalData: yCalibration && yCalibration.ok ? (x) => yCalibration.toValue(chosen[i].evalPixel(x)) : undefined,
    candidate: chosen[i],
    coordinateSpace,
  }));
  return { ok: !meta.hardFail, assignment: bestState.idx, loss: meta.loss, terms: meta.terms, relation: meta.relation, series: outSeries, candidates: chosen };
}
