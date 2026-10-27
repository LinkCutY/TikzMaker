/** Pixel measurements in source coordinates. No scientific formula is inferred
 * as ground truth: fits are only compact reconstructions of visible strokes. */
import { removeSpecks, eraseRegions } from "./denoise.mjs";
const median = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] ?? 0; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = rgb => '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
function pixel(r, x, y) {
  const i = (clamp(Math.round(y), 0, r.h - 1) * r.w + clamp(Math.round(x), 0, r.w - 1)) * 3;
  return [...r.rgb.slice(i, i + 3)];
}
function ink(c) { return 255 - (c[0] + c[1] + c[2]) / 3; }
function chroma(c) { return Math.max(...c) - Math.min(...c); }
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const [a, b] = [points[0], points.at(-1)]; let max = tolerance, index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const expected = a[1] + (b[1] - a[1]) * (points[i][0] - a[0]) / (b[0] - a[0]);
    if (Math.abs(points[i][1] - expected) > max) { max = Math.abs(points[i][1] - expected); index = i; }
  }
  return index < 0 ? [a, b] : [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}
function profilePeaks(values, minimum = 10) {
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] < minimum || values[i] < values[i - 1] || values[i] <= values[i + 1]) continue;
    const den = values[i - 1] - 2 * values[i] + values[i + 1];
    const shift = den ? clamp(0.5 * (values[i - 1] - values[i + 1]) / den, -0.5, 0.5) : 0;
    peaks.push(i + shift);
  }
  return peaks;
}

/** Bounded coordinate descent, robust loss, deterministic multi-start caller. */
export function boundedFit(points, fn, initial, bounds) {
  let p = initial.slice();
  const loss = q => points.reduce((s, [x, y]) => { const d = Math.abs(y - fn(x, q)); return s + (d < 3 ? d * d : 6 * d - 9); }, 0) / points.length;
  let best = loss(p), steps = bounds.map(([a, b]) => (b - a) / 8);
  for (let iteration = 0; iteration < 100; iteration++) {
    let improved = false;
    for (let j = 0; j < p.length; j++) for (const direction of [-1, 1]) {
      const q = p.slice(); q[j] = clamp(q[j] + steps[j] * direction, ...bounds[j]);
      const value = loss(q);
      if (value < best) { p = q; best = value; improved = true; }
    }
    if (!improved) steps = steps.map(s => s * 0.6);
    if (Math.max(...steps) < 0.002) break;
  }
  const rmse = Math.sqrt(points.reduce((s, [x, y]) => s + (y - fn(x, p)) ** 2, 0) / points.length);
  return { parameters: p, rmse, predict: x => fn(x, p) };
}

/** Monotone piecewise cubic Hermite. Unlike Catmull–Rom, flat plateaus and
 * minima cannot overshoot. Returned controls are in the input coordinates. */
