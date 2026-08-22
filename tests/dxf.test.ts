import { describe, expect, it } from 'vitest';
import { buildSlabReferenceDxf } from '../src/export/dxf.js';
import { emptyRow } from '../src/takeoff/rules.js';
import type { NormalizedDwg } from '../src/domain/types.js';

describe('slab reference DXF', () => {
  it('writes the Excel panel number at its source drawing coordinate', () => {
    const dwg: NormalizedDwg = { fileName: 'plan.dwg', units: 4, unitScaleToMm: 1, layers: [], entityCountsByType: {}, segments: [], dimensions: [], polylines: [], hatches: [], texts: [{ layer: 'SLAB NO', text: 'S1A', pos: { x: 2000, y: 1500 } }], extents: { min: { x: 0, y: 0 }, max: { x: 4000, y: 3000 } } };
    const member = { ...emptyRow('m1'), member: 'P1 (S1A)', cadX: 2000, cadY: 1500 };
    const dxf = buildSlabReferenceDxf([dwg], [member]);
    expect(dxf).toContain('QSS_PANEL_MARK');
    expect(dxf).toContain('1\r\nP1\r\n');
    expect(dxf).toContain('10\r\n2000\r\n20\r\n1500\r\n');
  });
});
