import { describe, expect, it } from 'vitest';
import { extractMembers } from '../src/extract/extractMembers.js';
import type { NormalizedDwg } from '../src/domain/types.js';

const base = (fileName: string): NormalizedDwg => ({
  fileName, units: 4, unitScaleToMm: 1, layers: [], entityCountsByType: {}, segments: [], dimensions: [], texts: [], polylines: [], hatches: [],
  extents: { min: { x: 0, y: 0 }, max: { x: 20000, y: 20000 } },
});

describe('cross-sheet beam extraction', () => {
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
