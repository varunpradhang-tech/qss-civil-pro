// Excel Measurement Book (.xlsx) — member-row based, review rows highlighted, total row.
import ExcelJS from 'exceljs';
import { RULES, UNIT_LABEL, type CapMode, type MemberRow } from '../takeoff/rules.js';
import { MB_COLUMNS, membersToRows } from './mb.js';

const naturalSort = (a: MemberRow, b: MemberRow) => (a.member || a.id).localeCompare(b.member || b.id, undefined, { numeric: true, sensitivity: 'base' });

function styleHeader(ws: ExcelJS.Worksheet) {
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function addFormulaTotal(ws: ExcelJS.Worksheet, qtyCol: string, unitCol: string, label: string, unit: string, result: number) {
  const row = ws.addRow([label]);
  row.getCell(qtyCol).value = { formula: `SUM(${qtyCol}2:${qtyCol}${row.number - 1})`, result: Math.round(result * 1000) / 1000 };
  row.getCell(unitCol).value = unit;
  row.font = { bold: true };
}

function buildBeamShuttering(ws: ExcelJS.Worksheet, members: MemberRow[], capMode: CapMode) {
  ws.columns = [
    { header: 'Member', key: 'member', width: 18 }, { header: 'Floor', key: 'floor', width: 14 },
    { header: 'Shuttering item', key: 'item', width: 18 }, { header: 'Length (m)', key: 'length', width: 12 },
    { header: 'Beam width (m)', key: 'width', width: 15 }, { header: 'Beam depth (m)', key: 'depth', width: 15 },
    { header: 'Slab thk (m)', key: 'slab', width: 13 }, { header: 'Inner sides', key: 'innerSides', width: 12 },
    { header: 'Quantity (m²)', key: 'quantity', width: 15 }, { header: 'Unit', key: 'unit', width: 9 },
    { header: 'Remarks', key: 'remarks', width: 34 },
  ];
  styleHeader(ws);
  const sorted = [...members].sort(naturalSort);
  for (const m of sorted) {
    const length = Math.max(m.length || 0, 0), width = Math.max(m.breadth || 0, 0), depth = Math.max(m.height || 0, 0);
    const slab = Math.min(Math.max(m.slabThickness || 0, 0), depth), innerSides = Math.min(Math.max(m.innerSideCount ?? 2, 0), 2);
    const remarks = m.needsReview ? `need review${m.reviewReason ? ` (${m.reviewReason})` : ''}` : '';
    const bottom = ws.addRow({ member: m.member || m.id, floor: m.floor, item: 'Beam bottom', length, width, unit: 'm²', remarks: remarks || null });
    bottom.getCell('quantity').value = { formula: `D${bottom.number}*E${bottom.number}`, result: length * width };
    const sides = ws.addRow({ member: m.member || m.id, floor: m.floor, item: 'Beam sides', length, depth, slab, innerSides, unit: 'm²', remarks: remarks || null });
    sides.getCell('quantity').value = { formula: `D${sides.number}*(2*F${sides.number}-H${sides.number}*G${sides.number})`, result: length * (2 * depth - innerSides * slab) };
    if (remarks) for (const row of [bottom, sides]) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  addFormulaTotal(ws, 'I', 'J', 'Total — Beam shuttering', 'm²', sorted.reduce((sum, m) => sum + RULES.beam_shuttering.calculate(m, capMode), 0));
  for (const c of ['D', 'E', 'F', 'G', 'I']) ws.getColumn(c).numFmt = '0.000';
}

function buildSlabShuttering(ws: ExcelJS.Worksheet, members: MemberRow[], capMode: CapMode) {
  ws.columns = [
    { header: 'Member', key: 'member', width: 22 }, { header: 'Floor', key: 'floor', width: 14 },
    { header: 'Shuttering item', key: 'item', width: 18 }, { header: 'Length (m)', key: 'length', width: 12 },
    { header: 'Breadth (m)', key: 'breadth', width: 13 }, { header: 'Openings (m²)', key: 'openings', width: 15 },
    { header: 'Quantity (m²)', key: 'quantity', width: 15 }, { header: 'Unit', key: 'unit', width: 9 },
    { header: 'Remarks', key: 'remarks', width: 34 },
  ];
  styleHeader(ws);
  const sorted = [...members].sort(naturalSort);
  for (const m of sorted) {
    const length = Math.max(m.length || 0, 0), breadth = Math.max(m.breadth || 0, 0), openings = Math.max(m.openings || 0, 0);
    const remarks = m.needsReview ? `need review${m.reviewReason ? ` (${m.reviewReason})` : ''}` : '';
    const row = ws.addRow({ member: m.member || m.id, floor: m.floor, item: 'Slab soffit', length, breadth, openings, unit: 'm²', remarks: remarks || null });
    row.getCell('quantity').value = { formula: `MAX(D${row.number}*E${row.number}-F${row.number},0)`, result: Math.max(length * breadth - openings, 0) };
    if (remarks) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  addFormulaTotal(ws, 'G', 'H', 'Total — Slab shuttering', 'm²', sorted.reduce((sum, m) => sum + RULES.slab_shuttering.calculate(m, capMode), 0));
  for (const c of ['D', 'E', 'F', 'G']) ws.getColumn(c).numFmt = '0.000';
}

export async function buildMbXlsx(members: MemberRow[], quantityKey: string, capMode: CapMode, project = 'QSS Project'): Promise<Blob> {
  const rule = RULES[quantityKey];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSS Pro';
  const ws = wb.addWorksheet(rule.label.slice(0, 28));
  if (quantityKey === 'beam_shuttering') {
    buildBeamShuttering(ws, members, capMode);
    return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  if (quantityKey === 'slab_shuttering') {
    buildSlabShuttering(ws, members, capMode);
    return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  ws.columns = MB_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.key === 'basis' ? 44 : c.key === 'member' || c.key === 'remarks' ? 22 : 12 }));
  styleHeader(ws);
  for (const r of membersToRows(members, quantityKey, capMode)) {
    const row = ws.addRow(r);
    if (r.remarks) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  const total = members.reduce((a, m) => a + rule.calculate(m, capMode), 0);
  const totalRow = ws.addRow({ member: `Total — ${rule.label}`, quantity: Math.round(total * 1000) / 1000, unit: UNIT_LABEL[rule.unit] });
  totalRow.font = { bold: true };
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
