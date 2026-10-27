/**
 * Panel detection for paper screenshots.
 *
 * Figures are dark line art on white. Panels are separated by white gutters, so
 * connected components of "ink" give us the panel boxes. Small components inside
 * a big one (labels, curves) are absorbed; the remaining boxes are the panels.
 */

export interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Gray {
  w: number;
  h: number;
  gray: ArrayLike<number>;
}

/** 4-neighbour connected components on the binarised image. */
function components(g: Gray, threshold: number): PanelBox[] {
  const { w, h, gray } = g;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < threshold ? 1 : 0;

  const seen = new Uint8Array(w * h);
  const boxes: PanelBox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    let count = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && ink[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && ink[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && ink[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && ink[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    if (count < Math.max(6, (w * h) / 40000)) continue;
    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return boxes;
}

const area = (b: PanelBox) => b.w * b.h;
const contains = (outer: PanelBox, inner: PanelBox) => {
  const pad = 2;
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.w <= outer.x + outer.w + pad &&
    inner.y + inner.h <= outer.y + outer.h + pad
  );
};

/**
 * Pure detector: takes a grayscale buffer so it can be unit-tested offline.
 * Returns panel boxes in the same coordinate space, biggest first.
 */
export function detectPanelsFromGray(input: Gray, opts: { minShare?: number } = {}): PanelBox[] {
  const { w, h } = input;
  const minShare = opts.minShare ?? 0.02; // a panel is at least 2% of the image area
  const raw = components(input, 200);

  // Drop components that sit inside a bigger one (labels, curves, ticks).
  const big = raw.filter((b) => area(b) >= w * h * minShare);
  const panels = big.filter((b) => !big.some((other) => other !== b && area(other) > area(b) && contains(other, b)));

  // Merge boxes that overlap a lot (a dashed border splits into pieces).
  const merged: PanelBox[] = [];
  for (const b of panels.sort((a, z) => area(z) - area(a))) {
    const hit = merged.find((m) => {
      const ix = Math.max(0, Math.min(m.x + m.w, b.x + b.w) - Math.max(m.x, b.x));
      const iy = Math.max(0, Math.min(m.y + m.h, b.y + b.h) - Math.max(m.y, b.y));
      return ix * iy > 0.5 * Math.min(area(m), area(b));
    });
    if (hit) {
      const x0 = Math.min(hit.x, b.x);
      const y0 = Math.min(hit.y, b.y);
      hit.w = Math.max(hit.x + hit.w, b.x + b.w) - x0;
      hit.h = Math.max(hit.y + hit.h, b.y + b.h) - y0;
      hit.x = x0;
      hit.y = y0;
    } else {
      merged.push({ ...b });
    }
  }

  return merged
    .filter((b) => b.w > w * 0.1 && b.h > h * 0.08)
    .sort((a, b) => (Math.abs(a.y - b.y) > h * 0.1 ? a.y - b.y : a.x - b.x))
    .slice(0, 8);
}

/** Browser wrapper: downscale the screenshot, then run the pure detector. */
export async function detectPanels(imageUrl: string, width = 320): Promise<{ panels: PanelBox[]; scale: number; w: number; h: number }> {
  const img = await loadImage(imageUrl);
  const h = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { panels: [], scale: 1, w: width, h };
  ctx.drawImage(img, 0, 0, width, h);
  const data = ctx.getImageData(0, 0, width, h).data;
  const gray = new Array<number>(width * h);
  for (let i = 0; i < width * h; i++) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  return { panels: detectPanelsFromGray({ w: width, h, gray }), scale: img.naturalWidth / width, w: width, h };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
}

/** Cut one panel out of the screenshot at full resolution. */
export function cropBounds(box: PanelBox, scale: number, imageWidth: number, imageHeight: number, pad = 4): PanelBox {
  const x = Math.max(0, Math.round(box.x * scale) - pad);
  const y = Math.max(0, Math.round(box.y * scale) - pad);
  return { x, y, w: Math.max(1, Math.min(imageWidth, Math.round((box.x + box.w) * scale) + pad) - x), h: Math.max(1, Math.min(imageHeight, Math.round((box.y + box.h) * scale) + pad) - y) };
}

/** Split whitespace between neighbouring frames, retaining outside tick labels. */
export function panelRegions(frames: PanelBox[], width: number, height: number): PanelBox[] {
  return frames.map((a, i) => {
    let x0 = 0, y0 = 0, x1 = width, y1 = height;
    frames.forEach((b, j) => {
      if (i === j) return;
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlapY > 0.2 * Math.min(a.h, b.h)) {
        if (b.x >= a.x + a.w) x1 = Math.min(x1, Math.floor((a.x + a.w + b.x) / 2));
        if (b.x + b.w <= a.x) x0 = Math.max(x0, Math.floor((b.x + b.w + a.x) / 2));
      }
      if (overlapX > 0.2 * Math.min(a.w, b.w)) {
        if (b.y >= a.y + a.h) y1 = Math.min(y1, Math.floor((a.y + a.h + b.y) / 2));
        if (b.y + b.h <= a.y) y0 = Math.max(y0, Math.floor((b.y + b.h + a.y) / 2));
      }
    });
    return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
  });
}

export function cropPanel(img: HTMLImageElement, box: PanelBox, scale = 1, pad = 4): string {
  const { x, y, w, h } = cropBounds(box, scale, img.naturalWidth, img.naturalHeight, pad);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  }
  return canvas.toDataURL("image/png");
}
