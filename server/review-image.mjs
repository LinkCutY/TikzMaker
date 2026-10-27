import { decodePng } from './trace.mjs';
import { encodePng } from './pngwrite.mjs';

/** Area filtering to a common comparison canvas; preserve aspect and padding.
 * This is part of project QA, not a replacement for the exported vector. */
export function reviewImageAtSourceSize(reference, preview) {
  const source = decodePng(reference), input = decodePng(preview);
  const scale = Math.min(source.w / input.w, source.h / input.h);
  const w = Math.max(1, Math.round(input.w * scale)), h = Math.max(1, Math.round(input.h * scale));
  const ox = Math.floor((source.w - w) / 2), oy = Math.floor((source.h - h) / 2);
  const rgb = new Uint8Array(source.w * source.h * 3).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x * input.w / w, x1 = (x + 1) * input.w / w;
    const y0 = y * input.h / h, y1 = (y + 1) * input.h / h;
    const sum = [0, 0, 0]; let total = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const weight = Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx)) * Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
      const i = (Math.min(input.h-1,sy)*input.w+Math.min(input.w-1,sx))*3;
      for(let c=0;c<3;c++) sum[c]+=input.rgb[i+c]*weight;
      total+=weight;
    }
    const i=((y+oy)*source.w+x+ox)*3;
    for(let c=0;c<3;c++) rgb[i+c]=Math.round(sum[c]/total);
  }
  return 'data:image/png;base64,' + encodePng({w: source.w, h: source.h, rgb}).toString('base64');
}
