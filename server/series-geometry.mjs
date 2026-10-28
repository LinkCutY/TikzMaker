/** Semantic series geometry shared by TikZ emission, verification and repairs.
 * Points are model-read observations/landmarks, never raster-traced samples.
 * All geometry coordinates use image-normalised x/y (0..1000, y down).
 */
import { catmullRom } from './plotcurve.mjs';
import { monotoneSegments } from './digitize.mjs';
import { chooseModel, fitAdaptive, segmentShape, fitPieces } from './spline.mjs';
import { chooseFamily, familyValue } from './family.mjs';

export const MAX_OBSERVATIONS = 80;
export const isObservationSeries = (s) => s?.dataKind === 'discrete' || ['linear', 'step', 'none'].includes(s?.connection);

export function normalizeSeries(s, index = 0) {
  const marker = typeof s.marker === 'string' ? { shape: s.marker } : { ...(s.marker || {}) };
  marker.shape = marker.shape || 'none';
  if (!['none', 'circle', 'square', 'triangle', 'diamond'].includes(marker.shape)) throw new Error('Unknown marker shape: ' + marker.shape);
  marker.radiusPx = Math.max(0.5, Math.min(16, Number(marker.radiusPx) || Number(marker.sizePx) / 2 || 3));
  marker.filled = marker.filled !== false;
  let connection = s.connection || (s.interpolation === 'linear' || s.smooth === false ? 'linear' : null);
  if (!connection) connection = s.dataKind === 'discrete' ? (s.scatter ? 'none' : 'linear') : 'smooth';
  if (!['none', 'linear', 'step', 'smooth'].includes(connection)) throw new Error('Unknown series connection: ' + connection);
  const points = (s.points || []).filter(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(v => Number.isFinite(Number(v))))
    .map(p => p.slice(0, 2).map(Number)).sort((a, b) => a[0] - b[0])
    .filter((p,i,all)=>!i || p[0]!==all[i-1][0] || p[1]!==all[i-1][1]);
  const observations = connection !== 'smooth' || s.dataKind === 'discrete';
  if (observations && points.length > MAX_OBSERVATIONS) throw new Error('OBSERVATION_BUDGET: split the panel; never discard visible observations');
  if (points.length < 2) throw new Error('A series needs at least two finite points');
  if (points.some(p=>p.some(v=>v < -200 || v > 1200))) throw new Error('Series coordinates exceed the declared image-normalised bounds');
  if (connection !== 'none' && points.some((p, i) => i && p[0] <= points[i - 1][0])) throw new Error('Series x must be strictly increasing');
  if (s.expectedPointCount != null && observations && Number(s.expectedPointCount) !== points.length) {
    throw new Error('OBSERVATION_COUNT: expected ' + s.expectedPointCount + ', received ' + points.length);
  }
  return { ...s, id: s.id || 'curve-' + (index + 1), dataKind: observations ? 'discrete' : 'continuous',
    connection, marker, points, role: s.role || 'data', coordinateSpace: 'image-normalised' };
}

export function polylineGeometry(points, connection = 'linear', stepPosition = 'post') {
  let vertices = points.map(p => p.slice());
  if (connection === 'step') {
    vertices = [points[0].slice()];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (stepPosition === 'pre') vertices.push([a[0], b[1]]);
      else if (stepPosition === 'mid') vertices.push([(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]]);
      else vertices.push([b[0], a[1]]);
      vertices.push(b.slice());
    }
  }
  return { kind: connection === 'none' ? 'scatter' : 'polyline', vertices, domain: [points[0][0], points.at(-1)[0]], connection };
}

export function cubicGeometry(fit) {
  const paths = fit.pieces ? fit.pieces.map(p => p.segments) : [fit.segments];
  return { kind: 'bezier', paths: paths.map(path => path.map(s => ({ p0: s.p1, p1: s.c1, p2: s.c2, p3: s.p2 }))),
    domain: [paths[0][0].p1[0], paths.at(-1).at(-1).p2[0]] };
}

