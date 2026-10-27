/**
 * Image term D(R(f), I_Omega) from §11.3.
 *
 * The image is used ONLY as evidence for fitting: it never becomes an output path.
 * The term compares the rasterised curve (R(f)) with the ink inside the curve's
 * region (I_Omega), foreground and background balanced, and is applied only to a
 * small set of free parameters.
 */

/** Ink mask of a normalised region, plus its bounding box in pixels. */
export function regionInk(raster, region, threshold) {
  const th = threshold == null ? 200 : threshold;
  const w = raster.w, h = raster.h;
  const x0 = Math.max(0, Math.floor((region[0] / 1000) * w));
  const y0 = Math.max(0, Math.floor((region[1] / 1000) * h));
  const x1 = Math.min(w - 1, Math.ceil(((region[0] + region[2]) / 1000) * w));
  const y1 = Math.min(h - 1, Math.ceil(((region[1] + region[3]) / 1000) * h));
  const mask = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1));
  const width = x1 - x0 + 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 3;
      const l = (raster.rgb[i] * 299 + raster.rgb[i + 1] * 587 + raster.rgb[i + 2] * 114) / 1000;
      mask[(y - y0) * width + (x - x0)] = l < th ? 1 : 0;
    }
  }
  return { mask, width, height: y1 - y0 + 1, x0, y0, x1, y1 };
}

const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

/**
 * Rasterise the fitted segments into the same grid as the ink mask. Sampling is
 * for MEASUREMENT only - the emitted TikZ stays a Bézier chain.
 */
export function rasterizeSegments(segments, ink, options) {
  const opts = options || {};
  const radius = Math.max(1, Math.round(opts.radius || 1.5));
  const out = new Uint8Array(ink.width * ink.height);
  const stamp = (px, py) => {
    const cx = (px / 1000) * (opts.widthPx || 1000) - ink.x0;
    const cy = (py / 1000) * (opts.heightPx || 1000) - ink.y0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= ink.width || y >= ink.height) continue;
        out[y * ink.width + x] = 1;
      }
    }
  };
  for (const s of segments || []) {
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const [x, y] = cubic(s.p0, s.p1, s.p2, s.p3, i / steps);
      stamp(x, y);
    }
  }
  return out;
}

/** Grow a binary mask by r pixels (a tolerance band, not a new output path). */
export function dilateMask(mask, width, height, r) {
  if (!r) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * F1 distance between the drawn curve and the ink, each side dilated by a small
 * tolerance so a sub-stroke offset is not counted as an error:
 *   recall    = |curve ∩ band(ink)| / |curve|
 *   precision = |ink ∩ band(curve)| / |ink|
 *   D         = 1 - F1
 * Using a symmetric difference with a dilated side would punish the curve for the
 * band itself, which is why this is measured one-sided.
 */
export function imageDistance(curveMask, ink, options) {
  const tol = (options && options.tolerance) == null ? 2 : (options && options.tolerance);
  const inkBand = dilateMask(ink.mask, ink.width, ink.height, tol);
  const curveBand = dilateMask(curveMask, ink.width, ink.height, tol);
  let curveTotal = 0, curveHit = 0, inkTotal = 0, inkHit = 0;
  for (let i = 0; i < ink.mask.length; i++) {
    if (curveMask[i]) { curveTotal++; if (inkBand[i]) curveHit++; }
    if (ink.mask[i]) { inkTotal++; if (curveBand[i]) inkHit++; }
  }
  const recall = curveTotal ? curveHit / curveTotal : 0;
  const precision = inkTotal ? inkHit / inkTotal : 0;
  if (!recall && !precision) return 1;
  if (!recall || !precision) return 1;
  const f1 = (2 * precision * recall) / (precision + recall);
  return 1 - f1;
}

/**
 * Coordinate descent on a few free parameters: a global vertical offset plus one
 * offset per knot. Each candidate is scored with the image term; the TikZ output
 * still comes from the coefficients, never from the pixels.
 */
export function refineWithImage(segments, ink, options) {
  const opts = options || {};
  const widthPx = opts.widthPx || 1000;
  const heightPx = opts.heightPx || 1000;
  const passes = Math.max(1, Math.min(4, opts.passes || 2));
  const start = opts.step == null ? Math.max(2, (opts.inkHeightPx || 40) * 0.12) : opts.step;
  const score = (segs) => imageDistance(rasterizeSegments(segs, ink, { widthPx, heightPx, radius: opts.radius }), ink);

  let best = segments.map((s) => ({ ...s }));
  let bestScore = score(best);
  const shiftAll = (dy) => best.map((s) => ({
    ...s,
    p0: [s.p0[0], s.p0[1] + dy], p1: [s.p1[0], s.p1[1] + dy],
    p2: [s.p2[0], s.p2[1] + dy], p3: [s.p3[0], s.p3[1] + dy],
  }));
  const shiftNode = (index, dy) => best.map((s, i) => {
    const before = i === index - 1;
    const after = i === index;
    if (!before && !after) return { ...s };
    return {
      ...s,
      p0: before || (i === index && index === 0) ? [s.p0[0], s.p0[1] + dy] : s.p0,
      p1: [s.p1[0], s.p1[1] + dy],
      p2: [s.p2[0], s.p2[1] + dy],
      p3: i === index ? [s.p3[0], s.p3[1] + dy] : s.p3,
    };
  });

  for (let pass = 0; pass < passes; pass++) {
    for (const delta of [start, -start, start / 2, -start / 2]) {
      const candidate = shiftAll(delta);
      const s = score(candidate);
      if (s < bestScore - 1e-6) { best = candidate; bestScore = s; break; }
    }
    for (let node = 0; node < best.length; node++) {
      for (const delta of [start, -start, start / 2, -start / 2]) {
        const candidate = shiftNode(node, delta);
        const s = score(candidate);
        if (s < bestScore - 1e-6) { best = candidate; bestScore = s; break; }
      }
    }
  }
  return { segments: best, before: score(segments), after: bestScore, improved: bestScore < score(segments) - 1e-6 };
}
