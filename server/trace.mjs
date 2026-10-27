import { inflateSync } from "node:zlib";

/** Decode the PNGs produced by browser canvas, without a native image package. */
export function decodePng(dataUrl) {
  if (!/^data:image\/png;base64,/.test(dataUrl)) throw new Error("精确描摹需要 PNG 图片，请重新上传图片");
  const data = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("PNG 文件无效");
  let w, h, depth, type, interlace, palette, alpha;
  const chunks = [];
  for (let offset = 8; offset + 12 <= data.length;) {
    const n = data.readUInt32BE(offset), name = data.toString("ascii", offset + 4, offset + 8);
    if (offset + n + 12 > data.length) throw new Error("PNG 文件不完整");
    const part = data.subarray(offset + 8, offset + 8 + n);
    if (name === "IHDR") { w = part.readUInt32BE(0); h = part.readUInt32BE(4); depth = part[8]; type = part[9]; interlace = part[12]; }
    if (name === "IDAT") chunks.push(part);
    if (name === "PLTE") palette = part;
    if (name === "tRNS") alpha = part;
    offset += n + 12;
  }
  if (!w || !h || w * h > 4_000_000 || depth !== 8 || interlace !== 0) throw new Error("请使用不超过 1600px 的普通 PNG 图片");
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!bpp) throw new Error("不支持此 PNG 颜色格式");
  const stride = w * bpp, bytes = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * h });
  if (bytes.length !== (stride + 1) * h) throw new Error("PNG 像素长度错误");
  const pixels = new Uint8Array(stride * h);
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < h; y++) {
    const filter = bytes[y * (stride + 1)];
    if (filter > 4) throw new Error("PNG 过滤器无效");
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= bpp ? pixels[i - bpp] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= bpp ? pixels[i - stride - bpp] : 0;
      pixels[i] = bytes[y * (stride + 1) + x + 1] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0);
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const j = i * bpp;
    let r, g, b, a = 255;
    if (type === 0 || type === 4) { r = g = b = pixels[j]; if (type === 4) a = pixels[j + 1]; }
    else if (type === 3) { r = palette?.[pixels[j] * 3] ?? 0; g = palette?.[pixels[j] * 3 + 1] ?? 0; b = palette?.[pixels[j] * 3 + 2] ?? 0; a = alpha?.[pixels[j]] ?? 255; }
    else { r = pixels[j]; g = pixels[j + 1]; b = pixels[j + 2]; if (type === 6) a = pixels[j + 3]; }
    rgb[i * 3] = Math.round((r * a + 255 * (255 - a)) / 255);
    rgb[i * 3 + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
    rgb[i * 3 + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
  }
  return { w, h, rgb };
}

function simplify(points, epsilon) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const p = points[a], q = points[b], dx = q[0] - p[0], dy = q[1] - p[1], length = dx * dx + dy * dy;
    let worst = epsilon * epsilon, index = -1;
    for (let i = a + 1; i < b; i++) {
      const v = points[i], t = length ? Math.max(0, Math.min(1, ((v[0] - p[0]) * dx + (v[1] - p[1]) * dy) / length)) : 0;
      const d = (v[0] - p[0] - t * dx) ** 2 + (v[1] - p[1] - t * dy) ** 2;
      if (d > worst) { worst = d; index = i; }
    }
    if (index >= 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Chaikin corner cutting: each edge is replaced by two points at 1/4 and 3/4.
 * Two iterations turn the pixel staircase into a smooth closed curve while
 * staying inside the original outline (convex, no overshoot).
 */
export function chaikin(points, iterations = 2) {
  let ring = points;
  for (let k = 0; k < iterations; k++) {
    const next = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    ring = next;
  }
  return ring;
}

/** Zhang–Suen thinning: a 3-5px stroke becomes a 1px centre line. */
export function skeletonize(mask, w, h) {
  const img = Uint8Array.from(mask);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const del = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!img[y * w + x]) continue;
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
          const neighbours = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (neighbours < 2 || neighbours > 6) continue;
          const transitions =
            (p2 === 0 && p3 === 1 ? 1 : 0) + (p3 === 0 && p4 === 1 ? 1 : 0) +
            (p4 === 0 && p5 === 1 ? 1 : 0) + (p5 === 0 && p6 === 1 ? 1 : 0) +
            (p6 === 0 && p7 === 1 ? 1 : 0) + (p7 === 0 && p8 === 1 ? 1 : 0) +
            (p8 === 0 && p9 === 1 ? 1 : 0) + (p9 === 0 && p2 === 1 ? 1 : 0);
          if (transitions !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0 : p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          del.push(y * w + x);
        }
      }
      if (del.length) {
        changed = true;
        for (const i of del) img[i] = 0;
      }
    }
  }
  return img;
}

