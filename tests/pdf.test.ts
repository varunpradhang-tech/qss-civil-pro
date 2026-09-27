import { describe, expect, it } from 'vitest';
import { buildSlabReferencePdf } from '../src/export/pdf.js';
import { emptyRow } from '../src/takeoff/rules.js';

describe('slab reference PDF', () => {
  it('creates a real PDF containing the matching panel number', async () => {
    const member = { ...emptyRow('m1'), member: 'P1 (S1A)', cadX: 2000, cadY: 1500, cadX0: 0, cadY0: 0, cadX1: 4000, cadY1: 3000 };
    const blob = buildSlabReferencePdf([], [member]);
    const text = await blob.text();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(P1) Tj');
    expect(text).toContain('%%EOF');
  });


  it('shows only total area for an irregular panel, without side-length labels', async () => {
    const member = { ...emptyRow('m2'), member: 'P2 (CANTILEVER CHAJJA)', cadX: 500, cadY: 500,
      cadX0: 0, cadY0: 0, cadX1: 4000, cadY1: 3000, netArea: 9.5,
      cadPolygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 },
        { x: 1000, y: 1000 }, { x: 1000, y: 3000 }, { x: 0, y: 3000 }] };
    const text = await buildSlabReferencePdf([], [member]).text();
    expect(text).toContain('(9.500 m2) Tj');
    expect(text).not.toContain('(4000) Tj');
    expect(text).not.toContain('(3000) Tj');
  });
});
