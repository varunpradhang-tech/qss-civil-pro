import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDwg } from '../src/parsing/parse.js';
import { extractMembers } from '../src/extract/extractMembers.js';
import { loadDraftingProfile, saveDraftingProfile } from '../src/state/draftingProfiles.js';
import { hasBundledDraftingProfile } from '../src/state/bundledDraftingProfiles.js';

const WASM = './node_modules/@mlightcad/libredwg-web/wasm/';
const plainFile = fileURLToPath(new URL('../assets/06. TYPICAL FRAMING PLAN.dwg', import.meta.url));
const markedFile = fileURLToPath(new URL('../assets/06. updated TYPICAL FRAMING PLAN.dwg', import.meta.url));

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function drawing(path: string, name: string) {
  return parseDwg(new Uint8Array(readFileSync(path)), name, { wasmPath: WASM });
}

describe('Tower A & B typical framing plan acceptance', () => {
  beforeEach(() => Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(), configurable: true,
  }));

  it('extracts the verified physical beam spans, copies, sizes and UNO slab deductions', async () => {
    const plain = await drawing(plainFile, '06. TYPICAL FRAMING PLAN.dwg');
    const beams = extractMembers(plain, 'beam');
    expect(beams.every((beam) => beam.sideLength === beam.length)).toBe(true);
    const expected: Record<string, { length: number; nos: number }> = {
      B7: { length: 6.825, nos: 2 }, B8: { length: 4.365, nos: 2 },
      B9: { length: 6.45, nos: 1 }, B10: { length: 8.15, nos: 2 },
      B12A: { length: 4.15, nos: 2 }, B17: { length: 1.86, nos: 1 },
      B31: { length: 2.65, nos: 2 }, B35: { length: 1.125, nos: 2 },
      B36: { length: 3.85, nos: 2 },
    };
    for (const [member, values] of Object.entries(expected)) {
      const rows = beams.filter((beam) => beam.member === member);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ...values, needsReview: false,
        slabThicknessSide1: 0.14, slabThicknessSide2: 0.14 });
      expect(rows[0].height).toBeGreaterThan(0);
      expect(rows[0].breadth).toBeGreaterThan(0);
    }
  }, 60_000);

  it('retains all 64 verified slab panels including mirrored irregular and edge bays', async () => {
    const plain = await drawing(plainFile, '06. TYPICAL FRAMING PLAN.dwg');
    const marked = await drawing(markedFile, '06. updated TYPICAL FRAMING PLAN.dwg');
    expect(hasBundledDraftingProfile(plain)).toBe(true);
    expect(extractMembers([plain, marked], 'slab')).toHaveLength(64);
    expect(saveDraftingProfile(plain, marked).saved).toBe(true);
    const learned = loadDraftingProfile(plain);
    expect(learned).toBeDefined();
    expect(extractMembers(plain, 'slab', 'Typical floor', learned)).toHaveLength(64);
  }, 90_000);
});
