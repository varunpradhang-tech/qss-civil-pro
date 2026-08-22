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
