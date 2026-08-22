import { describe, expect, it } from 'vitest';
import { projectFromJson, projectToJson, type StoredProject } from '../src/state/persistence.js';
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
});
