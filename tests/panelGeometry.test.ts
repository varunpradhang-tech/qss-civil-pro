import { describe, expect, it } from 'vitest';
import { irregularPanelPolygon } from '../src/takeoff/panelGeometry.js';
import { emptyRow } from '../src/takeoff/rules.js';

describe('panel geometry at downstream consumers', () => {
  it('repairs a stale near-rectangular saved polygon before rendering', () => {
    const member = { ...emptyRow('p3'), cadX0: 0, cadY0: 0, cadX1: 4450, cadY1: 3100,
      cadPolygon: [{ x: 0, y: 0 }, { x: 4450, y: 0 }, { x: 4450, y: 3100 }, { x: 0, y: 2860 }] };
    expect(irregularPanelPolygon(member)).toBeUndefined();
  });

  it('preserves a genuinely notched slab for exact-area rendering', () => {
    const member = { ...emptyRow('notched'), cadX0: 0, cadY0: 0, cadX1: 5000, cadY1: 5000,
      cadPolygon: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 5000 },
        { x: 1000, y: 5000 }, { x: 1000, y: 3500 }, { x: 0, y: 3500 }] };
    expect(irregularPanelPolygon(member)).toHaveLength(6);
  });
});
