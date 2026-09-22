import type { NormalizedDwg, Pt, Segment } from '../domain/types.js';

export type VisualRepairEvidence = {
  supportedFraction: number;
  structuralFraction: number;
  unsupportedEdges: number;
  containsBeamMark: boolean;
  accepted: boolean;
};

const beamNumber = /^(?:T\d+)?M?B\d+[A-Z]?$/i;
const structuralLayer = /beam|wall|col|pardi|rcc/i;
const detailLayer = /dimension|text|number|schedule|grid|axis/i;

function pointInPolygon(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: Pt, line: Segment): number {
  const dx = line.b.x - line.a.x, dy = line.b.y - line.a.y;
  const t = Math.max(0, Math.min(1, ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy)
    / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - line.a.x - t * dx, point.y - line.a.y - t * dy);
}

/** Check a proposed repair against the original CAD ink, rather than treating
 * a confident-looking AI polygon as a new quantity. The source DWG is untouched.
 * Partial edge support is allowed for a genuinely broken beam/wall junction,
 * but a missing whole side is not silently invented. */
export function assessVisualRepair(dwg: NormalizedDwg, polygon: Pt[], toleranceMm = 250): VisualRepairEvidence {
  const beamMarks = dwg.texts.filter((text) => beamNumber.test(text.text.replace(/\s/g, '')));
  // Beam-number insertion points can lie a few millimetres inside a hand-
  // traced beam face. Treat only a number clearly in the slab interior as a
  // contradiction, not a label sitting on its supporting boundary.
  const containsBeamMark = beamMarks.some((text) => pointInPolygon(text.pos, polygon)
    && polygon.every((a, index) => distanceToSegment(text.pos, {
      a, b: polygon[(index + 1) % polygon.length], layer: '',
    }) > 450));
  const bounds = {
    x0: Math.min(...polygon.map((p) => p.x)) - toleranceMm,
    x1: Math.max(...polygon.map((p) => p.x)) + toleranceMm,
    y0: Math.min(...polygon.map((p) => p.y)) - toleranceMm,
    y1: Math.max(...polygon.map((p) => p.y)) + toleranceMm,
  };
  const nearby = dwg.segments.filter((line) => !detailLayer.test(line.layer)
    && Math.max(line.a.x, line.b.x) >= bounds.x0 && Math.min(line.a.x, line.b.x) <= bounds.x1
    && Math.max(line.a.y, line.b.y) >= bounds.y0 && Math.min(line.a.y, line.b.y) <= bounds.y1);
  const structural = nearby.filter((line) => structuralLayer.test(line.layer));
  let supported = 0, structuralSupported = 0, sampled = 0, unsupportedEdges = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    if (length < 100) continue;
    const count = Math.max(1, Math.ceil(length / 125));
    let edgeSupported = 0;
    for (let j = 0; j < count; j++) {
      const point = { x: a.x + (b.x - a.x) * (j + 0.5) / count,
        y: a.y + (b.y - a.y) * (j + 0.5) / count };
      const onStructural = structural.some((line) => distanceToSegment(point, line) <= toleranceMm);
      if (onStructural) structuralSupported++;
      if (onStructural || nearby.some((line) => distanceToSegment(point, line) <= toleranceMm)) {
        supported++; edgeSupported++;
      }
      sampled++;
    }
    if (length >= 600 && edgeSupported / count < 0.35) unsupportedEdges++;
  }
  const supportedFraction = sampled ? supported / sampled : 0;
  const structuralFraction = sampled ? structuralSupported / sampled : 0;
  return { supportedFraction, structuralFraction, unsupportedEdges, containsBeamMark,
    accepted: polygon.length >= 3 && !containsBeamMark && supportedFraction >= 0.72
      && structuralFraction >= 0.5 && unsupportedEdges === 0 };
}
