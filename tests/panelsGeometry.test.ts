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

  it('measures an enclosed slab-code strip with TOS evidence on nonstandard beam layers', () => {
    const strip = drawing();
    strip.segments = [
      { layer: '17', a: { x: 0, y: 0 }, b: { x: 9000, y: 0 } },
      { layer: '17', a: { x: 0, y: 1200 }, b: { x: 9000, y: 1200 } },
      { layer: '5', a: { x: 0, y: 0 }, b: { x: 0, y: 1200 } },
      { layer: '5', a: { x: 9000, y: 0 }, b: { x: 9000, y: 1200 } },
    ];
    strip.texts = [
      { layer: '4', text: 'S6', pos: { x: 4500, y: 600 } },
      { layer: 'LEVEL', text: 'T.O.S.+2000 LVL.', pos: { x: 3500, y: 650 } },
    ];
    expect(autoProposePanels(strip)).toMatchObject([{ label: 'S6', lengthMm: 9000, breadthMm: 1200 }]);
  });

  it('measures an enclosed cantilever balcony beside a dashed beam edge', () => {
    const balcony = drawing();
    balcony.segments = [
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 2500, y: 0 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 6000 }, b: { x: 2500, y: 6000 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: 6000 } },
      { layer: 'BEAM', lineType: 'DASHED', a: { x: 2500, y: 0 }, b: { x: 2500, y: 6000 } },
    ];
    balcony.texts = [{ layer: 'NOTE', text: 'C', pos: { x: 1200, y: 3000 } }];
    expect(autoProposePanels(balcony)).toMatchObject([{ label: 'BALCONY', lengthMm: 2500, breadthMm: 6000 }]);
  });

  it('uses true polygon area for a triangular slab with one dashed and two continuous edges', () => {
    const triangle = drawing();
    triangle.segments = [
      { layer: 'BEAM', lineType: 'DASHED', a: { x: 0, y: 0 }, b: { x: 0, y: 4000 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 3000, y: 2000 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 4000 }, b: { x: 3000, y: 2000 } },
    ];
    triangle.texts = [];
    const [panel] = autoProposePanels(triangle);
    expect(panel).toMatchObject({ label: 'BALCONY-TRI', grossAreaM2: 6 });
    const [member] = extractMembers(triangle, 'slab');
    expect(member.netArea).toBe(6);
  });

  it('prefers a tight TOS strip enclosure over distant named structural boundaries', () => {
    const strip = drawing();
    strip.segments = [
      { layer: 'BEAM', a: { x: -20000, y: -10000 }, b: { x: 20000, y: -10000 } },
      { layer: 'BEAM', a: { x: -20000, y: 10000 }, b: { x: 20000, y: 10000 } },
      { layer: 'WALL', a: { x: -20000, y: -10000 }, b: { x: -20000, y: 10000 } },
      { layer: 'WALL', a: { x: 20000, y: -10000 }, b: { x: 20000, y: 10000 } },
      { layer: '17', lineType: 'DASHED', a: { x: 0, y: 0 }, b: { x: 9000, y: 0 } },
      { layer: '17', lineType: 'DASHED', a: { x: 0, y: 1200 }, b: { x: 9000, y: 1200 } },
      { layer: 'EDGE', a: { x: 0, y: 0 }, b: { x: 0, y: 1200 } },
      { layer: 'EDGE', a: { x: 9000, y: 0 }, b: { x: 9000, y: 1200 } },
    ];
    strip.texts = [{ layer: '4', text: 'S6', pos: { x: 4500, y: 600 } }, { layer: 'LEVEL', text: 'TOS +2000 LVL', pos: { x: 4000, y: 650 } }];
    expect(autoProposePanels(strip)).toMatchObject([{ lengthMm: 9000, breadthMm: 1200 }]);
  });

  it('trims the vertical leg of an L-shaped slab by the overlapping horizontal width', () => {
    const lShape = drawing();
    lShape.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 } },
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 0, y: 6000 } },
      { layer: 'BEAM', a: { x: 1000, y: 0 }, b: { x: 1000, y: 6000 } },
      { layer: 'BEAM', a: { x: 0, y: 6000 }, b: { x: 1000, y: 6000 } },
      { layer: 'BEAM', a: { x: 6000, y: 0 }, b: { x: 6000, y: 1000 } },
    ];
    lShape.texts = [
      { layer: 'SLABS NO', text: 'S1', pos: { x: 3000, y: 500 } },
      { layer: 'SLABS NO', text: 'S1', pos: { x: 500, y: 3000 } },
    ];
    const panels = autoProposePanels(lShape);
    const vertical = panels.find((p) => p.box.x1 - p.box.x0 < p.box.y1 - p.box.y0);
    expect(vertical?.breadthMm).toBe(5000);
  });

  it('never measures geometry belonging to a labelled section detail', () => {
    const section = drawing();
    section.texts = [
      { layer: 'SLABS NO', text: 'S1', pos: { x: 2000, y: 1500 } },
      { layer: 'TITLE', text: 'SECTION-10-10', pos: { x: 2000, y: -500 } },
    ];
    expect(autoProposePanels(section)).toHaveLength(0);
  });

  it('rejects slab beyond a continuous outer beam face and keeps the dashed side', () => {
    const outer = drawing();
    outer.segments.push(
      { layer: 'BEAM', lineType: 'CONTINUOUS', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: 'BEAM', lineType: 'DASHED', a: { x: 3700, y: 0 }, b: { x: 3700, y: 3000 } },
    );
    outer.texts = [{ layer: 'NOTE', text: 'C', pos: { x: 2000, y: 1500 } }];
    expect(autoProposePanels(outer)).toHaveLength(1);
    outer.texts = [{ layer: 'NOTE', text: 'C', pos: { x: 5000, y: 1500 } }];
    expect(autoProposePanels(outer)).toHaveLength(0);
  });

  it('detects a corridor with repeated slab codes enclosed on nonstandard layers', () => {
    const corridor = drawing();
    corridor.segments = [
      { layer: '17', a: { x: 0, y: 0 }, b: { x: 12000, y: 0 } },
      { layer: '17', a: { x: 0, y: 1800 }, b: { x: 12000, y: 1800 } },
      { layer: '5', a: { x: 0, y: 0 }, b: { x: 0, y: 1800 } },
      { layer: '5', a: { x: 4000, y: 0 }, b: { x: 4000, y: 1800 } },
      { layer: '5', a: { x: 8000, y: 0 }, b: { x: 8000, y: 1800 } },
      { layer: '5', a: { x: 12000, y: 0 }, b: { x: 12000, y: 1800 } },
    ];
    corridor.texts = [
      { layer: '4', text: 'S1', pos: { x: 2000, y: 900 } },
      { layer: '4', text: 'S2', pos: { x: 6000, y: 900 } },
      { layer: '4', text: 'S3', pos: { x: 10000, y: 900 } },
    ];
    expect(autoProposePanels(corridor)).toHaveLength(3);
  });

  it('excludes slab-code rows located under a slab reinforcement schedule title', () => {
    const schedule = drawing();
    schedule.texts = [
      { layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } },
      { layer: 'BRAM NO.', text: 'S1', pos: { x: 2000, y: 1500 } },
    ];
    expect(autoProposePanels(schedule)).toHaveLength(0);
  });

  it('recognizes consultant section titles written as SECTION:-10-10', () => {
    const section = drawing();
    section.texts = [
      { layer: 'TEXT 2', text: 'SECTION:-10-10', pos: { x: 2000, y: -500 } },
      { layer: '4', text: 'S1', pos: { x: 2000, y: 1500 } },
    ];
    expect(autoProposePanels(section)).toHaveLength(0);
  });

  it('detects a closed cantilever strip from dashed inner and continuous outer edges without a label', () => {
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
