import { describe, expect, it } from 'vitest';
import { autoProposePanels } from '../src/extract/panels.js';
import { extractMembers } from '../src/extract/extractMembers.js';
import type { NormalizedDwg } from '../src/domain/types.js';

const drawing = (): NormalizedDwg => ({
  fileName: 'unmarked-framing-plan.dwg', units: 4, unitScaleToMm: 1,
  layers: [], entityCountsByType: {}, dimensions: [], polylines: [], hatches: [],
  extents: { min: { x: 0, y: 0 }, max: { x: 4000, y: 3000 } },
  segments: [
    { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
    { layer: 'RCC WALL', a: { x: 0, y: 3000 }, b: { x: 4000, y: 3000 } },
    { layer: 'COLUMN', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 } },
    { layer: 'RCC WALL', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
  ],
  texts: [{ layer: 'SLABS NO T2', text: 'S1A', pos: { x: 2000, y: 1500 } }],
});

describe('unmarked slab geometry', () => {
  it('measures a panel enclosed by mixed RCC member types without dimensions', () => {
    const [panel] = autoProposePanels(drawing());
    expect(panel).toMatchObject({ label: 'S1A', lengthMm: 4000, breadthMm: 3000, confident: true });
    const [member] = extractMembers(drawing(), 'slab');
    expect(member).toMatchObject({ length: 4, breadth: 3, needsReview: false });
  });

  it('selects the sheet with slab labels and RCC geometry instead of a dimension-heavy schedule', () => {
    const schedule = { ...drawing(), fileName: 'schedule.dwg', segments: [], texts: [], dimensions: Array.from({ length: 20 }, (_, i) => ({ layer: 'TABLE', measurement: 1000, dir: 'H' as const, mid: { x: i, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 } })) };
    expect(extractMembers([schedule, drawing()], 'slab')).toHaveLength(1);
  });

  it('accepts a slab code on a numeric consultant layer when enclosed by RCC geometry', () => {
    const numericLayer = { ...drawing(), texts: [{ layer: '4', text: 'S1', pos: { x: 2000, y: 1500 } }] };
    expect(autoProposePanels(numericLayer)).toMatchObject([{ label: 'S1', lengthMm: 4000, breadthMm: 3000 }]);
    expect(extractMembers(numericLayer, 'slab')).toHaveLength(1);
  });

  it('excludes a panel containing a HOLD or HOLD AREA note', () => {
    const held = { ...drawing(), texts: [...drawing().texts, { layer: 'NOTES', text: 'HOLD AREA', pos: { x: 2500, y: 1800 } }] };
    expect(autoProposePanels(held)).toHaveLength(0);
    expect(extractMembers(held, 'slab')).toHaveLength(0);
  });
});
