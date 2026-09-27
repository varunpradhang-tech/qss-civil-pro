import { describe, expect, it } from 'vitest';
import type { NormalizedDwg, Pt, Segment } from '../src/domain/types.js';
import { assessVisualRepair } from '../src/vision/visualRepair.js';
import { appendVisualSlabMembers } from '../src/vision/visualPanelAdapter.js';
import { emptyRow } from '../src/takeoff/rules.js';
import type { Sheet } from '../src/state/store.js';

const polygon: Pt[] = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
const edge = (a: Pt, b: Pt): Segment => ({ a, b, layer: 'BEAM' });
const drawing = (segments: Segment[], texts: NormalizedDwg['texts'] = []): NormalizedDwg => ({
  fileName: 'unmarked-plan.dwg', units: 4, unitScaleToMm: 1, layers: [], entityCountsByType: {},
  segments, texts, dimensions: [], polylines: [], hatches: [], extents: { min: { x: 0, y: 0 }, max: { x: 4000, y: 3000 } },
});
const sides = polygon.map((a, i) => edge(a, polygon[(i + 1) % polygon.length]));

describe('general visual CAD repair gate', () => {
  it('accepts a beam-bounded slab with a short drafting gap and boundary beam label', () => {
    const broken = [edge({ x: 0, y: 0 }, { x: 1800, y: 0 }),
      edge({ x: 1900, y: 0 }, { x: 4000, y: 0 }), ...sides.slice(1)];
    const dwg = drawing(broken, [{ text: 'B12', pos: { x: 100, y: 1500 }, layer: 'BEAM NUMBER' }]);
    expect(assessVisualRepair(dwg, polygon).accepted).toBe(true);
  });

  it('rejects a whole unsupported edge or a beam number in the slab interior', () => {
    expect(assessVisualRepair(drawing(sides.slice(1)), polygon).accepted).toBe(false);
    expect(assessVisualRepair(drawing(sides, [{ text: 'MB3', pos: { x: 2000, y: 1500 }, layer: 'BEAM NUMBER' }]), polygon).accepted).toBe(false);
  });

  it('repairs one coarse inferred slab, but does not add a nested duplicate', () => {
    const dwg = drawing(sides);
    const row = emptyRow('cad-1', 'L1');
    row.member = 'P1'; row.length = 4; row.breadth = 3;
    row.cadX0 = 0; row.cadY0 = 0; row.cadX1 = 4000; row.cadY1 = 3000;
    const sheet = { id: 'one', name: 'one', dwg, slabDimCount: 0,
      visualPanels: [{ id: 'repair', polygon, areaM2: 12, confidence: 0.95, type: 'rectangle' }] } as Sheet;
    const members = [row];
    expect(appendVisualSlabMembers(members, sheet, 'L1')).toBe(1);
    expect(members).toHaveLength(1);
    expect(row.netArea).toBe(12);
    expect(row.cadPolygon).toEqual(polygon);
  });
});
