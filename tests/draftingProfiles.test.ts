import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedDwg, Pt } from '../src/domain/types.js';
import { extractMembers } from '../src/extract/extractMembers.js';
import { loadDraftingProfile, saveDraftingProfile } from '../src/state/draftingProfiles.js';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const rectangle = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];
const base = (): NormalizedDwg => ({ fileName: 'unmarked.dwg', units: 4, unitScaleToMm: 1,
  layers: [], entityCountsByType: {}, dimensions: [], texts: [], polylines: [], hatches: [],
  segments: [{ a: { x: 0, y: 0 }, b: { x: 50_000, y: 0 }, layer: 'BEAM' }],
  extents: { min: { x: 0, y: 0 }, max: { x: 50_000, y: 30_000 } } });
const marked = (): NormalizedDwg => ({ ...base(), fileName: 'marked.dwg',
  polylines: Array.from({ length: 6 }, (_, index) => ({ layer: 'A-HATCH', closed: false,
    pts: [...rectangle(index * 6000, 0, index * 6000 + 4000, 3000), { x: index * 6000 + 10, y: 0 }] })),
  dimensions: [
    { dir: 'H', measurement: 4400, p1: { x: 0, y: 0 }, p2: { x: 4000, y: 0 }, mid: { x: 2000, y: -200 }, layer: 'DIM' },
    { dir: 'V', measurement: 3200, p1: { x: 0, y: 0 }, p2: { x: 0, y: 3000 }, mid: { x: -200, y: 1500 }, layer: 'DIM' },
  ] });

describe('persistent drafting profiles', () => {
  beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true }); });

  it('reuses marked corrections on a later unmarked-only extraction', () => {
    const plain = base();
    expect(saveDraftingProfile(plain, marked())).toBe(true);
    const learned = loadDraftingProfile({ ...plain, fileName: 'uploaded-again.dwg' });
    expect(learned).toBeDefined();
    const rows = extractMembers([plain], 'slab', 'Typical floor', learned);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ length: 4.4, breadth: 3.2, measurementSource: 'marked dimension' });
  });

  it('does not apply a profile to different base geometry', () => {
    const plain = base();
    saveDraftingProfile(plain, marked());
    const other = base();
    other.segments[0].b.x = 49_000;
    expect(loadDraftingProfile(other)).toBeUndefined();
  });
});
