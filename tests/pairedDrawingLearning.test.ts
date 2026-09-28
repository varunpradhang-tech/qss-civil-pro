import { describe, expect, it } from 'vitest';
import type { NormalizedDwg, Pt } from '../src/domain/types.js';
import { extractMembers, selectGeometrySheet } from '../src/extract/extractMembers.js';

const rectangle = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const base = (): NormalizedDwg => ({ fileName: 'plan-unmarked.dwg', units: 4, unitScaleToMm: 1,
  layers: [], entityCountsByType: {},
  segments: [], dimensions: [], texts: [], polylines: [], hatches: [],
  extents: { min: { x: 0, y: 0 }, max: { x: 50_000, y: 30_000 } } });
const marked = (): NormalizedDwg => ({ ...base(), fileName: 'plan-marked.dwg',
  polylines: Array.from({ length: 6 }, (_, index) => ({ layer: 'A-HATCH', closed: false,
    pts: [...rectangle(index * 6000, 0, index * 6000 + 4000, 3000), { x: index * 6000 + 10, y: 0 }],
    lineType: 'Continuous' })),
  dimensions: [
    { dir: 'H', measurement: 4400, p1: { x: 0, y: 0 }, p2: { x: 4000, y: 0 }, mid: { x: 2000, y: -200 }, layer: 'DIM' },
    { dir: 'V', measurement: 3200, p1: { x: 0, y: 0 }, p2: { x: 0, y: 3000 }, mid: { x: -200, y: 1500 }, layer: 'DIM' },
  ] });

describe('paired marked/unmarked drawing learning', () => {
  it('keeps the unmarked copy as geometry source and transfers marked measurements', () => {
    const plain = base(), teacher = marked();
    expect(selectGeometrySheet([teacher, plain], 'slab')).toBe(plain);
    const rows = extractMembers([teacher, plain], 'slab');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ length: 4.4, breadth: 3.2, measurementSource: 'marked dimension' });
    expect(rows.slice(1).every((row) => row.measurementSource === 'drawing geometry')).toBe(true);
  });

  it('does not transfer marks between geometrically different drawings', () => {
    const plain = base(), teacher = marked();
    teacher.extents.max.x = 80_000;
    expect(selectGeometrySheet([plain, teacher], 'slab')).toBe(plain);
    expect(extractMembers([plain, teacher], 'slab')).toHaveLength(0);
  });

  it('pairs a marked copy even when annotations increase its entity count beyond eight percent', () => {
    const plain = base(), teacher = marked();
    plain.segments = Array.from({ length: 100 }, (_, index) => ({
      layer: 'STRUCTURE', a: { x: index * 100, y: 0 }, b: { x: index * 100, y: 10_000 },
    }));
    teacher.segments = [...plain.segments, ...Array.from({ length: 40 }, (_, index) => ({
      layer: 'MARKUP', a: { x: index * 100, y: 20_000 }, b: { x: index * 100 + 50, y: 20_050 },
    }))];
    teacher.texts = Array.from({ length: 40 }, (_, index) => ({ layer: 'DIM', text: `${index}`, pos: { x: index, y: 0 } }));
    expect(selectGeometrySheet([teacher, plain], 'slab')).toBe(plain);
    expect(extractMembers([teacher, plain], 'slab')).toHaveLength(6);
  });
});
