import { describe, expect, it } from 'vitest';
import { bayImageShowsFullX, imageShowsFullBayX, renderBayImage } from '../src/vision/bayImage.js';
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
});
