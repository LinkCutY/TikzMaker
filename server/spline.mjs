/**
 * Constrained spline fitting (§11).
 *
 * The curve lives in a FINITE parameter set: a natural cubic spline written in the
 * natural cubic regression-spline basis. x and y are normalised before solving,
 * so the same geometric curve has the same fit when expressed in pixels, points
 * or normalised coordinates.
 * over a small set of interior knots k_j. Knots are added only while the residual
 * demands it, and the parameter budget never follows the pixel count. The output is
 * one cubic Bézier segment per span (§11.5), never a sampled polyline.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function solveDense(A, b) {
  const n = b.length;
  const m = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    const p = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

const hinge = (x, k) => (x > k ? (x - k) ** 3 : 0);
const hingeSlope = (x, k) => (x > k ? 3 * (x - k) ** 2 : 0);

/** Natural-cubic basis on u in [0,1], with zero curvature at both ends. */
function naturalRow(u, knots) {
  const ks = knots.slice().sort((a, b) => a - b);
  if (!ks.length) return [1, u];
  const all = [0, ...ks, 1];
  const last = all.at(-1);
  const reference = all.at(-2);
  const d = (k) => (hinge(u, k) - hinge(u, last)) / Math.max(1e-9, last - k);
  const ref = d(reference);
  const row = [1, u];
  for (let i = 0; i < all.length - 2; i++) row.push(d(all[i]) - ref);
  return row;
}

function naturalSlopeRow(u, knots) {
  const ks = knots.slice().sort((a, b) => a - b);
  if (!ks.length) return [0, 1];
  const all = [0, ...ks, 1];
  const last = all.at(-1);
  const reference = all.at(-2);
  const d = (k) => (hingeSlope(u, k) - hingeSlope(u, last)) / Math.max(1e-9, last - k);
  const ref = d(reference);
  const row = [0, 1];
  for (let i = 0; i < all.length - 2; i++) row.push(d(all[i]) - ref);
  return row;
}

/**
 * Penalised, robust least squares for the truncated-power basis.
 *
 *   min_c  Σ w_i ρ((f(x_i)-y_i)/s) + λ ∫ (f'')² dx
 *
 * The integral is discretised on a fixed grid over the domain (independent of the
 * input resolution), so the smoothing strength never grows with the image size.
 * ρ is Huber, applied through 3 IRLS reweighting passes.
 */
export function fitTruncatedPower(points, knots, options) {
  const opts = options || {};
  const lambda = Math.max(0, Number(opts.lambda) || 0);
  const ks = knots.slice().sort((a, b) => a - b);
  const cols = 2 + ks.length;
  const xs = points.map((p) => p[0]);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const span = Math.max(1e-9, hi - lo);
  const ys = points.map((p) => p[1]);
  const yLo = Math.min(...ys), yHi = Math.max(...ys);
  const yShift = ys.reduce((sum, value) => sum + value, 0) / Math.max(1, ys.length);
  const yScale = Math.max(1e-9, yHi - yLo);
  const knotsU = ks.map((k) => clamp((k - lo) / span, 0, 1));
  const row = (x) => naturalRow(clamp((x - lo) / span, 0, 1), knotsU);
  const normalY = (y) => (y - yShift) / yScale;
  // Fixed discretisation grid for the curvature penalty.
  const grid = [];
  const steps = Math.max(8, cols + 6);
  for (let i = 0; i <= steps; i++) grid.push(lo + (span * i) / steps);
  const h2 = (1 / steps) ** 2;
  const curvature = [];
  for (let i = 1; i < grid.length - 1; i++) {
    const a = row(grid[i - 1]), b = row(grid[i]), c = row(grid[i + 1]);
    curvature.push(a.map((v, j) => v - 2 * b[j] + c[j]));
  }

  let weights = points.map(() => 1);
  let coef = null;
  // Robustness is opt-in: on clean data reweighting only biases the fit.
  const passes = opts.robust === true ? 3 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const A = Array.from({ length: cols }, () => new Array(cols).fill(0));
    const rhs = new Array(cols).fill(0);
    points.forEach(([x, y], i) => {
      const r = row(x);
      const w = weights[i];
      for (let a = 0; a < cols; a++) {
        rhs[a] += w * r[a] * normalY(y);
        for (let b = 0; b < cols; b++) A[a][b] += w * r[a] * r[b];
      }
    });
    // Each normalised column gets its own tiny stabiliser. A global trace-based
    // ridge made the answer depend on the unit used for x.
    for (let a = 0; a < cols; a++) A[a][a] += Math.max(1e-10, A[a][a] * 1e-8);
    // Smoothing term: λ Σ (second difference)² / h².
    if (lambda > 0) {
      for (const g of curvature) {
        for (let a = 0; a < cols; a++) {
          for (let b = 0; b < cols; b++) A[a][b] += (lambda / h2) * g[a] * g[b];
        }
      }
    }
    const next = solveDense(A, rhs);
    if (!next) return null;
    coef = next;
    // Huber reweighting on the residuals.
    const residuals = points.map(([x, y]) => {
      const r = row(x);
      let f = 0;
      for (let a = 0; a < cols; a++) f += r[a] * coef[a];
      return f - normalY(y);
    });
    const abs = residuals.map(Math.abs).sort((a, b) => a - b);
    const median = abs[Math.floor(abs.length / 2)] || 0;
    // MAD-based scale: robust to a few outliers without collapsing on a good fit.
    const scale = Math.max(1e-9, 1.4826 * median);
    const delta = (opts.huberDelta == null ? 1.5 : opts.huberDelta) * scale;
    const maxAbs = abs[abs.length - 1] || 0;
    // No heavy tail -> keep plain least squares (reweighting would only add noise).
    weights = maxAbs <= 1.5 * delta
      ? residuals.map(() => 1)
      : residuals.map((res) => {
          const a = Math.abs(res);
          return a <= delta ? 1 : delta / a;
        });
    if (passes === 1) break;
  }

  let sse = 0;
  for (const [x, y] of points) {
    const r = row(x);
    let f = 0;
    for (let a = 0; a < cols; a++) f += r[a] * coef[a];
    const predicted = yShift + yScale * f;
    sse += (predicted - y) ** 2;
  }
  return {
    coef, knots: ks, knotsU, xShift: lo, xScale: span, yShift, yScale,
    basis: "natural-cubic-normalised",
    rmse: Math.sqrt(sse / Math.max(1, points.length)), params: cols,
  };
}

