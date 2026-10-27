/**
 * Compact curve families (§10.3).
 *
 * A curve may be stored as an EXPRESSION plus a handful of parameters instead of a
 * point list. The families are OPTIONAL candidates: they are used only when they
 * explain the evidence better than the generic spline with fewer parameters. This
 * is fitting a low-dimensional model to sparse evidence, not reading pixels.
 */

const fmt = (v) => (Math.round(v * 10000) / 10000).toString();
const clampPower = (value) => Math.max(1, Math.min(8, Number(value) || 2));
const texVariable = (value) => {
  const raw = String(value || "x");
  return raw.startsWith("\\") || raw.startsWith("(") ? raw : "\\" + raw;
};

/** Generic Levenberg-Marquardt on a small parameter vector. */
function levenbergMarquardt(points, model, p0, options) {
  const opts = options || {};
  const maxIter = opts.maxIter || 60;
  const lambda0 = 0.01;
  let p = p0.slice();
  let lambda = lambda0;
  const residual = (pp) => {
    let s = 0;
    for (const [x, y] of points) { const r = model.eval(x, pp) - y; s += r * r; }
    return s / Math.max(1, points.length);
  };
  let best = residual(p);
  for (let iter = 0; iter < maxIter; iter++) {
    const J = [];
    const r = [];
    for (const [x, y] of points) {
      const f0 = model.eval(x, p);
      r.push(f0 - y);
      const row = [];
      for (let j = 0; j < p.length; j++) {
        const h = Math.max(1e-6, Math.abs(p[j]) * 1e-4);
        const q = p.slice();
        q[j] += h;
        row.push((model.eval(x, q) - f0) / h);
      }
      J.push(row);
    }
    const n = p.length;
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let i = 0; i < J.length; i++) {
      for (let a = 0; a < n; a++) {
        g[a] += J[i][a] * r[i];
        for (let b = 0; b < n; b++) A[a][b] += J[i][a] * J[i][b];
      }
    }
    for (let a = 0; a < n; a++) A[a][a] += lambda * (A[a][a] || 1);
    // Solve A d = -g by Gaussian elimination.
    const M = A.map((row, i) => row.concat([-g[i]]));
    let ok = true;
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let rr = col + 1; rr < n; rr++) if (Math.abs(M[rr][col]) > Math.abs(M[piv][col])) piv = rr;
      if (Math.abs(M[piv][col]) < 1e-14) { ok = false; break; }
      [M[col], M[piv]] = [M[piv], M[col]];
      const d = M[col][col];
      for (let c = col; c <= n; c++) M[col][c] /= d;
      for (let rr = 0; rr < n; rr++) {
        if (rr === col) continue;
        const f = M[rr][col];
        if (!f) continue;
        for (let c = col; c <= n; c++) M[rr][c] -= f * M[col][c];
      }
    }
    if (!ok) break;
    const dP = M.map((row) => row[n]);
    const candidate = p.map((v, i) => v + dP[i]);
    const score = residual(candidate);
    if (Number.isFinite(score) && score < best) {
      p = candidate;
      if (best - score < 1e-12) { best = score; break; }
      best = score;
      lambda = Math.max(lambda / 3, 1e-9);
    } else {
      lambda = Math.min(lambda * 5, 1e6);
      if (lambda > 1e5) break;
    }
  }
  return { params: p, mse: best, rmse: Math.sqrt(Math.max(0, best)) };
}

const TANH = (u) => Math.tanh(u);

