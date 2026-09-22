import type { NormalizedDwg, Pt } from '../domain/types.js';
import type { PanelProposalBox } from './panels.js';

type Box = PanelProposalBox['box'];
const box = (polygon: Pt[]): Box => ({
  x0: Math.min(...polygon.map((point) => point.x)), y0: Math.min(...polygon.map((point) => point.y)),
  x1: Math.max(...polygon.map((point) => point.x)), y1: Math.max(...polygon.map((point) => point.y)),
});
const area = (polygon: Pt[]) => Math.abs(polygon.reduce((sum, point, index) => {
  const next = polygon[(index + 1) % polygon.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;
const boxArea = (value: Box) => Math.max(0, value.x1 - value.x0) * Math.max(0, value.y1 - value.y0);
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
function contains(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// The polyline intersection must use its actual shape, not the bounding box:
// a perimeter chajja's box contains many unrelated room slabs.
function polygonRectArea(polygon: Pt[], rect: Box): number {
  let clipped = polygon;
  const clip = (inside: (point: Pt) => boolean, cross: (a: Pt, b: Pt) => Pt) => {
    const input = clipped; clipped = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const ai = inside(a), bi = inside(b);
      if (ai && bi) clipped.push(b);
      else if (ai && !bi) clipped.push(cross(a, b));
      else if (!ai && bi) clipped.push(cross(a, b), b);
    }
  };
  const xCross = (x: number) => (a: Pt, b: Pt): Pt => ({ x, y: a.y + (b.y - a.y) * (x - a.x) / ((b.x - a.x) || 1e-9) });
  const yCross = (y: number) => (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9), y });
  clip((point) => point.x >= rect.x0, xCross(rect.x0)); if (!clipped.length) return 0;
  clip((point) => point.x <= rect.x1, xCross(rect.x1)); if (!clipped.length) return 0;
  clip((point) => point.y >= rect.y0, yCross(rect.y0)); if (!clipped.length) return 0;
  clip((point) => point.y <= rect.y1, yCross(rect.y1));
  return clipped.length >= 3 ? area(clipped) : 0;
}

function markedPolygons(dwg: NormalizedDwg): Pt[][] {
  const eligible = dwg.polylines.filter((line) => {
    if (!/^(?:A-HATCH|QSS[_ -].*OUTLINE.*)$/i.test(line.layer) || line.pts.length < 4) return false;
    const first = line.pts[0], last = line.pts[line.pts.length - 1];
    const gap = Math.hypot(first.x - last.x, first.y - last.y);
    // The consultant's existing hatch loops close exactly. Freehand CAD
    // correction strokes finish a few millimetres from their start point.
    return (line.layer !== 'A-HATCH' && (line.closed || gap <= 50))
      || (line.layer === 'A-HATCH' && !line.closed && gap >= 5 && gap <= 50);
  }).map((line) => {
    const points = line.pts.map((point) => ({ x: point.x, y: point.y }));
    while (points.length > 3 && Math.hypot(points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y) <= 50) points.pop();
    return points;
  }).filter((points) => points.length >= 3 && area(points) >= 200_000);
  // A-HATCH is a consultant layer, not an annotation convention. Require a
  // coherent group before interpreting slightly open loops as manual edits.
  return eligible.length >= 6 || eligible.some((points) => dwg.polylines.some((line) =>
    /^QSS[_ -].*OUTLINE.*$/i.test(line.layer) && line.pts.some((point) =>
      point.x === points[0].x && point.y === points[0].y))) ? eligible : [];
}

function symmetryAxis(polygons: Pt[][]): number | undefined {
  const boxes = polygons.map(box).filter((candidate) => candidate.y1 - candidate.y0 < 12_000);
  const axes: number[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const left = boxes[i], right = boxes[j];
    if (Math.abs((left.y0 + left.y1) - (right.y0 + right.y1)) > 400
      || Math.abs((left.x1 - left.x0) - (right.x1 - right.x0)) > 400
      || Math.abs((left.y1 - left.y0) - (right.y1 - right.y0)) > 400
      || Math.abs((left.x0 + left.x1) / 2 - (right.x0 + right.x1) / 2) < 3000) continue;
    axes.push((left.x0 + left.x1 + right.x0 + right.x1) / 4);
  }
  if (axes.length < 2) return undefined;
  axes.sort((a, b) => a - b);
  return axes[Math.floor(axes.length / 2)];
}

/** Explicit CAD correction outlines supersede overlapping inferred bays.
 * This is a general opt-in correction path; an ordinary unmarked DWG is unchanged. */
export function reconcileMarkedPanelCorrections(dwg: NormalizedDwg, panels: PanelProposalBox[]): PanelProposalBox[] {
  const source = markedPolygons(dwg);
  if (!source.length) return panels;
  const axis = symmetryAxis(source);
  const outlines = [...source];
  if (axis != null) for (const polygon of source) {
    const bounds = box(polygon);
    if (bounds.x0 < axis && bounds.x1 > axis) continue;
    const mirror = polygon.map((point) => ({ x: 2 * axis - point.x, y: point.y })).reverse();
    const reflected = box(mirror);
    if (!source.some((other) => {
      const candidate = box(other);
      return Math.abs((candidate.x1 - candidate.x0) - (reflected.x1 - reflected.x0)) < 400
        && Math.abs((candidate.y1 - candidate.y0) - (reflected.y1 - reflected.y0)) < 400
        && overlap(candidate, reflected) / Math.min(boxArea(candidate), boxArea(reflected)) > 0.8;
    }))
      outlines.push(mirror);
  }
  const chajja = (polygon: Pt[]) => box(polygon).y1 - box(polygon).y0 > 30_000;
  const corrected: PanelProposalBox[] = outlines.map((polygon) => {
    const bounds = box(polygon), gross = area(polygon) / 1e6;
    const irregular = chajja(polygon) || gross < boxArea(bounds) / 1e6 * 0.985;
    const matching = panels.filter((panel) => chajja(polygon) === /CHAJJA/i.test(panel.label || ''))
      .map((panel) => ({ panel, intersection: chajja(polygon) ? overlap(bounds, panel.box)
        : polygonRectArea(polygon, panel.box) }))
      .sort((a, b) => b.intersection - a.intersection)[0];
    const depth = dwg.texts.find((text) => /slab\s*(?:thk|thickness|depth)/i.test(text.layer)
      && /^\d{2,3}(?:\s*mm)?$/i.test(text.text.trim()) && contains(text.pos, polygon));
    const depthMm = depth ? Number.parseInt(depth.text, 10) : 0;
    return { label: chajja(polygon) ? 'CANTILEVER CHAJJA' : 'UNMARKED SLAB',
      box: bounds, lengthMm: bounds.x1 - bounds.x0, breadthMm: bounds.y1 - bounds.y0,
      openingM2: 0, thicknessMm: depthMm || (matching?.intersection > 200_000 ? matching.panel.thicknessMm : 0),
      confident: false, duplicate: false, markedBoundary: true,
      polygon: irregular ? polygon : undefined,
      netAreaM2: irregular ? gross : undefined };
  });
  const retained = panels.filter((panel) => !corrected.some((mark) => {
    if (/CHAJJA/i.test(panel.label || '') && /CHAJJA/i.test(mark.label || ''))
      return (panel.box.x0 + panel.box.x1 - mark.box.x0 - mark.box.x1) ** 2 < 20_000_000;
    if (/CHAJJA/i.test(panel.label || '')) return false;
    const intersection = mark.polygon ? polygonRectArea(mark.polygon, panel.box) : overlap(mark.box, panel.box);
    const panelArea = panel.netAreaM2 ? panel.netAreaM2 * 1e6 : boxArea(panel.box);
    return panelArea > 0 && intersection / panelArea > 0.35;
  }));
  return [...retained, ...corrected];
}