/** PCHIP (Fritsch-Carlson) slopes: monotone by construction in every span. */
export function pchipSlopes(segments) {
  const n = segments.length + 1;
  const h = [], delta = [];
  for (const s of segments) {
    h.push(s.b - s.a);
    delta.push((s.p3[1] - s.p0[1]) / Math.max(1e-9, s.b - s.a));
  }
  const m = new Array(n).fill(0);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  }
  return m;
}

/** Rebuild segments with shape-preserving slopes (monotone data stays monotone). */
export function applyMonotone(segments) {
  if (!segments.length) return segments;
  const slopes = pchipSlopes(segments);
  return segments.map((s, i) => {
    const h = s.b - s.a;
    const fa = s.p0[1];
    const fb = s.p3[1];
    return {
      a: s.a, b: s.b,
      p0: [s.a, fa],
      p1: [s.a + h / 3, fa + (h / 3) * slopes[i]],
      p2: [s.b - h / 3, fb - (h / 3) * slopes[i + 1]],
      p3: [s.b, fb],
    };
  });
}

export function evalPower(fit, x) {
  if (fit && fit.basis === "natural-cubic-normalised") {
    const u = clamp((x - fit.xShift) / Math.max(1e-9, fit.xScale), 0, 1);
    const r = naturalRow(u, fit.knotsU || []);
    const value = r.reduce((sum, v, i) => sum + v * fit.coef[i], 0);
    return fit.yShift + fit.yScale * value;
  }
  let f = fit.coef[0] + fit.coef[1] * x;
  fit.knots.forEach((k, j) => { f += fit.coef[2 + j] * hinge(x, k); });
  return f;
}

export function slopePower(fit, x) {
  if (fit && fit.basis === "natural-cubic-normalised") {
    const u = clamp((x - fit.xShift) / Math.max(1e-9, fit.xScale), 0, 1);
    const r = naturalSlopeRow(u, fit.knotsU || []);
    const derivative = r.reduce((sum, v, i) => sum + v * fit.coef[i], 0);
    return derivative * fit.yScale / Math.max(1e-9, fit.xScale);
  }
  let d = fit.coef[1];
  fit.knots.forEach((k, j) => { if (x > k) d += 3 * fit.coef[2 + j] * (x - k) ** 2; });
  return d;
}

