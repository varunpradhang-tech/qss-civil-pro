import { describe, expect, it } from 'vitest';
import { polygoniseCadFaces } from '../src/extract/topology.js';

describe('connected CAD topology', () => {
  it('returns actual rectangle and triangle faces without inventing a diagonal split', () => {
    const segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: 'BEAM', a: { x: 4000, y: 3000 }, b: { x: 0, y: 3000 } },
      { layer: 'BEAM', a: { x: 0, y: 3000 }, b: { x: 0, y: 0 } },
      { layer: 'BEAM', a: { x: 5000, y: 0 }, b: { x: 8000, y: 0 } },
      { layer: 'BEAM', a: { x: 8000, y: 0 }, b: { x: 5000, y: 3000 } },
      { layer: 'BEAM', a: { x: 5000, y: 3000 }, b: { x: 5000, y: 0 } },
    ];
    const faces = polygoniseCadFaces(segments);
    expect(faces.map((face) => face.areaM2).sort((a, b) => a - b)).toEqual([4.5, 12]);
  });
});