export function monotoneSegments(input) {
  const points = input.filter(p => p?.length >= 2 && p.every(Number.isFinite)).slice().sort((a, b) => a[0] - b[0]);
  const pts = points.filter((p, i) => !i || p[0] > points[i - 1][0]);
  if (pts.length < 2) return null;
  const h = [], d = [], m = [];
  for (let i = 0; i < pts.length - 1; i++) { h.push(pts[i + 1][0] - pts[i][0]); d.push((pts[i + 1][1] - pts[i][1]) / h[i]); }
  m[0] = d[0]; m[pts.length - 1] = d.at(-1);
  for (let i = 1; i < pts.length - 1; i++) {
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return { start: pts[0], segments: d.map((_, i) => ({ p1: pts[i], p2: pts[i + 1],
    c1: [pts[i][0] + h[i] / 3, pts[i][1] + h[i] * m[i] / 3],
    c2: [pts[i + 1][0] - h[i] / 3, pts[i + 1][1] - h[i] * m[i + 1] / 3] })) };
}

function ridge(r, b) {
  const width = b.x1 - b.x0;
  // The two tails must independently contain the same regularly spaced family.
  const profile = fraction => Array.from({ length: r.h }, (_, y) => {
    const values = [];
    for (let dx = -3; dx <= 3; dx++) { const c = pixel(r, b.x0 + width * fraction + dx, y); values.push(chroma(c) > 5 ? ink(c) : 0); }
    return median(values);
  });
  const left = profilePeaks(profile(0.16)).filter(y => y > b.y0 + 4 && y < b.y1 - 5);
  const right = profilePeaks(profile(0.84)).filter(y => y > b.y0 + 4 && y < b.y1 - 5);
  const bases = left.filter(y => right.some(z => Math.abs(y - z) < 1.7));
  if (bases.length < 8 || bases.length > 60) return null;
  const spacings = bases.slice(1).map((y, i) => y - bases[i]), spacing = median(spacings);
  if (spacing < 2.5 || spacings.some(s => Math.abs(s - spacing) > spacing * 0.45)) return null;
  const envelope = [];
  for (let x = Math.ceil(b.x0 + width * 0.25); x <= b.x0 + width * 0.75; x++) {
    for (let y = Math.ceil(b.y0 + 5); y <= bases[0] + 2; y++) {
      const c = pixel(r, x, y);
      if (chroma(c) > 8 && ink(c) > 20) { envelope.push([x, y + 0.8]); break; }
    }
  }
  if (envelope.length < width * 0.35) return null;
  const apex = envelope.reduce((a, p) => p[1] < a[1] ? p : a), amplitude = bases[0] - apex[1];
  if (amplitude < r.h * 0.12 || Math.abs(apex[0] - (b.x0 + b.x1) / 2) > width * 0.2) return null;
  const families = {
    gaussian: (x, [base, a, c, s]) => base - a * Math.exp(-(((x - c) / s) ** 2)),
    lorentzian: (x, [base, a, c, s]) => base - a / (1 + ((x - c) / s) ** 2) ** 2,
    sech: (x, [base, a, c, s]) => base - a / Math.cosh((x - c) / s) ** 2,
  };
  const fits = Object.entries(families).map(([name, fn]) => ({ name, ...boundedFit(envelope, fn,
    [bases[0], amplitude, apex[0], width * 0.05], [[bases[0] - 2, bases[0] + 2], [amplitude - 5, amplitude + 5], [apex[0] - 4, apex[0] + 4], [width * 0.012, width * 0.15]]) }));
  const fit = fits.sort((a, b) => a.rmse - b.rmse)[0];
  if (fit.rmse > 2.5) return null;
  const center = fit.parameters[2];
  // Avoid a dotted vertical annotation exactly on the peak axis. Rank-preserving
  // matching uses actual cross-section maxima, not an invented curve count.
  let peaks = [];
  for (const dx of [-3, -2, 2, 3]) {
    const values = Array.from({ length: r.h }, (_, y) => { const c = pixel(r, center + dx, y); return chroma(c) > 5 ? ink(c) : 0; });
    const candidate = profilePeaks(values, 18).filter(y => y > b.y0 + 6 && y < b.y1 - 5);
    if (Math.abs(candidate.length - bases.length) < Math.abs(peaks.length - bases.length)) peaks = candidate;
  }
  if (peaks.length !== bases.length || peaks.some((y, i) => y > bases[i] + 2)) return null;
  const curves = bases.map((base, i) => {
    const a = Math.max(0, base - peaks[i]);
    const points = [], colors = [], widths = [];
    const xs = [b.x0 + 7, ...Array.from({ length: 49 }, (_, n) => center - width * 0.22 + n * width * 0.44 / 48), b.x1 - 7];
    for (const x of xs) {
      const shape = (fit.parameters[0] - fit.predict(x)) / fit.parameters[1];
      const y = base - a * shape;
      points.push([x / r.w * 1000, y / r.h * 1000]);
      const samples = [-1, 0, 1].map(dy => pixel(r, x, y + dy)).sort((a, b) => ink(b) - ink(a));
      colors.push(hex(samples[0]));
      const centerInk = ink(samples[0]);
      let mass = 0;
      const samplesPerLine = 16;
      for (let n=0;n<samplesPerLine;n++) mass += ink(pixel(r,x,y+spacing*((n+0.5)/samplesPerLine-0.5))) * spacing/samplesPerLine;
      // Ink mass / stroke darkness is the effective line width. This conserves
      // both faint antialiased tails and tightly packed peaks, without a fixed
      // width that makes the tail disappear or the peak too dark.
      widths.push(clamp(mass / Math.max(1,centerInk),1,spacing*1.08));
    }
    return { name: `Measured slice ${i + 1}`, points, colors, widths, color: colors[0], width: 1.8, interpolation: 'monotone', measured: true };
  });
  return { curves, method: `ridge-${fit.name}`, rmse: fit.rmse, count: bases.length, parameters: fit.parameters };
}

function coloredCurves(r, b, labels) {
  const width = b.x1 - b.x0, clusters = [];
  const isLabel = (x, y) => labels.some(e => {
    const q = e.box; return q?.length === 4 && x > q[0] / 1000 * r.w - 1 && x < (q[0] + q[2]) / 1000 * r.w + 1 && y > q[1] / 1000 * r.h - 1 && y < (q[1] + q[3]) / 1000 * r.h + 1;
  });
  const coords = [];
  for (let x = Math.ceil(b.x0 + 3); x < b.x1 - 3; x++) for (let y = Math.ceil(b.y0 + 3); y < b.y1 - 3; y++) {
    const c = pixel(r, x, y), saturation = chroma(c);
    if (saturation < 18 || ink(c) < 25) continue;
    const u = c[0] - c[1], v = c[2] - c[1], n = Math.hypot(u, v);
    const direction = [u / n, v / n];
    let index = clusters.findIndex(k => k[0] * direction[0] + k[1] * direction[1] > 0.94);
    if (index < 0) { index = clusters.length; clusters.push(direction); }
    coords.push({ x, y, c, index, weight: saturation });
  }
  const curves = [];
  for (let index = 0; index < clusters.length; index++) {
    const cloud = coords.filter(p => p.index === index), columns = new Map();
    for (const p of cloud) { const list = columns.get(p.x) || []; list.push(p); columns.set(p.x, list); }
    if (columns.size < width * 0.22) continue;
    // Multiple same-colour curves need the family tracker, not averaging.
    const candidates = [];
    let ambiguous = 0;
    for (const [x, list] of columns) {
      const runs = [];
      for (const p of list) { const last = runs.at(-1); if (last && p.y - last.at(-1).y < 3) last.push(p); else runs.push([p]); }
      if (runs.length > 1) ambiguous++;
      candidates.push({ x, runs: runs.map(run => {
        const weight = run.reduce((s, p) => s + p.weight, 0);
        return { y: run.reduce((s, p) => s + p.y * p.weight, 0) / weight, width: run.length, weight };
      }) });
    }
    if (ambiguous > columns.size * 0.3) continue;
    candidates.sort((a, b) => a.x - b.x);
    // Viterbi continuity disambiguates a short legend swatch from the curve.
    // Averaging both would bend a flat data curve up into its own legend.
    for (let t = 0; t < candidates.length; t++) for (const run of candidates[t].runs) {
      run.cost = -Math.min(1, run.weight / 150);
      if (!t) continue;
      const previous = candidates[t - 1], dx = candidates[t].x - previous.x;
      const ranked = previous.runs.map((p, i) => ({ i, cost: p.cost + (run.y - p.y) ** 2 / dx }));
      const best = ranked.sort((a, b) => a.cost - b.cost)[0];
      run.cost += best.cost; run.previous = best.i;
    }
    let choice = candidates.at(-1).runs.reduce((best, p, i, list) => p.cost < list[best].cost ? i : best, 0);
    const rows = [];
    for (let t = candidates.length - 1; t >= 0; t--) {
      const run = candidates[t].runs[choice]; rows.push([candidates[t].x, run.y, run.width]); choice = run.previous;
    }
    rows.reverse();
    if (rows.at(-1)[0] - rows[0][0] < width * 0.8) continue;
    const gaps = rows.slice(1).map((p, i) => p[0] - rows[i][0]);
    if (Math.max(...gaps) > width * 0.09) continue;
    const dotted = gaps.filter(d => d >= 3).length > 8;
    let points = [];
    // Bin centroid smooths antialiasing but keeps transitions at pixel precision.
    for (let start = 0; start < rows.length;) {
      let end = start + 1;
      while (end < rows.length && rows[end][0] - rows[start][0] < 3) end++;
      const group = rows.slice(start, end);
      points.push([group.reduce((s, p) => s + p[0], 0) / group.length / r.w * 1000, median(group.map(p => p[1])) / r.h * 1000]);
      start = end;
    }
    const darkest = cloud.slice().sort((a, b) => ink(b.c) - ink(a.c)).slice(0, Math.max(5, cloud.length * 0.12));
    const color = hex([0, 1, 2].map(c => median(darkest.map(p => p.c[c]))));
    let fitting = null;
    if (dotted) {
      const base = median(rows.slice(0, 30).concat(rows.slice(-30)).map(p => p[1]));
      const extreme = rows.reduce((a, p) => Math.abs(p[1] - base) > Math.abs(a[1] - base) ? p : a);
      const amplitude = extreme[1] - base;
      const fn = (x, [base, a, center, sigma, power]) => base + a * Math.exp(-(Math.abs((x - center) / sigma) ** power));
      const fit = boundedFit(rows, fn, [base, amplitude, extreme[0], width * 0.06, 2],
        [[base - 4, base + 4], [amplitude * 0.8, amplitude * 1.2].sort((a,b)=>a-b), [extreme[0] - 12, extreme[0] + 12], [width * 0.02, width * 0.18], [1.2, 4]]);
      const supported = rows.filter(([x,y]) => Math.abs(fit.predict(x) - y) < 4).length / rows.length;
      if (supported >= 0.8) {
        points = Array.from({length: 81}, (_, i) => {
          const x = rows[0][0] + (rows.at(-1)[0] - rows[0][0]) * i / 80;
          return [x / r.w * 1000, fit.predict(x) / r.h * 1000];
        });
        fitting = { method: 'robust-generalized-gaussian', support: supported };
      }
    }
    const starts = rows.filter((p, i) => !i || p[0] - rows[i-1][0] > 2).map(p=>p[0]);
    const period = median(starts.slice(1).map((x,i)=>x-starts[i]).filter(d=>d>5 && d<30));
    curves.push({ name: 'Pixel-measured curve', points: simplify(points, 0.45 / r.h * 1000), color, width: Math.max(1, median(rows.map(p => p[2])) * 0.65), dash: dotted ? 'dotted' : 'solid', dashPeriodPx: dotted ? period : undefined, fitting, interpolation: 'monotone', measured: true });
  }
  return curves.length && curves.length <= 6 ? { curves, method: 'color-centroid-pchip', count: curves.length } : null;
}

export function digitizePlot(raster, model, frameInfo) {
  if (!frameInfo?.hasBox) return { model, applied: false };
  const b = frameInfo.bounds;
  const measured = ridge(raster, b) || coloredCurves(raster, b, (model.elements || []).filter(e => e.kind === 'text'));
  if (!measured) return { model, applied: false };
  // Replace only data-sized primitives. Legends, text, ticks and the frame stay.
  const elements = (model.elements || []).filter(e => {
    if (e.kind !== 'polyline' && e.kind !== 'line') return true;
    if (e.closed) return true;
    const pts = e.kind === 'line' ? [[e.x1, e.y1], [e.x2, e.y2]] : e.points || [];
    if (pts.length < 2) return true;
    const xs = pts.map(p => p[0] * raster.w / 1000), ys = pts.map(p => p[1] * raster.h / 1000);
    const wide = Math.max(...xs) - Math.min(...xs) > (b.x1 - b.x0) * 0.45;
    const edge = Math.max(...ys) - Math.min(...ys) < 2 && (Math.abs(ys[0] - b.y0) < 4 || Math.abs(ys[0] - b.y1) < 4);
    return !wide || edge;
  });
  return { applied: true, model: { ...model, type: 'plot', elements, curves: measured.curves }, ...measured };
}

/** Keep labels/frames/legend samples as vectorisable ink, erasing only pixels
 * supported by the measured data curves. Unknown marks remain visible. */
export function plotResidual(raster, curves, options) {
  const opts = options || {};
  const halo = opts.halo == null ? 3 : opts.halo;
  const rgb = Uint8Array.from(raster.rgb);
  const { w, h } = raster;
  for (const curve of curves) {
    const pts = curve.points.map(([x,y]) => [x/1000*w,y/1000*h]);
    for (let i=1;i<pts.length;i++) {
      const a=pts[i-1], b=pts[i];
      for(let x=Math.ceil(a[0]);x<=b[0];x++) {
        const y=a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);
        // The antialiased halo around a stroke has almost no chroma, so it must
        // be erased by darkness, not by colour — otherwise it survives as a
        // ring of confetti around the measured curve.
        const radius = (curve.widths ? 8 : Math.max(5, curve.width*1.7)) + halo;
        for(let py=Math.max(0,Math.floor(y-radius));py<=Math.min(h-1,y+radius);py++) {
          for(let px=Math.max(0,Math.floor(x-radius));px<=Math.min(w-1,x+radius);px++) {
            const n=(py*w+px)*3;
            const c=[raster.rgb[n],raster.rgb[n+1],raster.rgb[n+2]];
            // 252, not 246: the last antialiased ring is ~250 and would survive
            // as a pale ghost that VTracer still turns into a thin fill.
            const dark=(c[0]*299+c[1]*587+c[2]*114)/1000 < 252;
            if(dark) rgb.fill(255,n,n+3);
          }
        }
      }
    }
  }
  // The frame and the labels are drawn as real lines and nodes: drop their pixels
  // so they are not traced into grey blobs on top of the clean ones.
  const clean = opts.regions && opts.regions.length ? eraseRegions({ w, h, rgb }, opts.regions) : { w, h, rgb, wiped: 0 };
  // Whatever survived as a few-pixel island is noise, not content.
  const result = removeSpecks(clean, opts.minSpeckPx == null ? 10 : opts.minSpeckPx);
  result.wiped = clean.wiped;
  return result;
}
