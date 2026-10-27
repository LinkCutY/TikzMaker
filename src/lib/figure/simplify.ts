export interface Pt2 {
  x: number;
  y: number;
}

function perpDistance(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Douglas–Peucker simplification. Points are dropped only where the curve is
 * close to straight, so the emitted TikZ keeps the shape with a fraction of the
 * coordinates (a 300-point wave typically collapses to ~60 points, < 0.1pt error).
 */
export function simplifyPath(points: Pt2[], eps = 0.004): Pt2[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    let worst = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDistance(points[i], points[a], points[b]);
      if (d > worst) {
        worst = d;
        idx = i;
      }
    }
    if (worst > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Pt2[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}
