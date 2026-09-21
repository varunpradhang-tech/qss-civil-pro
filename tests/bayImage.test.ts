import { describe, expect, it } from 'vitest';
import { bayImageShowsFullX, imageShowsFullBayX, mirroredBaySimilarity, renderBayImage, segmentVisualBay, unionVisualPolygons } from '../src/vision/bayImage.js';
import type { Segment } from '../src/domain/types.js';

const bay = { x0: 0, y0: 0, x1: 4000, y1: 3000 };
const stroke = (x0: number, y0: number, x1: number, y1: number): Segment => ({
  a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, layer: '0',
});

describe('raster bay cues', () => {
  it('recognises a full X made of fragmented strokes', () => {
    const strokes = [
      stroke(0, 0, 2000, 1500), stroke(2000, 1500, 4000, 3000),
      stroke(0, 3000, 2000, 1500), stroke(2000, 1500, 4000, 0),
    ];
    expect(bayImageShowsFullX(strokes, bay)).toBe(true);
  });

  it('does not mistake the beam enclosure or a local inset X for a full-bay X', () => {
    const enclosure = [stroke(0, 0, 4000, 0), stroke(4000, 0, 4000, 3000),
      stroke(4000, 3000, 0, 3000), stroke(0, 3000, 0, 0)];
    expect(imageShowsFullBayX(renderBayImage(enclosure, bay))).toBe(false);
    expect(bayImageShowsFullX([...enclosure, stroke(1000, 800, 3000, 2200),
      stroke(1000, 2200, 3000, 800)], bay)).toBe(false);
  });

  it('segments a visibly enclosed notched bay as an exact polygon', () => {
    const outline = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 },
      { x: 2500, y: 3000 }, { x: 2500, y: 2200 }, { x: 0, y: 2200 }];
    const strokes = outline.map((point, index) => stroke(point.x, point.y,
      outline[(index + 1) % outline.length].x, outline[(index + 1) % outline.length].y));
    const region = segmentVisualBay(strokes, { x: 2000, y: 1000 }, { x0: -500, y0: -500, x1: 4500, y1: 3500 });
    expect(region).not.toBeNull();
    expect(region?.rectangular).toBe(false);
    expect(region?.areaM2).toBeCloseTo(10, 0);
  });

  it('recognises reflected structural images and unions connected chajja legs', () => {
    const left = [stroke(0, 0, 4000, 0), stroke(4000, 0, 4000, 3000),
      stroke(4000, 3000, 0, 3000), stroke(0, 3000, 0, 0)];
    const right = left.map((line) => stroke(12000 - line.a.x, line.a.y, 12000 - line.b.x, line.b.y));
    expect(mirroredBaySimilarity([...left, ...right], bay, { x0: 8000, y0: 0, x1: 12000, y1: 3000 }))
      .toBeGreaterThan(0.9);
    const union = unionVisualPolygons([
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 0, y: 1000 }],
      [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 5000 }, { x: 0, y: 5000 }],
    ]);
    expect(union?.rectangular).toBe(false);
    expect(union?.areaM2).toBeCloseTo(8, 1);
  });
});
