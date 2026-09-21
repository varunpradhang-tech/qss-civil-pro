import type { Pt } from '../domain/types.js';
import type { Sheet } from '../state/store.js';
import { emptyRow, type MemberRow } from '../takeoff/rules.js';

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

/** Add only distinct, thickness-marked visual bays as provisional area-only rows. */
export function appendVisualSlabMembers(members: MemberRow[], sheet: Sheet, floor: string): number {
  let added = 0;
  for (const visual of sheet.visualPanels ?? []) {
    if (visual.confidence < 0.9 || visual.polygon.length < 3) continue;
    const xs = visual.polygon.map((p) => p.x), ys = visual.polygon.map((p) => p.y);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const boxArea = (box.x1 - box.x0) * (box.y1 - box.y0);
    if (boxArea <= 0 || visual.areaM2 < 0.2) continue;
    // Bounding boxes are intentionally conservative: do not bill the same
    // slab twice when an AI polygon touches an existing CAD member.
    if (members.some((member) => member.cadX0 != null && member.cadY0 != null
      && member.cadX1 != null && member.cadY1 != null
      && intersectionArea(box, { x0: Math.min(member.cadX0, member.cadX1), y0: Math.min(member.cadY0, member.cadY1),
        x1: Math.max(member.cadX0, member.cadX1), y1: Math.max(member.cadY0, member.cadY1) }) > boxArea * 0.05)) continue;
    const mark = sheet.dwg.texts.find((text) => /slab\s*(?:thk|thickness|depth)/i.test(text.layer)
      && /^(?:\d{2,3})(?:\s*mm)?$/i.test(text.text.trim()) && contains(text.pos, visual.polygon));
    if (!mark) continue;
    const thicknessMm = Number.parseInt(mark.text, 10);
    if (thicknessMm < 75 || thicknessMm > 600) continue;
    const row = emptyRow(`visual-${sheet.id}-${visual.id}`, floor);
    row.member = `AI-${visual.id}`;
    row.length = 0; row.breadth = 0; row.netArea = visual.areaM2;
    row.height = thicknessMm / 1000; row.slabThickness = row.height;
    row.cadX = (box.x0 + box.x1) / 2; row.cadY = (box.y0 + box.y1) / 2;
    row.cadX0 = box.x0; row.cadY0 = box.y0; row.cadX1 = box.x1; row.cadY1 = box.y1;
    row.cadPolygon = visual.polygon;
    row.needsReview = true;
    row.reviewReason = 'Gemini visual panel with CAD slab thickness; verify beam faces and area';
    row.measurementSource = 'drawing geometry';
    members.push(row);
    added++;
  }
  return added;
}
