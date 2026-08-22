import type { MemberRow } from '../takeoff/rules.js';
import type { NormalizedDwg, Pt } from '../domain/types.js';
import { slabReferenceGeometry } from './dxf.js';

const PAGE_W = 1190.55; // A3 landscape, points
const PAGE_H = 841.89;
const MARGIN = 28;
const n = (v: number) => Number.isFinite(v) ? v.toFixed(2) : '0';
const pdfText = (v: string) => v.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Vector PDF reference plan with the same P-numbers used by the Excel Member column. */
export function buildSlabReferencePdf(dwgs: NormalizedDwg[], members: MemberRow[]): Blob {
  const dwg = slabReferenceGeometry(dwgs);
  const points: Pt[] = dwg ? [dwg.extents.min, dwg.extents.max] : members.filter((m) => Number.isFinite(m.cadX) && Number.isFinite(m.cadY)).map((m) => ({ x: m.cadX as number, y: m.cadY as number }));
  const bounds = points.length ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const minX = Math.min(...bounds.map((p) => p.x)), maxX = Math.max(...bounds.map((p) => p.x));
  const minY = Math.min(...bounds.map((p) => p.y)), maxY = Math.max(...bounds.map((p) => p.y));
  const scale = Math.min((PAGE_W - 2 * MARGIN) / Math.max(maxX - minX, 1), (PAGE_H - 2 * MARGIN) / Math.max(maxY - minY, 1));
  const ox = MARGIN + (PAGE_W - 2 * MARGIN - (maxX - minX) * scale) / 2;
  const oy = MARGIN + (PAGE_H - 2 * MARGIN - (maxY - minY) * scale) / 2;
  const map = (p: Pt) => ({ x: ox + (p.x - minX) * scale, y: oy + (p.y - minY) * scale });
  let stream = '0.55 G 0.35 w\n';
  if (dwg) {
    for (const s of dwg.segments) { const a = map(s.a), b = map(s.b); stream += `${n(a.x)} ${n(a.y)} m ${n(b.x)} ${n(b.y)} l S\n`; }
    for (const p of dwg.polylines) for (let i = 0; i < p.pts.length - 1; i++) { const a = map(p.pts[i]), b = map(p.pts[i + 1]); stream += `${n(a.x)} ${n(a.y)} m ${n(b.x)} ${n(b.y)} l S\n`; }
  }
  const radius = Math.max(8, Math.min(18, Math.max(PAGE_W, PAGE_H) / 75));
  const k = 0.5522847498;
  stream += '0 0.65 0 RG 0.8 w\n';
  for (const m of members) {
    if (!Number.isFinite(m.cadX) || !Number.isFinite(m.cadY)) continue;
    const c = map({ x: m.cadX as number, y: m.cadY as number });
    const panelNo = m.member.match(/^P\d+/i)?.[0] ?? m.member;
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
