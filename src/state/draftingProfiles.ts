import type { NormalizedDwg } from '../domain/types.js';

const STORAGE_KEY = 'qss-drafting-profiles-v1';
const MAX_PROFILES = 8;

interface SavedProfile {
  version: 1;
  fingerprint: string;
  updatedAt: number;
  teacher: NormalizedDwg;
}

function hashPart(hash: number, value: number): number {
  hash ^= value | 0;
  return Math.imul(hash, 16777619) >>> 0;
}

/** Stable identity for an unchanged base drawing, independent of its filename. */
export function drawingFingerprint(dwg: NormalizedDwg): string {
  const ox = dwg.extents.min.x, oy = dwg.extents.min.y;
  let hash = 2166136261;
  hash = hashPart(hash, Math.round((dwg.extents.max.x - ox) / 10));
  hash = hashPart(hash, Math.round((dwg.extents.max.y - oy) / 10));
  hash = hashPart(hash, dwg.segments.length);
  // Parsed entity order is stable for the same DWG. Coordinates are made
  // origin-independent and quantised to tolerate harmless parser noise.
  for (const segment of dwg.segments) {
    hash = hashPart(hash, Math.round((segment.a.x - ox) / 10));
    hash = hashPart(hash, Math.round((segment.a.y - oy) / 10));
    hash = hashPart(hash, Math.round((segment.b.x - ox) / 10));
    hash = hashPart(hash, Math.round((segment.b.y - oy) / 10));
  }
  return `dwg-${hash.toString(16).padStart(8, '0')}`;
}

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readProfiles(): SavedProfile[] {
  try {
    const value = storage()?.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as SavedProfile[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.version === 1) : [];
  } catch { return []; }
}

function compactTeacher(dwg: NormalizedDwg): NormalizedDwg {
  const marked = dwg.polylines.filter((line) => /^(?:A-HATCH|QSS[_ -].*OUTLINE.*)$/i.test(line.layer));
  return {
    ...dwg,
    layers: [], entityCountsByType: {}, segments: [], hatches: [],
    polylines: marked,
    // Keep every verified dimension. Filtering these by the outline bounding
    // box lost dimensions whose text/extension line sits outside an irregular
    // panel, so a persisted profile could not reproduce its teaching run.
    dimensions: dwg.dimensions,
    // Marked dimensions supply the verified side lengths. Thickness notes are
    // the only teacher text required by the correction pass.
    texts: dwg.texts.filter((text) => /slab|thk|thickness|depth/i.test(`${text.layer} ${text.text}`)),
  };
}

export function saveDraftingProfile(base: NormalizedDwg, teacher: NormalizedDwg): { saved: boolean; reason?: string } {
  const target = storage();
  if (!target) return { saved: false, reason: 'browser storage unavailable' };
  const fingerprint = drawingFingerprint(base);
  const profile: SavedProfile = { version: 1, fingerprint, updatedAt: Date.now(), teacher: compactTeacher(teacher) };
  const profiles = [profile, ...readProfiles().filter((item) => item.fingerprint !== fingerprint)]
    .slice(0, MAX_PROFILES);
  try { target.setItem(STORAGE_KEY, JSON.stringify(profiles)); return { saved: true }; } catch {
    try { target.setItem(STORAGE_KEY, JSON.stringify([profile])); return { saved: true }; } catch {
      return { saved: false, reason: 'browser storage quota exceeded' };
    }
  }
}

export function loadDraftingProfile(base: NormalizedDwg): NormalizedDwg | undefined {
  const fingerprint = drawingFingerprint(base);
  return readProfiles().find((item) => item.fingerprint === fingerprint)?.teacher;
}