/** Existing smooth-model selection, now executed once before emission. */
export function compileSeriesGeometry(input, options = {}) {
  if (input.geometry) return input.geometry;
  const s = normalizeSeries(input);
  if (s.connection !== 'smooth') return { ...polylineGeometry(s.points, s.connection, s.stepPosition), description: s.connection === 'none' ? '离散标记' : s.connection === 'step' ? '阶梯连接' : '折线连接' };
  const pts = s.points;
  let fit = s.interpolation === 'monotone' ? monotoneSegments(pts) : catmullRom(pts);
  let description = '稀疏控制点插值 · 拟合未过残差门槛';
  if (pts.length >= 4) {
    const split = s.continuous === false || s.discontinuous === true ? segmentShape(pts, {}) : { pieces: [{ points: pts }] };
    const pieces = split.pieces.length > 1 ? fitPieces(split.pieces, { tolerance: 6, maxK: 8 }) : null;
    if (pieces?.length > 1) {
      fit = { pieces: pieces.filter(p => p?.segments).map(p => ({ segments: p.segments.map(b => ({ p1: b.p0, c1: b.p1, c2: b.p2, p2: b.p3 })) })) };
      description = '分段拟合 · ' + pieces.length + ' 段';
    } else {
      const spline = fitAdaptive(pts, { tolerance: 6, maxK: 8 });
      const family = chooseFamily(pts, { tolerance: 8, spline: spline ? { params: spline.params, rmse: spline.rmse } : null });
      if (family) {
        const domain = [pts[0][0], pts.at(-1)[0]], frame = options.frameDomain;
        const reachesFrame = frame && domain[0] - frame[0] <= 150 && frame[1] - domain[1] <= 150;
        return { kind: 'family', fit: family, domain: reachesFrame ? frame : domain,
          description: '参数族拟合 · ' + family.family + ' · 残差 ' + family.rmse.toFixed(1) };
      }
      const model = chooseModel(pts, { tolerance: 6, maxK: 8 });
      if (model?.ok) {
        fit = { segments: model.segments.map(b => ({ p1: b.p0, c1: b.p1, c2: b.p2, p2: b.p3 })) };
        description = model.kind === 'line' ? '该曲线判定为直线' : '样条拟合 · ' + model.params + ' 参数 · 残差 ' + model.rmse.toFixed(1);
      }
    }
  }
  return { ...cubicGeometry(fit), description };
}

const cubic = (a, b, c, d, t) => (1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d;
export function evaluateGeometry(g, x) {
  if (g.kind === 'family') return familyValue(g.fit.family, g.fit.params, x);
  if (g.kind === 'bezier') {
    for (const path of g.paths) {
      for (const s of path) {
        if (x < s.p0[0] - 1e-7 || x > s.p3[0] + 1e-7) continue;
        let lo = 0, hi = 1;
        for (let i = 0; i < 40; i++) { const t = (lo + hi) / 2; if (cubic(s.p0[0], s.p1[0], s.p2[0], s.p3[0], t) < x) lo = t; else hi = t; }
        return cubic(s.p0[1], s.p1[1], s.p2[1], s.p3[1], (lo + hi) / 2);
      }
    }
    return NaN;
  }
  const pts = g.vertices || [];
  if (g.kind === 'scatter') return pts.find(p => Math.abs(p[0] - x) < 1e-6)?.[1] ?? NaN;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1], b = pts[i];
    if (x < a[0] || x > b[0]) continue;
    if (a[0] === b[0]) return b[1];
    return a[1] + (x-a[0])/(b[0]-a[0])*(b[1]-a[1]);
  }
  return NaN;
}

/** Bounded evaluation of already-built vectors, used only for QA, never tracing. */
export function sampleGeometry(g, perSpan = 16) {
  if (g.kind === 'scatter') return g.vertices;
  if (g.kind === 'polyline') return g.vertices.slice(1).flatMap((b, i) => Array.from({ length: perSpan + 1 }, (_, k) => {
    const a = g.vertices[i], t = k/perSpan; return [a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])];
  }));
  if (g.kind === 'bezier') return g.paths.flatMap(path => path.flatMap(s => Array.from({ length: perSpan + 1 }, (_, k) => {
    const t = k/perSpan; return [cubic(s.p0[0],s.p1[0],s.p2[0],s.p3[0],t), cubic(s.p0[1],s.p1[1],s.p2[1],s.p3[1],t)];
  })));
  return Array.from({ length: 129 }, (_, i) => { const x = g.domain[0]+(g.domain[1]-g.domain[0])*i/128; return [x, evaluateGeometry(g,x)]; });
}

export function validateSeriesGeometry(series) {
  const failures = [];
  for (const s of series) {
    if (!s.geometry) { failures.push(s.id + ': missing final geometry'); continue; }
    if (isObservationSeries(s)) {
      const wanted = s.connection === 'none' ? 'scatter' : 'polyline';
      if (s.geometry.kind !== wanted) failures.push(s.id + ': connection changed');
      if (s.expectedPointCount != null && s.points.length !== s.expectedPointCount) failures.push(s.id + ': observation count changed');
      for (const p of s.points) {
        if (!(s.geometry.vertices || []).some(q => Math.hypot(q[0]-p[0],q[1]-p[1]) < 1e-6)) failures.push(s.id + ': observation lost');
      }
    }
    if (sampleGeometry(s.geometry).some(p => p.some(v => !Number.isFinite(v)))) failures.push(s.id + ': non-finite geometry');
  }
  return { ok: failures.length === 0, failures };
}
