import type { Segment } from '../domain/types.js';

export interface ImageBay { x0: number; y0: number; x1: number; y1: number }
export interface ImagePoint { x: number; y: number }
export interface SegmentedBay { polygon: ImagePoint[]; areaM2: number; box: ImageBay; rectangular: boolean }

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

const polygonArea = (points: ImagePoint[]) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;

function simplifyRasterPolygon(points: ImagePoint[], tolerance: number): ImagePoint[] {
  if (points.length < 4) return points;
  const collinear: ImagePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
    if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-6) collinear.push(b);
  }
  if (collinear.length < 4) return collinear;
  const distance = (p: ImagePoint, a: ImagePoint, b: ImagePoint) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-9)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const open = [...collinear, collinear[0]];
  const keep = new Uint8Array(open.length); keep[0] = 1; keep[open.length - 1] = 1;
  const stack: [number, number][] = [[0, open.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!; let farthest = -1, at = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distance(open[i], open[start], open[end]);
      if (d > farthest) { farthest = d; at = i; }
    }
    if (farthest > tolerance && at > start) { keep[at] = 1; stack.push([start, at], [at, end]); }
  }
  return open.filter((_, index) => keep[index]).slice(0, -1);
}

/**
 * Segment the visually enclosed white region around a slab seed. This is
 * layer-independent after callers select structural strokes. Scale-aware
 * dilation joins drafting gaps only up to 75 mm at plan scale.
 */
