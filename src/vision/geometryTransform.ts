import type { Pt } from '../domain/types.js';
import type { RenderTile } from './renderDwg.js';

/** Converts Gemini's 0–1000 tile coordinates back into CAD millimetres. */
export function tilePolygonToCad(polygon: number[][], tile: RenderTile, imageSize = 1800): Pt[] {
  const width = tile.x1 - tile.x0;
  const height = tile.y1 - tile.y0;
  return polygon.map(([x, y]) => ({
    x: tile.x0 + (Number(x) / 1000) * width,
    y: tile.y1 - (Number(y) / 1000) * height,
  })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}
