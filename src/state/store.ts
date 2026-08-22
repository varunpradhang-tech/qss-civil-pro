import { create } from 'zustand';
import type { NormalizedDwg } from '../domain/types.js';
import { MENU, RULES, emptyRow, type CapMode, type DrawingType, type MemberRow } from '../takeoff/rules.js';
import { extractMembers } from '../extract/extractMembers.js';
import { deleteProject, getProject, listProjects, projectFromJson, projectToJson, saveProject, type StoredProject } from './persistence.js';

export interface Sheet { id: string; name: string; dwg: NormalizedDwg; slabDimCount: number; sourceBytes?: ArrayBuffer; }
export type OutputType = 'total' | 'member' | 'floor';

interface AppState {
  sheets: Sheet[];
  activeSheetId: string | null;
  dwg: NormalizedDwg | null;
  status: string;
  parsing: boolean;

  drawingType: DrawingType;
  workGroup: string;
  quantityKey: string;
  capMode: CapMode;
  outputType: OutputType;
  defaultFloor: string;
  members: MemberRow[];

  projectId: string | null;
  projectName: string;
  savedProjects: { id: string; name: string; updatedAt: number; panels: number }[];

  setParsing: (b: boolean) => void;
  setStatus: (s: string) => void;
  setSheets: (sheets: Sheet[]) => void;
  setActiveSheet: (id: string) => void;
  setDrawingType: (t: DrawingType) => void;
  setWorkGroup: (w: string) => void;
  setQuantityKey: (k: string) => void;
  setCapMode: (m: CapMode) => void;
  setOutputType: (o: OutputType) => void;
  setDefaultFloor: (f: string) => void;
  extractQuantity: () => void;
  addMember: () => void;
  duplicateMember: (id: string) => void;
  updateMember: (id: string, patch: Partial<MemberRow>) => void;
  deleteMember: (id: string) => void;

  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  deleteSavedProject: (id: string) => Promise<void>;
  renameProject: (name: string) => void;
  loadStoredProject: (p: StoredProject) => void;
  exportProjectJson: () => string;
  importProjectJson: (text: string) => void;
}

let mseq = 1;
const mid = () => `m${mseq++}`;

// Increment whenever extraction or quantity rules change in a way that makes
// previously saved member rows stale. Drawings are then re-extracted on open.
const EXTRACTION_VERSION = 6;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function snapshot(s: AppState): StoredProject | null {
  if (!s.projectId) return null;
  return { id: s.projectId, name: s.projectName, updatedAt: Date.now(), sheets: s.sheets, activeSheetId: s.activeSheetId, members: s.members, extractionVersion: EXTRACTION_VERSION, settings: { drawingType: s.drawingType, workGroup: s.workGroup, quantityKey: s.quantityKey, capMode: s.capMode, outputType: s.outputType, defaultFloor: s.defaultFloor } };
}
function autosave(get: () => AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { const snap = snapshot(get()); if (snap) saveProject(snap).then(() => get().refreshProjects()).catch(() => {}); }, 600);
}

// Keep the selected rule valid when the work group / drawing type changes.
function firstRuleFor(drawingType: DrawingType, workGroup: string): string {
  const group = MENU[drawingType][workGroup];
  return group ? group.rules[0][0] : Object.values(MENU[drawingType])[0].rules[0][0];
}

