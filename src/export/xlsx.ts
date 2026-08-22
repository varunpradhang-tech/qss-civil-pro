// Excel Measurement Book (.xlsx) — member-row based, review rows highlighted, total row.
import ExcelJS from 'exceljs';
import { RULES, UNIT_LABEL, type CapMode, type MemberRow } from '../takeoff/rules.js';
import { MB_COLUMNS, membersToRows } from './mb.js';

export async function buildMbXlsx(members: MemberRow[], quantityKey: string, capMode: CapMode, project = 'QSS Project'): Promise<Blob> {
  const rule = RULES[quantityKey];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSS Pro';
  const ws = wb.addWorksheet(rule.label.slice(0, 28));
  ws.columns = MB_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.key === 'basis' ? 44 : c.key === 'member' || c.key === 'remarks' ? 22 : 12 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
  for (const r of membersToRows(members, quantityKey, capMode)) {
    const row = ws.addRow(r);
    if (r.remarks) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  const total = members.reduce((a, m) => a + rule.calculate(m, capMode), 0);
  const totalRow = ws.addRow({ member: `Total — ${rule.label}`, quantity: Math.round(total * 1000) / 1000, unit: UNIT_LABEL[rule.unit] });
  totalRow.font = { bold: true };
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
