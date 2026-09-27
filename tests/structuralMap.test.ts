import { describe, expect, it } from 'vitest';
import type { NormalizedDwg, Segment } from '../src/domain/types.js';
import { buildStructuralBayQuestions } from '../src/vision/structuralMap.js';

const line = (x0: number, y0: number, x1: number, y1: number, layer = 'BEAM'): Segment => ({
  a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, layer,
});
const drawing = (segments: Segment[], texts: NormalizedDwg['texts'] = []) => ({
  segments, texts, polylines: [], dimensions: [], hatches: [], layers: [],
  entityCountsByType: {}, fileName: 'framing.dwg', units: 4, unitScaleToMm: 1,
  extents: { min: { x: 0, y: 0 }, max: { x: 5000, y: 5000 } },
}) as NormalizedDwg;

describe('working structural map', () => {
  const box = { x0: -500, y0: -500, x1: 4500, y1: 4500 };
  const broken = [line(0, 0, 4000, 0), line(4000, 0, 4000, 4000),
    line(4000, 4000, 2200, 4000), line(2050, 4000, 0, 4000), line(0, 4000, 0, 0)];

  it('records a short collinear repair as an alternative without editing the drawing', () => {
    const dwg = drawing(broken);
    const before = JSON.stringify(dwg);
    const question = buildStructuralBayQuestions(dwg, [], [box])[0];
    expect(question.alternatives.some((candidate) => candidate.repairedGaps === 1
      && candidate.gapMm === 150)).toBe(true);
    expect(JSON.stringify(dwg)).toBe(before);
  });

  it('rejects a bay containing a beam number', () => {
    const dwg = drawing(broken, [{ text: 'B28', pos: { x: 2000, y: 2000 }, layer: 'BEAM NO' }]);
    expect(buildStructuralBayQuestions(dwg, [], [box])[0].alternatives).toHaveLength(0);
  });

  it('does not close an unsupported large opening', () => {
    const wide = [...broken.slice(0, 2), line(4000, 4000, 2600, 4000),
      line(1400, 4000, 0, 4000), broken[4]];
    expect(buildStructuralBayQuestions(drawing(wide), [], [box])[0].alternatives).toHaveLength(0);
  });
});
