import type { NormalizedDwg, Pt } from '../domain/types.js';

export type RenderTile = { data: string; mimeType: 'image/png'; x0: number; y0: number; x1: number; y1: number };

function esc(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

function svgFor(dwg: NormalizedDwg, x0: number, y0: number, x1: number, y1: number, px: number): string {
  const sx = px / Math.max(1, x1 - x0), sy = px / Math.max(1, y1 - y0);
  const line = (a: Pt, b: Pt) => `<line x1="${(a.x-x0)*sx}" y1="${(y1-a.y)*sy}" x2="${(b.x-x0)*sx}" y2="${(y1-b.y)*sy}"/>`;
  const text = dwg.texts.filter((t) => t.pos.x >= x0 && t.pos.x <= x1 && t.pos.y >= y0 && t.pos.y <= y1)
    .map((t) => `<text x="${(t.pos.x-x0)*sx}" y="${(y1-t.pos.y)*sy}" font-size="${Math.max(8, 18*sx)}">${esc(t.text)}</text>`).join('');
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
export async function renderDwgTiles(dwg: NormalizedDwg, tileMm = 12000, overlapMm = 1000, pixels = 1800): Promise<RenderTile[]> {
  const { min, max } = dwg.extents; const tiles: RenderTile[] = [];
  for (let y0 = min.y; y0 < max.y; y0 += tileMm - overlapMm) for (let x0 = min.x; x0 < max.x; x0 += tileMm - overlapMm) {
    const x1 = Math.min(max.x, x0 + tileMm), y1 = Math.min(max.y, y0 + tileMm);
    tiles.push({ data: await svgToPng(svgFor(dwg, x0, y0, x1, y1, pixels)), mimeType: 'image/png', x0, y0, x1, y1 });
    if (x1 === max.x) break;
  }
  return tiles;
}
