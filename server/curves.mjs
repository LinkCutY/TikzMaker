/**
 * Column-wise curve extraction ("单值跟踪").
 *
 * Why not skeletons: a skeleton walk follows whatever the ink is connected to,
 * so where two anti-aliased curves touch, one track hops to the neighbour and
 * comes back — the result is a thick zig-zag band instead of N thin lines.
 *
 * A plot of y = f(x) has one more property we can exploit: every curve is
 * single-valued in x. So scan column by column, take the ink runs in each
 * column, and link runs across columns by slope continuity. A track can never
 * zig-zag: it is one y per x, by construction.
 *
 * Trade-off: where curves genuinely merge (a peak), the track simply stops —
 * an honest gap instead of an invented bridge.
 */

const DEFAULTS = {
  inkThreshold: 220,   // grey level below which a pixel is ink
  maxRunPx: 5,         // runs thicker than this need splitting (curves packed tight)
  maxSplitRunPx: 14,   // ...but a solid block (colour bar, filled area) is not a curve family
  splitWidthPx: 2.2,   // expected spacing of the curves inside a merged run
  tolerancePx: 2.2,    // max |y - prediction| when linking a run to a track
  maxSlope: 1.6,       // px per column
  maxMiss: 2,          // columns a track may skip before it is closed
  minSpanPx: 18,       // horizontal extent a track must have to be kept
  minPoints: 8,
  smooth: 3,           // moving-average window on y
};

function runsInColumn(gray, w, h, x, threshold) {
  const runs = [];
  let y = 0;
  while (y < h) {
    const i = y * w + x;
    if (gray[i] < threshold) {
      let end = y;
      while (end + 1 < h && gray[(end + 1) * w + x] < threshold) end++;
      runs.push({ y0: y, y1: end, center: (y + end) / 2, thickness: end - y + 1 });
      y = end + 1;
    } else {
      y++;
    }
  }
  return runs;
}

/** Extract single-valued curves from a raster ({ w, h, rgb }). */
export function extractCurves(raster, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const { w, h, rgb } = raster;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    gray[i] = (rgb[p] * 299 + rgb[p + 1] * 587 + rgb[p + 2] * 114) / 1000;
  }

  const active = [];
  const finished = [];
  let columnsWithInk = 0;
  let runsTotal = 0;
  let runsSkippedThick = 0;
  let runsSplit = 0;

  for (let x = 0; x < w; x++) {
    const runs = runsInColumn(gray, w, h, x, opts.inkThreshold);
    const usable = [];
    for (const run of runs) {
      runsTotal++;
      if (run.thickness <= opts.maxRunPx) { usable.push(run); continue; }
      // A merged run is a bundle of curves packed tighter than one pixel gap.
      // Split it at the expected spacing so the peak region keeps its curve
      // count instead of disappearing.
      if (run.thickness > opts.maxSplitRunPx) { runsSkippedThick++; continue; }
      const count = Math.max(2, Math.round(run.thickness / opts.splitWidthPx));
      for (let i = 0; i < count; i++) {
        const y = run.y0 + ((run.thickness - 1) * i) / (count - 1);
        usable.push({ y0: y, y1: y, center: y, thickness: opts.splitWidthPx, split: true });
      }
      runsSplit++;
    }
    if (usable.length) columnsWithInk++;

    // Predict every active track, then match greedily by smallest distance.
    const pairs = [];
    for (let t = 0; t < active.length; t++) {
      const track = active[t];
      if (track.lastX === x - 1) {
        track.predicted = track.lastY + track.slope;
      } else {
        track.predicted = track.lastY; // gap: hold the last height
      }
      for (let r = 0; r < usable.length; r++) {
        const d = Math.abs(usable[r].center - track.predicted);
        if (d <= opts.tolerancePx + (x - track.lastX - 1) * 0.5) pairs.push({ t, r, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const trackUsed = new Set();
    const runUsed = new Set();
    for (const pair of pairs) {
      if (trackUsed.has(pair.t) || runUsed.has(pair.r)) continue;
      trackUsed.add(pair.t);
      runUsed.add(pair.r);
      const track = active[pair.t];
      const run = usable[pair.r];
      const dx = Math.max(1, x - track.lastX);
      const slope = Math.max(-opts.maxSlope, Math.min(opts.maxSlope, (run.center - track.lastY) / dx));
      track.slope = track.slope * 0.6 + slope * 0.4;
      track.points.push([x, run.center]);
      track.thickness += run.thickness;
      track.lastX = x;
      track.lastY = run.center;
      track.miss = 0;
    }
    for (let t = active.length - 1; t >= 0; t--) {
      if (trackUsed.has(t)) continue;
      const track = active[t];
      track.miss++;
      if (track.miss > opts.maxMiss) {
        finished.push(track);
        active.splice(t, 1);
      }
    }
    for (let r = 0; r < usable.length; r++) {
      if (runUsed.has(r)) continue;
      const run = usable[r];
      active.push({
        points: [[x, run.center]],
        slope: 0,
        lastX: x,
        lastY: run.center,
        miss: 0,
        thickness: run.thickness,
      });
    }
  }
  for (const track of active) finished.push(track);

  const tracks = [];
  let droppedShort = 0;
  for (const track of finished) {
    const pts = track.points;
    const span = pts[pts.length - 1][0] - pts[0][0];
    if (span < opts.minSpanPx || pts.length < opts.minPoints) { droppedShort++; continue; }
    // moving average on y: kills single-pixel jitter without moving the curve
    const half = Math.floor(opts.smooth / 2);
    const smoothed = pts.map((p, i) => {
      let sum = 0, n = 0;
      for (let k = -half; k <= half; k++) {
        const q = pts[i + k];
        if (q) { sum += q[1]; n++; }
      }
      return [p[0], sum / n];
    });
    // colour: sample the ink at the middle of the track
    const mid = pts[Math.floor(pts.length / 2)];
    const si = (Math.round(mid[1]) * w + Math.round(mid[0])) * 3;
    tracks.push({
      points: smoothed,
      color: [rgb[si], rgb[si + 1], rgb[si + 2]],
      widthPx: track.thickness / pts.length,
    });
  }

  return {
    tracks,
    stats: {
      width: w,
      height: h,
      columnsWithInk,
      runsTotal,
      runsSkippedThick,
      runsSplit,
      tracks: tracks.length,
      droppedShort,
      avgPoints: tracks.length ? Math.round(tracks.reduce((n, t) => n + t.points.length, 0) / tracks.length) : 0,
      avgWidthPx: tracks.length ? Number((tracks.reduce((n, t) => n + t.widthPx, 0) / tracks.length).toFixed(2)) : 0,
    },
  };
}