/** Walk an 8-connected skeleton into open polylines (junction-safe). */
export function traceSkeleton(skel, w, h) {
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x] === 1;
  const seen = new Uint8Array(w * h);
  const degree = (x, y) => {
    let d = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (on(x + dx, y + dy)) d++;
    }
    return d;
  };
  const paths = [];
  const walk = (sx, sy) => {
    const path = [];
    let x = sx, y = sy;
    for (;;) {
      path.push([x, y]);
      seen[y * w + x] = 1;
      let next = null;
      for (let dy = -1; dy <= 1 && !next; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (on(nx, ny) && !seen[ny * w + nx]) { next = [nx, ny]; break; }
      }
      if (!next) break;
      [x, y] = next;
      if (degree(x, y) > 2 && path.length > 3) { path.push([x, y]); break; }
    }
    return path;
  };
  // Start from endpoints, then any remaining pixel (loops).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < skel.length; i++) {
      if (skel[i] !== 1 || seen[i]) continue;
      const x = i % w, y = Math.floor(i / w);
      if (pass === 0 && degree(x, y) > 1) continue;
      const path = walk(x, y);
      if (path.length >= 2) paths.push(path);
    }
  }
  return paths;
}

/**
 * Skeleton walking splits every strand at a junction, so a family of ridges turns
 * into dozens of stubs. Stitch them back: two ends that are close and whose
 * tangents continue each other belong to the same curve.
 */
