// Faithful port of QSS-Pro's quantity rule engine (app.js). One member row + a rule → a quantity.
// All lengths in metres, areas m², volumes m³, steel kg. Beam cap-mode & column cap logic preserved.

export type Unit = 'm3' | 'm2' | 'kg';
export type DrawingType = 'structural' | 'architectural';
export type CapMode = 'included' | 'excluded';

// A measurement-book member row. Every field a QSS-Pro row can carry; unused ones stay 0.
export interface MemberRow {
  id: string;
  member: string; // name / mark, e.g. P1, B12, S9
  floor: string;
  length: number; // m
  breadth: number; // m (a.k.a. thickness/width depending on rule)
  height: number; // m (a.k.a. depth)
  capHeight: number; // m (column cap)
  capExposedPerimeter: number; // m (column cap shuttering)
  slabThickness: number; // m (beam side deduction)
  innerSideCount: number; // beam sides adjoining slab: 0, 1, or 2
  sideLength: number; // m (beam side run; defaults to length)
  bottomJointDeduction: number; // m² (beam support)
  sideJointDeduction: number; // m²
  columnCapDeduction: number; // m³ (beam concrete, caps excluded)
  dia: number; // mm (steel)
  spacing: number; // mm (steel mesh)
  nos: number;
  openings: number; // m² (slab/wall)
  needsReview: boolean;
  reviewReason?: string;
}

export function emptyRow(id: string, floor = 'Basement'): MemberRow {
  return {
    id, member: '', floor, length: 0, breadth: 0, height: 0, capHeight: 0, capExposedPerimeter: 0,
    slabThickness: 0, innerSideCount: 2, sideLength: 0, bottomJointDeduction: 0, sideJointDeduction: 0, columnCapDeduction: 0,
    dia: 0, spacing: 0, nos: 1, openings: 0, needsReview: false,
  };
}

export const steelUnitWeight = (diaMm: number): number => (diaMm * diaMm) / 162;

// --- column ---
const columnCapHeight = (r: MemberRow) => Math.max(r.capHeight || 0, 0);
const columnMainHeight = (r: MemberRow) => Math.max(r.height - columnCapHeight(r), 0);
const columnMainConcrete = (r: MemberRow) => r.length * r.breadth * columnMainHeight(r) * r.nos;
const columnCapConcrete = (r: MemberRow) => r.length * r.breadth * columnCapHeight(r) * r.nos;
const columnMainShuttering = (r: MemberRow) => 2 * (r.length + r.breadth) * columnMainHeight(r) * r.nos;
const columnCapShuttering = (r: MemberRow) => Math.max(r.capExposedPerimeter || 0, 0) * columnCapHeight(r) * r.nos;

// --- beam (cap-mode aware) ---
export function beamShutteringBreakdown(r: MemberRow, capMode: CapMode) {
  const length = Math.max(r.length || 0, 0);
  const sideLength = Math.max(r.sideLength || length, 0);
  const breadth = Math.max(r.breadth || 0, 0);
  const depth = Math.max(r.height || 0, 0);
  const nos = Math.max(r.nos || 0, 0);
  const slabThickness = Math.min(Math.max(r.slabThickness || 0, 0), depth);
  const innerSideCount = Math.min(Math.max(r.innerSideCount ?? 2, 0), 2);
  const bottomArea = length * breadth;
  const sideArea = sideLength * Math.max(2 * depth - innerSideCount * slabThickness, 0);
  const capAddition = 0;
  return { bottomArea, sideArea, capAddition, total: (bottomArea + sideArea + capAddition) * nos };
}
export function beamConcreteBreakdown(r: MemberRow, capMode: CapMode) {
  const gross = Math.max(r.length || 0, 0) * Math.max(r.breadth || 0, 0) * Math.max(r.height || 0, 0) * Math.max(r.nos || 0, 0);
  const capDeduction = capMode === 'excluded' ? Math.max(r.columnCapDeduction || 0, 0) * Math.max(r.nos || 0, 0) : 0;
  return { gross, capDeduction, net: Math.max(gross - capDeduction, 0) };
}

export interface QuantityRule {
  key: string;
  label: string;
  unit: Unit;
  calculate: (r: MemberRow, capMode: CapMode) => number;
  note: string;
}

