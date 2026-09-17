import type { Segment } from '../domain/types.js';

export interface ImageBay { x0: number; y0: number; x1: number; y1: number }

// Render the drawing strokes into a small, layer-independent monochrome image.
// This deliberately tests what is visible in the bay, not CAD layer names.
export function renderBayImage(segments: Segment[], bay: ImageBay, size = 96): Uint8Array {
  const pixels = new Uint8Array(size * size);
  const width = bay.x1 - bay.x0, height = bay.y1 - bay.y0;
  if (width <= 0 || height <= 0) return pixels;
  const plot = (x: number, y: number) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix >= 0 && ix < size && iy >= 0 && iy < size) pixels[iy * size + ix] = 1;
  };
  for (const segment of segments) {
    if (Math.max(segment.a.x, segment.b.x) < bay.x0 || Math.min(segment.a.x, segment.b.x) > bay.x1
      || Math.max(segment.a.y, segment.b.y) < bay.y0 || Math.min(segment.a.y, segment.b.y) > bay.y1) continue;
    const a = { x: (segment.a.x - bay.x0) / width * (size - 1), y: (segment.a.y - bay.y0) / height * (size - 1) };
    const b = { x: (segment.b.x - bay.x0) / width * (size - 1), y: (segment.b.y - bay.y0) / height * (size - 1) };
    const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2);
    if (steps > size * 30) continue; // sheet-wide annotation, not local ink
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      plot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }
  return pixels;
}

function diagonalCoverage(pixels: Uint8Array, size: number, descending: boolean): number {
  let hits = 0, total = 0;
  // Ignore beam corners and the centre, where labels and intersection strokes
  // can mimic a diagonal. Require ink along both long diagonal arms.
  for (let i = 8; i < size - 8; i++) {
    if (i > size * 0.43 && i < size * 0.57) continue;
    const y = descending ? size - 1 - i : i;
    let found = false;
    for (let dy = -1; dy <= 1 && !found; dy++)
      for (let dx = -1; dx <= 1 && !found; dx++) {
        const xx = i + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size && pixels[yy * size + xx]) found = true;
      }
    total++;
    if (found) hits++;
  }
  return total ? hits / total : 0;
}

/** A full-bay X is an exclusion cue, never a slab measurement by itself. */
export function imageShowsFullBayX(pixels: Uint8Array): boolean {
  const size = Math.sqrt(pixels.length);
  if (!Number.isInteger(size) || size < 32) return false;
  return diagonalCoverage(pixels, size, false) >= 0.78
    && diagonalCoverage(pixels, size, true) >= 0.78;
}

export function bayImageShowsFullX(segments: Segment[], bay: ImageBay): boolean {
  return imageShowsFullBayX(renderBayImage(segments, bay));
}