export function stitchPaths(paths, maxDist = 1.5, minCos = 0.85) {
  const dirAt = (path, end) => {
    const n = path.length;
    if (n < 2) return [0, 0];
    const a = end === "end" ? path[n - 1 - Math.min(3, n - 1)] : path[Math.min(3, n - 1)];
    const b = end === "end" ? path[n - 1] : path[0];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let list = paths.map((p) => p.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const A = list[i], B = list[j];
        const combos = [
          ["end", "start"], ["end", "end"], ["start", "start"], ["start", "end"],
        ];
        for (const [ea, eb] of combos) {
          const pa = ea === "end" ? A[A.length - 1] : A[0];
          const pb = eb === "end" ? B[B.length - 1] : B[0];
          if (dist(pa, pb) > maxDist) continue;
          const da = dirAt(A, ea);
          const db = dirAt(B, eb);
          // The tangents must continue one another: da points out of A, so a
          // good join has da ≈ db when B is reversed onto it.
          const cos = da[0] * db[0] + da[1] * db[1];
          const ok = eb === "start" ? cos > -minCos : cos < minCos;
          if (!ok) continue;
          let tail = eb === "start" ? B : B.slice().reverse();
          list[i] = A.concat(tail.slice(1));
          list.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

/** Pixel-derived closed vector paths. The model supplies semantics, not coordinates to guess. */
export function traceRaster(raster, semantics = {}, options = {}) {
  const { w, h, rgb } = raster;
  const histogram = new Map();
  const keyOf = i => (rgb[i] >> 3) * 1024 + (rgb[i + 1] >> 3) * 32 + (rgb[i + 2] >> 3);
  for (let i = 0; i < rgb.length; i += 3) {
    if (Math.min(rgb[i], rgb[i + 1], rgb[i + 2]) >= 248) continue;
    const key = keyOf(i), entry = histogram.get(key) || [0, 0, 0, 0];
    entry[0] += rgb[i]; entry[1] += rgb[i + 1]; entry[2] += rgb[i + 2]; entry[3]++;
    histogram.set(key, entry);
  }
  const bins = [...histogram.entries()].map(([key, v]) => ({ key, color: v.slice(0, 3).map(x => x / v[3]), count: v[3] })).sort((a, b) => b.count - a.count);
  if (!bins.length) throw new Error("图片中没有可提取的图形");
  const distance = (a, b) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
  const palette = [bins[0].color];
  const colors = Math.min(options.colors || 28, bins.length);
  while (palette.length < colors) {
    let selected = bins[0], best = -1;
    for (const bin of bins) { const d = Math.min(...palette.map(c => distance(c, bin.color))) * Math.sqrt(bin.count); if (d > best) { best = d; selected = bin; } }
    palette.push(selected.color);
  }
  const nearest = color => { let best = Infinity, index = 0; for (let i = 0; i < palette.length; i++) { const d = distance(color, palette[i]); if (d < best) { best = d; index = i; } } return index; };
  for (let iteration = 0; iteration < 5; iteration++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const bin of bins) { const sum = sums[nearest(bin.color)]; for (let c = 0; c < 3; c++) sum[c] += bin.color[c] * bin.count; sum[3] += bin.count; }
    sums.forEach((sum, i) => { if (sum[3]) palette[i] = sum.slice(0, 3).map(v => v / sum[3]); });
  }
  const lookup = new Map(bins.map(bin => [bin.key, nearest(bin.color)]));
  const labels = new Int16Array(w * h).fill(-1);
  // Colour-agnostic geometry: every non-white pixel is "ink", so two curves that
  // differ only slightly in colour are no longer glued into one blob. The colour
  // is sampled per element afterwards, before drawing.
  // Off by default: removing hue merges neighbouring curves into one blob (measured),
  // so colour stays the primary separator. Kept as an option for line art.
  const colorAgnostic = options.colorAgnostic === true;
  for (let i = 0; i < labels.length; i++) {
    const ink = Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) < 248;
    if (!ink) continue;
    if (!colorAgnostic) {
      labels[i] = lookup.get(keyOf(i * 3));
    } else {
      // Lightness bands keep neighbouring curves apart (they differ in darkness)
      // without letting a hue shift fragment one curve into pieces.
      const lum = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
      const bands = options.bands || 12;
      labels[i] = Math.max(0, Math.min(bands - 1, Math.floor((lum / 248) * bands)));
    }
  }
  const seen = new Uint8Array(w * h), shapes = [];
  const vertexWidth = w + 1;
  let ignoredPixels = 0;
  let components = 0;
  let discarded = 0;
  for (let start = 0; start < labels.length; start++) {
    if (seen[start] || labels[start] < 0) continue;
    const colorIndex = labels[start], queue = [start]; seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % w, y = Math.floor(i / w);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      for (const n of [x ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y ? i - w : -1, y < h - 1 ? i + w : -1]) if (n >= 0 && !seen[n] && labels[n] === colorIndex) { seen[n] = 1; queue.push(n); }
    }
    const edges = new Map();
    const add = (a, b) => { const list = edges.get(a) || []; list.push(b); edges.set(a, list); };
    for (const i of queue) {
      const x = i % w, y = Math.floor(i / w), v = y * vertexWidth + x;
      if (!y || labels[i - w] !== colorIndex) add(v, v + 1);
      if (x === w - 1 || labels[i + 1] !== colorIndex) add(v + 1, v + 1 + vertexWidth);
      if (y === h - 1 || labels[i + w] !== colorIndex) add(v + 1 + vertexWidth, v + vertexWidth);
      if (!x || labels[i - 1] !== colorIndex) add(v + vertexWidth, v);
    }
    const rings = [];
    while (edges.size) {
      const first = edges.keys().next().value, ring = [];
      let current = first, guard = 0;
      do {
        ring.push([current % vertexWidth, Math.floor(current / vertexWidth)]);
        const outgoing = edges.get(current);
        if (!outgoing?.length) break;
        const next = outgoing.pop();
        if (!outgoing.length) edges.delete(current);
        current = next;
      } while (current !== first && guard++ < w * h * 4);
      if (current === first && ring.length >= 4) {
        ring.push(ring[0]);
        const simplified = simplify(ring, options.epsilon ?? 0.35);
        simplified.pop();
        if (simplified.length >= 3) {
          // Smooth, then drop the points Chaikin made redundant: a staircase
          // outline becomes a curve with fewer vertices than the polygon had.
          // Tolerance is in PIXELS here (the cm conversion happens later), so scale
          // it with the polygon epsilon instead of using a fixed 0.12.
          const eps = options.epsilon ?? 0.35;
          const iterations = options.smoothing ?? 1;
          // Smoothing a thin stroke's outline (a 1px line is a long thin loop) or a
          // heavily simplified rectangle turns it into a blob. Only round outlines
          // that still have enough vertices to describe a curve.
          const curvy = simplified.length >= 10;
          if (!curvy || iterations === 0) {
            rings.push(simplified);
            continue;
          }
          const smoothEps = options.smoothEpsilon ?? Math.max(0.2, eps * 0.25);
          const pairs = simplified.map(([x, y]) => ({ x, y }));
          const smoothed = chaikin(pairs, iterations);
          const resampled = simplify(smoothed.map((p) => [p.x, p.y]), smoothEps);
          rings.push((resampled.length >= 3 ? resampled : simplified).map(([x, y]) => [x, y]));
        }
      }
    }
    const spanPx = Math.max(x1 - x0, y1 - y0, 1);
    // --- noise gate -------------------------------------------------------
    // Anti-aliasing leaves 1-3px specks that later look like broken curves.
    // Drop them here, before anything is merged or fitted.
    const area = queue.length;
    const diag = Math.hypot(x1 - x0, y1 - y0);
    // Two tiers. A 1-2 px speck is noise no matter what: preserveGeometry is
    // about not skeletonising real strokes, NOT about keeping antialiasing grit
    // (that grit used to become a one-pixel ill and turned 5 KB into 247 KB).
    const tiny = area < 6 || diag < 3.5;
    const sparse = (area / Math.max(1, spanPx)) < 0.5;
    // A pale sliver is antialiasing, not content: real marks (ticks, frame, text)
    // are dark. Only applies to small components, so a pale panel fill survives.
    // Measure the component's own colour: the quantised palette merges a 235-grey
    // sliver into a darker bin, so the palette entry cannot tell pale from dark.
    let pale = false;
    if (area < 400) {
      let r = 0, g = 0, b = 0;
      for (const i of queue) { r += rgb[i * 3]; g += rgb[i * 3 + 1]; b += rgb[i * 3 + 2]; }
      pale = r / area > 225 && g / area > 225 && b / area > 225;
    }
    components++;
    if (tiny || pale || (sparse && !options.preserveGeometry)) {
      discarded++;
      ignoredPixels += area;
      continue;
    }
    const thickness = queue.length / spanPx;
    // A stroke is long and thin: describe it by its centre line, not its outline.
    if (!options.preserveGeometry && thickness < 3.2 && spanPx >= 6) {
      const mask = new Uint8Array(w * h);
      for (const i of queue) mask[i] = 1;
      const skel = skeletonize(mask, w, h);
      const paths = stitchPaths(traceSkeleton(skel, w, h));
      const polylines = paths
        .filter((path) => path.length >= 6) // dots and specks are not strokes
        // Strokes tolerate a wider tolerance: they are drawn as a line of a given
        // width, so sub-pixel wiggles are invisible and only inflate the file.
        .map((path) => simplify(path, Math.max(2.2, (options.epsilon ?? 0.35) * 6)))
        .filter((path) => path.length >= 2);
      if (polylines.length) {
        shapes.push({
          colorIndex,
          rings: polylines,
          area: queue.length,
          box: { x0, y0, x1, y1 },
          isStroke: true,
          strokePx: thickness,
        });
        continue;
      }
    }
    // median colour of this component, used when the geometry was traced colour-blind
    let sample = null;
    if (colorAgnostic) {
      const px = queue.filter((_, k) => k % Math.max(1, Math.floor(queue.length / 64)) === 0);
      const sum = [0, 0, 0];
      for (const i of px) {
        sum[0] += rgb[i * 3];
        sum[1] += rgb[i * 3 + 1];
        sum[2] += rgb[i * 3 + 2];
      }
      sample = sum.map((v) => Math.round(v / Math.max(1, px.length)));
    }
    if (rings.length) shapes.push({ colorIndex, rings, area: queue.length, box: { x0, y0, x1, y1 }, sample });
  }
  // --- family grouping -------------------------------------------------
  // When the model says "this is a ridge plot with N curves", stop treating every
  // fragment as its own curve: bucket the fragments by baseline and rebuild one
  // polyline per curve.
  const fam = semantics && semantics.structure;
  const famCount = fam ? Math.round(Number(fam.curveCount) || 0) : 0;
  if (famCount >= 2) {
    // Only real curves take part in the family: frames and axes span the panel,
    // ticks and glyph strokes are tiny. Clustering either of them invents curves
    // that wander across the whole figure.
    // Frames and axes are geometrically identical to a ridge curve by size — a
    // ridge also spans the panel. Tell them apart by shape instead:
    //   frame = closed loop, axis = perfectly straight, curve = neither.
    const straightness = (pts) => {
      if (pts.length < 3) return 0;
      const [ax, ay] = pts[0];
      const [bx, by] = pts[pts.length - 1];
      const dx = bx - ax, dy = by - ay;
      const base = Math.hypot(dx, dy) || 1;
      let worst = 0;
      for (const [x, y] of pts) {
        worst = Math.max(worst, Math.abs((x - ax) * dy - (y - ay) * dx) / base);
      }
      return worst; // px away from the chord
    };
    const isCurveLike = (s) => {
      const bw = s.box.x1 - s.box.x0;
      const bh = s.box.y1 - s.box.y0;
      if (bw < 8 && bh < 8) return false; // dots
      const line = s.rings.reduce((best, r) => (r.length > best.length ? r : best), s.rings[0]);
      if (!line || line.length < 4) return false; // ticks, glyph fragments
      const [fx, fy] = line[0];
      const [lx, ly] = line[line.length - 1];
      const closed = Math.hypot(fx - lx, fy - ly) < 3 && line.length > 12;
      if (closed) return false; // frame loop
      const straight = straightness(line) < 1.5;
      if (straight) return false; // axis, tick, rule
      return true;
    };
    const strokes = shapes.filter((s) => s.isStroke && isCurveLike(s));
    const rest = shapes.filter((s) => !(s.isStroke && isCurveLike(s)));
    if (strokes.length >= famCount) {
      const midY = strokes.map((s) => {
        const ys = s.rings.flat().map((p) => p[1]).sort((a, b) => a - b);
        return ys.length ? ys[Math.floor(ys.length * 0.5)] : 0;
      });
      const lo = Math.min(...midY), hi = Math.max(...midY);
      const centres = Array.from({ length: famCount }, (_, i) => lo + ((hi - lo) * i) / Math.max(1, famCount - 1));
      let assign = midY.map((y) => {
        let best = 0;
        centres.forEach((c, i) => { if (Math.abs(y - c) < Math.abs(y - centres[best])) best = i; });
        return best;
      });
      for (let iter = 0; iter < 6; iter++) {
        const sums = centres.map(() => [0, 0]);
        assign.forEach((k, i) => { sums[k][0] += midY[i]; sums[k][1]++; });
        sums.forEach((s, i) => { if (s[1]) centres[i] = s[0] / s[1]; });
        const next = midY.map((y) => {
          let best = 0;
          centres.forEach((c, i) => { if (Math.abs(y - c) < Math.abs(y - centres[best])) best = i; });
          return best;
        });
        if (next.every((v, i) => v === assign[i])) break;
        assign = next;
      }
      shapes.length = 0;
      shapes.push(...rest);
      for (let c = 0; c < famCount; c++) {
        const parts = strokes.filter((_, i) => assign[i] === c);
        if (!parts.length) continue;
        // one polyline per curve: x-bins, mean y of the fragments in that bin
        const bins = new Map();
        for (const part of parts) {
          for (const [x, y] of part.rings.flat()) {
            const key = Math.round(x / 3);
            const cur = bins.get(key);
            if (cur) { cur[0] += x; cur[1] += y; cur[2] += 1; } else bins.set(key, [x, y, 1]);
          }
        }
        const pts = [...bins.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => [v[0] / v[2], v[1] / v[2]]);
        if (pts.length < 3) continue;
        shapes.push({
          colorIndex: parts[0].colorIndex,
          rings: [simplify(pts, Math.max(1.5, (options.epsilon ?? 0.35) * 4))],
          area: parts.reduce((n, p) => n + p.area, 0),
          box: {
            x0: Math.min(...pts.map((p) => p[0])),
            y0: Math.min(...pts.map((p) => p[1])),
            x1: Math.max(...pts.map((p) => p[0])),
            y1: Math.max(...pts.map((p) => p[1])),
          },
          sample: parts[0].sample,
          isStroke: true,
          strokePx: parts[0].strokePx,
        });
      }
    }
  }

  const recognized = (Array.isArray(semantics.labels) ? semantics.labels : []).filter(label => typeof label.tex === "string" && label.tex.length <= 300 && Array.isArray(label.box) && label.box.length === 4 && label.box.every(Number.isFinite) && label.confidence >= 0.4).slice(0, 80);
  const groups = new Map();
  for (const shape of shapes) {
    // Text is whatever sits inside a recognised label box: a glyph often pokes a
    // pixel or two outside it, so test the centre instead of full containment.
    const cx = (shape.box.x0 + shape.box.x1) / 2;
    const cy = (shape.box.y0 + shape.box.y1) / 2;
    const labelIndex = recognized.findIndex((label) => {
      const [x, y, width, height] = label.box;
      const pad = 2;
      return (
        cx >= (x * w) / 1000 - pad &&
        cx <= ((x + width) * w) / 1000 + pad &&
        cy >= (y * h) / 1000 - pad &&
        cy <= ((y + height) * h) / 1000 + pad
      );
    });
    // A label wins over "this stroke looks like a line": glyph strokes must be
    // replaced by text, not drawn.
    const key = labelIndex >= 0
      ? `label:${labelIndex}`
      : shape.isStroke
        ? `stroke${groups.size}`
        : shape.area < 12
          ? `detail:${shape.colorIndex}:${Math.floor(shape.box.x0 / 48)}:${Math.floor(shape.box.y0 / 32)}`
          : `shape${groups.size}`;
    if (groups.has(key)) groups.get(key).rings.push(...shape.rings);
    else groups.set(key, { ...shape, labelIndex });
  }
  const k = 12 / w, elements = [];
  for (const shape of groups.values()) {
    const rings = shape.rings.map(ring => ring.map(([x, y]) => ({ x: x * k, y: (h - y) * k })));
    const rgbPick = shape.sample || palette[shape.colorIndex] || [0, 0, 0];
    const color = "#" + rgbPick.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
    const label = recognized[shape.labelIndex];
    const ocr = label ? { text: label.tex, at: { x: (label.box[0] + label.box[2] / 2) * w / 1000 * k, y: (h - (label.box[1] + label.box[3] / 2) * h / 1000) * k }, fontSize: label.box[3] * h / 1000 * k * 72 / 2.54 * 0.8 } : undefined;
    const labelNode = recognized[shape.labelIndex];
    if (labelNode) {
      // Text is text: keep the OCR content and its position, throw away the
      // traced glyph outlines (they are unreadable blobs at low palette counts).
      elements.push({
        id: `trace${elements.length}`,
        kind: "node",
        name: `文字：${labelNode.tex}`,
        at: {
          x: (labelNode.box[0] + labelNode.box[2] / 2) * (w / 1000) * k,
          y: (h - (labelNode.box[1] + labelNode.box[3] / 2) * (h / 1000)) * k,
        },
        text: labelNode.tex,
        style: { color: "#000000", fill: null, thickness: "normal", dashed: false, arrow: "none" },
        boxed: false,
        rounded: 0,
        fontSize: Math.max(5, Math.min(30, labelNode.box[3] * (h / 1000) * k * 72 / 2.54 * 0.8)),
        anchor: "center",
        ocr: { text: labelNode.tex, at: { x: 0, y: 0 }, fontSize: 10 },
      });
      continue;
    }
    if (shape.isStroke) {
      const widthPt = Math.max(0.2, (shape.strokePx || 1) * k * 28.3465);
      const thickness = widthPt < 0.6 ? "thin" : widthPt < 1.1 ? "normal" : widthPt < 1.7 ? "thick" : "very thick";
      for (const line of rings) {
        // Catmull-Rom -> cubic Bézier: same shape, far fewer control points, and
        // the exported path is genuinely smooth instead of a dense polyline.
        const start = line[0];
        // Few points + axis-aligned segments = a frame, axis or colour-bar edge.
        // Those must stay sharp: turning them into cubics rounds the corners.
        const sharp =
          line.length <= 6 &&
          line.every((p, i) => {
            if (i === 0) return true;
            const dx = Math.abs(p.x - line[i - 1].x);
            const dy = Math.abs(p.y - line[i - 1].y);
            return dx < 1e-6 || dy < 1e-6 || Math.min(dx, dy) / Math.max(dx, dy) < 0.15;
          });
        const path = [];
        for (let i = 0; i < line.length - 1; i++) {
          const p0 = line[i - 1] ?? line[i];
          const p1 = line[i];
          const p2 = line[i + 1];
          const p3 = line[i + 2] ?? p2;
          path.push({
            c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
            c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
            p: p2,
          });
        }
        elements.push({
          id: `trace${elements.length}`,
          kind: "poly",
          name: `线条 ${elements.length + 1}`,
          points: line,
          start,
          path: path.length && !sharp ? path : undefined,
          closed: false,
          style: { color, fill: null, thickness, dashed: false, arrow: "none", strokeNone: false },
        });
      }
      continue;
    }
    elements.push({ id: `trace${elements.length}`, kind: "poly", name: ocr ? `文字：${ocr.text}` : `轮廓 ${elements.length + 1}`, points: rings[0], rings: rings.slice(1), closed: true, style: { color, fill: color, thickness: "normal", dashed: false, arrow: "none", strokeNone: true }, ...(ocr ? { ocr } : {}) });
  }
  const stats = { width: w, height: h, palette: palette.length, components, discarded, elements: elements.length, strokes: elements.filter((el) => el.kind === "poly" && el.closed === false).length, points: elements.reduce((n, el) => n + (el.points || []).length + (el.rings || []).reduce((s, r) => s + r.length, 0), 0), labels: recognized.length, ignoredPixels };
  if (elements.length > (options.maxElements || 1800) || stats.points > 45000) throw new Error(`图片细节过多（${elements.length} 个轮廓），请裁切单个子图或缩小图片后重试`);
  return { figure: { elements, viewport: { x0: 0, y0: 0, w: 12, h: h * k } }, stats };
}

import { cjkPreamble } from "./textext.mjs";

export function traceDocument(figure) {
  const fmt = v => String(Math.round(v * 1000) / 1000);
  const pt = p => `(${fmt(p.x)},${fmt(p.y)})`;
  // Bare standalone documents have no CJK glyphs: a \node{球} compiles and draws
  // nothing. Load ctex whenever the figure actually contains such text.
  const textBlob = figure.elements.map((el) => el && typeof el.text === "string" ? el.text : "").join(" ");
  const lines = ["\\documentclass[tikz,border=0pt]{standalone}", "\\usepackage{amsmath,amssymb}"]
    .concat(cjkPreamble(textBlob))
    .concat(["\\begin{document}", "\\begin{tikzpicture}", `% @viewport 0 0 ${figure.viewport.w} ${figure.viewport.h}`, `\\useasboundingbox (0,0) rectangle (${fmt(figure.viewport.w)},${fmt(figure.viewport.h)});`]);
  const rgbOf = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const widthOf = { thin: 0.4, normal: 0.8, thick: 1.2, "very thick": 1.8 };
  for (const el of figure.elements) {
    if (el.ocr) lines.push("% @ocr " + JSON.stringify(el.ocr));
    // Open polylines are strokes: draw the line, do not fill its "outline".
    if (el.kind === "node") {
      const esc = String(el.text || "").replace(/([%#&])/g, "\\\\$1");
      lines.push(`\\node[anchor=center, font=\\fontsize{${fmt(el.fontSize)}}{${fmt(el.fontSize * 1.2)}}\\selectfont] at ${pt(el.at)} {${esc}};`);
      continue;
    }
    if (el.closed === false) {
      const [r, g, b] = rgbOf(el.style.color);
      const w = widthOf[el.style.thickness] ?? 0.8;
      const opts = `draw={rgb,255:red,${r};green,${g};blue,${b}},line width=${w}pt,line cap=round,line join=round`;
      const chain = el.start && el.path?.length
        ? pt(el.start) + " " + el.path.map((s) => `.. controls ${pt(s.c1)} and ${pt(s.c2)} .. ${pt(s.p)}`).join(" ")
        : el.points.map(pt).join(" -- ");
      lines.push(`\\draw[${opts}] ${chain};`);
      continue;
    }
    const hex = el.style.fill || el.style.color;
    const [r, g, b] = rgbOf(hex);
    const loops = [el.points, ...(el.rings || [])].map(ring => ring.map(pt).join(" -- ") + " -- cycle").join(" ");
    lines.push(`\\draw[draw=none,fill={rgb,255:red,${r};green,${g};blue,${b}},even odd rule] ${loops};`);
  }
  return [...lines, "\\end{tikzpicture}", "\\end{document}"].join("\n");
}
