import { describe, expect, it, vi } from 'vitest';
import { projectFromJson, projectToJson, type StoredProject } from '../src/state/persistence.js';
import { useStore } from '../src/state/store.js';
import { emptyRow } from '../src/takeoff/rules.js';

const project: StoredProject = {
  id: 'proj-1', name: 'Test', updatedAt: 123,
  sheets: [{ id: 's1', name: 'a.dwg', slabDimCount: 5, dwg: { fileName: 'a.dwg', units: 4, unitScaleToMm: 1, layers: [], entityCountsByType: {}, segments: [], dimensions: [], texts: [], polylines: [], hatches: [], extents: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } } } }],
  activeSheetId: 's1',
  members: [{ ...emptyRow('m1', 'Basement'), member: 'S1', length: 4, breadth: 3, height: 0.175 }],
  settings: { drawingType: 'structural', workGroup: 'slab', quantityKey: 'slab_shuttering', capMode: 'excluded', outputType: 'member', defaultFloor: 'Basement' },
};

describe('project JSON', () => {
  it('round-trips a project through export/import', () => {
    const restored = projectFromJson(projectToJson(project));
    expect(restored.name).toBe('Test');
    expect(restored.members[0].member).toBe('S1');
    expect(restored.members[0].length).toBe(4);
    expect(restored.settings?.quantityKey).toBe('slab_shuttering');
    expect(restored.sheets[0].slabDimCount).toBe(5);
  });

  it('rejects non-project JSON', () => {
    expect(() => projectFromJson('{"foo":1}')).toThrow();
  });

  it('re-extracts old saved members after the slab geometry rules change', () => {
    vi.useFakeTimers();
    try {
      useStore.getState().loadStoredProject({ ...project, extractionVersion: 11 });
      expect(useStore.getState().members).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('migrates a legacy saved row without approval evidence as provisional', () => {
    const legacy = { ...project, sheets: [], activeSheetId: null, extractionVersion: 28,
      members: [{ ...emptyRow('legacy'), member: 'S1', length: 4, breadth: 3, height: 0.175 }] };
    useStore.getState().loadStoredProject(legacy);
    expect(useStore.getState().members[0]).toMatchObject({
      quantityStatus: 'provisional',
      reviewReason: 'legacy saved row requires validation or explicit approval',
    });
  });

  it('preserves manual member edits in a version-28 drawing project during approval migration', () => {
    const edited = { ...project, extractionVersion: 28,
      members: [{ ...emptyRow('edited'), member: 'S1 manual', length: 4.123, breadth: 3.456, height: 0.16 }] };
    useStore.getState().loadStoredProject(edited);
    expect(useStore.getState().members[0]).toMatchObject({
      member: 'S1 manual', length: 4.123, breadth: 3.456, height: 0.16,
      quantityStatus: 'provisional',
    });
    expect(useStore.getState().status).toContain('Opened');
    expect(useStore.getState().status).not.toContain('recalculating');
  });

  it('invalidates explicit approval when a quantity input is edited', () => {
    const manual = { ...project, sheets: [], activeSheetId: null, extractionVersion: 28,
      members: [{ ...emptyRow('manual'), member: 'S1', length: 4, breadth: 3, height: 0.175 }] };
    useStore.getState().loadStoredProject(manual);
    useStore.getState().approveMember('manual');
    expect(useStore.getState().members[0].quantityStatus).toBe('approved');
    useStore.getState().updateMember('manual', { length: 5 });
    expect(useStore.getState().members[0]).toMatchObject({
      quantityStatus: 'provisional', needsReview: true,
      reviewReason: 'engineering inputs changed after approval',
    });
  });
});
