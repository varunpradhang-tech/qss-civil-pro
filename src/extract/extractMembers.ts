// Auto-extract measurement-book member rows from a parsed drawing for the selected work group.
// Slab panels + beam runs are both extracted automatically (no manual marking). Rows are editable after.
import type { NormalizedDwg, Pt, Segment } from '../domain/types.js';
import { autoProposePanels } from './panels.js';
import { emptyRow, type MemberRow } from '../takeoff/rules.js';
import { round3 } from '../lib/num.js';

// Parse "300X650" / "300x900" beam size text → { widthMm, depthMm }.
function parseBeamSize(text: string): { widthMm: number; depthMm: number } | null {
  const m = text.replace(/\s/g, '').match(/(\d{2,4})[xX](\d{2,4})/);
  return m ? { widthMm: +m[1], depthMm: +m[2] } : null;
}

let seq = 1;
const nextId = () => `m${seq++}`;

export function extractMembers(input: NormalizedDwg | NormalizedDwg[], workGroup: string, floor = 'Basement'): MemberRow[] {
  seq = 1;
  const dwgs = Array.isArray(input) ? input : [input];
  const dwg = selectGeometrySheet(dwgs, workGroup);
  if (workGroup === 'slab') return slabMembers(dwg, floor);
  if (workGroup === 'beam') return beamMembers(dwg, floor, beamSchedule(dwgs), slabSchedule(dwgs));
  return []; // column/raft/wall/floor: start empty, user adds (auto-extraction not reliable on this data)
}

function beamLabel(text: string): string | null {
  const value = text.replace(/\s/g, '').toUpperCase();
  return /^T\d+(?:M?B)\d+[A-Z]?$/.test(value) ? value : null;
}

