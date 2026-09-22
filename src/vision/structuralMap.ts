import type { NormalizedDwg, Pt, Segment } from '../domain/types.js';
import { polygoniseCadFaces } from '../extract/topology.js';
import type { PanelProposalBox } from '../extract/panels.js';
import type { PlanBounds } from './renderDwg.js';

export interface StructuralBayQuestion {
  bounds: PlanBounds;
  originalFaces: number;
  alternatives: Array<{ polygon: Pt[]; areaM2: number; repairedGaps: number; gapMm: number }>;
  beamMarks: Array<{ label: string; point: Pt }>;
}

const structural = /beam|wall|col|pardi|rcc|slab|chajja/i;
const excluded = /grid|axis|centre|center|dim|text|number|schedule|section|detail|cut|void|shaft|lift|duct/i;
const beamNumber = /^(?:T\d+)?M?B\d+[A-Z]?$/i;
const length = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p: Pt, box: PlanBounds) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
const inPolygon = (point: Pt, polygon: Pt[]) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
const covered = (point: Pt, panels: PanelProposalBox[]) => panels.some((panel) => {
  if (!inside(point, panel.box)) return false;
  if (panel.polygonParts?.length) return panel.polygonParts.some((part) => inPolygon(point, part));
  return !panel.polygon || inPolygon(point, panel.polygon);
});

/** An independent, reversible working graph. Never edits the uploaded DWG.
 * Test both original and gap-closed graphs; retain the exact proposed repair
 * and its CAD evidence for a narrow visual question. No quantity is added here. */
export function buildStructuralBayQuestions(dwg: NormalizedDwg, panels: PanelProposalBox[], crops: PlanBounds[]): StructuralBayQuestion[] {
  const all: Segment[] = [...dwg.segments];
  for (const line of dwg.polylines) {
    for (let i = 1; i < line.pts.length; i++) all.push({ a: line.pts[i - 1], b: line.pts[i], layer: line.layer });
    if (line.closed && line.pts.length > 2) all.push({ a: line.pts[line.pts.length - 1], b: line.pts[0], layer: line.layer });
  }
  return crops.map((bounds) => {
    const centre = { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 };
    const local = all.filter((line) => structural.test(line.layer) && !excluded.test(line.layer)
      && length(line.a, line.b) >= 120 && (inside(line.a, bounds) || inside(line.b, bounds)));
    const original = polygoniseCadFaces(local, 100);
    const endpoints = local.flatMap((line, index) => [{ point: line.a, index }, { point: line.b, index }]);
    const bridges: Segment[] = [];
    for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i], b = endpoints[j];
      if (a.index === b.index) continue;
      const gap = length(a.point, b.point);
      if (gap < 40 || gap > 160) continue;
      // Only repair a tiny collinear drafting break. A perpendicular corner
      // or a column-width opening is not evidence of a missing beam face.
      const first = local[a.index], second = local[b.index];
      const horizontal = (line: Segment) => Math.abs(line.a.y - line.b.y) <= 35;
      const vertical = (line: Segment) => Math.abs(line.a.x - line.b.x) <= 35;
      if (!((horizontal(first) && horizontal(second) && Math.abs(a.point.y - b.point.y) <= 35)
        || (vertical(first) && vertical(second) && Math.abs(a.point.x - b.point.x) <= 35))) continue;
      bridges.push({ a: a.point, b: b.point, layer: 'QSS-WORKING-GAP-REPAIR' });
    }
    const beamMarks = dwg.texts.filter((text) => beamNumber.test(text.text.replace(/\s/g, '')) && inside(text.pos, bounds))
      .map((text) => ({ label: text.text.trim(), point: text.pos }));
    const alternatives = polygoniseCadFaces([...local, ...bridges], 100)
      .filter((face) => face.areaM2 >= 1 && face.areaM2 <= 120 && inPolygon(centre, face.polygon)
        && !covered(centre, panels) && !beamMarks.some((mark) => inPolygon(mark.point, face.polygon)))
      .map((face) => {
        const repaired = bridges.filter((bridge) => face.polygon.some((point, i) => {
          const next = face.polygon[(i + 1) % face.polygon.length];
          return (length(point, bridge.a) <= 120 && length(next, bridge.b) <= 120)
            || (length(point, bridge.b) <= 120 && length(next, bridge.a) <= 120);
        }));
        return { polygon: face.polygon, areaM2: face.areaM2, repairedGaps: repaired.length,
          gapMm: repaired.reduce((sum, bridge) => sum + length(bridge.a, bridge.b), 0) };
      })
      .sort((a, b) => a.repairedGaps - b.repairedGaps || a.gapMm - b.gapMm || a.areaM2 - b.areaM2)
      .slice(0, 3);
    return { bounds, originalFaces: original.filter((face) => inPolygon(centre, face.polygon)).length,
      alternatives, beamMarks };
  });
}
