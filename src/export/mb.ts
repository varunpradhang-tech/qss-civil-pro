// Measurement Book export (member-row based). One sheet per selected quantity rule; ends in an
// IS-code measurement-basis column (QSS-Pro style). Pure/testable.
import { RULES, UNIT_LABEL, type CapMode, type MemberRow } from '../takeoff/rules.js';
import { round3 as round } from '../lib/num.js';

export interface MBRow {
  member: string; floor: string;
  length: number; breadth: number; height: number;
  dia: number; spacing: number; nos: number; openings: number;
  quantity: number; unit: string; remarks: string; basis: string;
}

export const MB_COLUMNS: { key: keyof MBRow; header: string }[] = [
  { key: 'member', header: 'Member' }, { key: 'floor', header: 'Floor' },
  { key: 'length', header: 'Length (m)' }, { key: 'breadth', header: 'Breadth/Thk (m)' }, { key: 'height', header: 'Height/Depth (m)' },
  { key: 'openings', header: 'Openings (m²)' }, { key: 'dia', header: 'Dia (mm)' }, { key: 'spacing', header: 'Spacing (mm)' }, { key: 'nos', header: 'Nos' },
  { key: 'quantity', header: 'Quantity' }, { key: 'unit', header: 'Unit' }, { key: 'remarks', header: 'Remarks' }, { key: 'basis', header: 'Measurement basis' },
];

export function membersToRows(members: MemberRow[], quantityKey: string, capMode: CapMode): MBRow[] {
  const rule = RULES[quantityKey];
  return members.map((m) => ({
    member: quantityKey.startsWith('beam_') && m.breadth > 0 && m.height > 0
      ? `${m.member || m.id} ${Math.round(m.breadth * 1000)}x${Math.round(m.height * 1000)}`
      : m.member || m.id,
    floor: m.floor,
    length: round(m.length), breadth: round(m.breadth), height: round(m.height),
    dia: m.dia, spacing: m.spacing, nos: m.nos, openings: round(m.openings),
    quantity: round(rule.calculate(m, capMode)), unit: UNIT_LABEL[rule.unit],
    remarks: m.needsReview ? `need review${m.reviewReason ? ` (${m.reviewReason})` : ''}` : '',
    basis: rule.note,
  }));
}

export function membersToCsv(members: MemberRow[], quantityKey: string, capMode: CapMode): string {
  const rule = RULES[quantityKey];
  const rows = membersToRows(members, quantityKey, capMode);
  const total = round(members.reduce((a, m) => a + rule.calculate(m, capMode), 0));
  const header = MB_COLUMNS.map((c) => c.header);
  const body = rows.map((r) => MB_COLUMNS.map((c) => csvCell(r[c.key])));
  const totalObj: Record<string, unknown> = { member: `Total — ${rule.label}`, quantity: total, unit: UNIT_LABEL[rule.unit] };
  const totalRow = MB_COLUMNS.map((c) => csvCell(totalObj[c.key] ?? ''));
  return [header.map(csvCell), ...body, totalRow].map((cells) => cells.join(',')).join('\r\n');
}

function csvCell(v: unknown): string { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