function compareBeamLabels(a: string, b: string): number {
  const am = a.match(/^T(\d+)(M?B)(\d+)([A-Z]?)$/), bm = b.match(/^T(\d+)(M?B)(\d+)([A-Z]?)$/);
  if (am && bm) return Number(am[1]) - Number(bm[1]) || Number(am[3]) - Number(bm[3]) || am[4].localeCompare(bm[4]) || am[2].localeCompare(bm[2]);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function selectGeometrySheet(dwgs: NormalizedDwg[], workGroup: string): NormalizedDwg {
  if (workGroup !== 'beam') return [...dwgs].sort((a, b) => b.dimensions.length - a.dimensions.length)[0];
  return [...dwgs].sort((a, b) => {
    const score = (d: NormalizedDwg) => d.texts.filter((t) => /beam no/i.test(t.layer) && beamLabel(t.text)).length * 1000 + d.segments.filter((s) => /^beam$/i.test(s.layer.trim())).length;
    return score(b) - score(a);
  })[0];
}

/** Read label-specific width/depth rows from beam schedule/detail drawings. */
function beamSchedule(dwgs: NormalizedDwg[]): Map<string, { widthMm: number; depthMm: number }> {
  const schedule = new Map<string, { widthMm: number; depthMm: number }>();
  for (const dwg of dwgs) {
    for (const labelText of dwg.texts) {
      const label = beamLabel(labelText.text);
      if (!label || !/table|schedule/i.test(labelText.layer)) continue;
      const numbers = dwg.texts
        .filter((t) => t.layer === labelText.layer && Math.abs(t.pos.y - labelText.pos.y) <= 120 && t.pos.x > labelText.pos.x + 300 && t.pos.x < labelText.pos.x + 5000 && /^\d{2,4}$/.test(t.text.trim()))
        .sort((a, b) => a.pos.x - b.pos.x)
        .map((t) => Number(t.text.trim()));
      const widthMm = numbers[0], depthMm = numbers[1];
      if (widthMm >= 150 && widthMm <= 1000 && depthMm >= 300 && depthMm <= 2500) schedule.set(label, { widthMm, depthMm });
    }
  }
  return schedule;
}

function slabSchedule(dwgs: NormalizedDwg[]): Map<string, number> {
  const schedule = new Map<string, number>();
  for (const dwg of dwgs) {
    for (const label of dwg.texts) {
      const code = label.text.replace(/\s/g, '').toUpperCase();
      if (!/^S\d+[A-Z]?$/.test(code) || !/table|schedule/i.test(label.layer)) continue;
      const thickness = dwg.texts
        .filter((t) => t.layer === label.layer && Math.abs(t.pos.y - label.pos.y) <= 100 && t.pos.x > label.pos.x + 200 && t.pos.x < label.pos.x + 3000 && /^\d{2,4}$/.test(t.text.trim()))
        .sort((a, b) => a.pos.x - b.pos.x)
        .map((t) => Number(t.text.trim()))
        .find((n) => n >= 75 && n <= 500);
      if (thickness) schedule.set(code, thickness);
    }
  }
  return schedule;
}

// --- slab: reuse the label-anchored panel proposer ---
function slabMembers(dwg: NormalizedDwg, floor: string): MemberRow[] {
  return autoProposePanels(dwg).map((p, i) => {
    const r = emptyRow(nextId(), floor);
    r.member = `P${i + 1}${p.label ? ` (${p.label})` : ''}`;
    r.length = round3(p.lengthMm / 1000);
    r.breadth = round3(p.breadthMm / 1000);
    r.height = round3((p.thicknessMm || 175) / 1000); // slab thickness → concrete depth
    r.slabThickness = r.height;
    r.openings = round3(p.openingM2);
    r.nos = 1;
    r.needsReview = !p.confident || p.duplicate;
    r.reviewReason = p.duplicate ? 'overlaps a stronger panel' : !p.confident ? 'dimension/void uncertain' : undefined;
    return r;
  });
}

// --- beam: group BEAM face segments into collinear runs (bridging support gaps), size from BEAM SIZE text ---
function beamMembers(dwg: NormalizedDwg, floor: string, schedule: Map<string, { widthMm: number; depthMm: number }>, slabThicknesses: Map<string, number>): MemberRow[] {
  const beams: Segment[] = dwg.segments.filter((s) => /^beam$/i.test(s.layer.trim()));
  const sizeTexts = dwg.texts.filter((t) => /beam size/i.test(t.layer));
  const noTexts = dwg.texts.filter((t) => /beam no/i.test(t.layer));
  const slabLabels = dwg.texts
    .filter((t) => /slab no/i.test(t.layer) && /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, '')))
    .map((t) => ({ ...t, code: t.text.replace(/\s/g, '').toUpperCase() }));
  const BRIDGE = 1400, CLUSTER = 550; // 550mm merges a beam's two faces (width 240–500) into one run

  const runs: { a: Pt; b: Pt; horizontal: boolean }[] = [];
  const build = (segs: { coord: number; lo: number; hi: number }[], horizontal: boolean) => {
    segs.sort((x, y) => x.coord - y.coord);
    const lines: { coord: number; iv: [number, number][] }[] = [];
    for (const s of segs) {
      let L = lines[lines.length - 1];
      if (!L || Math.abs(s.coord - L.coord) > CLUSTER) { L = { coord: s.coord, iv: [] }; lines.push(L); }
      L.iv.push([s.lo, s.hi]);
    }
    for (const L of lines) {
      L.iv.sort((p, q) => p[0] - q[0]);
      const merged: [number, number][] = [];
      for (const [lo, hi] of L.iv) { const last = merged[merged.length - 1]; if (last && lo <= last[1] + BRIDGE) last[1] = Math.max(last[1], hi); else merged.push([lo, hi]); }
      for (const [lo, hi] of merged) {
        if (hi - lo < 600) continue; // skip stubs
        runs.push(horizontal ? { a: { x: lo, y: L.coord }, b: { x: hi, y: L.coord }, horizontal } : { a: { x: L.coord, y: lo }, b: { x: L.coord, y: hi }, horizontal });
      }
    }
  };
  build(beams.filter((s) => Math.abs(s.a.y - s.b.y) < Math.abs(s.a.x - s.b.x)).map((s) => ({ coord: (s.a.y + s.b.y) / 2, lo: Math.min(s.a.x, s.b.x), hi: Math.max(s.a.x, s.b.x) })), true);
  build(beams.filter((s) => Math.abs(s.a.y - s.b.y) >= Math.abs(s.a.x - s.b.x)).map((s) => ({ coord: (s.a.x + s.b.x) / 2, lo: Math.min(s.a.y, s.b.y), hi: Math.max(s.a.y, s.b.y) })), false);

  const nearestText = (mid: Pt, arr: { pos: Pt; text: string }[], max: number) => {
    let best: string | undefined, bd = max;
    for (const t of arr) { const d = Math.hypot(t.pos.x - mid.x, t.pos.y - mid.y); if (d < bd) { bd = d; best = t.text; } }
    return best;
  };

  const pointSegmentDistance = (p: Pt, s: Segment) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const den = dx * dx + dy * dy;
    const t = den ? Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / den)) : 0;
    return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy));
  };

  // A framing plan normally has one BEAM NO label per physical beam and two face lines.
  // Use labels as the primary member list so collinear beams separated by supports are not merged.
  const labelled = noTexts.map((t) => ({ text: t, label: beamLabel(t.text) })).filter((x): x is { text: typeof noTexts[number]; label: string } => !!x.label);
  if (labelled.length) {
    return labelled.map(({ text, label }) => {
      const nearest = [...beams].sort((a, b) => pointSegmentDistance(text.pos, a) - pointSegmentDistance(text.pos, b))[0];
      const nearestDistance = nearest ? pointSegmentDistance(text.pos, nearest) : Number.POSITIVE_INFINITY;
      const beamDirection = nearest ? (Math.abs(nearest.b.x - nearest.a.x) >= Math.abs(nearest.b.y - nearest.a.y) ? 'H' : 'V') : null;
      const markedDimension = dwg.dimensions
        .filter((d) => d.measurement >= 600 && d.measurement <= 30000 && (!beamDirection || d.dir === beamDirection))
        .map((d) => {
          const span: Segment = { layer: d.layer, a: d.p1, b: d.p2 };
          return { dimension: d, distance: pointSegmentDistance(text.pos, span) };
        })
        // The label must project onto the actual dimension span. A nearby midpoint alone
        // can belong to the adjacent slab bay or the next beam.
        .filter(({ dimension }) => beamDirection === 'V'
          ? text.pos.y >= Math.min(dimension.p1.y, dimension.p2.y) - 300 && text.pos.y <= Math.max(dimension.p1.y, dimension.p2.y) + 300
          : text.pos.x >= Math.min(dimension.p1.x, dimension.p2.x) - 300 && text.pos.x <= Math.max(dimension.p1.x, dimension.p2.x) + 300)
        .sort((a, b) => a.distance - b.distance)[0];
      // Prefer a marked CAD dimension only when it is close to the beam label and is
      // materially better associated than the nearest beam face. This avoids borrowing
      // an adjacent slab/beam dimension while still handling beams whose face lines stop
      // well away from their label (for example T3B1 in the validation drawing).
      const useMarkedDimension = !!markedDimension && markedDimension.distance <= 1200 && markedDimension.distance < nearestDistance * 0.75;
      const lengthMm = useMarkedDimension ? markedDimension.dimension.measurement : nearest ? Math.hypot(nearest.b.x - nearest.a.x, nearest.b.y - nearest.a.y) : 0;
      const maxAlong = Math.max(lengthMm / 2 + 2000, 3500);
      const adjacent = (side: -1 | 1) => slabLabels
        .map((slab) => {
          const along = beamDirection === 'V' ? slab.pos.y - text.pos.y : slab.pos.x - text.pos.x;
          const perpendicular = beamDirection === 'V' ? slab.pos.x - text.pos.x : slab.pos.y - text.pos.y;
          return { slab, along, perpendicular, score: Math.abs(perpendicular) + 0.35 * Math.abs(along) };
        })
        .filter((x) => Math.sign(x.perpendicular) === side && Math.abs(x.along) <= maxAlong && Math.abs(x.perpendicular) <= 8000)
        .sort((a, b) => a.score - b.score)[0]?.slab;
      const side1 = adjacent(1), side2 = adjacent(-1);
      const midpoint = nearest ? { x: (nearest.a.x + nearest.b.x) / 2, y: (nearest.a.y + nearest.b.y) / 2 } : text.pos;
      const inlineSize = parseBeamSize(nearestText(midpoint, sizeTexts, 6000) ?? '');
      const size = schedule.get(label) ?? inlineSize;
      const r = emptyRow(nextId(), floor);
      r.member = label;
      r.length = round3(lengthMm / 1000);
      r.measurementSource = useMarkedDimension ? 'marked dimension' : 'drawing geometry';
      r.sideLength = r.length;
      r.breadth = size ? round3(size.widthMm / 1000) : 0;
      r.height = size ? round3(size.depthMm / 1000) : 0;
      r.slabThickness = 0.175;
      r.slabCodeSide1 = side1?.code;
      r.slabCodeSide2 = side2?.code;
      r.slabThicknessSide1 = side1 ? round3((slabThicknesses.get(side1.code) ?? 0) / 1000) : 0;
      r.slabThicknessSide2 = side2 ? round3((slabThicknesses.get(side2.code) ?? 0) / 1000) : 0;
      r.innerSideCount = Number(!!r.slabThicknessSide1) + Number(!!r.slabThicknessSide2);
      r.nos = 1;
      const unresolvedSlabs = (side1 && !r.slabThicknessSide1) || (side2 && !r.slabThicknessSide2);
      r.needsReview = !lengthMm || !size || unresolvedSlabs;
      r.reviewReason = !lengthMm ? 'no marked dimension or matching beam face found' : !size ? 'no beam size found in uploaded plan/schedule' : unresolvedSlabs ? 'adjacent slab code has no thickness schedule' : undefined;
      return r;
    }).sort((a, b) => compareBeamLabels(a.member, b.member));
  }

  let n = 1;
  return runs.map((run) => {
    const mid: Pt = { x: (run.a.x + run.b.x) / 2, y: (run.a.y + run.b.y) / 2 };
    const size = parseBeamSize(nearestText(mid, sizeTexts, 6000) ?? '');
    const label = nearestText(mid, noTexts, 4000);
    const r = emptyRow(nextId(), floor);
    r.member = label ?? `QB${n++}`;
    r.length = round3(Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y) / 1000);
    r.measurementSource = 'drawing geometry';
    r.sideLength = r.length;
    r.breadth = size ? round3(size.widthMm / 1000) : 0;
    r.height = size ? round3(size.depthMm / 1000) : 0;
    r.slabThickness = 0.175;
    r.nos = 1;
    r.needsReview = !size;
    r.reviewReason = size ? undefined : 'no beam size found in uploaded plan/schedule';
    return r;
  });
}
