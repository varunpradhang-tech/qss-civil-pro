import { describe, expect, it } from 'vitest';
import type { NormalizedDwg, Pt } from '../src/domain/types.js';
import type { PanelProposalBox } from '../src/extract/panels.js';
import { reconcileMarkedPanelCorrections } from '../src/extract/markedPanelCorrections.js';

const rectangle = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const drawn = (polygon: Pt[]) => ({ layer: 'A-HATCH', closed: false,
  pts: [...polygon, { x: polygon[0].x + 10, y: polygon[0].y }], lineType: 'Continuous' });
const dwg = (polylines: ReturnType<typeof drawn>[]) => ({ polylines, texts: [] } as unknown as NormalizedDwg);
const panel = (bounds: PanelProposalBox['box'], label = 'UNMARKED SLAB'): PanelProposalBox => ({
  label, box: bounds, lengthMm: bounds.x1 - bounds.x0, breadthMm: bounds.y1 - bounds.y0,
  openingM2: 0, thicknessMm: 150, confident: false, duplicate: false,
});

describe('CAD-marked slab corrections', () => {
  it('does not reinterpret ordinary exactly closed consultant hatch outlines', () => {
    const original = panel({ x0: 0, y0: 0, x1: 3000, y1: 3000 });
    const hatch = { ...drawn(rectangle(0, 0, 3000, 3000)),
      pts: [...rectangle(0, 0, 3000, 3000), { x: 0, y: 0 }] };
    expect(reconcileMarkedPanelCorrections(dwg([hatch]), [original])).toEqual([original]);
  });

  it('replaces split CAD guesses with one irregular outline and fills its missing mirror', () => {
    const irregular: Pt[] = [
      { x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 2500 },
      { x: 4000, y: 2500 }, { x: 4000, y: 4000 }, { x: 1000, y: 4000 },
    ];
    const lines = [drawn(irregular), drawn(rectangle(1000, 5000, 4000, 7000)),
      drawn(rectangle(16000, 5000, 19000, 7000)),
      drawn(rectangle(1000, 8000, 4000, 10000)),
      drawn(rectangle(16000, 8000, 19000, 10000)),
      drawn(rectangle(1000, 11000, 4000, 13000)),
      drawn(rectangle(16000, 11000, 19000, 13000))];
    const existing = [panel({ x0: 1000, y0: 1000, x1: 5000, y1: 2500 }),
      panel({ x0: 1000, y0: 2500, x1: 4000, y1: 4000 })];
    const result = reconcileMarkedPanelCorrections(dwg(lines), existing);
    expect(result.filter((candidate) => candidate.box.y0 === 1000)).toHaveLength(2);
    expect(result.some((candidate) => candidate.box.x0 === 1000 && candidate.netAreaM2 === 10.5)).toBe(true);
    expect(result.some((candidate) => candidate.box.x0 === 15000 && candidate.netAreaM2 === 10.5)).toBe(true);
  });

  it('does not remove interior room slabs just because a perimeter chajja encloses them in its bounding box', () => {
    const perimeter: Pt[] = [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 1000 },
      { x: 1000, y: 1000 }, { x: 1000, y: 36000 }, { x: 0, y: 36000 },
    ];
    const others = Array.from({ length: 6 }, (_, index) =>
      drawn(rectangle(8000 + index * 4000, 2000, 11000 + index * 4000, 4000)));
    const room = panel({ x0: 2000, y0: 5000, x1: 5000, y1: 8000 });
    const result = reconcileMarkedPanelCorrections(dwg([drawn(perimeter), ...others]), [room]);
    expect(result).toContain(room);
    expect(result.some((candidate) => candidate.label === 'CANTILEVER CHAJJA'
      && candidate.netAreaM2 === 41)).toBe(true);
  });
});
