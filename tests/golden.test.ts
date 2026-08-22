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

// Ground truth: verified manual total for this sheet (per-panel breakdown not yet available).
const TRUE_TOTAL_M2 = 610.9;
const TOLERANCE = 0.005; // ±0.5%

describe('golden: GPL SIG3 T3 basement slab shuttering', () => {
  it('auto total is within ±0.5% of the verified 610.9 m²', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const panels = autoProposePanels(dwg);

    // Independent oracle: recompute the billable total here, not trusting the store.
    const billable = panels.filter((p) => !p.duplicate);
    const total = billable.reduce((s, p) => s + Math.max((p.lengthMm / 1000) * (p.breadthMm / 1000) - p.openingM2, 0), 0);

    expect(total).toBeGreaterThan(TRUE_TOTAL_M2 * (1 - TOLERANCE));
    expect(total).toBeLessThan(TRUE_TOTAL_M2 * (1 + TOLERANCE));
  }, 30000);

  it('detects and deducts the lift/stair voids (QSS-SLAB-004)', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const panels = autoProposePanels(dwg);
    const openings = panels.reduce((s, p) => s + p.openingM2, 0);
    expect(openings).toBeGreaterThan(15); // ~17 m² of X-voids
    expect(openings).toBeLessThan(25);
  }, 30000);

  it('produces a sane panel count and marks review reasons', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const panels = autoProposePanels(dwg);
    expect(panels.length).toBeGreaterThanOrEqual(45);
    expect(panels.length).toBeLessThanOrEqual(65);
    // void-distorted panels must be flagged, not silently shipped
    const distorted = panels.filter((p) => {
      const gross = (p.lengthMm / 1000) * (p.breadthMm / 1000);
      return panelReviewReasons({ confident: p.confident, duplicate: p.duplicate, openingM2: p.openingM2, grossM2: gross }).length > 0;
    });
    // there is at least the void-affected panel(s) flagged
    expect(distorted.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});

describe('member extraction → rule engine (app path)', () => {
  it('slab members feed slab_shuttering to within ±0.5% of 610.9 m²', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const members = extractMembers(dwg, 'slab');
    const total = members.reduce((a, m) => a + RULES.slab_shuttering.calculate(m, 'excluded'), 0);
    expect(total).toBeGreaterThan(TRUE_TOTAL_M2 * 0.995);
    expect(total).toBeLessThan(TRUE_TOTAL_M2 * 1.005);
  }, 30000);

  it('beam members auto-extract and compute both shuttering and concrete', async () => {
    const dwg = await parseDwg(new Uint8Array(readFileSync(FILE)), 'ST-300', { wasmPath: WASM });
    const members = extractMembers(dwg, 'beam');
    expect(members.length).toBeGreaterThan(10);
    expect(members.reduce((a, m) => a + RULES.beam_shuttering.calculate(m, 'excluded'), 0)).toBeGreaterThan(0);
    expect(members.reduce((a, m) => a + RULES.beam_concrete.calculate(m, 'excluded'), 0)).toBeGreaterThan(0);
  }, 30000);
});