export const RULES: Record<string, QuantityRule> = {
  column_concrete: { key: 'column_concrete', label: 'Column concrete', unit: 'm3', calculate: (r) => columnMainConcrete(r) + columnCapConcrete(r), note: 'Column concrete shows main quantity up to beam bottom and column cap from beam bottom to slab top separately.' },
  column_shuttering: { key: 'column_shuttering', label: 'Column shuttering', unit: 'm2', calculate: (r) => columnMainShuttering(r) + columnCapShuttering(r), note: 'Column shuttering: main up to beam bottom plus only exposed cap faces; faces covered by beam sides are not measured again.' },
  column_steel: { key: 'column_steel', label: 'Column steel BBS', unit: 'kg', calculate: (r) => r.length * r.nos * steelUnitWeight(r.dia), note: 'Column reinforcement BBS by bar mark, diameter, cutting length, number of bars, unit weight d²/162 kg/m.' },
  beam_concrete: { key: 'beam_concrete', label: 'Beam concrete', unit: 'm3', calculate: (r, cap) => beamConcreteBreakdown(r, cap).net, note: 'Beam concrete in m³. With caps excluded, support/cap overlap is deducted from beam concrete.' },
  beam_shuttering: { key: 'beam_shuttering', label: 'Beam shuttering', unit: 'm2', calculate: (r, cap) => beamShutteringBreakdown(r, cap).total, note: 'Beam shuttering = length × width at bottom + length × exposed depth for both sides. Slab thickness is deducted only on sides marked as inner.' },
  beam_steel: { key: 'beam_steel', label: 'Beam steel BBS', unit: 'kg', calculate: (r) => r.length * r.nos * steelUnitWeight(r.dia), note: 'Beam reinforcement BBS by bar mark, diameter, cutting length, number of bars, unit weight d²/162 kg/m.' },
  slab_concrete: { key: 'slab_concrete', label: 'Slab concrete', unit: 'm3', calculate: (r) => Math.max(r.length * r.breadth - r.openings, 0) * r.height * r.nos, note: 'Slab concrete = net slab area after cutout/opening deductions × thickness (IS 1200).' },
  slab_shuttering: { key: 'slab_shuttering', label: 'Slab shuttering', unit: 'm2', calculate: (r) => Math.max(r.length * r.breadth - r.openings, 0) * r.nos, note: 'Slab soffit shuttering = net slab area after cutout/opening deductions (IS 1200).' },
  slab_steel: { key: 'slab_steel', label: 'Slab steel', unit: 'kg', calculate: (r) => meshSteel(r), note: 'Slab reinforcement estimated from mesh spacing × diameter (d²/162).' },
  steel_bbs: { key: 'steel_bbs', label: 'Steel BBS', unit: 'kg', calculate: (r) => r.length * r.nos * steelUnitWeight(r.dia), note: 'Reinforcement BBS: length × nos × d²/162 kg/m.' },
  raft_concrete: { key: 'raft_concrete', label: 'Raft concrete', unit: 'm3', calculate: (r) => r.length * r.breadth * r.height * r.nos, note: 'Raft concrete measured in m³.' },
  raft_shuttering: { key: 'raft_shuttering', label: 'Raft shuttering', unit: 'm2', calculate: (r) => 2 * (r.length + r.breadth) * r.height * r.nos, note: 'Raft shuttering = exposed edge/perimeter formwork in m².' },
  raft_steel: { key: 'raft_steel', label: 'Raft steel', unit: 'kg', calculate: (r) => meshSteel(r), note: 'Raft steel from bar spacing, layers, cutting length.' },
  brickwork: { key: 'brickwork', label: 'Brickwork / blockwork', unit: 'm3', calculate: (r) => Math.max(r.length * r.height - r.openings, 0) * r.breadth * r.nos, note: 'Brick/blockwork = net wall area after openings × thickness.' },
  plaster: { key: 'plaster', label: 'Plaster', unit: 'm2', calculate: (r) => Math.max(r.length * r.height - r.openings, 0) * r.nos, note: 'Plaster = net wall face area after openings.' },
  paint: { key: 'paint', label: 'Paint', unit: 'm2', calculate: (r) => Math.max(r.length * r.height - r.openings, 0) * r.nos, note: 'Paint = net wall face area after openings.' },
  flooring: { key: 'flooring', label: 'Flooring', unit: 'm2', calculate: (r) => r.length * r.breadth * r.nos, note: 'Flooring = floor area.' },
};

