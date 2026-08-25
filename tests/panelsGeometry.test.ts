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

  it('reads slab thickness by slab mark from a separately drawn schedule', () => {
    const schedule = { ...drawing(), fileName: 'schedule.dwg', segments: [], dimensions: [], texts: [
      { layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } },
      { layer: 'BRAM NO.', text: 'S1A', pos: { x: 1000, y: 3000 } },
      { layer: 'BRAM NO.', text: '150', pos: { x: 2000, y: 3000 } },
    ] };
    const [member] = extractMembers([drawing(), schedule], 'slab');
    expect(member).toMatchObject({ height: 0.15, slabThickness: 0.15, needsReview: false });
  });

  it('uses the UNO general-note thickness only when the slab mark has no schedule row', () => {
    const notes = { ...drawing(), fileName: 'general-notes.dwg', segments: [], texts: [
      { layer: 'NOTES', text: 'ALL SLAB THICKNESS SHALL BE 160 mm THK. (U.N.O.)', pos: { x: 0, y: 0 } },
    ] };
    const [member] = extractMembers([drawing(), notes], 'slab');
    expect(member).toMatchObject({ height: 0.16, slabThickness: 0.16, needsReview: false });
  });

  it('prefers a slab schedule row over the UNO general-note default', () => {
    const references = { ...drawing(), fileName: 'references.dwg', segments: [], texts: [
      { layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } },
      { layer: 'BRAM NO.', text: 'S1A', pos: { x: 1000, y: 3000 } },
      { layer: 'BRAM NO.', text: '150', pos: { x: 2000, y: 3000 } },
      { layer: 'NOTES', text: 'ALL SLAB THICKNESS SHALL BE 175 mm THK. (U.N.O.)', pos: { x: 0, y: -5000 } },
    ] };
    expect(extractMembers([drawing(), references], 'slab')[0].height).toBe(0.15);
  });

  it('accepts a slab code on a numeric consultant layer when enclosed by RCC geometry', () => {
    const numericLayer = { ...drawing(), texts: [{ layer: '4', text: 'S1', pos: { x: 2000, y: 1500 } }] };
    expect(autoProposePanels(numericLayer)).toMatchObject([{ label: 'S1', lengthMm: 4000, breadthMm: 3000 }]);
    expect(extractMembers(numericLayer, 'slab')).toHaveLength(1);
  });

  it('rejects an impossible panel span instead of producing an extreme quantity', () => {
    const huge = drawing();
    huge.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 100000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 100000 }, b: { x: 100000, y: 100000 } },
      { layer: 'WALL', a: { x: 0, y: 0 }, b: { x: 0, y: 100000 } },
      { layer: 'WALL', a: { x: 100000, y: 0 }, b: { x: 100000, y: 100000 } },
    ];
    huge.texts = [{ layer: '4', text: 'S1', pos: { x: 50000, y: 50000 } }];
    expect(autoProposePanels(huge)).toHaveLength(0);
  });

  it('excludes a panel containing a HOLD or HOLD AREA note', () => {
    const held = { ...drawing(), texts: [...drawing().texts, { layer: 'NOTES', text: 'HOLD AREA', pos: { x: 2500, y: 1800 } }] };
    expect(autoProposePanels(held)).toHaveLength(0);
    expect(extractMembers(held, 'slab')).toHaveLength(0);
  });

  it('excludes S rows below a slab reinforcement schedule title', () => {
    const schedule = drawing();
    schedule.texts = [{ layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } }, { layer: 'BRAM NO.', text: 'S1', pos: { x: 2000, y: 1500 } }];
    expect(autoProposePanels(schedule)).toHaveLength(0);
  });

  it('excludes S marks in consultant section details', () => {
    const section = drawing();
    section.texts = [{ layer: 'TEXT', text: 'SECTION:-10-10', pos: { x: 2000, y: -500 } }, { layer: '4', text: 'S1', pos: { x: 2000, y: 1500 } }];
    expect(autoProposePanels(section)).toHaveLength(0);
  });

  it('adds a closed cantilever without changing normal S-panel boundaries', () => {
    const cantilever = drawing();
    cantilever.texts = [];
    cantilever.segments = [
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } },
      { layer: 'BEAM', lineType: 'DASHED', a: { x: 0, y: 1500 }, b: { x: 6000, y: 1500 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: 1500 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 6000, y: 0 }, b: { x: 6000, y: 1500 } },
    ];
    expect(autoProposePanels(cantilever)).toMatchObject([{ label: 'CANTILEVER', lengthMm: 6000, breadthMm: 1500 }]);
  });
});
