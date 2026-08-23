import type { NormalizedDwg, Pt, Segment } from '../domain/types.js';
import type { MemberRow } from '../takeoff/rules.js';

const pair = (code: number, value: string | number) => `${code}\r\n${value}\r\n`;
const cleanLayer = (value: string) => (value || 'QSS_REFERENCE').replace(/[^A-Za-z0-9_$-]/g, '_').slice(0, 60);

function line(s: Segment, layer: string, colour = 8): string {
  return pair(0, 'LINE') + pair(8, layer) + pair(62, colour)
    + pair(10, s.a.x) + pair(20, s.a.y) + pair(30, 0)
    + pair(11, s.b.x) + pair(21, s.b.y) + pair(31, 0);
}

function circle(c: Pt, radius: number): string {
  return pair(0, 'CIRCLE') + pair(8, 'QSS_PANEL_MARK') + pair(62, 3)
    + pair(10, c.x) + pair(20, c.y) + pair(30, 0) + pair(40, radius);
}

function centredText(c: Pt, value: string, height: number): string {
  return pair(0, 'TEXT') + pair(8, 'QSS_PANEL_MARK') + pair(62, 3)
    + pair(10, c.x) + pair(20, c.y) + pair(30, 0)
    + pair(40, height) + pair(1, value) + pair(72, 1) + pair(73, 2)
    + pair(11, c.x) + pair(21, c.y) + pair(31, 0);
}

export function slabReferenceGeometry(dwgs: NormalizedDwg[]): NormalizedDwg | undefined {
  return [...dwgs].sort((a, b) => {
    const score = (d: NormalizedDwg) => d.texts.filter((t) => /slabs?\s*no/i.test(t.layer) && /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, ''))).length * 1000
      + d.segments.filter((s) => /beam|wall|col|pardi|rcc/i.test(s.layer)).length;
    return score(b) - score(a);
  })[0];
}

/** ASCII DXF reference plan. Panel marks are exactly the P-numbers used in the Excel Member column. */
export function buildSlabReferenceDxf(dwgs: NormalizedDwg[], members: MemberRow[]): string {
  const dwg = slabReferenceGeometry(dwgs);
  let entities = '';
  if (dwg) {
    for (const s of dwg.segments) entities += line(s, cleanLayer(s.layer));
    for (const p of dwg.polylines) for (let i = 0; i < p.pts.length - 1; i++)
      entities += line({ layer: p.layer, a: p.pts[i], b: p.pts[i + 1] }, cleanLayer(p.layer));
  }
  const span = dwg ? Math.max(dwg.extents.max.x - dwg.extents.min.x, dwg.extents.max.y - dwg.extents.min.y) : 50000;
  const radius = Math.min(750, Math.max(250, span / 180));
  for (const m of members) {
    if (!Number.isFinite(m.cadX) || !Number.isFinite(m.cadY)) continue;
    const c = { x: m.cadX as number, y: m.cadY as number };
    const panelNo = m.member.match(/^P\d+/i)?.[0] ?? m.member;
    if ([m.cadX0, m.cadY0, m.cadX1, m.cadY1].every(Number.isFinite)) {
      const x0 = m.cadX0 as number, y0 = m.cadY0 as number, x1 = m.cadX1 as number, y1 = m.cadY1 as number;
      entities += line({ layer: 'QSS_PANEL_BOUNDARY', a: { x: x0, y: y0 }, b: { x: x1, y: y0 } }, 'QSS_PANEL_BOUNDARY', 3);
      entities += line({ layer: 'QSS_PANEL_BOUNDARY', a: { x: x1, y: y0 }, b: { x: x1, y: y1 } }, 'QSS_PANEL_BOUNDARY', 3);
      entities += line({ layer: 'QSS_PANEL_BOUNDARY', a: { x: x1, y: y1 }, b: { x: x0, y: y1 } }, 'QSS_PANEL_BOUNDARY', 3);
      entities += line({ layer: 'QSS_PANEL_BOUNDARY', a: { x: x0, y: y1 }, b: { x: x0, y: y0 } }, 'QSS_PANEL_BOUNDARY', 3);
    }
    entities += circle(c, radius);
    entities += line({ layer: 'QSS_PANEL_MARK', a: { x: c.x - radius * 0.75, y: c.y }, b: { x: c.x + radius * 0.75, y: c.y } }, 'QSS_PANEL_MARK', 2);
    entities += line({ layer: 'QSS_PANEL_MARK', a: { x: c.x, y: c.y - radius * 0.75 }, b: { x: c.x, y: c.y + radius * 0.75 } }, 'QSS_PANEL_MARK', 2);
    entities += centredText({ x: c.x, y: c.y + radius * 0.15 }, panelNo, radius * 0.9);
  }
  return pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities + pair(0, 'ENDSEC') + pair(0, 'EOF');
}