function meshSteel(r: MemberRow): number {
  const spacing = r.spacing > 0 ? r.spacing / 1000 : 0.15;
  const xBars = Math.floor(r.breadth / spacing) + 1;
  const yBars = Math.floor(r.length / spacing) + 1;
  return (xBars * r.length + yBars * r.breadth) * r.nos * steelUnitWeight(r.dia);
}

// drawing type → work group → [ruleKey, label]
export const MENU: Record<DrawingType, Record<string, { label: string; rules: [string, string][] }>> = {
  structural: {
    raft: { label: 'Raft', rules: [['raft_concrete', 'Concrete'], ['raft_shuttering', 'Shuttering'], ['raft_steel', 'Steel']] },
    column: { label: 'Column', rules: [['column_concrete', 'Concrete'], ['column_shuttering', 'Shuttering'], ['column_steel', 'Steel']] },
    beam: { label: 'Beam', rules: [['beam_concrete', 'Concrete'], ['beam_shuttering', 'Shuttering'], ['beam_steel', 'Steel']] },
    slab: { label: 'Slab', rules: [['slab_concrete', 'Concrete'], ['slab_shuttering', 'Shuttering'], ['slab_steel', 'Steel']] },
  },
  architectural: {
    wall: { label: 'Wall work', rules: [['brickwork', 'Brickwork / blockwork'], ['plaster', 'Plaster'], ['paint', 'Paint']] },
    finish: { label: 'Surface finish', rules: [['plaster', 'Plaster'], ['paint', 'Paint']] },
    floor: { label: 'Floor work', rules: [['flooring', 'Flooring']] },
  },
};

export const UNIT_LABEL: Record<Unit, string> = { m3: 'm³', m2: 'm²', kg: 'kg' };

// Compact column headers for the editable member-table numeric fields.
export const FIELD_LABEL: Record<string, string> = {
  length: 'Length',
  breadth: 'Breadth / thk',
  height: 'Height / depth',
  capHeight: 'Cap height',
  capExposedPerimeter: 'Cap perimeter',
  slabThickness: 'Slab thk',
  innerSideCount: 'Inner sides (0–2)',
  bottomJointDeduction: 'Bottom ded.',
  sideJointDeduction: 'Side ded.',
  dia: 'Dia (mm)',
  spacing: 'Spacing (mm)',
  nos: 'Nos',
  openings: 'Openings',
};

// Only the numeric fields each rule actually consumes — drives which table columns are shown,
// so the member table stays narrow and relevant instead of listing all 12 possible inputs.
export const RULE_FIELDS: Record<string, (keyof MemberRow)[]> = {
  column_concrete: ['length', 'breadth', 'height', 'capHeight', 'nos'],
  column_shuttering: ['length', 'breadth', 'height', 'capHeight', 'capExposedPerimeter', 'nos'],
  column_steel: ['length', 'dia', 'nos'],
  beam_concrete: ['length', 'breadth', 'height', 'nos'],
  beam_shuttering: ['length', 'breadth', 'height', 'slabThickness', 'innerSideCount', 'nos'],
  beam_steel: ['length', 'dia', 'nos'],
  slab_concrete: ['length', 'breadth', 'height', 'openings', 'nos'],
  slab_shuttering: ['length', 'breadth', 'openings', 'nos'],
  slab_steel: ['length', 'breadth', 'dia', 'spacing', 'nos'],
  steel_bbs: ['length', 'dia', 'nos'],
  raft_concrete: ['length', 'breadth', 'height', 'nos'],
  raft_shuttering: ['length', 'breadth', 'height', 'nos'],
  raft_steel: ['length', 'breadth', 'dia', 'spacing', 'nos'],
  brickwork: ['length', 'breadth', 'height', 'openings', 'nos'],
  plaster: ['length', 'height', 'openings', 'nos'],
  paint: ['length', 'height', 'openings', 'nos'],
  flooring: ['length', 'breadth', 'nos'],
};
