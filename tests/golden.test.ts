// Golden accuracy tests — lock the known-good slab total and protect the rules that produce it.
// Runs the real parser + auto engine headless (libredwg WASM in Node). Slower than unit tests.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDwg } from '../src/parsing/parse.js';
import { autoProposePanels } from '../src/extract/panels.js';
import { extractMembers } from '../src/extract/extractMembers.js';
import { RULES } from '../src/takeoff/rules.js';

// A panel needs review if it was auto-proposed with low confidence or flagged as a duplicate.
const panelReviewReasons = (p: { confident: boolean; duplicate: boolean; openingM2: number; grossM2: number }): string[] => {
  const r: string[] = [];
  if (p.duplicate) r.push('overlaps a stronger panel');
  if (!p.confident) r.push('dimension uncertain');
  if (p.grossM2 > 0 && p.openingM2 > 0.4 * p.grossM2) r.push('void deduction distorts this panel');
  return r;
};

const WASM = './node_modules/@mlightcad/libredwg-web/wasm/';
const FILE = fileURLToPath(new URL('../assets/GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg', import.meta.url));

// Corrected fixture result: the three CUT-layer X boxes lie outside the measured
// slab bays, so their combined bounding-box area is not a slab deduction.
const TRUE_TOTAL_M2 = 629.079;
const TOLERANCE = 0.005; // ±0.5%

describe('golden: GPL SIG3 T3 basement slab shuttering', () => {
  it('auto total is within ±0.5% of the corrected no-false-cutout fixture total', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const panels = autoProposePanels(dwg);

    // Independent oracle: recompute the billable total here, not trusting the store.
    const billable = panels.filter((p) => !p.duplicate);
    const total = billable.reduce((s, p) => s + Math.max((p.lengthMm / 1000) * (p.breadthMm / 1000) - p.openingM2, 0), 0);

    expect(total).toBeGreaterThan(TRUE_TOTAL_M2 * (1 - TOLERANCE));
    expect(total).toBeLessThan(TRUE_TOTAL_M2 * (1 + TOLERANCE));
  }, 30000);

  it('does not assign the external lift/stair X boxes to nearby slab bays (QSS-SLAB-004)', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const panels = autoProposePanels(dwg);
    const openings = panels.reduce((s, p) => s + p.openingM2, 0);
    expect(openings).toBe(0);
  }, 30000);

  it('produces a sane panel count without false void-distortion review reasons', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const panels = autoProposePanels(dwg);
    expect(panels.length).toBeGreaterThanOrEqual(45);
    expect(panels.length).toBeLessThanOrEqual(65);
    // External CUT-layer X symbols must not create either a deduction or a
    // false void-distortion review reason on a nearby slab.
    const distorted = panels.filter((p) => {
      const gross = (p.lengthMm / 1000) * (p.breadthMm / 1000);
      return panelReviewReasons({ confident: p.confident, duplicate: p.duplicate, openingM2: p.openingM2, grossM2: gross }).length > 0;
    });
    expect(distorted).toHaveLength(0);
  }, 30000);
});

describe('member extraction → rule engine (app path)', () => {
  it('does not deduct panel-mark leaders or adjacent stair geometry from the reported slab bays', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const members = extractMembers(dwg, 'slab');
    const bySize = (length: number, breadth: number) => members.find((member) =>
      Math.abs(member.length - length) <= 0.01 && Math.abs(member.breadth - breadth) <= 0.01);

    expect(bySize(1.8, 5.04)?.openings).toBe(0);
    expect(bySize(3.4, 3.4)?.openings).toBe(0);
  }, 30000);

  it('slab members feed slab_shuttering to within ±0.5% of the corrected fixture total', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const members = extractMembers(dwg, 'slab');
    const total = members.reduce((a, m) => a + RULES.slab_shuttering.calculate(m, 'excluded'), 0);
    expect(total).toBeGreaterThan(TRUE_TOTAL_M2 * 0.995);
    expect(total).toBeLessThan(TRUE_TOTAL_M2 * 1.005);
  }, 30000);

  it('beam members without a size remain review-only instead of inventing quantities', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const members = extractMembers(dwg, 'beam');
    expect(members.length).toBeGreaterThan(10);
    expect(members.every((m) => m.needsReview && m.breadth === 0 && m.height === 0)).toBe(true);
    expect(members.reduce((a, m) => a + RULES.beam_shuttering.calculate(m, 'excluded'), 0)).toBe(0);
    expect(members.reduce((a, m) => a + RULES.beam_concrete.calculate(m, 'excluded'), 0)).toBe(0);
  }, 30000);

});