/** Insert panel marks into the model-space ENTITIES section of a preserved CAD DXF. */
export function appendSlabPanelMarksToDxf(original: string, members: MemberRow[]): string {
  // Accept padded group codes and LF, CRLF, or legacy CR-only line endings.
  const section = /(?:^|[\r\n])\s*0\s+(?:SECTION)\s+2\s+(?:ENTITIES)\s+/i.exec(original);
  if (!section) throw new Error('Converted CAD has no DXF ENTITIES section');
  const tail = original.slice(section.index + section[0].length);
  const end = /(?:^|[\r\n])\s*0\s+(?:ENDSEC)(?=\s)/i.exec(tail);
  if (!end) throw new Error('Converted CAD has an incomplete DXF ENTITIES section');
  const insertAt = section.index + section[0].length + end.index;
  const coords = members.filter((m) => Number.isFinite(m.cadX) && Number.isFinite(m.cadY));
  const xs = coords.map((m) => m.cadX as number), ys = coords.map((m) => m.cadY as number);
  const span = coords.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 50000;
  const radius = Math.min(750, Math.max(250, span / 120));
  let marks = '';
  for (const m of coords) {
    const c = { x: m.cadX as number, y: m.cadY as number };
    const panelNo = m.member.match(/^P\d+/i)?.[0] ?? m.member;
    marks += circle(c, radius);
    marks += line({ layer: 'QSS_PANEL_MARK', a: { x: c.x - radius * 0.75, y: c.y }, b: { x: c.x + radius * 0.75, y: c.y } }, 'QSS_PANEL_MARK', 2);
    marks += line({ layer: 'QSS_PANEL_MARK', a: { x: c.x, y: c.y - radius * 0.75 }, b: { x: c.x, y: c.y + radius * 0.75 } }, 'QSS_PANEL_MARK', 2);
    marks += centredText({ x: c.x, y: c.y + radius * 0.15 }, panelNo, radius * 0.9);
  }
  return original.slice(0, insertAt) + '\r\n' + marks + original.slice(insertAt);
}

const ascii = (value: string) => new TextEncoder().encode(`${value}\0`);
const concatBytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const code = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255]);
const int16 = (value: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, value, true); return b; };
const float64 = (value: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, value, true); return b; };
const binaryString = (group: number, value: string) => concatBytes(code(group), ascii(value));
const binaryInt16 = (group: number, value: number) => concatBytes(code(group), int16(value));
const binaryDouble = (group: number, value: number) => concatBytes(code(group), float64(value));

function findBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Insert marks into an AutoCAD binary DXF (R13+ two-byte group codes). */
export function appendSlabPanelMarksToBinaryDxf(original: Uint8Array, members: MemberRow[]): Uint8Array {
  const entities = concatBytes(code(0), ascii('ENTITIES'));
  const endsec = concatBytes(code(0), ascii('ENDSEC'));
  const sectionAt = findBytes(original, entities);
  const insertAt = sectionAt < 0 ? -1 : findBytes(original, endsec, sectionAt + entities.length);
  if (insertAt < 0) throw new Error('Binary DXF has no editable ENTITIES section');
  const coords = members.filter((m) => Number.isFinite(m.cadX) && Number.isFinite(m.cadY));
  const xs = coords.map((m) => m.cadX as number), ys = coords.map((m) => m.cadY as number);
  const span = coords.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 50000;
  const radius = Math.min(750, Math.max(250, span / 120));
  const records: Uint8Array[] = [];
  const entityBase = (kind: string, colour: number) => concatBytes(binaryString(0, kind), binaryString(8, 'QSS_PANEL_MARK'), binaryInt16(62, colour));
  for (const m of coords) {
    const x = m.cadX as number, y = m.cadY as number;
    const panelNo = m.member.match(/^P\d+/i)?.[0] ?? m.member;
    records.push(concatBytes(entityBase('CIRCLE', 3), binaryDouble(10, x), binaryDouble(20, y), binaryDouble(30, 0), binaryDouble(40, radius)));
    records.push(concatBytes(entityBase('LINE', 2), binaryDouble(10, x - radius * 0.75), binaryDouble(20, y), binaryDouble(30, 0), binaryDouble(11, x + radius * 0.75), binaryDouble(21, y), binaryDouble(31, 0)));
    records.push(concatBytes(entityBase('LINE', 2), binaryDouble(10, x), binaryDouble(20, y - radius * 0.75), binaryDouble(30, 0), binaryDouble(11, x), binaryDouble(21, y + radius * 0.75), binaryDouble(31, 0)));
    records.push(concatBytes(entityBase('TEXT', 3), binaryDouble(10, x), binaryDouble(20, y + radius * 0.15), binaryDouble(30, 0), binaryDouble(40, radius * 0.9), binaryString(1, panelNo), binaryInt16(72, 1), binaryInt16(73, 2), binaryDouble(11, x), binaryDouble(21, y), binaryDouble(31, 0)));
  }
  return concatBytes(original.slice(0, insertAt), ...records, original.slice(insertAt));
}