export function segmentVisualBay(segments: Segment[], seed: ImagePoint, search: ImageBay, size = 512): SegmentedBay | null {
  const width = search.x1 - search.x0, height = search.y1 - search.y0;
  if (width <= 0 || height <= 0 || size < 64) return null;
  const ink = renderBayImage(segments, search, size);
  const closed = ink.slice();
  // Thicken visible strokes just enough to close a maximum 75 mm plotting
  // break. Deriving the radius from the viewport scale is important: a fixed
  // pixel radius either misses the same physical gap in a large bay or joins
  // a 100–150 mm expansion joint in a small one.
  const mmPerPixel = Math.max(width, height) / size;
  const closeRadius = Math.max(1, Math.min(4, Math.floor(75 / Math.max(1, 2 * mmPerPixel))));
  for (let y = closeRadius; y < size - closeRadius; y++) for (let x = closeRadius; x < size - closeRadius; x++) if (ink[y * size + x]) {
    for (let dy = -closeRadius; dy <= closeRadius; dy++) for (let dx = -closeRadius; dx <= closeRadius; dx++)
      closed[(y + dy) * size + x + dx] = 1;
  }
  let sx = Math.max(1, Math.min(size - 2, Math.round((seed.x - search.x0) / width * (size - 1))));
  let sy = Math.max(1, Math.min(size - 2, Math.round((seed.y - search.y0) / height * (size - 1))));
  // A panel centre frequently lies on a dimension/beam centreline. Locate the
  // nearest white pixel without jumping across a physical boundary.
  if (closed[sy * size + sx]) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let radius = 1; radius <= 8 && !best; radius++) for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x <= 0 || y <= 0 || x >= size - 1 || y >= size - 1 || closed[y * size + x]) continue;
        const d = Math.hypot(dx, dy); if (!best || d < best.d) best = { x, y, d };
      }
    if (!best) return null; sx = best.x; sy = best.y;
  }
  const region = new Uint8Array(size * size), queue = new Int32Array(size * size);
  let head = 0, tail = 0, leaks = false; queue[tail++] = sy * size + sx; region[sy * size + sx] = 1;
  while (head < tail) {
    const index = queue[head++], x = index % size, y = Math.floor(index / size);
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) leaks = true;
    for (const next of [index - 1, index + 1, index - size, index + size]) {
      if (next < 0 || next >= region.length || closed[next] || region[next]) continue;
      const nx = next % size;
      if (Math.abs(nx - x) > 1) continue;
      region[next] = 1; queue[tail++] = next;
    }
  }
  if (leaks || tail < 20) return null;
  type Edge = { a: ImagePoint; b: ImagePoint };
  const edges: Edge[] = [];
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && !!region[y * size + x];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (filled(x, y)) {
    if (!filled(x, y - 1)) edges.push({ a: { x, y }, b: { x: x + 1, y } });
    if (!filled(x + 1, y)) edges.push({ a: { x: x + 1, y }, b: { x: x + 1, y: y + 1 } });
    if (!filled(x, y + 1)) edges.push({ a: { x: x + 1, y: y + 1 }, b: { x, y: y + 1 } });
    if (!filled(x - 1, y)) edges.push({ a: { x, y: y + 1 }, b: { x, y } });
  }
  const byStart = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = `${edge.a.x},${edge.a.y}`; byStart.set(key, [...(byStart.get(key) || []), edge]);
  }
  const loops: ImagePoint[][] = [];
  const remaining = new Set(edges);
  while (remaining.size) {
    let edge = remaining.values().next().value as Edge; const loop = [edge.a];
    remaining.delete(edge); let guard = 0;
    while (guard++ < edges.length + 1) {
      loop.push(edge.b);
      if (edge.b.x === loop[0].x && edge.b.y === loop[0].y) break;
      const next = (byStart.get(`${edge.b.x},${edge.b.y}`) || []).find((candidate) => remaining.has(candidate));
      if (!next) break; edge = next; remaining.delete(edge);
    }
    if (loop.length >= 4) loops.push(loop.slice(0, -1));
  }
  const raster = loops.sort((a, b) => polygonArea(b) - polygonArea(a))[0];
  if (!raster) return null;
  const simplified = simplifyRasterPolygon(raster, 2.2);
  const polygon = simplified.map((point) => ({
    x: search.x0 + point.x / size * width,
    y: search.y0 + point.y / size * height,
  }));
  const box = polygon.reduce((value, point) => ({ x0: Math.min(value.x0, point.x), y0: Math.min(value.y0, point.y),
    x1: Math.max(value.x1, point.x), y1: Math.max(value.y1, point.y) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const areaM2 = polygonArea(polygon) / 1e6, boundingM2 = (box.x1 - box.x0) * (box.y1 - box.y0) / 1e6;
  return { polygon, areaM2, box, rectangular: polygon.length === 4 && areaM2 >= boundingM2 * 0.985 };
}

/** Compare what is visibly drawn in two mirrored candidate bays. */
export function mirroredBaySimilarity(segments: Segment[], left: ImageBay, right: ImageBay, size = 96): number {
  const a = renderBayImage(segments, left, size), b = renderBayImage(segments, right, size);
  const match = (source: Uint8Array, target: Uint8Array, reflected: boolean) => {
    let hits = 0, total = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (source[y * size + x]) {
      total++; const tx = reflected ? size - 1 - x : x; let found = false;
      for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2 && !found; dx++)
        if (y + dy >= 0 && y + dy < size && tx + dx >= 0 && tx + dx < size
          && target[(y + dy) * size + tx + dx]) found = true;
      if (found) hits++;
    }
    return total ? hits / total : 0;
  };
  return Math.min(match(a, b, true), match(b, a, true));
}

/** Raster-union connected slab fragments into one display/quantity outline. */
export function unionVisualPolygons(polygons: ImagePoint[][], step = 25): SegmentedBay | null {
  if (!polygons.length) return null;
  const bounds = polygons.flat().reduce((box, point) => ({ x0: Math.min(box.x0, point.x), y0: Math.min(box.y0, point.y),
    x1: Math.max(box.x1, point.x), y1: Math.max(box.y1, point.y) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const nx = Math.ceil((bounds.x1 - bounds.x0) / step), ny = Math.ceil((bounds.y1 - bounds.y0) / step);
  if (nx <= 0 || ny <= 0 || nx * ny > 8_000_000) return null;
  const inside = (point: ImagePoint, polygon: ImagePoint[]) => {
    let value = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) value = !value;
    }
    return value;
  };
  const cells = new Uint8Array(nx * ny); let count = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const point = { x: bounds.x0 + (x + 0.5) * step, y: bounds.y0 + (y + 0.5) * step };
    if (polygons.some((polygon) => inside(point, polygon))) { cells[y * nx + x] = 1; count++; }
  }
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < nx && y < ny && !!cells[y * nx + x];
  type Edge = { a: ImagePoint; b: ImagePoint };
  const edges: Edge[] = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (filled(x, y)) {
    if (!filled(x, y - 1)) edges.push({ a: { x, y }, b: { x: x + 1, y } });
    if (!filled(x + 1, y)) edges.push({ a: { x: x + 1, y }, b: { x: x + 1, y: y + 1 } });
    if (!filled(x, y + 1)) edges.push({ a: { x: x + 1, y: y + 1 }, b: { x, y: y + 1 } });
    if (!filled(x - 1, y)) edges.push({ a: { x, y: y + 1 }, b: { x, y } });
  }
  const starts = new Map<string, Edge[]>();
  for (const edge of edges) { const key = `${edge.a.x},${edge.a.y}`; starts.set(key, [...(starts.get(key) || []), edge]); }
  const remaining = new Set(edges), loops: ImagePoint[][] = [];
  while (remaining.size) {
    let edge = remaining.values().next().value as Edge; const loop = [edge.a]; remaining.delete(edge);
    for (let guard = 0; guard <= edges.length; guard++) {
      loop.push(edge.b); if (edge.b.x === loop[0].x && edge.b.y === loop[0].y) break;
      const next = (starts.get(`${edge.b.x},${edge.b.y}`) || []).find((candidate) => remaining.has(candidate));
      if (!next) break; edge = next; remaining.delete(edge);
    }
    if (loop.length >= 4) loops.push(loop.slice(0, -1));
  }
  const raster = loops.sort((a, b) => polygonArea(b) - polygonArea(a))[0];
  if (!raster) return null;
  const polygon = simplifyRasterPolygon(raster, 2).map((point) => ({ x: bounds.x0 + point.x * step, y: bounds.y0 + point.y * step }));
  const box = polygon.reduce((value, point) => ({ x0: Math.min(value.x0, point.x), y0: Math.min(value.y0, point.y),
    x1: Math.max(value.x1, point.x), y1: Math.max(value.y1, point.y) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const areaM2 = count * step * step / 1e6, boundingM2 = (box.x1 - box.x0) * (box.y1 - box.y0) / 1e6;
  return { polygon, box, areaM2, rectangular: polygon.length === 4 && areaM2 >= boundingM2 * 0.985 };
}
