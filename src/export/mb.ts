// Measurement Book export (member-row based). One sheet per selected quantity rule; ends in an
// IS-code measurement-basis column (QSS-Pro style). Pure/testable.
import { RULES, UNIT_LABEL, beamConcreteBreakdown, type CapMode, type MemberRow } from '../takeoff/rules.js';
import { round3 as round } from '../lib/num.js';
import { isApprovedMember, summarizeQuantities } from '../takeoff/quantityApproval.js';

export interface MBRow {
  member: string; floor: string;
  length: number; breadth: number; height: number;
  dia: number; spacing: number; nos: number; openings: number;
  quantity: number; unit: string; approval: string; remarks: string; basis: string;
}

export const MB_COLUMNS: { key: keyof MBRow; header: string }[] = [
  { key: 'member', header: 'Member' },
  { key: 'length', header: 'Length (m)' }, { key: 'breadth', header: 'Breadth/Thk (m)' }, { key: 'height', header: 'Height/Depth (m)' },
  { key: 'openings', header: 'Openings (m²)' }, { key: 'dia', header: 'Dia (mm)' }, { key: 'spacing', header: 'Spacing (mm)' }, { key: 'nos', header: 'Nos' },
  { key: 'quantity', header: 'Quantity' }, { key: 'unit', header: 'Unit' }, { key: 'approval', header: 'Approval status' }, { key: 'remarks', header: 'Remarks' }, { key: 'basis', header: 'Measurement basis' },
];

export function membersToRows(members: MemberRow[], quantityKey: string, capMode: CapMode): MBRow[] {
  const rule = RULES[quantityKey];
  return members.map((m) => {
    // For excluded beam caps, make the support deduction visible where it
    // belongs: in measured length. Quantity then remains L x B x D x Nos.
    const supportDeduction = quantityKey === 'beam_concrete' && capMode === 'excluded'
      ? (m.supportWidths || []).reduce((sum, width) => sum + Math.max(width, 0), 0)
      : 0;
    const effectiveHeight = quantityKey === 'beam_concrete'
      ? beamConcreteBreakdown(m, capMode).effectiveDepth
      : m.height;
    return ({
    member: quantityKey.startsWith('beam_') && m.breadth > 0 && m.height > 0
      ? `${m.member || m.id} ${Math.round(m.breadth * 1000)}x${Math.round(m.height * 1000)}`
      : m.member || m.id,
    floor: m.floor,
    length: round(Math.max(m.length - supportDeduction, 0)), breadth: round(m.breadth), height: round(effectiveHeight),
    dia: m.dia, spacing: m.spacing, nos: m.nos, openings: round(m.openings),
    quantity: round(rule.calculate(m, capMode)), unit: UNIT_LABEL[rule.unit], approval: isApprovedMember(m, quantityKey) ? 'Approved' : 'Provisional',
    remarks: m.needsReview ? `need review${m.reviewReason ? ` (${m.reviewReason})` : ''}` : '',
    basis: rule.note,
    });
  });
}

export function membersToCsv(members: MemberRow[], quantityKey: string, capMode: CapMode): string {
  const rule = RULES[quantityKey];
  const rows = membersToRows(members, quantityKey, capMode);
  const summary = summarizeQuantities(members, quantityKey, capMode);
  const header = MB_COLUMNS.map((c) => c.header);
  const body = rows.map((r) => MB_COLUMNS.map((c) => csvCell(r[c.key])));
  const provisionalObj: Record<string, unknown> = { member: `Provisional subtotal — ${rule.label}`, quantity: round(summary.provisionalTotal), unit: UNIT_LABEL[rule.unit], approval: 'Provisional' };
  const approvedObj: Record<string, unknown> = { member: `Approved total — ${rule.label}`, quantity: round(summary.approvedTotal), unit: UNIT_LABEL[rule.unit], approval: 'Approved' };
  const totals = [
    ...(summary.provisionalMembers.length ? [provisionalObj] : []),
    approvedObj,
  ].map((value) => MB_COLUMNS.map((column) => csvCell(value[column.key] ?? '')));
  return [header.map(csvCell), ...body, ...totals].map((cells) => cells.join(',')).join('\r\n');
}

function csvCell(v: unknown): string { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