export const FAMILIES = {
  /** Smooth plateau between two shoulders: y = y0 + A/2 [tanh((x-zL)/sL) - tanh((x-zR)/sR)]. */
  tanhPlateau: {
    name: "tanhPlateau",
    params: ["y0", "amp", "zL", "zR", "sL", "sR"],
    guess(points) {
      const ys = points.map((p) => p[1]);
      const xs = points.map((p) => p[0]);
      const y0 = Math.min(...ys), yTop = Math.max(...ys);
      const span = Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
      return [y0, yTop - y0, Math.min(...xs) + span * 0.3, Math.min(...xs) + span * 0.7, span * 0.08, span * 0.08];
    },
    eval(x, p) {
      const [y0, amp, zL, zR, sL, sR] = p;
      return y0 + (amp / 2) * (TANH((x - zL) / (Math.abs(sL) + 1e-6)) - TANH((x - zR) / (Math.abs(sR) + 1e-6)));
    },
    tikz(p, v) {
      const [y0, amp, zL, zR, sL, sR] = p;
      const x = texVariable(v);
      // PGF math uses TeX dimensions internally. Saturate tanh's argument before
      // evaluating exp so flat tails cannot overflow far from a shoulder.
      const th = (u) => {
        const safe = "max(-4.5,min(4.5," + u + "))";
        return "((exp(2*(" + safe + "))-1)/(exp(2*(" + safe + "))+1))";
      };
      return fmt(y0) + " + " + fmt(amp / 2) + "*(" + th("(" + x + "-" + fmt(zL) + ")/" + fmt(Math.abs(sL) + 1e-6)) + " - " + th("(" + x + "-" + fmt(zR) + ")/" + fmt(Math.abs(sR) + 1e-6)) + ")";
    },
  },
  /** Generalised dip: y = inf - depth exp(-|(x-mu)/sigma|^p). */
  genDip: {
    name: "genDip",
    params: ["inf", "depth", "mu", "sigma", "p"],
    guess(points) {
      const ys = points.map((p) => p[1]);
      const xs = points.map((p) => p[0]);
      const span = Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
      const iMin = ys.indexOf(Math.min(...ys));
      return [Math.max(...ys), Math.max(...ys) - Math.min(...ys), xs[iMin], span * 0.12, 2];
    },
    eval(x, p) {
      const [inf, depth, mu, sigma, pw] = p;
      const u = Math.min(2, Math.abs((x - mu) / (Math.abs(sigma) + 1e-6))) ** clampPower(pw);
      return inf - depth * Math.exp(-u);
    },
    tikz(p, v) {
      const [inf, depth, mu, sigma, pw] = p;
      const x = texVariable(v);
      return fmt(inf) + " - " + fmt(depth) + "*exp(-((min(2,abs((" + x + "-" + fmt(mu) + ")/" + fmt(Math.abs(sigma) + 1e-6) + ")))^" + fmt(clampPower(pw)) + "))";
    },
  },
  /** Plain Gaussian bump. */
  gauss: {
    name: "gauss",
    params: ["base", "amp", "mu", "sigma"],
    guess(points) {
      const ys = points.map((p) => p[1]);
      const xs = points.map((p) => p[0]);
      const span = Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
      const iMax = ys.indexOf(Math.max(...ys));
      return [Math.min(...ys), Math.max(...ys) - Math.min(...ys), xs[iMax], span * 0.1];
    },
    eval(x, p) {
      const [base, amp, mu, sigma] = p;
      return base + amp * Math.exp(-(Math.min(20, Math.abs((x - mu) / (Math.abs(sigma) + 1e-6))) ** 2));
    },
    tikz(p, v) {
      const [base, amp, mu, sigma] = p;
      const x = texVariable(v);
      return fmt(base) + " + " + fmt(amp) + "*exp(-((min(20,abs((" + x + "-" + fmt(mu) + ")/" + fmt(Math.abs(sigma) + 1e-6) + ")))^2))";
    },
  },
};

/** Fit one family; returns params, residual and whether it converged sanely. */
export function fitFamily(points, familyName, options) {
  const family = FAMILIES[familyName];
  if (!family || !points.length) return null;
  const p0 = family.guess(points);
  const fit = levenbergMarquardt(points, family, p0, options);
  const ok = Number.isFinite(fit.rmse) && fit.rmse < 1e6;
  return { family: familyName, params: fit.params, rmse: fit.rmse, ok, k: fit.params.length };
}

/** TikZ function expression for a fitted family. */
export function familyExpression(familyName, params, variable) {
  const family = FAMILIES[familyName];
  if (!family) return null;
  return family.tikz(params, variable || "x");
}

/**
 * Model choice between a compact family and the generic spline: both must meet the
 * tolerance, then the FEWER parameters win (ties go to the generic spline).
 */
export function chooseFamily(points, options) {
  const opts = options || {};
  const tolerance = opts.tolerance == null ? 0.02 : opts.tolerance;
  const names = opts.families || ["tanhPlateau", "genDip", "gauss"];
  const candidates = [];
  for (const name of names) {
    const fit = fitFamily(points, name, opts);
    if (fit && fit.ok && fit.rmse <= tolerance) {
      candidates.push({ kind: "family", family: name, params: fit.params, rmse: fit.rmse, k: fit.k });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.k - b.k || a.rmse - b.rmse);
  const best = candidates[0];
  // The spline only competes when it MEETS the tolerance itself.
  const spline = opts.spline;
  const splineOk = spline && Number.isFinite(spline.rmse) && spline.rmse <= tolerance;
  if (splineOk && spline.params <= best.k) return null;
  return best;
}

/** TikZ drawing statement for a family over a domain. */
export function familyTikz(fit, domain, options) {
  const opts = options || {};
  const style = opts.style || "";
  const expr = familyExpression(fit.family, fit.params, opts.inputExpression || "x");
  if (!expr) return null;
  const samples = opts.samples || 160;
  const scale = Number.isFinite(Number(opts.outputScale)) ? Number(opts.outputScale) : 1;
  const offset = Number.isFinite(Number(opts.outputOffset)) ? Number(opts.outputOffset) : 0;
  const mapped = scale === 1 && offset === 0 ? expr : fmt(offset) + "+(" + fmt(scale) + "* (" + expr + "))";
  return "\\draw[" + style + "] plot[domain=" + domain[0] + ":" + domain[1] + ", samples=" + samples + "] (\\x,{" + mapped + "});";
}
