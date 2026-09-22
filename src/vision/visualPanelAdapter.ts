import type { Pt } from '../domain/types.js';
import type { Sheet } from '../state/store.js';
import { emptyRow, type MemberRow } from '../takeoff/rules.js';
import { assessVisualRepair } from './visualRepair.js';

function contains(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function intersectionArea(a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
    * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

/** Reconcile visually proposed bays with original CAD evidence. This is a
 * working-geometry repair, never a modification of the uploaded DWG. */
export function appendVisualSlabMembers(members: MemberRow[], sheet: Sheet, floor: string): number {
  let added = 0;
  for (const visual of sheet.visualPanels ?? []) {
    if (visual.confidence < 0.9 || visual.polygon.length < 3) continue;
    // Recheck persisted proposals too: older saved projects predate this gate.
    // A chajja with a genuinely free outer face needs separate human review;
    // beam-edge corroboration alone cannot determine its perimeter.
    const evidence = assessVisualRepair(sheet.dwg, visual.polygon);
    if (!evidence.accepted || visual.type === 'cantilever_chajja') continue;
    const xs = visual.polygon.map((p) => p.x), ys = visual.polygon.map((p) => p.y);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const boxArea = (box.x1 - box.x0) * (box.y1 - box.y0);
    if (boxArea <= 0 || visual.areaM2 < 0.2) continue;
    const overlaps = members.filter((member) => member.cadX0 != null && member.cadY0 != null
      && member.cadX1 != null && member.cadY1 != null
      && intersectionArea(box, { x0: Math.min(member.cadX0, member.cadX1), y0: Math.min(member.cadY0, member.cadY1),
        x1: Math.max(member.cadX0, member.cadX1), y1: Math.max(member.cadY0, member.cadY1) }) > boxArea * 0.05);
    // A visual outline may repair exactly one coarse inferred slab. It must
    // not erase two separately identified panels or swallow a neighboring bay.
    if (overlaps.length > 1) continue;
    const mark = sheet.dwg.texts.find((text) => /slab\s*(?:thk|thickness|depth)/i.test(text.layer)
      && /^(?:\d{2,3})(?:\s*mm)?$/i.test(text.text.trim()) && contains(text.pos, visual.polygon));
    const thicknessMm = mark ? Number.parseInt(mark.text, 10) : undefined;
    const existing = overlaps[0];
    if (existing) {
      const oldBox = { x0: Math.min(existing.cadX0!, existing.cadX1!), y0: Math.min(existing.cadY0!, existing.cadY1!),
        x1: Math.max(existing.cadX0!, existing.cadX1!), y1: Math.max(existing.cadY0!, existing.cadY1!) };
      const shared = intersectionArea(box, oldBox);
      const oldArea = Math.max(1, (oldBox.x1 - oldBox.x0) * (oldBox.y1 - oldBox.y0));
      // Only a one-to-one contour refinement. Nested AI panels are rejected.
      if (shared / Math.min(boxArea, oldArea) < 0.7 || boxArea / oldArea < 0.5 || boxArea / oldArea > 1.6) continue;
      existing.cadPolygon = visual.polygon;
      existing.cadX0 = box.x0; existing.cadY0 = box.y0; existing.cadX1 = box.x1; existing.cadY1 = box.y1;
      existing.cadX = (box.x0 + box.x1) / 2; existing.cadY = (box.y0 + box.y1) / 2;
      existing.length = 0; existing.breadth = 0; existing.netArea = visual.areaM2;
      existing.needsReview = true;
      existing.reviewReason = 'Gemini contour repaired against CAD beam/wall faces; verify panel boundary and area';
      added++;
      continue;
    }
    if (thicknessMm == null || thicknessMm < 75 || thicknessMm > 600) continue;
    const row = emptyRow(`visual-${sheet.id}-${visual.id}`, floor);
    row.member = `AI-${visual.id}`;
    row.length = 0; row.breadth = 0; row.netArea = visual.areaM2;
    row.height = thicknessMm / 1000; row.slabThickness = row.height;
    row.cadX = (box.x0 + box.x1) / 2; row.cadY = (box.y0 + box.y1) / 2;
    row.cadX0 = box.x0; row.cadY0 = box.y0; row.cadX1 = box.x1; row.cadY1 = box.y1;
    row.cadPolygon = visual.polygon;
    row.needsReview = true;
    row.reviewReason = 'Gemini visual panel corroborated by CAD beam/wall faces; verify area';
    row.measurementSource = 'drawing geometry';
    members.push(row);
    added++;
  }
  return added;
}
