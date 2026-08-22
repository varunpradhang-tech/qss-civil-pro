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
    ];

    const members = extractMembers([plan, schedule], 'beam');
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.member === 'T3B2')).toMatchObject({ length: 5, breadth: 0.24, height: 0.65, needsReview: false });
    expect(members.find((m) => m.member === 'T3B10')).toMatchObject({ length: 4, breadth: 0.3, height: 0.9, needsReview: false });
  });

  it('does not invent a 300x600 size when no schedule match exists', () => {
    const plan = base('framing.dwg');
    plan.segments = [{ layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } }];
    plan.texts = [{ layer: 'BEAM NO', text: 'T3B1', pos: { x: 2000, y: 100 } }];
    const [member] = extractMembers(plan, 'beam');
    expect(member).toMatchObject({ breadth: 0, height: 0, needsReview: true, reviewReason: 'no beam size found in uploaded plan/schedule' });
  });
});