/** One Bézier segment per knot span, exactly the §11.5 control-point formulas. */
export function bezierSegments(fit, domain) {
  const lo = domain ? domain[0] : Math.min(...fit.domain);
  const hi = domain ? domain[1] : Math.max(...fit.domain);
  const xs = [lo, ...fit.knots.filter((k) => k > lo && k < hi), hi];
  const segs = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], h = b - a;
    const fa = evalPower(fit, a), fb = evalPower(fit, b);
    const da = slopePower(fit, a), db = slopePower(fit, b);
    segs.push({
      a, b,
      p0: [a, fa],
      p1: [a + h / 3, fa + (h / 3) * da],
      p2: [b - h / 3, fb - (h / 3) * db],
      p3: [b, fb],
    });
  }
  return segs;
}

/** Greedy knot refinement driven by the worst point, inside a fixed budget. */
export function fitAdaptive(points, options) {
  const opts = options || {};
  const maxK = Math.max(3, Math.min(14, opts.maxK || 10));
  const tolerance = opts.tolerance == null ? 0.5 : opts.tolerance;
  const sorted = points.slice().sort((p, q) => p[0] - q[0]);
  if (sorted.length < 2) return null;
  const xs = sorted.map((p) => p[0]);
  const lo = xs[0], hi = xs[xs.length - 1];
  const fitOpts = { lambda: opts.lambda, robust: opts.robust, huberDelta: opts.huberDelta };
  let knots = [];
  let best = fitTruncatedPower(sorted, knots, fitOpts);
  if (!best) return null;
  best.domain = [lo, hi];
  // params grows by one per added knot; stop BEFORE crossing the budget.
  while (best.params < maxK && best.rmse > tolerance) {
    // Put the next knot where the error peaks, away from existing knots.
    // Keep the new knot away from the boundary: a hinge at the very end is both
    // ill-conditioned and useless.
    const margin = (hi - lo) * 0.08;
    let worst = -1, worstErr = 0;
    for (const [x, y] of sorted) {
      const err = Math.abs(evalPower(best, x) - y);
      if (err > worstErr && x > lo + margin && x < hi - margin) { worstErr = err; worst = x; }
    }
    if (worst < 0 || worstErr <= tolerance) break;
    if (knots.some((k) => Math.abs(k - worst) < (hi - lo) * 0.02)) break;
    knots = knots.concat([worst]).sort((a, b) => a - b);
    const next = fitTruncatedPower(sorted, knots, fitOpts);
    if (!next || next.rmse >= best.rmse) break;
    next.domain = [lo, hi];
    best = next;
  }
  best.segments = bezierSegments(best, [lo, hi]);
  // §11.4: enforce the shape evidence instead of only reporting it.
  if (opts.monotone) best.segments = applyMonotone(best.segments);
  best.K = best.params;
  best.report = shapeReport(best.segments);
  return best;
}

/** Shape report from the fitted segment slopes. */
export function shapeReport(segs) {
  const slopes = segs.map((s) => (s.p1[1] - s.p0[1]) / Math.max(1e-9, s.p1[0] - s.p0[0]));
  const monotoneUp = slopes.every((s) => s >= -1e-6);
  const monotoneDown = slopes.every((s) => s <= 1e-6);
  return { monotoneUp, monotoneDown, slopes, signChanges: slopes.slice(1).filter((s, i) => Math.sign(s) !== Math.sign(slopes[i])).length };
}

/** TikZ: one controls-chain statement, no sampled coordinates. */
export function toTikzPath(segs, mapPoint) {
  const m = mapPoint || ((p) => "(" + (Math.round(p[0] * 1000) / 1000) + "," + (Math.round(p[1] * 1000) / 1000) + ")");
  if (!segs.length) return null;
  let out = m(segs[0].p0);
  for (const s of segs) out += " .. controls " + m(s.p1) + " and " + m(s.p2) + " .. " + m(s.p3);
  return out;
}

/** Model selection: the simplest model that explains the points wins. */
export function chooseModel(points, options) {
  const opts = options || {};
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return null;
  const tolerance = opts.tolerance == null ? 0.5 : opts.tolerance;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < pts.length; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const slope = sxx ? sxy / sxx : 0;
  const lineRmse = Math.sqrt(pts.reduce((s, p) => s + (p[1] - (my + slope * (p[0] - mx))) ** 2, 0) / pts.length);
  // Emit the FITTED line (intercept + slope), not the chord between the first and
  // last point: the reported error must describe what is actually drawn.
  const asLineSegments = () => {
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = my + slope * (x0 - mx), y1 = my + slope * (x1 - mx);
    const h = x1 - x0;
    return [{
      a: x0, b: x1,
      p0: [x0, y0],
      p1: [x0 + h / 3, y0 + (h / 3) * slope],
      p2: [x1 - h / 3, y1 - (h / 3) * slope],
      p3: [x1, y1],
    }];
  };
  if (lineRmse <= tolerance) return { kind: "line", rmse: lineRmse, params: 2, ok: true, segments: asLineSegments() };
  const fit = fitAdaptive(pts, opts);
  if (!fit) return { kind: "line", rmse: lineRmse, params: 2, ok: false, reason: "fit failed", segments: asLineSegments() };
  // §11.6: reaching the budget without meeting the error is a FAILURE, not a pass.
  const ok = fit.rmse <= Math.max(tolerance, opts.acceptRmse == null ? tolerance : opts.acceptRmse);
  return {
    kind: "spline", rmse: fit.rmse, params: fit.params, ok, report: fit.report,
    reason: ok ? undefined : "residual " + fit.rmse.toFixed(3) + " > " + tolerance + " at K=" + fit.params,
    segments: fit.segments, fit,
  };
}

