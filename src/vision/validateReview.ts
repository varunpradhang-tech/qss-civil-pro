import type { Pt, Segment } from '../domain/types.js';

export type ReviewCandidate = { id: string; polygon: Pt[]; confidence: number; type: string };
export type ReviewValidation = ReviewCandidate & { accepted: boolean; reasons: string[]; areaM2: number };

const area = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2 / 1e6;
const orient = (a: Pt, b: Pt, c: Pt) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => orient(a,b,c) * orient(a,b,d) < 0 && orient(c,d,a) * orient(c,d,b) < 0;
const overlaps = (a: Pt[], b: Pt[]) => a.some((point) => pointInPolygon(point, b))
  || b.some((point) => pointInPolygon(point, a))
  || a.some((point, i) => b.some((other, j) => crosses(point, a[(i + 1) % a.length], other, b[(j + 1) % b.length])));
const edgeDistance = (point: Pt, polygon: Pt[]) => Math.min(...polygon.map((a, index) => {
  const b = polygon[(index + 1) % polygon.length], dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}));

/** Deterministic gate for visual proposals; accepted results still require normal CAD panel matching. */
export function validateReviewCandidates(candidates: ReviewCandidate[], beams: Segment[], voids: Pt[][] = [], beamMarks: Pt[] = []): ReviewValidation[] {
  const accepted: ReviewCandidate[] = [];
  return [...candidates].sort((a, b) => b.confidence - a.confidence).map((candidate) => {
    const reasons: string[] = [];
    if (candidate.polygon.length < 3) reasons.push('polygon has fewer than three vertices');
    if (candidate.confidence < 0.6) reasons.push('confidence below review threshold');
    const edges = candidate.polygon.map((a, i) => [a, candidate.polygon[(i + 1) % candidate.polygon.length]] as const);
    // CAD beam faces often terminate at a slab edge. A topological crossing
    // alone rejects legitimate panels; only beam ink deep inside the proposed
    // slab is a contradiction. Final CAD edge-support is checked separately.
    if (beams.some((beam) => {
      const midpoint = { x: (beam.a.x + beam.b.x) / 2, y: (beam.a.y + beam.b.y) / 2 };
      return pointInPolygon(midpoint, candidate.polygon) && edgeDistance(midpoint, candidate.polygon) > 450
        && edges.some(([a,b]) => crosses(a,b,beam.a,beam.b));
    })) reasons.push('boundary crosses a beam');
    if (voids.some((voidPolygon) => overlaps(candidate.polygon, voidPolygon))) reasons.push('candidate overlaps a void');
    if (beamMarks.some((mark) => pointInPolygon(mark, candidate.polygon)
      && edgeDistance(mark, candidate.polygon) > 450)) reasons.push('candidate contains a beam number');
    const areaM2 = candidate.polygon.length >= 3 ? area(candidate.polygon) : 0;
    if (areaM2 < 0.2 || areaM2 > 400) reasons.push('area outside slab limits');
    if (accepted.some((other) => overlaps(candidate.polygon, other.polygon))) reasons.push('candidate overlaps an accepted candidate');
    if (!reasons.length) accepted.push(candidate);
    return { ...candidate, accepted: reasons.length === 0, reasons, areaM2 };
  });
}

function pointInPolygon(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x-a.x) * (point.y-a.y) / (b.y-a.y) + a.x) inside = !inside;
  }
  return inside;
}
