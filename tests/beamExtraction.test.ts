import { describe, expect, it } from 'vitest';
import { extractMembers, selectGeometrySheet } from '../src/extract/extractMembers.js';
import type { NormalizedDwg } from '../src/domain/types.js';

const base = (fileName: string): NormalizedDwg => ({
  fileName, units: 4, unitScaleToMm: 1, layers: [], entityCountsByType: {}, segments: [], dimensions: [], texts: [], polylines: [], hatches: [],
  extents: { min: { x: 0, y: 0 }, max: { x: 20000, y: 20000 } },
});

describe('cross-sheet beam extraction', () => {
  it('uses schedules embedded in the same drawing without treating their rows as framing geometry', () => {
    const combined = base('combined-framing-and-schedules.dwg');
    combined.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 3000 }, b: { x: 4000, y: 3000 } },
      { layer: 'RCC WALL', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 } },
      { layer: 'RCC WALL', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 300 }, b: { x: 4000, y: 300 } },
    ];
    combined.texts = [
      { layer: 'TITLE', text: 'FRAMING PLAN AT FIFTH FLOOR LEVEL', pos: { x: 0, y: 5000 } },
      { layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 20000, y: 20000 } },
      { layer: 'TEXT', text: 'S1', pos: { x: 20000, y: 18000 } },
      { layer: 'TEXT', text: '150', pos: { x: 21500, y: 18000 } },
      { layer: 'TEXT', text: 'BEAM SCHEDULE', pos: { x: 40000, y: 20000 } },
      { layer: 'BEAM NO', text: 'B1', pos: { x: 2000, y: 150 } },
      { layer: 'TEXT', text: 'B1', pos: { x: 40000, y: 18000 } },
      { layer: 'TEXT', text: '300X600', pos: { x: 42000, y: 18000 } },
    ];

    expect(extractMembers(combined, 'slab')).toMatchObject([
      { member: 'P1 (S1)', length: 4, breadth: 3, height: 0.15, needsReview: false },
    ]);
    expect(extractMembers(combined, 'beam')).toContainEqual(expect.objectContaining({
      member: 'B1', breadth: 0.3, height: 0.6,
    }));
  });

  it('uses a framing plan for slab geometry and keeps a slab schedule as reference only', () => {
    const plan = base('FIFTH FLOOR FRAMING PLAN.dwg');
    plan.texts = [{ layer: 'TITLE', text: 'FRAMING PLAN AT FIFTH FLOOR LEVEL', pos: { x: 0, y: 0 } }];
    const schedule = base('slab schedule.dwg');
    schedule.texts = Array.from({ length: 50 }, (_, i) => ({
      layer: 'SLABS NO', text: `S${i + 1}`, pos: { x: i * 100, y: 0 },
    }));
    schedule.texts.push({ layer: 'TITLE', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 1000 } });
    schedule.segments = Array.from({ length: 200 }, (_, i) => ({
      layer: 'BEAM-TABLE', a: { x: i, y: 0 }, b: { x: i, y: 1000 },
    }));

    expect(selectGeometrySheet([schedule, plan], 'slab').fileName).toBe(plan.fileName);
  });

  it('keeps every beam label and reads its size from a separate schedule drawing', () => {
    const plan = base('framing.dwg');
    plan.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 300 }, b: { x: 4000, y: 300 } },
      { layer: 'BEAM', a: { x: 4500, y: 0 }, b: { x: 9500, y: 0 } },
      { layer: 'BEAM', a: { x: 4500, y: 240 }, b: { x: 9500, y: 240 } },
    ];
    plan.texts = [
      { layer: 'BEAM NO', text: 'T3B10', pos: { x: 2000, y: 150 } },
      { layer: 'BEAM NO', text: 'T3B2', pos: { x: 7000, y: 120 } },
    ];
    const schedule = base('beam-schedule.dwg');
    schedule.texts = [
      { layer: 'TABLE-TEXT', text: 'T3B2', pos: { x: 1000, y: 2000 } },
      { layer: 'TABLE-TEXT', text: '240', pos: { x: 2760, y: 2000 } },
      { layer: 'TABLE-TEXT', text: '650', pos: { x: 3930, y: 2000 } },
      { layer: 'TABLE-TEXT', text: 'T3B10', pos: { x: 1000, y: 1000 } },
      { layer: 'TABLE-TEXT', text: '300', pos: { x: 2760, y: 1000 } },
      { layer: 'TABLE-TEXT', text: '900', pos: { x: 3930, y: 1000 } },
      { layer: 'TABLE-TEXT', text: 'S1A', pos: { x: 1000, y: 500 } },
      { layer: 'TABLE-TEXT', text: '150', pos: { x: 1800, y: 500 } },
      { layer: 'TABLE-TEXT', text: 'S6', pos: { x: 1000, y: 300 } },
      { layer: 'TABLE-TEXT', text: '200', pos: { x: 1800, y: 300 } },
    ];
    plan.texts.push(
      { layer: 'SLAB NO', text: 'S1A', pos: { x: 2000, y: 1500 } },
      { layer: 'SLAB NO', text: 'S6', pos: { x: 2000, y: -1500 } },
    );

    const members = extractMembers([plan, schedule], 'beam');
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.member === 'T3B2')).toMatchObject({ length: 5, breadth: 0.24, height: 0.65, needsReview: false });
    expect(members.find((m) => m.member === 'T3B10')).toMatchObject({ length: 4, breadth: 0.3, height: 0.9, slabCodeSide1: 'S1A', slabThicknessSide1: 0.15, slabCodeSide2: 'S6', slabThicknessSide2: 0.2, needsReview: false });
  });

  it('does not invent a 300x600 size when no schedule match exists', () => {
    const plan = base('framing.dwg');
    plan.segments = [{ layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } }];
    plan.texts = [{ layer: 'BEAM NO', text: 'T3B1', pos: { x: 2000, y: 100 } }];
    const [member] = extractMembers(plan, 'beam');
    expect(member).toMatchObject({ breadth: 0, height: 0, needsReview: true, reviewReason: 'no beam size found in uploaded plan/schedule' });
  });

  it('reads nearby sizes and beam marks from generic CAD text layers', () => {
    const plan = base('generic-layers.dwg');
    plan.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 5000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 300 }, b: { x: 5000, y: 300 } },
    ];
    plan.texts = [
      { layer: 'TEXT', text: 'B5', pos: { x: 2200, y: 100 } },
      { layer: 'TEXT', text: '(300×600)', pos: { x: 2750, y: 100 } },
    ];
    const [member] = extractMembers(plan, 'beam');
    expect(member).toMatchObject({ member: 'B5', length: 5, breadth: 0.3, height: 0.6 });
  });

  it('uses a drawing U.N.O. beam size only when no specific size is associated', () => {
    const plan = base('uno.dwg');
    plan.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 300 }, b: { x: 4000, y: 300 } },
    ];
    plan.texts = [
      { layer: 'TEXT', text: 'B1', pos: { x: 2000, y: 100 } },
      { layer: 'TEXT', text: '11. ALL BEAM SIZE SHALL BE 300X500 (U.N.O.).', pos: { x: 18000, y: 18000 } },
    ];
    const [member] = extractMembers(plan, 'beam');
    expect(member).toMatchObject({ member: 'B1', breadth: 0.3, height: 0.5, needsReview: false });
  });

  it('never creates beam quantities from sections or details embedded beside the framing plan', () => {
    const drawing = base('framing-plan-with-details.dwg');
    drawing.extents.max = { x: 100_000, y: 60_000 };
    drawing.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 9800, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 600 }, b: { x: 9800, y: 600 } },
      { layer: 'BEAM', a: { x: 20_000, y: 0 }, b: { x: 29_800, y: 0 } },
      { layer: 'BEAM', a: { x: 20_000, y: 600 }, b: { x: 29_800, y: 600 } },
      ...Array.from({ length: 21 }, (_, index) => ({
        layer: 'BEAM', a: { x: 60_000, y: index * 1500 }, b: { x: 64_000 + index * 50, y: index * 1500 },
      })),
    ];
    drawing.texts = [
      { layer: 'TITLE', text: 'TYPICAL FRAMING PLAN', pos: { x: 15_000, y: 20_000 } },
      { layer: 'SLAB NO', text: 'S1', pos: { x: 3000, y: 4000 } },
      { layer: 'SLAB NO', text: 'S2', pos: { x: 9000, y: 4000 } },
      { layer: 'SLAB NO', text: 'S3', pos: { x: 15_000, y: 4000 } },
      { layer: 'SLAB NO', text: 'S4', pos: { x: 21_000, y: 4000 } },
      { layer: 'BEAM NO', text: 'B1', pos: { x: 4900, y: 300 } },
      { layer: 'BEAM NO', text: 'B1', pos: { x: 24_900, y: 300 } },
      { layer: 'TEXT', text: '600X800', pos: { x: 5500, y: 300 } },
      { layer: 'TITLE', text: 'BEAM DETAILS AND SECTIONS', pos: { x: 60_000, y: 35_000 } },
      ...Array.from({ length: 21 }, (_, index) => ({ layer: 'BEAM NO', text: 'B1', pos: { x: 62_000, y: index * 1500 } })),
    ];
    drawing.dimensions = [
      { layer: 'DIM', measurement: 9800, dir: 'H', p1: { x: 0, y: 900 }, p2: { x: 9800, y: 900 }, mid: { x: 4900, y: 900 } },
      { layer: 'DIM', measurement: 9800, dir: 'H', p1: { x: 20_000, y: 900 }, p2: { x: 29_800, y: 900 }, mid: { x: 24_900, y: 900 } },
    ];

    expect(extractMembers(drawing, 'beam')).toEqual([
      expect.objectContaining({ member: 'B1', length: 9.8, nos: 2, breadth: 0.6, height: 0.8 }),
    ]);
  });

  it('uses a detail dimension as reference without creating another beam', () => {
    const drawing = base('combined-plan-and-details.dwg');
    drawing.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4950, y: 0 } },
      { layer: 'BEAM', a: { x: 20_000, y: 0 }, b: { x: 24_950, y: 0 } },
    ];
    drawing.texts = [
      { layer: 'BEAM NO', text: 'B2', pos: { x: 2000, y: 100 } },
      { layer: 'BEAM NO', text: 'B2', pos: { x: 22_000, y: 100 } },
      { layer: 'TEXT', text: 'B2', pos: { x: 61_500, y: 1000 } },
      { layer: 'TEXT', text: '240X450', pos: { x: 63_000, y: 1000 } },
    ];
    drawing.dimensions = [{ layer: 'DIM', measurement: 4450, dir: 'H',
      p1: { x: 60_000, y: 2000 }, p2: { x: 64_450, y: 2000 }, mid: { x: 62_225, y: 2000 } }];
    expect(extractMembers(drawing, 'beam')).toEqual([
      expect.objectContaining({ member: 'B2', length: 4.45, nos: 2, breadth: 0.24, height: 0.45 }),
    ]);
  });

  it('reads the consultant note wording FOR BEAM SIZE SHALL BE 300X550 U.N.O.', () => {
    const plan = base('uno-consultant-wording.dwg');
    plan.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 300 }, b: { x: 4000, y: 300 } },
    ];
    plan.texts = [
      { layer: 'TEXT', text: 'B1', pos: { x: 2000, y: 100 } },
      { layer: 'NOTES', text: '10. FOR BEAM SIZE SHALL BE (300X550) U.N.O.', pos: { x: 18000, y: 18000 } },
    ];
    const [member] = extractMembers(plan, 'beam');
    expect(member).toMatchObject({ member: 'B1', breadth: 0.3, height: 0.55, needsReview: false });
  });

  it('uses a clearly associated marked CAD dimension instead of a distant beam face', () => {
    const plan = base('framing.dwg');
    plan.segments = [{ layer: 'BEAM', a: { x: 5000, y: 0 }, b: { x: 7170, y: 0 } }];
    plan.texts = [{ layer: 'BEAM NO', text: 'T3B1', pos: { x: 1000, y: 100 } }];
    plan.dimensions = [{ layer: 'SLABS NO T2', measurement: 3976.4, dir: 'H', mid: { x: 1100, y: 300 }, p1: { x: 0, y: 300 }, p2: { x: 3976.4, y: 300 } }];
    const [member] = extractMembers(plan, 'beam');
    expect(member.length).toBe(3.976);
  });

  it('keeps the nearby beam-face length when a less-related dimension is farther away', () => {
    const plan = base('framing.dwg');
    plan.segments = [{ layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 2170, y: 0 } }];
    plan.texts = [{ layer: 'BEAM NO', text: 'T3MB2', pos: { x: 1000, y: 90 } }];
    plan.dimensions = [{ layer: 'SLABS NO T2', measurement: 2324.8, dir: 'H', mid: { x: 1500, y: 500 }, p1: { x: 0, y: 500 }, p2: { x: 2324.8, y: 500 } }];
    const [member] = extractMembers(plan, 'beam');
    expect(member.length).toBe(2.17);
  });

  it('rejects a nearby dimension whose span does not contain the beam label and uses geometry', () => {
    const plan = base('framing.dwg');
    plan.segments = [{ layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 3975, y: 0 } }];
    plan.texts = [{ layer: 'BEAM NO', text: 'T3B1', pos: { x: 2000, y: 80 } }];
    plan.dimensions = [{ layer: 'SLAB DIM', measurement: 2790, dir: 'H', mid: { x: 5000, y: 200 }, p1: { x: 3605, y: 200 }, p2: { x: 6395, y: 200 } }];
    const [member] = extractMembers(plan, 'beam');
    expect(member.length).toBe(3.975);
  });
});
