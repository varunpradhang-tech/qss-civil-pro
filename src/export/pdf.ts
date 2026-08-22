import type { MemberRow } from '../takeoff/rules.js';
import type { NormalizedDwg, Pt } from '../domain/types.js';
import { slabReferenceGeometry } from './dxf.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W = 1190.55; // A3 landscape, points
const PAGE_H = 841.89;
const MARGIN = 28;
const n = (v: number) => Number.isFinite(v) ? v.toFixed(2) : '0';
const pdfText = (v: string) => v.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Vector PDF reference plan with the same P-numbers used by the Excel Member column. */
export function buildSlabReferencePdf(dwgs: NormalizedDwg[], members: MemberRow[]): Blob {
  const dwg = slabReferenceGeometry(dwgs);
  const panelPoints: Pt[] = members.flatMap((m) => [
    ...(Number.isFinite(m.cadX0) && Number.isFinite(m.cadY0) ? [{ x: m.cadX0 as number, y: m.cadY0 as number }] : []),
    ...(Number.isFinite(m.cadX1) && Number.isFinite(m.cadY1) ? [{ x: m.cadX1 as number, y: m.cadY1 as number }] : []),
    ...(Number.isFinite(m.cadX) && Number.isFinite(m.cadY) ? [{ x: m.cadX as number, y: m.cadY as number }] : []),
  ]);
  // Reference sheets are framed around detected panels. Full DWG extents often include
  // remote legends/title blocks that would shrink the actual slab plan to a tiny speck.
  const points: Pt[] = panelPoints.length ? panelPoints : dwg ? [dwg.extents.min, dwg.extents.max] : [];
  const bounds = points.length ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const rawMinX = Math.min(...bounds.map((p) => p.x)), rawMaxX = Math.max(...bounds.map((p) => p.x));
  const rawMinY = Math.min(...bounds.map((p) => p.y)), rawMaxY = Math.max(...bounds.map((p) => p.y));
  const pad = Math.max(rawMaxX - rawMinX, rawMaxY - rawMinY, 1000) * 0.04;
  const minX = rawMinX - pad, maxX = rawMaxX + pad, minY = rawMinY - pad, maxY = rawMaxY + pad;
  const scale = Math.min((PAGE_W - 2 * MARGIN) / Math.max(maxX - minX, 1), (PAGE_H - 2 * MARGIN) / Math.max(maxY - minY, 1));
  const ox = MARGIN + (PAGE_W - 2 * MARGIN - (maxX - minX) * scale) / 2;
  const oy = MARGIN + (PAGE_H - 2 * MARGIN - (maxY - minY) * scale) / 2;
  const map = (p: Pt) => ({ x: ox + (p.x - minX) * scale, y: oy + (p.y - minY) * scale });
  let stream = '0.55 G 0.35 w\n';
  if (dwg) {
    const visible = (a: Pt, b: Pt) => Math.max(a.x, b.x) >= minX && Math.min(a.x, b.x) <= maxX && Math.max(a.y, b.y) >= minY && Math.min(a.y, b.y) <= maxY;
    for (const s of dwg.segments) if (visible(s.a, s.b)) { const a = map(s.a), b = map(s.b); stream += `${n(a.x)} ${n(a.y)} m ${n(b.x)} ${n(b.y)} l S\n`; }
    for (const p of dwg.polylines) for (let i = 0; i < p.pts.length - 1; i++) if (visible(p.pts[i], p.pts[i + 1])) { const a = map(p.pts[i]), b = map(p.pts[i + 1]); stream += `${n(a.x)} ${n(a.y)} m ${n(b.x)} ${n(b.y)} l S\n`; }
  }
  const radius = Math.max(8, Math.min(18, Math.max(PAGE_W, PAGE_H) / 75));
  const k = 0.5522847498;
  stream += '0 0.65 0 RG 0.8 w\n';
  for (const m of members) {
    if (!Number.isFinite(m.cadX) || !Number.isFinite(m.cadY)) continue;
    const c = map({ x: m.cadX as number, y: m.cadY as number });
    const panelNo = m.member.match(/^P\d+/i)?.[0] ?? m.member;
    if ([m.cadX0, m.cadY0, m.cadX1, m.cadY1].every(Number.isFinite)) {
      const a = map({ x: m.cadX0 as number, y: m.cadY0 as number }), b = map({ x: m.cadX1 as number, y: m.cadY1 as number });
      stream += `0 0.7 0 RG 0.9 w ${n(a.x)} ${n(a.y)} ${n(b.x - a.x)} ${n(b.y - a.y)} re S\n`;
    }
    stream += `${n(c.x + radius)} ${n(c.y)} m ${n(c.x + radius)} ${n(c.y + k * radius)} ${n(c.x + k * radius)} ${n(c.y + radius)} ${n(c.x)} ${n(c.y + radius)} c `;
    stream += `${n(c.x - k * radius)} ${n(c.y + radius)} ${n(c.x - radius)} ${n(c.y + k * radius)} ${n(c.x - radius)} ${n(c.y)} c `;
    stream += `${n(c.x - radius)} ${n(c.y - k * radius)} ${n(c.x - k * radius)} ${n(c.y - radius)} ${n(c.x)} ${n(c.y - radius)} c `;
    stream += `${n(c.x + k * radius)} ${n(c.y - radius)} ${n(c.x + radius)} ${n(c.y - k * radius)} ${n(c.x + radius)} ${n(c.y)} c S\n`;
    stream += '1 0.75 0 RG 0.6 w\n';
    stream += `${n(c.x - radius * 0.75)} ${n(c.y)} m ${n(c.x + radius * 0.75)} ${n(c.y)} l S ${n(c.x)} ${n(c.y - radius * 0.75)} m ${n(c.x)} ${n(c.y + radius * 0.75)} l S\n`;
    stream += `0 0.65 0 rg BT /F1 ${n(radius * 0.9)} Tf ${n(c.x - panelNo.length * radius * 0.24)} ${n(c.y + radius * 0.12)} Td (${pdfText(panelNo)}) Tj ET\n0 0.65 0 RG\n`;
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

/** Add QSS panel marks to the PDF rendered from the original CAD drawing. */
export async function overlayPanelNumbersOnPdf(source: ArrayBuffer, dwg: NormalizedDwg | undefined, members: MemberRow[]): Promise<Blob> {
  const pdf = await PDFDocument.load(source);
  const page = pdf.getPages()[0];
  if (!page || !dwg) return new Blob([new Uint8Array(await pdf.save()).buffer], { type: 'application/pdf' });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const min = dwg.extents.min, max = dwg.extents.max;
  const scale = Math.min(width / Math.max(max.x - min.x, 1), height / Math.max(max.y - min.y, 1));
  const ox = (width - (max.x - min.x) * scale) / 2;
  const oy = (height - (max.y - min.y) * scale) / 2;
  const radius = Math.max(7, Math.min(16, Math.max(width, height) / 70));
  for (const m of members) {
    if (!Number.isFinite(m.cadX) || !Number.isFinite(m.cadY)) continue;
    const x = ox + ((m.cadX as number) - min.x) * scale;
    const y = oy + ((m.cadY as number) - min.y) * scale;
    const panelNo = m.member.match(/^P\d+/i)?.[0] ?? m.member;
    page.drawCircle({ x, y, size: radius, borderColor: rgb(0, 0.75, 0), borderWidth: 1.2 });
    page.drawLine({ start: { x: x - radius * 0.75, y }, end: { x: x + radius * 0.75, y }, color: rgb(1, 0.75, 0), thickness: 0.8 });
    page.drawLine({ start: { x, y: y - radius * 0.75 }, end: { x, y: y + radius * 0.75 }, color: rgb(1, 0.75, 0), thickness: 0.8 });
    const size = radius * 0.85;
    page.drawText(panelNo, { x: x - font.widthOfTextAtSize(panelNo, size) / 2, y: y + radius * 0.12, size, font, color: rgb(0, 0.65, 0) });
  }
  return new Blob([new Uint8Array(await pdf.save()).buffer], { type: 'application/pdf' });
}
