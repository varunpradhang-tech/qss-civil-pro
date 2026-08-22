// Local-first persistence via IndexedDB (no dependency). Stores whole projects — the parsed model is
// small after selective block expansion, so it serializes cleanly. Structured as a thin async CRUD.
import type { MemberRow } from '../takeoff/rules.js';
import type { OutputType, Sheet } from './store.js';

export interface ProjectSettings {
  drawingType?: 'structural' | 'architectural';
  workGroup?: string;
  quantityKey?: string;
  capMode?: 'included' | 'excluded';
  outputType?: OutputType;
  defaultFloor?: string;
}

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: number;
  sheets: Sheet[]; // includes the NormalizedDwg per sheet
  activeSheetId: string | null;
  members: MemberRow[];
  extractionVersion?: number;
  settings?: ProjectSettings;
}

const DB_NAME = 'qss';
const STORE = 'projects';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const saveProject = (p: StoredProject) => tx('readwrite', (s) => s.put(p));
export const deleteProject = (id: string) => tx('readwrite', (s) => s.delete(id));
export const getProject = (id: string) => tx<StoredProject | undefined>('readonly', (s) => s.get(id));

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: number; panels: number }[]> {
  const all = await tx<StoredProject[]>('readonly', (s) => s.getAll());
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, panels: p.members?.length ?? 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// --- portable JSON (full project, re-openable on another machine) ---
export function projectToJson(p: StoredProject): string {
  return JSON.stringify({ version: 1, project: p }, null, 2);
}
export function projectFromJson(text: string): StoredProject {
  const data = JSON.parse(text);
  const p = data?.project ?? data;
  if (!p || !Array.isArray(p.members) || !Array.isArray(p.sheets)) throw new Error('Not a valid QSS project file');
  return p as StoredProject;
}
