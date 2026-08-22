import { describe, expect, it } from 'vitest';
import { buildSlabReferencePdf } from '../src/export/pdf.js';
import { emptyRow } from '../src/takeoff/rules.js';

describe('slab reference PDF', () => {
  it('creates a real PDF containing the matching panel number', async () => {
    const member = { ...emptyRow('m1'), member: 'P1 (S1A)', cadX: 2000, cadY: 1500 };
    const blob = buildSlabReferencePdf([], [member]);
    const text = await blob.text();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(P1) Tj');
    expect(text).toContain('%%EOF');
  });
});
