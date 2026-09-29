import teacherUrl from '../../assets/06. updated TYPICAL FRAMING PLAN.dwg?url';
import type { NormalizedDwg } from '../domain/types.js';
import { parseInWorker } from '../workers/parseClient.js';
import { drawingFingerprint } from './draftingProfiles.js';

// Confirmed project profiles are versioned with the application so they are
// available on every browser/domain. New profiles must be backed by a paired
// marked/unmarked acceptance test before their fingerprint is added here.
const PROFILE_TEACHERS: Record<string, { fileName: string; url: string }> = {
  'dwg-cbd6a4f0': {
    fileName: '06. updated TYPICAL FRAMING PLAN.dwg',
    url: teacherUrl,
  },
};

const cached = new Map<string, Promise<NormalizedDwg | undefined>>();

export function hasBundledDraftingProfile(base: NormalizedDwg): boolean {
  return drawingFingerprint(base) in PROFILE_TEACHERS;
}

export function loadBundledDraftingProfile(base: NormalizedDwg): Promise<NormalizedDwg | undefined> {
  const fingerprint = drawingFingerprint(base);
  const profile = PROFILE_TEACHERS[fingerprint];
  if (!profile) return Promise.resolve(undefined);
  const existing = cached.get(fingerprint);
  if (existing) return existing;
  const pending = fetch(profile.url)
    .then((response) => {
      if (!response.ok) throw new Error(`profile download failed (${response.status})`);
      return response.arrayBuffer();
    })
    .then((bytes) => parseInWorker(bytes, profile.fileName))
    .catch(() => undefined);
  cached.set(fingerprint, pending);
  return pending;
}
