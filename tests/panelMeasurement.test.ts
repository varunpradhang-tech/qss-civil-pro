import { describe, expect, it } from 'vitest';
import type { NormalizedDwg } from '../src/domain/types.js';
import type { PanelProposalBox } from '../src/extract/panels.js';
import { applyPanelMeasurementPriority } from '../src/extract/panelMeasurement.js';

const panel = (x0: number, y0: number, x1: number, y1: number,
  extra: Partial<PanelProposalBox> = {}): PanelProposalBox => ({
  box: { x0, y0, x1, y1 }, lengthMm: x1 - x0, breadthMm: y1 - y0,
  openingM2: 0, thicknessMm: 150, confident: false, duplicate: false, ...extra,
});
const drawing = (dimensions: NormalizedDwg['dimensions']) => ({ dimensions } as NormalizedDwg);

describe('universal per-panel measurement priority', () => {
  it('uses matching dimensions for one panel while leaving an unmarked neighbour geometric', () => {
    const dimensions: NormalizedDwg['dimensions'] = [
      { dir: 'H', measurement: 4200, p1: { x: 0, y: 0 }, p2: { x: 4000, y: 0 }, mid: { x: 2000, y: -200 }, layer: 'DIM' },
      { dir: 'V', measurement: 3200, p1: { x: 0, y: 0 }, p2: { x: 0, y: 3000 }, mid: { x: -200, y: 1500 }, layer: 'DIM' },
    ];
    const [measured, geometric] = applyPanelMeasurementPriority(drawing(dimensions),
      [panel(0, 0, 4000, 3000), panel(7000, 0, 11000, 3000)]);
    expect(measured).toMatchObject({ lengthMm: 4200, breadthMm: 3200,
      dimensionBounded: true, measurementBasis: 'marked dimensions' });
    expect(geometric).toMatchObject({ lengthMm: 4000, breadthMm: 3000,
      measurementBasis: 'drawing geometry' });
  });

  it('keeps an irregular polygon as area-only and never averages its sides', () => {
    const irregular = panel(0, 0, 4000, 3000, { polygon: [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1500 },
      { x: 3000, y: 1500 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 },
    ], netAreaM2: 10.5 });
    const [result] = applyPanelMeasurementPriority(drawing([]), [irregular]);
    expect(result.netAreaM2).toBe(10.5);
    expect(result.measurementBasis).toBe('exact polygon');
  });

  it('calibrates exact irregular area only on axes supported by associated dimensions', () => {
    const dimensions: NormalizedDwg['dimensions'] = [
      { dir: 'H', measurement: 4400, p1: { x: 0, y: 0 }, p2: { x: 4000, y: 0 }, mid: { x: 2000, y: -200 }, layer: 'DIM' },
    ];
    const [result] = applyPanelMeasurementPriority(drawing(dimensions), [panel(0, 0, 4000, 3000,
      { polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }], netAreaM2: 10.5 })]);
    expect(result.netAreaM2).toBeCloseTo(11.55, 3);
    expect(result.breadthMm).toBe(3000);
  });
});
