import type { NormalizedDwg, Pt } from '../domain/types.js';

export type RenderTile = { data: string; mimeType: 'image/png'; x0: number; y0: number; x1: number; y1: number };
export type PlanBounds = { x0: number; y0: number; x1: number; y1: number };

export function framingPlanTileBounds(dwg: NormalizedDwg, tileMm = 18000, overlapMm = 2000): PlanBounds[] {
  const bounds = framingPlanBounds(dwg);
  if (overlapMm >= tileMm) throw new Error('Tile overlap must be smaller than tile size');
  const tiles: PlanBounds[] = [];
  for (let y0 = bounds.y0; y0 < bounds.y1; y0 += tileMm - overlapMm) {
    for (let x0 = bounds.x0; x0 < bounds.x1; x0 += tileMm - overlapMm) {
      const x1 = Math.min(bounds.x1, x0 + tileMm), y1 = Math.min(bounds.y1, y0 + tileMm);
      tiles.push({ x0, y0, x1, y1 });
      if (x1 === bounds.x1) break;
    }
    if (Math.min(bounds.y1, y0 + tileMm) === bounds.y1) break;
  }
  return tiles;
}

/** Limit visual review to the slab plan when a sheet also contains details and sections. */
export function framingPlanBounds(dwg: NormalizedDwg): PlanBounds {
  const slabMarks = dwg.texts.filter((t) => /slab\s*(?:thk|thickness|depth)/i.test(t.layer)
    && /^(?:\d{2,3})(?:\s*mm)?$/i.test(t.text.trim()));
  if (slabMarks.length >= 4) {
    const xs = slabMarks.map((t) => t.pos.x), ys = slabMarks.map((t) => t.pos.y);
    const x0 = Math.min(...xs) - 5000, x1 = Math.max(...xs) + 5000;
    const y0 = Math.min(...ys) - 5000, y1 = Math.max(...ys) + 5000;
    // A title block or schedule may contain isolated thickness marks. Refuse
    // ambiguous sheet-wide crops instead of sending beam details as slab bays.
    if (x1 - x0 <= 80000 && y1 - y0 <= 80000) return { x0, y0, x1, y1 };
  }
  const { min, max } = dwg.extents;
  if (max.x - min.x <= 80000 && max.y - min.y <= 80000)
    return { x0: min.x, y0: min.y, x1: max.x, y1: max.y };
  throw new Error('Framing plan region could not be isolated from the drawing details');
}

function esc(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

function svgFor(dwg: NormalizedDwg, x0: number, y0: number, x1: number, y1: number, px: number): string {
  const sx = px / Math.max(1, x1 - x0), sy = px / Math.max(1, y1 - y0);
  const line = (a: Pt, b: Pt) => `<line x1="${(a.x-x0)*sx}" y1="${(y1-a.y)*sy}" x2="${(b.x-x0)*sx}" y2="${(y1-b.y)*sy}"/>`;
  const text = dwg.texts.filter((t) => t.pos.x >= x0 && t.pos.x <= x1 && t.pos.y >= y0 && t.pos.y <= y1)
    .map((t) => `<text x="${(t.pos.x-x0)*sx}" y="${(y1-t.pos.y)*sy}" font-size="16">${esc(t.text)}</text>`).join('');
  const lines = dwg.segments.filter((s) => Math.max(s.a.x,s.b.x)>=x0 && Math.min(s.a.x,s.b.x)<=x1 && Math.max(s.a.y,s.b.y)>=y0 && Math.min(s.a.y,s.b.y)<=y1).map((s) => line(s.a,s.b)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke="#333" stroke-width="${Math.max(1, 1.5*sx)}">${lines}</g><g fill="#111" font-family="Arial">${text}</g></svg>`;
}

async function svgToPng(svg: string): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}

/** Render overlapping, high-resolution plan tiles for visual review. */
export async function renderDwgTile(dwg: NormalizedDwg, bounds: PlanBounds, pixels = 2200): Promise<RenderTile> {
  return { ...bounds, data: await svgToPng(svgFor(dwg, bounds.x0, bounds.y0, bounds.x1, bounds.y1, pixels)), mimeType: 'image/png' };
}

export async function renderDwgTiles(dwg: NormalizedDwg, tileMm = 18000, overlapMm = 2000, pixels = 2200): Promise<RenderTile[]> {
  const tiles: RenderTile[] = [];
  for (const bounds of framingPlanTileBounds(dwg, tileMm, overlapMm)) tiles.push(await renderDwgTile(dwg, bounds, pixels));
  return tiles;
}
