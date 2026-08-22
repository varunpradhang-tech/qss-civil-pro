import { describe, expect, it } from 'vitest';
import { membersToCsv, membersToRows } from '../src/export/mb.js';
import { buildMbXlsx } from '../src/export/xlsx.js';
import ExcelJS from 'exceljs';
import { emptyRow, type MemberRow } from '../src/takeoff/rules.js';

function row(over: Partial<MemberRow>): MemberRow {
  return { ...emptyRow('m1', 'Basement'), member: 'S1', length: 4, breadth: 3, nos: 1, ...over };
}

describe('MB export (member rows)', () => {
  it('computes slab shuttering quantity per row', () => {
    const [r] = membersToRows([row({})], 'slab_shuttering', 'excluded');
    expect(r.member).toBe('S1');
    expect(r.quantity).toBe(12); // 4 × 3
    expect(r.unit).toBe('m²');
    expect(r.remarks).toBe('');
  });

  it('computes slab concrete with thickness (height)', () => {
    const [r] = membersToRows([row({ height: 0.175 })], 'slab_concrete', 'excluded');
    expect(r.quantity).toBe(2.1); // 12 × 0.175
    expect(r.unit).toBe('m³');
  });

  it('beam shuttering deducts slab thickness on sides', () => {
    const [r] = membersToRows([row({ breadth: 0.3, height: 0.6, slabThickness: 0.15, innerSideCount: 2, sideLength: 5, length: 5 })], 'beam_shuttering', 'excluded');
    // bottom 5×0.3=1.5 ; side 2×5×(0.6−0.15)=4.5 ; total 6
    expect(r.quantity).toBe(6);
  });

  it('beam shuttering deducts slab thickness from one side for an edge beam', () => {
    const [r] = membersToRows([row({ breadth: 0.3, height: 0.6, slabThickness: 0.15, innerSideCount: 1, sideLength: 5, length: 5 })], 'beam_shuttering', 'excluded');
    // bottom 5×0.3=1.5 ; sides 5×[(0.6−0.15)+0.6]=5.25 ; total 6.75
    expect(r.quantity).toBe(6.75);
  });

  it('beam shuttering uses full height on both fully exposed sides', () => {
    const [r] = membersToRows([row({ breadth: 0.3, height: 0.6, slabThickness: 0.15, innerSideCount: 0, sideLength: 5, length: 5 })], 'beam_shuttering', 'excluded');
    // bottom 5×0.3=1.5 ; sides 2×5×0.6=6 ; total 7.5
    expect(r.quantity).toBe(7.5);
  });

  it('beam shuttering deducts different adjacent slab thicknesses on each side', () => {
    const [r] = membersToRows([row({ breadth: 0.3, height: 0.65, slabThicknessSide1: 0.15, slabThicknessSide2: 0.2, sideLength: 3.976, length: 3.976 })], 'beam_shuttering', 'excluded');
    // bottom 3.976×0.3 + sides 3.976×[(0.65−0.15)+(0.65−0.20)]
    expect(r.quantity).toBe(4.97);
  });

  it('CSV has header, review remarks, and a total row', () => {
    const csv = membersToCsv([row({ member: 'S1, corner' }), row({ member: 'S2', length: 2, breadth: 4, needsReview: true, reviewReason: 'dim uncertain' })], 'slab_shuttering', 'excluded');
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Quantity');
    expect(csv).toContain('"S1, corner"');       // RFC-4180 quoting
    expect(csv).toContain('need review');
    expect(lines[lines.length - 1]).toMatch(/^Total — Slab shuttering,/);
    expect(lines[lines.length - 1]).toContain('20'); // 12 + 8
  });

  it('exports sorted beam bottom and side rows with formulas', async () => {
    const blob = await buildMbXlsx([
      row({ member: 'B10', length: 4, breadth: 0.3, height: 0.6, slabThickness: 0.15, innerSideCount: 2 }),
      row({ member: 'B2', length: 5, breadth: 0.25, height: 0.5, slabThickness: 0.15, innerSideCount: 1 }),
    ], 'beam_shuttering', 'excluded');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await blob.arrayBuffer()); const ws = wb.worksheets[0];
    for (const unwanted of ['Dia (mm)', 'Spacing (mm)', 'Nos', 'Measurement basis']) expect(ws.getRow(1).values).not.toContain(unwanted);
    expect(ws.getCell('A2').value).toBe(1); expect(ws.getCell('B2').value).toBe('B2'); expect(ws.getCell('D2').value).toBe('Beam bottom'); expect(ws.getCell('D3').value).toBe('Beam sides');
    expect((ws.getCell('L2').value as ExcelJS.CellFormulaValue).formula).toBe('E2*F2');
    expect((ws.getCell('L3').value as ExcelJS.CellFormulaValue).formula).toBe('E3*(2*G3-I3-K3)');
    expect(ws.getCell('B4').value).toBe('B10'); expect((ws.getCell('L6').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(L2:L5)');
  });

  it('exports slab shuttering with formula quantities and no reinforcement columns', async () => {
    const blob = await buildMbXlsx([row({ member: 'S2', openings: 1 })], 'slab_shuttering', 'excluded');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await blob.arrayBuffer()); const ws = wb.worksheets[0];
    for (const unwanted of ['Dia (mm)', 'Spacing (mm)', 'Nos', 'Measurement basis']) expect(ws.getRow(1).values).not.toContain(unwanted);
    expect(ws.getCell('A2').value).toBe(1);
    expect((ws.getCell('H2').value as ExcelJS.CellFormulaValue).formula).toBe('MAX(E2*F2-G2,0)');
    expect((ws.getCell('H3').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(H2:H2)');
  });
});