/**
 * Split a point chain where the image evidence shows a discontinuity (§11.4):
 *  - a jump/gap: two independent paths, never forced into one curve;
 *  - a corner: allow a first-derivative discontinuity by ending the span there.
 */
export function segmentShape(points, options) {
  const opts = options || {};
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return { pieces: [], corners: 0, jumps: 0 };
  const dxs = [];
  for (let i = 1; i < pts.length; i++) dxs.push(pts[i][0] - pts[i - 1][0]);
  const dys = [];
  for (let i = 1; i < pts.length; i++) dys.push(Math.abs(pts[i][1] - pts[i - 1][1]));
  const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] || 0; };
  const maxGap = opts.maxGap != null ? opts.maxGap : Math.max(3 * (median(dxs) || 0), 0.15);
  const maxJump = opts.maxJump != null ? opts.maxJump : Math.max(6 * (median(dys) || 0), 0.25);
  const cornerAngle = opts.cornerAngle == null ? (Math.PI * 2) / 3 : opts.cornerAngle;

  const pieces = [];
  let current = [pts[0]];
  let corners = 0, jumps = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const prev = current[current.length - 1];
    const dx = p[0] - prev[0];
    const dy = Math.abs(p[1] - prev[1]);
    // A gap in x or a vertical leap is a discontinuity, not a steep curve.
    if (dx > maxGap || dy > Math.max(maxJump, Math.abs(dx) * 6)) {
      jumps++;
      pieces.push({ points: current, reason: "jump" });
      current = [p];
      continue;
    }
    // Turn angle at prev, using the incoming and outgoing chords.
    if (current.length >= 2) {
      const a = current[current.length - 2];
      const v1 = [prev[0] - a[0], prev[1] - a[1]];
      const v2 = [p[0] - prev[0], p[1] - prev[1]];
      const n1 = Math.hypot(v1[0], v1[1]) || 1;
      const n2 = Math.hypot(v2[0], v2[1]) || 1;
      const cos = clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2), -1, 1);
      const turn = Math.acos(cos);
      if (turn > cornerAngle) {
        corners++;
        pieces.push({ points: current, reason: "corner" });
        current = [prev, p]; // the corner point belongs to both spans
        continue;
      }
    }
    current.push(p);
  }
  pieces.push({ points: current, reason: "end" });
  return { pieces: pieces.filter((p) => p.points.length >= 2), corners, jumps };
}

/** Fit every piece; two-point pieces become plain lines. */
export function fitPieces(pieces, options) {
  const opts = options || {};
  return pieces.map((piece) => {
    if (piece.points.length === 2) {
      const [a, b] = piece.points;
      return {
        kind: "line", params: 2, rmse: 0, ok: true,
        segments: [{ p0: [a[0], a[1]], p1: [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], p2: [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], p3: [b[0], b[1]] }],
      };
    }
    return chooseModel(piece.points, opts);
  });
}

/** Plateau evidence: clamp near-zero slopes to exactly zero inside a flat span. */
export function applyPlateau(segments, options) {
  const opts = options || {};
  const epsilon = opts.epsilon == null ? 0.02 : opts.epsilon;
  return segments.map((s) => {
    const h = s.b - s.a;
    const m0 = (s.p1[1] - s.p0[1]) / Math.max(1e-9, h / 3);
    const m1 = (s.p3[1] - s.p2[1]) / Math.max(1e-9, h / 3);
    if (Math.abs(m0) > epsilon && Math.abs(m1) > epsilon) return s;
    return {
      a: s.a, b: s.b,
      p0: s.p0,
      p1: [s.p0[0] + h / 3, s.p0[1]],
      p2: [s.p3[0] - h / 3, s.p3[1]],
      p3: s.p3,
    };
  });
}