export const useStore = create<AppState>((set, get) => ({
  sheets: [],
  activeSheetId: null,
  dwg: null,
  status: 'Upload one or more DWG/DXF sheets, then Extract quantity.',
  parsing: false,

  drawingType: 'structural',
  workGroup: 'slab',
  quantityKey: 'slab_shuttering',
  capMode: 'excluded',
  outputType: 'member',
  defaultFloor: 'Basement',
  members: [],

  projectId: null,
  projectName: 'Untitled project',
  savedProjects: [],

  setParsing: (b) => set({ parsing: b }),
  setStatus: (s) => set({ status: s }),

  setSheets: (sheets) => {
    const active = [...sheets].sort((a, b) => b.slabDimCount - a.slabDimCount)[0];
    const name = (active?.name || 'Untitled project').replace(/\.[^.]+$/, '');
    set({ sheets, activeSheetId: active?.id ?? null, dwg: active?.dwg ?? null, projectId: `proj-${Date.now()}`, projectName: name, members: [] });
    get().extractQuantity();
    autosave(get);
  },
  setActiveSheet: (id) => { const sh = get().sheets.find((s) => s.id === id); if (!sh) return; set({ activeSheetId: id, dwg: sh.dwg }); get().extractQuantity(); },

  setDrawingType: (t) => { const w = Object.keys(MENU[t])[0]; set({ drawingType: t, workGroup: w, quantityKey: firstRuleFor(t, w) }); get().extractQuantity(); },
  setWorkGroup: (w) => { set({ workGroup: w, quantityKey: firstRuleFor(get().drawingType, w) }); get().extractQuantity(); },
  setQuantityKey: (k) => { set({ quantityKey: k }); autosave(get); },
  setCapMode: (m) => { set({ capMode: m }); autosave(get); },
  setOutputType: (o) => { set({ outputType: o }); autosave(get); },
  setDefaultFloor: (f) => { set({ defaultFloor: f }); autosave(get); },

  extractQuantity: () => {
    const { dwg, workGroup, defaultFloor, quantityKey } = get();
    if (!dwg) { set({ members: [] }); return; }
    const members = extractMembers(get().sheets.map((sheet) => sheet.dwg), workGroup, defaultFloor);
    mseq = members.length + 1;
    const flagged = members.filter((m) => m.needsReview).length;
    const sourceSummary = workGroup === 'beam'
      ? ` · marked dimensions: ${members.filter((m) => m.measurementSource === 'marked dimension').length} · drawing geometry: ${members.filter((m) => m.measurementSource === 'drawing geometry').length}`
      : '';
    set({
      members,
      status: members.length
        ? `Extracted ${members.length} ${workGroup} members for ${RULES[quantityKey].label}${sourceSummary}${flagged ? ` · ${flagged} need review` : ''}.`
        : `No ${workGroup} members auto-extracted — add rows manually.`,
    });
    autosave(get);
  },
  addMember: () => { set((s) => ({ members: [...s.members, emptyRow(mid(), s.defaultFloor)] })); autosave(get); },
  duplicateMember: (id) => set((s) => {
    const src = s.members.find((m) => m.id === id); if (!src) return {};
    const i = s.members.findIndex((m) => m.id === id);
    const copy = { ...src, id: mid() };
    const members = [...s.members.slice(0, i + 1), copy, ...s.members.slice(i + 1)];
    autosave(get); return { members };
  }),
  updateMember: (id, patch) => { set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) })); autosave(get); },
  deleteMember: (id) => { set((s) => ({ members: s.members.filter((m) => m.id !== id) })); autosave(get); },

  refreshProjects: async () => set({ savedProjects: await listProjects() }),
  openProject: async (id) => { const p = await getProject(id); if (p) get().loadStoredProject(p); },
  deleteSavedProject: async (id) => { await deleteProject(id); await get().refreshProjects(); },
  renameProject: (name) => { set({ projectName: name }); autosave(get); },
  loadStoredProject: (p) => {
    const active = p.sheets.find((s) => s.id === p.activeSheetId) ?? p.sheets[0];
    const st = p.settings ?? {};
    const needsReextract = p.extractionVersion !== EXTRACTION_VERSION && p.sheets.length > 0;
    mseq = (p.members?.length || 0) + 1;
    set({
      projectId: p.id, projectName: p.name, sheets: p.sheets, activeSheetId: p.activeSheetId, dwg: active?.dwg ?? null,
      members: p.members ?? [],
      drawingType: st.drawingType ?? 'structural', workGroup: st.workGroup ?? 'slab', quantityKey: st.quantityKey ?? 'slab_shuttering',
      capMode: st.capMode ?? 'excluded', outputType: st.outputType ?? 'member', defaultFloor: st.defaultFloor ?? 'Basement',
      status: needsReextract
        ? `Opened "${p.name}" — recalculating with the latest extraction rules…`
        : `Opened "${p.name}" — ${p.members?.length ?? 0} members.`,
    });
    if (needsReextract) get().extractQuantity();
  },
  exportProjectJson: () => {
    const s = get();
    return projectToJson({ id: s.projectId ?? `proj-${Date.now()}`, name: s.projectName, updatedAt: Date.now(), sheets: s.sheets, activeSheetId: s.activeSheetId, members: s.members, extractionVersion: EXTRACTION_VERSION, settings: { drawingType: s.drawingType, workGroup: s.workGroup, quantityKey: s.quantityKey, capMode: s.capMode, outputType: s.outputType, defaultFloor: s.defaultFloor } });
  },
  importProjectJson: (text) => { const p = projectFromJson(text); p.id = `proj-${Date.now()}`; get().loadStoredProject(p); autosave(get); },
}));

if (typeof window !== 'undefined') (window as unknown as { __qss: unknown }).__qss = useStore;
