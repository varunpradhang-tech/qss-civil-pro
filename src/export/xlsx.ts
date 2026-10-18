// Excel Measurement Book (.xlsx) — member-row based, review rows highlighted, total row.
import ExcelJS from 'exceljs';
import type { NormalizedDwg } from '../domain/types.js';
import { isApprovedMember, summarizeQuantities } from '../takeoff/quantityApproval.js';
import { RULES, UNIT_LABEL, type CapMode, type MemberRow } from '../takeoff/rules.js';
import { MB_COLUMNS, membersToRows } from './mb.js';

function naturalSort(a: MemberRow, b: MemberRow): number {
  const av = a.member || a.id, bv = b.member || b.id;
  const am = av.match(/^T(\d+)(M?B)(\d+)([A-Z]?)$/i), bm = bv.match(/^T(\d+)(M?B)(\d+)([A-Z]?)$/i);
  if (am && bm) return Number(am[1]) - Number(bm[1]) || Number(am[3]) - Number(bm[3]) || am[4].localeCompare(bm[4]) || am[2].localeCompare(bm[2]);
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
}

function styleHeader(ws: ExcelJS.Worksheet) {
  ws.getRow(2).font = { bold: true };
  ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

function drawingMeta(dwgs: NormalizedDwg[]): { title?: string; number?: string } {
  const texts = dwgs.flatMap((dwg) => dwg.texts).filter((item) => item.text.trim());
  const title = texts
    .filter((item) => /(?:FRAMING|LAYOUT|STRUCTURAL)\s+PLAN/i.test(item.text) && /(?:FLOOR|ROOF|BASEMENT|LEVEL|LVL)/i.test(item.text))
    .sort((a, b) => b.text.length - a.text.length)[0]?.text.trim();
  const numberLabel = texts.find((item) => /^DRAWING\s*(?:NO\.?|NUMBER)\s*:?$/i.test(item.text.trim()));
  const number = numberLabel && texts
    .filter((item) => item !== numberLabel && item.pos.y <= numberLabel.pos.y + 1000
      && Math.abs(item.pos.x - numberLabel.pos.x) <= 50000
      && Math.hypot(item.pos.x - numberLabel.pos.x, item.pos.y - numberLabel.pos.y) <= 50000
      && /[A-Z0-9][A-Z0-9_./-]{4,}/i.test(item.text.replace(/\s/g, ''))
      && /\/|(?:^|[-_])(?:ST|STR|S)\s*[-_]?\d/i.test(item.text.replace(/\s/g, ''))
      && !/^(?:SCALE|DRAWN|CHECKED|PROJECT|TITLE|DATE)/i.test(item.text.trim()))
    .sort((a, b) => Math.hypot(a.pos.x - numberLabel.pos.x, a.pos.y - numberLabel.pos.y) - Math.hypot(b.pos.x - numberLabel.pos.x, b.pos.y - numberLabel.pos.y))[0]?.text.trim();
  return { title, number };
}

function addSheetTitle(ws: ExcelJS.Worksheet, text: string) {
  ws.insertRow(1, [text]);
  ws.mergeCells(1, 1, 1, ws.columnCount);
  const cell = ws.getCell('A1');
  cell.font = { bold: true, size: 14 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
  ws.getRow(1).height = 30;
}

function addApprovalTotals(ws: ExcelJS.Worksheet, members: MemberRow[], quantityKey: string, capMode: CapMode, qtyCol: string, unitCol: string, labelCol: string, unit: string) {
  const summary = summarizeQuantities(members, quantityKey, capMode);
  const formulaFor = (selected: MemberRow[]) => {
    const cells = selected.map((member) => `${qtyCol}${members.indexOf(member) + 3}`);
    if (!cells.length) return '0';
    if (cells.length === 1) return `SUM(${cells[0]}:${cells[0]})`;
    const rows = cells.map((cell) => Number(cell.replace(/^[A-Z]+/, '')));
    return rows.every((value, index) => !index || value === rows[index - 1] + 1)
      ? `SUM(${cells[0]}:${cells[cells.length - 1]})` : cells.join('+');
  };
  if (summary.provisionalMembers.length) {
    const row = ws.addRow({});
    row.getCell(labelCol).value = `Provisional subtotal — ${RULES[quantityKey].label}`;
    row.getCell(qtyCol).value = { formula: formulaFor(summary.provisionalMembers), result: Math.round(summary.provisionalTotal * 1000) / 1000 };
    row.getCell(unitCol).value = unit;
    row.font = { bold: true, color: { argb: 'FF9A6700' } };
  }
  const approved = ws.addRow({});
  approved.getCell(labelCol).value = `Approved total — ${RULES[quantityKey].label}`;
  approved.getCell(qtyCol).value = { formula: formulaFor(summary.approvedMembers), result: Math.round(summary.approvedTotal * 1000) / 1000 };
  approved.getCell(unitCol).value = unit;
  approved.font = { bold: true };
}

function addCategorizedFormulaTotal(ws: ExcelJS.Worksheet, cells: string[], qtyCol: string, unitCol: string, label: string, unit: string, result: number) {
  const row = ws.addRow([label]);
  const rowNumbers = cells.map((cell) => Number(cell.replace(/^[A-Z]+/, '')));
  const contiguous = rowNumbers.length > 1 && rowNumbers.every((value, index) => !index || value === rowNumbers[index - 1] + 1);
  const formula = contiguous ? `SUM(${cells[0]}:${cells[cells.length - 1]})` : cells.join('+') || '0';
  row.getCell(qtyCol).value = { formula, result: Math.round(result * 1000) / 1000 };
  row.getCell(unitCol).value = unit;
  row.font = { bold: true };
}

function buildBeamShuttering(ws: ExcelJS.Worksheet, members: MemberRow[], capMode: CapMode, title: string) {
  ws.columns = [
    { header: 'S.No.', key: 'serial', width: 8 }, { header: 'Member', key: 'member', width: 18 },
    { header: 'Shuttering item', key: 'item', width: 18 }, { header: 'Length (m)', key: 'length', width: 12 },
    { header: 'Nos', key: 'nos', width: 8 }, { header: 'Beam width (m)', key: 'width', width: 15 }, { header: 'Beam depth (m)', key: 'depth', width: 15 },
    { header: 'Side 1 slab', key: 'side1Code', width: 12 }, { header: 'Side 1 thk (m)', key: 'side1Thickness', width: 14 },
    { header: 'Side 2 slab', key: 'side2Code', width: 12 }, { header: 'Side 2 thk (m)', key: 'side2Thickness', width: 14 },
    { header: 'Quantity (m²)', key: 'quantity', width: 15 }, { header: 'Unit', key: 'unit', width: 9 },
    { header: 'Remarks', key: 'remarks', width: 34 }, { header: 'Approval status', key: 'approval', width: 16 },
  ];
  addSheetTitle(ws, title);
  styleHeader(ws);
  const sorted = [...members].sort(naturalSort);
  const approvedCells: string[] = [], provisionalCells: string[] = [];
  for (const [index, m] of sorted.entries()) {
    const length = Math.max(m.length || 0, 0), width = Math.max(m.breadth || 0, 0), depth = Math.max(m.height || 0, 0);
    const side1Thickness = Math.min(Math.max(m.slabThicknessSide1 ?? (m.innerSideCount >= 1 ? m.slabThickness : 0), 0), depth);
    const side2Thickness = Math.min(Math.max(m.slabThicknessSide2 ?? (m.innerSideCount >= 2 ? m.slabThickness : 0), 0), depth);
    const remarks = m.needsReview ? `need review${m.reviewReason ? ` (${m.reviewReason})` : ''}` : '';
    const nos = Math.max(m.nos || 0, 0);
    const member = `${m.member || m.id} ${Math.round(width * 1000)}x${Math.round(depth * 1000)}`;
    const approval = isApprovedMember(m, 'beam_shuttering') ? 'Approved' : 'Provisional';
    const bottom = ws.addRow({ serial: index + 1, member, item: 'Beam bottom', length, nos, width, unit: 'm²', remarks: remarks || null, approval });
    bottom.getCell('quantity').value = { formula: `D${bottom.number}*E${bottom.number}*F${bottom.number}`, result: length * nos * width };
    const sideFaces = nos * 2;
    const sideLength = Math.max(m.sideLength || length, 0);
    const sides = ws.addRow({ serial: index + 1, member, item: 'Beam sides', length: sideLength, nos: sideFaces, depth, side1Code: m.slabCodeSide1 ?? null, side1Thickness, side2Code: m.slabCodeSide2 ?? null, side2Thickness, unit: 'm²', remarks: remarks || null, approval });
    // E contains individual side faces (two per physical beam). H/J identify
    // the adjacent slabs; I/K contain their numeric thickness deductions.
    sides.getCell('quantity').value = {
      formula: `D${sides.number}*(E${sides.number}/2)*(MAX(G${sides.number}-I${sides.number},0)+MAX(G${sides.number}-K${sides.number},0))`,
      result: sideLength * (sideFaces / 2) * (Math.max(depth - side1Thickness, 0) + Math.max(depth - side2Thickness, 0)),
    };
    (isApprovedMember(m, 'beam_shuttering') ? approvedCells : provisionalCells).push(`L${bottom.number}`, `L${sides.number}`);
    if (remarks) for (const row of [bottom, sides]) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  const summary = summarizeQuantities(sorted, 'beam_shuttering', capMode);
  if (summary.provisionalMembers.length) addCategorizedFormulaTotal(ws, provisionalCells, 'L', 'M', 'Provisional subtotal — Beam shuttering', 'm²', summary.provisionalTotal);
  addCategorizedFormulaTotal(ws, approvedCells, 'L', 'M', 'Approved total — Beam shuttering', 'm²', summary.approvedTotal);
  for (const c of ['D', 'F', 'G', 'I', 'K', 'L']) ws.getColumn(c).numFmt = '0.000';
}

function buildBeamConcrete(ws: ExcelJS.Worksheet, members: MemberRow[], capMode: CapMode, title: string) {
  ws.columns = [
    { header: 'S.No.', key: 'serial', width: 8 }, { header: 'Member', key: 'member', width: 20 },
    { header: 'Length (m)', key: 'length', width: 12 }, { header: 'Beam width (m)', key: 'breadth', width: 15 },
    { header: 'Beam depth (m)', key: 'height', width: 15 }, { header: 'Nos', key: 'nos', width: 8 },
    { header: 'Quantity (m³)', key: 'quantity', width: 15 }, { header: 'Unit', key: 'unit', width: 9 },
    { header: 'Remarks', key: 'remarks', width: 34 }, { header: 'Measurement basis', key: 'basis', width: 44 }, { header: 'Approval status', key: 'approval', width: 16 },
  ];
  addSheetTitle(ws, title);
  styleHeader(ws);
  const sorted = [...members].sort(naturalSort);
  const rows = membersToRows(sorted, 'beam_concrete', capMode);
  for (const [index, data] of rows.entries()) {
    const row = ws.addRow({
      serial: index + 1, member: data.member, length: data.length,
      breadth: data.breadth, height: data.height, nos: data.nos, unit: data.unit,
      remarks: data.remarks || null, basis: data.basis, approval: data.approval,
    });
    row.getCell('quantity').value = {
      formula: `C${row.number}*D${row.number}*E${row.number}*F${row.number}`,
      result: data.quantity,
    };
    if (data.remarks) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  addApprovalTotals(ws, sorted, 'beam_concrete', capMode, 'G', 'H', 'F', 'm³');
  for (const column of ['C', 'D', 'E', 'G']) ws.getColumn(column).numFmt = '0.000';
}

function buildSlabShuttering(ws: ExcelJS.Worksheet, members: MemberRow[], capMode: CapMode, title: string) {
  ws.columns = [
    { header: 'S.No.', key: 'serial', width: 8 }, { header: 'Member', key: 'member', width: 22 },
    { header: 'Shuttering item', key: 'item', width: 18 }, { header: 'Length (m)', key: 'length', width: 12 },
    { header: 'Breadth (m)', key: 'breadth', width: 13 }, { header: 'Openings (m²)', key: 'openings', width: 15 },
    { header: 'Exact polygon area (m²)', key: 'exactArea', width: 22 }, { header: 'Quantity (m²)', key: 'quantity', width: 15 }, { header: 'Unit', key: 'unit', width: 9 },
    { header: 'Remarks', key: 'remarks', width: 34 }, { header: 'Approval status', key: 'approval', width: 16 },
  ];
  addSheetTitle(ws, title);
  styleHeader(ws);
  const sorted = [...members].sort(naturalSort);
  for (const [index, m] of sorted.entries()) {
    const length = Math.max(m.length || 0, 0), breadth = Math.max(m.breadth || 0, 0), openings = Math.max(m.openings || 0, 0);
    const remarks = m.needsReview ? `need review${m.reviewReason ? ` (${m.reviewReason})` : ''}` : '';
    const exactArea = m.netArea != null ? Math.max(m.netArea + openings, 0) : null;
    const result = exactArea != null ? Math.max(exactArea - openings, 0) : Math.max(length * breadth - openings, 0);
    const row = ws.addRow({ serial: index + 1, member: m.member || m.id, item: 'Slab soffit', length, breadth, openings, exactArea, unit: 'm²', remarks: remarks || null, approval: isApprovedMember(m, 'slab_shuttering') ? 'Approved' : 'Provisional' });
    row.getCell('quantity').value = { formula: `MAX(IF(G${row.number}>0,G${row.number},D${row.number}*E${row.number})-F${row.number},0)`, result };
    if (remarks) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  addApprovalTotals(ws, sorted, 'slab_shuttering', capMode, 'H', 'I', 'G', 'm²');
  for (const c of ['D', 'E', 'F', 'G', 'H']) ws.getColumn(c).numFmt = '0.000';
}

function genericQuantityFormula(quantityKey: string, row: number, member: MemberRow, result: number, capMode: CapMode): string {
  const C = `B${row}`, D = `C${row}`, E = `D${row}`, F = `E${row}`, G = `F${row}`, H = `G${row}`, I = `H${row}`;
  switch (quantityKey) {
    case 'column_concrete': return `${C}*${D}*${E}*${I}`;
    case 'beam_concrete': {
      // membersToRows has already placed the net, support-excluded length in C.
      return `${C}*${D}*${E}*${I}`;
    }
    case 'column_steel': case 'beam_steel': case 'steel_bbs': return `${C}*${I}*(${G}^2/162)`;
    case 'slab_concrete': return member.netArea != null
      ? `${Math.max(member.netArea, 0)}*${E}*${I}`
      : `MAX(${C}*${D}-${F},0)*${E}*${I}`;
    case 'raft_concrete': return `${C}*${D}*${E}*${I}`;
    case 'raft_shuttering': return `2*(${C}+${D})*${E}*${I}`;
    case 'brickwork': return `MAX(${C}*${E}-${F},0)*${D}*${I}`;
    case 'plaster': case 'paint': return `MAX(${C}*${E}-${F},0)*${I}`;
    case 'flooring': return `${C}*${D}*${I}`;
    // Keep uncommon/special rules as an Excel formula rather than a fixed
    // literal, while preserving the verified engine result.
    default: return `${Math.round(result * 1e6) / 1e6}`;
  }
}

export async function buildMbXlsx(members: MemberRow[], quantityKey: string, capMode: CapMode, project = 'QSS Project', dwgs: NormalizedDwg[] = []): Promise<Blob> {
  const rule = RULES[quantityKey];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QSS Pro';
  const ws = wb.addWorksheet(rule.label.slice(0, 28));
  const meta = drawingMeta(dwgs);
  const title = `${rule.label} MB Sheet${meta.title ? ` — ${meta.title}` : ''}${meta.number ? ` — Drawing No. ${meta.number}` : ''}`;
  if (quantityKey === 'beam_shuttering') {
    buildBeamShuttering(ws, members, capMode, title);
    return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  if (quantityKey === 'beam_concrete') {
    buildBeamConcrete(ws, members, capMode, title);
    return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  if (quantityKey === 'slab_shuttering') {
    buildSlabShuttering(ws, members, capMode, title);
    return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  ws.columns = MB_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.key === 'basis' ? 44 : c.key === 'member' || c.key === 'remarks' ? 22 : 12 }));
  addSheetTitle(ws, title);
  styleHeader(ws);
  const exportRows = membersToRows(members, quantityKey, capMode);
  for (const [index, r] of exportRows.entries()) {
    const row = ws.addRow(r);
    row.getCell('quantity').value = {
      formula: genericQuantityFormula(quantityKey, row.number, members[index], r.quantity, capMode),
      result: r.quantity,
    };
    if (r.remarks) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }));
  }
  addApprovalTotals(ws, members, quantityKey, capMode, 'I', 'J', 'H', UNIT_LABEL[rule.unit]);
  ws.getColumn('I').numFmt = '0.000';
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
