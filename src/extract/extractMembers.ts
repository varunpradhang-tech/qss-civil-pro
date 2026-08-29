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
  if (workGroup === 'slab') return slabMembers(dwg, floor, slabSchedule(dwgs), slabUnoThickness(dwgs));
  if (workGroup === 'beam') return beamMembers(dwg, floor, beamSchedule(dwgs), slabSchedule(dwgs));
  return []; // column/raft/wall/floor: start empty, user adds (auto-extraction not reliable on this data)
}

function beamLabel(text: string): string | null {
  const value = text.replace(/\s/g, '').toUpperCase();
  // Projects use plain B1/MB1 as well as tower-prefixed T3B1/T3MB1 labels.
  return /^(?:T\d+)?M?B\d+[A-Z]?$/.test(value) ? value : null;
}

const isBeamGeometryLayer = (layer: string) => /(?:^|[-_\s])beam(?:$|[-_\s])/i.test(layer)
  && !/(?:beam|bram)\s*(?:no|number|size|text)/i.test(layer);
const isBeamNumberLayer = (layer: string) => /b(?:ea|ra)m\s*(?:no|number)/i.test(layer);

function compareBeamLabels(a: string, b: string): number {
  const am = a.match(/^T(\d+)(M?B)(\d+)([A-Z]?)$/), bm = b.match(/^T(\d+)(M?B)(\d+)([A-Z]?)$/);
  if (am && bm) return Number(am[1]) - Number(bm[1]) || Number(am[3]) - Number(bm[3]) || am[4].localeCompare(bm[4]) || am[2].localeCompare(bm[2]);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function selectGeometrySheet(dwgs: NormalizedDwg[], workGroup: string): NormalizedDwg {
  if (workGroup === 'slab') return [...dwgs].sort((a, b) => {
    const score = (d: NormalizedDwg) => {
      const labels = d.texts.filter((t) => /slabs?\s*no/i.test(t.layer) && /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, ''))).length;
      const boundaries = d.segments.filter((s) => /beam|wall|col|pardi|rcc/i.test(s.layer)).length
        + d.polylines.filter((p) => /beam|wall|col|pardi|rcc/i.test(p.layer)).length
        + d.hatches.filter((h) => /beam|wall|col|pardi|rcc/i.test(h.layer)).length;
      return labels * 1000 + boundaries;
    };
    return score(b) - score(a);
  })[0];
  if (workGroup !== 'beam') return [...dwgs].sort((a, b) => b.dimensions.length - a.dimensions.length)[0];
  return [...dwgs].sort((a, b) => {
    const score = (d: NormalizedDwg) => d.texts.filter((t) => isBeamNumberLayer(t.layer) && beamLabel(t.text)).length * 1000
      + d.segments.filter((s) => isBeamGeometryLayer(s.layer)).length;
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
    const titles = dwg.texts.filter((t) => /SLAB\s+(?:REINFORCEMENT\s+)?SCHEDULE/i.test(t.text));
    for (const label of dwg.texts) {
      const code = label.text.replace(/\s/g, '').toUpperCase();
      if (!/^S\d+[A-Z]?$/.test(code)) continue;
      const inScheduleRegion = /table|schedule/i.test(label.layer) || titles.some((title) =>
        label.pos.x >= title.pos.x - 5000 && label.pos.x <= title.pos.x + 60000
        && label.pos.y <= title.pos.y + 3000 && label.pos.y >= title.pos.y - 25000);
      if (!inScheduleRegion) continue;
      const thickness = dwg.texts
        .filter((t) => Math.abs(t.pos.y - label.pos.y) <= 200 && t.pos.x > label.pos.x + 100 && t.pos.x < label.pos.x + 10000 && /^\d{2,4}$/.test(t.text.trim()))
        .sort((a, b) => a.pos.x - b.pos.x)
        .map((t) => Number(t.text.trim()))
        .find((n) => n >= 75 && n <= 500);
      if (thickness) schedule.set(code, thickness);
    }
  }
  return schedule;
}

/** Read the drawing-wide default from a general note such as
 * "ALL SLAB THICKNESS SHALL BE 150 mm THK. (U.N.O.)". */
function slabUnoThickness(dwgs: NormalizedDwg[]): number | undefined {
  const parse = (text: string) => {
    const normalized = text.replace(/\\P|\r?\n/g, ' ').replace(/\s+/g, ' ');
    if (!/ALL\s+SLAB\s+THICKNESS/i.test(normalized) || !/U\s*\.?\s*N\s*\.?\s*O/i.test(normalized)) return undefined;
    const value = normalized.match(/ALL\s+SLAB\s+THICKNESS[\s\S]{0,100}?(\d{2,4})\s*(?:MM)?\s*(?:THK|THICK)/i)?.[1];
    const thickness = value ? Number(value) : 0;
    return thickness >= 75 && thickness <= 500 ? thickness : undefined;
  };
  for (const dwg of dwgs) {
    for (const note of dwg.texts) {
      const thickness = parse(note.text);
      if (thickness) return thickness;
    }
    // Some CAD exports split one general note across several TEXT entities.
    const thickness = parse(dwg.texts.map((t) => t.text).join(' '));
    if (thickness) return thickness;
  }
  return undefined;
}

// --- slab: reuse the label-anchored panel proposer ---
function slabMembers(dwg: NormalizedDwg, floor: string, schedule: Map<string, number>, unoThickness?: number): MemberRow[] {
  const panels = autoProposePanels(dwg);
  const heights = panels.map((p) => Math.max(p.box.y1 - p.box.y0, 0)).filter(Boolean).sort((a, b) => a - b);
  const rowTolerance = Math.max(500, (heights[Math.floor(heights.length / 2)] || 2000) * 0.35);
  const rows: { y: number; panels: typeof panels }[] = [];
  for (const panel of [...panels].sort((a, b) => ((b.box.y0 + b.box.y1) - (a.box.y0 + a.box.y1)) / 2)) {
    const cy = (panel.box.y0 + panel.box.y1) / 2;
    const row = rows.find((candidate) => Math.abs(candidate.y - cy) <= rowTolerance);
    if (row) { row.panels.push(panel); row.y = row.panels.reduce((sum, p) => sum + (p.box.y0 + p.box.y1) / 2, 0) / row.panels.length; }
    else rows.push({ y: cy, panels: [panel] });
  }
  const ordered = rows.sort((a, b) => b.y - a.y).flatMap((row) => row.panels.sort((a, b) => (a.box.x0 + a.box.x1) - (b.box.x0 + b.box.x1)));
  return ordered.map((p, i) => {
    const r = emptyRow(nextId(), floor);
    r.member = `P${i + 1}${p.label ? ` (${p.label})` : ''}`;
    r.cadX = (p.box.x0 + p.box.x1) / 2;
    r.cadY = (p.box.y0 + p.box.y1) / 2;
    r.cadX0 = p.box.x0;
    r.cadY0 = p.box.y0;
    r.cadX1 = p.box.x1;
    r.cadY1 = p.box.y1;
    r.length = round3(p.lengthMm / 1000);
    r.breadth = round3(p.breadthMm / 1000);
    const slabCode = (p.inferredSlabCode || p.label)?.replace(/\s/g, '').toUpperCase();
    const thicknessMm = p.thicknessMm || (slabCode ? schedule.get(slabCode) : undefined) || unoThickness || 175;
    const missingThickness = !p.thicknessMm && !(slabCode && schedule.has(slabCode)) && !unoThickness;
    r.height = round3(thicknessMm / 1000); // slab thickness → concrete depth
    r.slabThickness = r.height;
    r.openings = round3(p.openingM2);
    if (p.netAreaM2 !== undefined) {
      r.netArea = round3(Math.max(p.netAreaM2 - p.openingM2, 0));
      r.cadPolygon = p.polygon;
    }
    r.nos = 1;
    const reviewReasons = [
      p.duplicate ? 'overlaps a stronger panel' : '',
      !p.confident ? 'dimension/void uncertain' : '',
      missingThickness ? 'no slab thickness found in panel, schedule, or UNO general note; using 175 mm fallback' : '',
    ].filter(Boolean);
    r.needsReview = reviewReasons.length > 0;
    r.reviewReason = reviewReasons.length ? reviewReasons.join('; ') : undefined;
    return r;
  });
}

// --- beam: group BEAM face segments into collinear runs (bridging support gaps), size from BEAM SIZE text ---
function beamMembers(dwg: NormalizedDwg, floor: string, schedule: Map<string, { widthMm: number; depthMm: number }>, slabThicknesses: Map<string, number>): MemberRow[] {
  const beams: Segment[] = dwg.segments.filter((s) => isBeamGeometryLayer(s.layer));
  const sizeTexts = dwg.texts.filter((t) => /beam size/i.test(t.layer));
  const noTexts = dwg.texts.filter((t) => isBeamNumberLayer(t.layer));
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
    const inferredDirection = new Map<typeof noTexts[number], 'H' | 'V'>();
    for (const item of labelled) {
      const siblings = labelled.filter((candidate) => candidate.label === item.label && candidate !== item);
      let horizontalVotes = 0, verticalVotes = 0;
      for (const sibling of siblings) {
        const dx = Math.abs(sibling.text.pos.x - item.text.pos.x), dy = Math.abs(sibling.text.pos.y - item.text.pos.y);
        if (dx >= 1200 && dy <= 1000) horizontalVotes++;
        if (dy >= 1200 && dx <= 1000) verticalVotes++;
      }
      if (horizontalVotes || verticalVotes) inferredDirection.set(item.text, horizontalVotes >= verticalVotes ? 'H' : 'V');
      else {
        const nearbyRuns = runs.map((run) => {
          const segment: Segment = { layer: 'BEAM-RUN', a: run.a, b: run.b };
          return { direction: run.horizontal ? 'H' as const : 'V' as const, distance: pointSegmentDistance(item.text.pos, segment) };
        }).sort((a, b) => a.distance - b.distance);
        const first = nearbyRuns[0];
        const opposite = nearbyRuns.find((candidate) => candidate.direction !== first?.direction);
        if (first && first.distance <= 500 && (!opposite || opposite.distance >= first.distance * 1.5)) inferredDirection.set(item.text, first.direction);
      }
    }
    const sizeForBeam = (labelPos: Pt, direction: 'H' | 'V' | null, beamCoord: number) => {
      if (!direction) return parseBeamSize(nearestText(labelPos, sizeTexts, 6000) ?? '');
      const sameBaseline = sizeTexts.map((candidate) => {
        const along = direction === 'H' ? candidate.pos.x - labelPos.x : candidate.pos.y - labelPos.y;
        const normal = direction === 'H' ? candidate.pos.y - labelPos.y : candidate.pos.x - labelPos.x;
        return { candidate, along, normal, score: Math.abs(along) + Math.abs(normal) * 2 };
      }).filter(({ along, normal }) => Math.abs(along) <= 1600 && Math.abs(normal) <= 250)
        .sort((a, b) => a.score - b.score)[0]?.candidate;
      if (sameBaseline) return parseBeamSize(sameBaseline.text);
      const labelNormal = direction === 'H' ? labelPos.y - beamCoord : labelPos.x - beamCoord;
      const opposite = sizeTexts.map((candidate) => {
        const along = direction === 'H' ? candidate.pos.x - labelPos.x : candidate.pos.y - labelPos.y;
        const normal = direction === 'H' ? candidate.pos.y - beamCoord : candidate.pos.x - beamCoord;
        return { candidate, along, normal, score: Math.abs(along) * 1.5 + Math.abs(normal) };
      }).filter(({ along, normal }) => Math.abs(labelNormal) >= 40 && labelNormal * normal < 0 && Math.abs(along) <= 1800 && Math.abs(normal) <= 3200)
        .sort((a, b) => a.score - b.score)[0]?.candidate;
      return parseBeamSize((opposite?.text ?? nearestText(labelPos, sizeTexts, 6000)) ?? '');
    };
    // A beam mark may be repeated along several spans while its size is printed
    // beside only one occurrence. Share that verified size with every occurrence
    // of the same mark instead of producing zero-quantity sibling rows.
    const sizeByLabel = new Map(schedule);
    for (const item of labelled) {
      if (sizeByLabel.has(item.label)) continue;
      const inline = parseBeamSize(nearestText(item.text.pos, sizeTexts, 6000) ?? '');
      if (inline) sizeByLabel.set(item.label, inline);
    }
    const rows = labelled.map(({ text, label }) => {
      let nearest = [...beams].sort((a, b) => pointSegmentDistance(text.pos, a) - pointSegmentDistance(text.pos, b))[0];
      const expectedDirection = inferredDirection.get(text);
      const rawDirection = nearest ? (Math.abs(nearest.b.x - nearest.a.x) >= Math.abs(nearest.b.y - nearest.a.y) ? 'H' : 'V') : null;
      const rawLength = nearest ? Math.hypot(nearest.b.x - nearest.a.x, nearest.b.y - nearest.a.y) : 0;
      if (expectedDirection === 'V') {
        const full = runs.filter((run) => (run.horizontal ? 'H' : 'V') === expectedDirection)
          .map((run) => ({ run, segment: { layer: 'BEAM-RUN', a: run.a, b: run.b } as Segment }))
          .map((candidate) => ({ ...candidate, distance: pointSegmentDistance(text.pos, candidate.segment), length: Math.hypot(candidate.run.b.x - candidate.run.a.x, candidate.run.b.y - candidate.run.a.y) }))
          .filter((candidate) => candidate.distance <= 1200 && candidate.length <= 60000)
          .sort((a, b) => a.distance - b.distance)[0];
        if (full) nearest = full.segment;
      }
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
      const beamCoord = beamDirection === 'H' ? midpoint.y : beamDirection === 'V' ? midpoint.x : 0;
      const inlineSize = sizeForBeam(text.pos, beamDirection, beamCoord);
      // A size printed beside the actual framing-plan beam is the strongest
      // evidence. Use uploaded detail/schedule drawings only as fallback.
      const size = inlineSize ?? schedule.get(label) ?? sizeByLabel.get(label);
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
      const sourceA = useMarkedDimension ? markedDimension.dimension.p1 : nearest?.a;
      const sourceB = useMarkedDimension ? markedDimension.dimension.p2 : nearest?.b;
      if (sourceA && sourceB) {
        r.cadX0 = sourceA.x; r.cadY0 = sourceA.y;
        r.cadX1 = sourceB.x; r.cadY1 = sourceB.y;
      }
      const unresolvedSlabs = (side1 && !r.slabThicknessSide1) || (side2 && !r.slabThicknessSide2);
      r.needsReview = !lengthMm || !size || unresolvedSlabs;
      r.reviewReason = !lengthMm ? 'no marked dimension or matching beam face found' : !size ? 'no beam size found in uploaded plan/schedule' : unresolvedSlabs ? 'adjacent slab code has no thickness schedule' : undefined;
      return r;
    });
    const verifiedSize = new Map<string, { breadth: number; height: number }>();
    for (const row of rows) if (row.breadth > 0 && row.height > 0 && !verifiedSize.has(row.member))
      verifiedSize.set(row.member, { breadth: row.breadth, height: row.height });
    for (const row of rows) {
      const sibling = verifiedSize.get(row.member);
      if ((!row.breadth || !row.height) && sibling) {
        row.breadth = sibling.breadth; row.height = sibling.height;
        row.needsReview = false; row.reviewReason = undefined;
      }
    }
    let consolidated = consolidateBeamRows(rows);
    const coverage = (row: MemberRow) => {
      if ([row.cadX0, row.cadY0, row.cadX1, row.cadY1].some((value) => value == null)) return 0;
      const segment: Segment = { layer: 'BEAM-ROW', a: { x: row.cadX0 as number, y: row.cadY0 as number }, b: { x: row.cadX1 as number, y: row.cadY1 as number } };
      return labelled.filter((item) => item.label === row.member && pointSegmentDistance(item.text.pos, segment) <= 1200).length;
    };
    consolidated = consolidated.filter((row) => !consolidated.some((other) => {
      if (other === row || other.member !== row.member || other.length < row.length * 1.25 || coverage(other) < 2) return false;
      if ([row.cadX0, row.cadY0, row.cadX1, row.cadY1, other.cadX0, other.cadY0, other.cadX1, other.cadY1].some((value) => value == null)) return false;
      const rowHorizontal = Math.abs((row.cadX1 as number) - (row.cadX0 as number)) >= Math.abs((row.cadY1 as number) - (row.cadY0 as number));
      const otherHorizontal = Math.abs((other.cadX1 as number) - (other.cadX0 as number)) >= Math.abs((other.cadY1 as number) - (other.cadY0 as number));
      if (rowHorizontal !== otherHorizontal) return false;
      const rowLo = rowHorizontal ? Math.min(row.cadX0 as number, row.cadX1 as number) : Math.min(row.cadY0 as number, row.cadY1 as number);
      const rowHi = rowHorizontal ? Math.max(row.cadX0 as number, row.cadX1 as number) : Math.max(row.cadY0 as number, row.cadY1 as number);
      const otherLo = rowHorizontal ? Math.min(other.cadX0 as number, other.cadX1 as number) : Math.min(other.cadY0 as number, other.cadY1 as number);
      const otherHi = rowHorizontal ? Math.max(other.cadX0 as number, other.cadX1 as number) : Math.max(other.cadY0 as number, other.cadY1 as number);
      return rowLo >= otherLo - 100 && rowHi <= otherHi + 100;
    }));
    for (const row of consolidated) {
      const marks = labelled.filter((item) => item.label === row.member).map((item) => item.text.pos);
      if (!marks.length || row.nos > 1) continue;
      const horizontal = Math.abs((row.cadX1 || 0) - (row.cadX0 || 0)) >= Math.abs((row.cadY1 || 0) - (row.cadY0 || 0));
      const completeRun = runs.map((run) => {
        const segment: Segment = { layer: 'BEAM-RUN', a: run.a, b: run.b };
        return { run, length: Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y), covered: marks.filter((mark) => pointSegmentDistance(mark, segment) <= 1200).length };
      }).filter((candidate) => candidate.covered >= Math.min(marks.length, 2)
        && candidate.run.horizontal === horizontal
        && candidate.length >= row.length * 1000 - 100
        && candidate.length <= row.length * 1000 + 2000)
        .sort((a, b) => b.length - a.length)[0];
      if (completeRun) {
        row.length = round3(completeRun.length / 1000);
        row.cadX0 = completeRun.run.a.x; row.cadY0 = completeRun.run.a.y;
        row.cadX1 = completeRun.run.b.x; row.cadY1 = completeRun.run.b.y;
      }
      const marked = dwg.dimensions
        .filter((dimension) => dimension.dir === (horizontal ? 'H' : 'V')
          // A written dimension may extend a fragmented face run, but it must
          // not shorten an already complete first-to-last support run.
          && dimension.measurement >= Math.max(row.length * 1000 - (marks.length === 1 ? 2000 : 100), 600)
          && dimension.measurement <= row.length * 1000 + (completeRun ? 100 : 2000))
        .filter((dimension) => marks.every((mark) => horizontal
          ? mark.x >= Math.min(dimension.p1.x, dimension.p2.x) - 500 && mark.x <= Math.max(dimension.p1.x, dimension.p2.x) + 500
          : mark.y >= Math.min(dimension.p1.y, dimension.p2.y) - 500 && mark.y <= Math.max(dimension.p1.y, dimension.p2.y) + 500))
        .map((dimension) => ({ dimension, perpendicular: marks.reduce((sum, mark) => sum + (horizontal
          ? Math.abs(mark.y - dimension.mid.y) : Math.abs(mark.x - dimension.mid.x)), 0) / marks.length }))
        .filter((candidate) => candidate.perpendicular <= 5000)
        .sort((a, b) => Math.abs(a.dimension.measurement - row.length * 1000) - Math.abs(b.dimension.measurement - row.length * 1000)
          || a.perpendicular - b.perpendicular)[0];
      // With one mark the nearest beam-face geometry is the direct span
      // evidence. Do not replace it with an adjacent bay dimension (B3 in
      // the validation plan is 3.550 m, while a nearby slab dimension is
      // 4.850 m). Repeated marks may legitimately use one overall dimension.
      if (marked && marks.length > 1) {
        row.length = round3(marked.dimension.measurement / 1000);
        row.sideLength = row.length;
        row.measurementSource = 'marked dimension';
        if (horizontal) {
          row.cadX0 = marked.dimension.p1.x; row.cadX1 = marked.dimension.p2.x;
        } else {
          row.cadY0 = marked.dimension.p1.y; row.cadY1 = marked.dimension.p2.y;
        }
        continue;
      }
      // Where no written beam dimension is available, measure between the
      // inner faces of the first and last RCC supports. Closed column/wall
      // outlines are more reliable endpoints than fragmented beam face lines.
      const x0 = Math.min(row.cadX0 || 0, row.cadX1 || 0), x1 = Math.max(row.cadX0 || 0, row.cadX1 || 0);
      const y0 = Math.min(row.cadY0 || 0, row.cadY1 || 0), y1 = Math.max(row.cadY0 || 0, row.cadY1 || 0);
      const supportBoxes = dwg.polylines
        .filter((polyline) => (/column|wall|rcc/i.test(polyline.layer) || (polyline.layer === '0' && polyline.pts.length <= 6)) && polyline.pts.length >= 4)
        .map((polyline) => ({
          x0: Math.min(...polyline.pts.map((point) => point.x)), x1: Math.max(...polyline.pts.map((point) => point.x)),
          y0: Math.min(...polyline.pts.map((point) => point.y)), y1: Math.max(...polyline.pts.map((point) => point.y)),
        }))
        .filter((box) => box.x1 - box.x0 >= 200 && box.x1 - box.x0 <= 2000 && box.y1 - box.y0 >= 200 && box.y1 - box.y0 <= 2000);
      const rccBoxes = dwg.polylines
        .filter((polyline) => /column|wall|rcc/i.test(polyline.layer) && polyline.pts.length >= 4)
        .map((polyline) => ({
          x0: Math.min(...polyline.pts.map((point) => point.x)), x1: Math.max(...polyline.pts.map((point) => point.x)),
          y0: Math.min(...polyline.pts.map((point) => point.y)), y1: Math.max(...polyline.pts.map((point) => point.y)),
        }));
      if (horizontal) {
        const lineY = (y0 + y1) / 2;
        const near = supportBoxes.filter((box) => lineY >= box.y0 - 700 && lineY <= box.y1 + 700);
        const left = near.filter((box) => Math.abs(box.x0 - x0) <= 150 && box.x1 > x0).sort((a, b) => a.x1 - b.x1)[0];
        const right = near.filter((box) => Math.abs(box.x0 - x1) <= 150 && box.x1 > x1).sort((a, b) => a.x1 - b.x1)[0];
        if (left && right && right.x0 > left.x1) {
          const clear = (right.x0 - left.x1) / 1000;
          const supportLength = ((left.x1 - left.x0) + (right.x1 - right.x0)) / 1000;
          row.length = row.sideLength = round3(clear);
          row.columnCapDeduction = round3(supportLength * row.breadth * row.height);
          row.bottomJointDeduction = round3(supportLength * row.breadth);
        } else {
          const leftMass = rccBoxes.some((box) => Math.abs(box.x1 - x0) <= 150 && lineY >= box.y0 - 700 && lineY <= box.y1 + 700);
          const rightMass = rccBoxes.some((box) => Math.abs(box.x0 - x1) <= 150 && lineY >= box.y0 - 700 && lineY <= box.y1 + 700);
          const known = right ?? left;
          if (known && marks.length === 2 && (leftMass || rightMass)) {
            const terminalWidth = known.x1 - known.x0;
            row.length = row.sideLength = round3(Math.max(row.length - terminalWidth / 1000, 0));
            if (right) row.cadX1 = (row.cadX1 || 0) - terminalWidth;
            else row.cadX0 = (row.cadX0 || 0) + terminalWidth;
            row.columnCapDeduction = round3(terminalWidth / 1000 * row.breadth * row.height);
            row.bottomJointDeduction = round3(terminalWidth / 1000 * row.breadth);
            row.measurementSource = 'rcc support faces';
          }
        }
      } else {
        const lineX = (x0 + x1) / 2;
        const near = supportBoxes.filter((box) => lineX >= box.x0 - 700 && lineX <= box.x1 + 700);
        const bottom = near.filter((box) => Math.abs(box.y0 - y0) <= 150 && box.y1 > y0).sort((a, b) => a.y1 - b.y1)[0];
        const top = near.filter((box) => Math.abs(box.y0 - y1) <= 150 && box.y1 > y1).sort((a, b) => a.y1 - b.y1)[0];
        if (bottom && top && top.y0 > bottom.y1) {
          const clear = (top.y0 - bottom.y1) / 1000;
          const supportLength = ((bottom.y1 - bottom.y0) + (top.y1 - top.y0)) / 1000;
          row.length = row.sideLength = round3(clear);
          row.columnCapDeduction = round3(supportLength * row.breadth * row.height);
          row.bottomJointDeduction = round3(supportLength * row.breadth);
        }
      }
    }
    // Calculate the RCC overlap for every physical beam from all intersecting
    // closed column/wall outlines. The gross beam length remains unchanged;
    // this overlap is deducted only when the user selects "exclude caps".
    const supports = dwg.polylines
      .filter((polyline) => (/column|wall|rcc/i.test(polyline.layer) || (polyline.layer === '0' && polyline.pts.length <= 6)) && polyline.pts.length >= 4)
      .map((polyline) => ({
        x0: Math.min(...polyline.pts.map((point) => point.x)), x1: Math.max(...polyline.pts.map((point) => point.x)),
        y0: Math.min(...polyline.pts.map((point) => point.y)), y1: Math.max(...polyline.pts.map((point) => point.y)),
      }))
      .filter((box) => box.x1 - box.x0 >= 200 && box.x1 - box.x0 <= 2000 && box.y1 - box.y0 >= 200 && box.y1 - box.y0 <= 2000);
    // Repeated parallel beams carrying the same mark and section between the
    // same framing lines have one gross span. Small differences are normally
    // face-to-face versus centreline measurements, not separate beam lengths.
    // Normalize only close matches; genuinely different beams (for example
    // the two differently sized B12 members) remain separate rows.
    const comparable = new Map<string, MemberRow[]>();
    for (const row of consolidated) {
      if ([row.cadX0, row.cadY0, row.cadX1, row.cadY1].some((value) => value == null)) continue;
      const horizontal = Math.abs((row.cadX1 as number) - (row.cadX0 as number)) >= Math.abs((row.cadY1 as number) - (row.cadY0 as number));
      const key = `${row.member}|${horizontal ? 'H' : 'V'}|${row.breadth}|${row.height}`;
      comparable.set(key, [...(comparable.get(key) || []), row]);
    }
    for (const group of comparable.values()) {
      if (group.length < 2) continue;
      for (const row of group) {
        const horizontal = Math.abs((row.cadX1 as number) - (row.cadX0 as number)) >= Math.abs((row.cadY1 as number) - (row.cadY0 as number));
        const lo = horizontal ? Math.min(row.cadX0 as number, row.cadX1 as number) : Math.min(row.cadY0 as number, row.cadY1 as number);
        const hi = horizontal ? Math.max(row.cadX0 as number, row.cadX1 as number) : Math.max(row.cadY0 as number, row.cadY1 as number);
        const aligned = group.filter((candidate) => {
          const candidateLo = horizontal ? Math.min(candidate.cadX0 as number, candidate.cadX1 as number) : Math.min(candidate.cadY0 as number, candidate.cadY1 as number);
          const candidateHi = horizontal ? Math.max(candidate.cadX0 as number, candidate.cadX1 as number) : Math.max(candidate.cadY0 as number, candidate.cadY1 as number);
          return Math.abs(candidateLo - lo) <= 500 && Math.abs(candidateHi - hi) <= 500;
        });
        const longest = Math.max(...aligned.map((candidate) => candidate.length));
        if (longest > 0 && row.length / longest >= 0.85) row.length = longest;
      }
    }
    for (const row of consolidated) {
      if ([row.cadX0, row.cadY0, row.cadX1, row.cadY1].some((value) => value == null)) continue;
      const horizontal = Math.abs((row.cadX1 as number) - (row.cadX0 as number)) >= Math.abs((row.cadY1 as number) - (row.cadY0 as number));
      let lo = horizontal ? Math.min(row.cadX0 as number, row.cadX1 as number) : Math.min(row.cadY0 as number, row.cadY1 as number);
      let hi = horizontal ? Math.max(row.cadX0 as number, row.cadX1 as number) : Math.max(row.cadY0 as number, row.cadY1 as number);
      const perpendicular = horizontal ? ((row.cadY0 as number) + (row.cadY1 as number)) / 2 : ((row.cadX0 as number) + (row.cadX1 as number)) / 2;
      const intervals = supports.filter((box) => horizontal
        ? perpendicular >= box.y0 - 50 && perpendicular <= box.y1 + 50 && box.x1 > lo + 50 && box.x0 < hi - 50
        : perpendicular >= box.x0 - 50 && perpendicular <= box.x1 + 50 && box.y1 > lo + 50 && box.y0 < hi - 50)
        .map((box): [number, number] => {
          const b0 = horizontal ? box.x0 : box.y0, b1 = horizontal ? box.x1 : box.y1;
          return [Math.max(lo, b0), Math.min(hi, b1)];
        })
        .filter((interval) => interval[1] - interval[0] > 50)
        .sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const interval of intervals) {
        const last = merged[merged.length - 1];
        if (last && interval[0] <= last[1] + 25) last[1] = Math.max(last[1], interval[1]);
        else merged.push([...interval]);
      }
      const supportLength = merged.reduce((sum, interval) => sum + interval[1] - interval[0], 0) / 1000;
      row.supportWidths = merged.map((interval) => round3((interval[1] - interval[0]) / 1000)).filter((width) => width > 0);
      row.columnCapDeduction = round3(supportLength * row.breadth * row.height);
      row.bottomJointDeduction = round3(supportLength * row.breadth);
      row.sideLength = round3(Math.max(row.length - supportLength, 0));
    }
    // Normalization above can make equivalent parallel occurrences identical;
    // fold them into one MB row with Nos after support deductions are known.
    const finalRows = new Map<string, MemberRow>();
    for (const row of consolidated) {
      // Repeated labels along one continuous beam resolve to the same CAD run.
      // Keep that run once, but retain genuinely separate physical beams even
      // when their mark, size and length happen to match.
      const geometryKey = [row.cadX0, row.cadY0, row.cadX1, row.cadY1]
        .map((value) => value == null ? '' : Math.round(value))
        .join(',');
      const key = `${row.member}|${round3(row.length)}|${round3(row.breadth)}|${round3(row.height)}|${(row.supportWidths || []).join(',')}|${geometryKey}`;
      const prior = finalRows.get(key);
      if (prior) prior.nos = Math.max(prior.nos, row.nos);
      else finalRows.set(key, { ...row });
    }
    return [...finalRows.values()].sort((a, b) => compareBeamLabels(a.member, b.member));
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

/** One MB row per beam mark. Repeated labels are the clear spans of the same
 * continuous beam through multiple RCC supports, not separate beam marks. */
function consolidateBeamRows(rows: MemberRow[]): MemberRow[] {
  const groups = new Map<string, MemberRow[]>();
  const lanes = new Map<string, { horizontal: boolean; perpendicular: number; breadth: number; height: number }[]>();
  // Repeated marks on the same physical centreline are spans of one beam,
  // even when a nearby unrelated size note was associated differently.
  // A mark is split only when its geometry lies on a genuinely separate line.
  for (const row of rows) {
    let lane = 0;
    if ([row.cadX0, row.cadY0, row.cadX1, row.cadY1].every((v) => v != null)) {
      const dx = (row.cadX1 as number) - (row.cadX0 as number), dy = (row.cadY1 as number) - (row.cadY0 as number);
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const perpendicular = horizontal ? ((row.cadY0 as number) + (row.cadY1 as number)) / 2 : ((row.cadX0 as number) + (row.cadX1 as number)) / 2;
      const memberLanes = lanes.get(row.member) || [];
      const match = memberLanes.findIndex((candidate) => {
        if (candidate.horizontal !== horizontal) return false;
        const offset = Math.abs(candidate.perpendicular - perpendicular);
        return offset <= 250 || (offset <= 700 && candidate.breadth === row.breadth && candidate.height === row.height);
      });
      lane = match >= 0 ? match : memberLanes.length;
      if (match < 0) { memberLanes.push({ horizontal, perpendicular, breadth: row.breadth, height: row.height }); lanes.set(row.member, memberLanes); }
    }
    const key = `${row.member}|lane:${lane}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const consolidated = [...groups.values()].map((spans) => {
    if (spans.length === 1) return spans[0];
    const sizeCounts = new Map<string, number>();
    for (const span of spans) {
      const key = `${span.breadth}|${span.height}`;
      sizeCounts.set(key, (sizeCounts.get(key) || 0) + 1);
    }
    const selectedSize = [...sizeCounts].sort((a, b) => b[1] - a[1])[0]?.[0].split('|').map(Number) ?? [0, 0];
    type LocatedSpan = { row: MemberRow; horizontal: boolean; perpendicular: number; lo: number; hi: number };
    const located = spans.map((span): LocatedSpan | null => {
      if ([span.cadX0, span.cadY0, span.cadX1, span.cadY1].some((v) => v == null)) return null;
      const dx = (span.cadX1 as number) - (span.cadX0 as number);
      const dy = (span.cadY1 as number) - (span.cadY0 as number);
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      return {
        row: span, horizontal,
        perpendicular: horizontal ? ((span.cadY0 as number) + (span.cadY1 as number)) / 2 : ((span.cadX0 as number) + (span.cadX1 as number)) / 2,
        lo: horizontal ? Math.min(span.cadX0 as number, span.cadX1 as number) : Math.min(span.cadY0 as number, span.cadY1 as number),
        hi: horizontal ? Math.max(span.cadX0 as number, span.cadX1 as number) : Math.max(span.cadY0 as number, span.cadY1 as number),
      };
    }).filter((span): span is LocatedSpan => !!span);
    const lineGroups: LocatedSpan[][] = [];
    for (const span of located.sort((a, b) => Number(a.horizontal) - Number(b.horizontal) || a.perpendicular - b.perpendicular)) {
      const group = lineGroups.find((candidate) => candidate[0].horizontal === span.horizontal
        && Math.abs(candidate.reduce((sum, item) => sum + item.perpendicular, 0) / candidate.length - span.perpendicular) <= 1000);
      if (group) group.push(span); else lineGroups.push([span]);
    }
    const physicalBeams = lineGroups.map((group) => {
      const grossMm = Math.max(...group.map((span) => span.hi)) - Math.min(...group.map((span) => span.lo));
      const clearM = group.reduce((sum, span) => sum + span.row.length, 0);
      return { grossM: grossMm / 1000, clearM };
    }).filter((beam) => beam.grossM > 0);
    const grossLength = physicalBeams.length
      ? physicalBeams.reduce((sum, beam) => sum + beam.grossM, 0) / physicalBeams.length
      : spans.reduce((sum, span) => sum + span.length, 0);
    const clearLength = physicalBeams.length
      ? physicalBeams.reduce((sum, beam) => sum + Math.min(beam.clearM, beam.grossM), 0) / physicalBeams.length
      : spans.reduce((sum, span) => sum + (span.sideLength || span.length), 0);
    const totalSideLength = clearLength;
    const weightedThickness = (side: 1 | 2) => totalSideLength > 0
      ? spans.reduce((sum, span) => sum + (span.sideLength || span.length)
        * (side === 1 ? span.slabThicknessSide1 || 0 : span.slabThicknessSide2 || 0), 0) / totalSideLength
      : 0;
    const row = { ...spans[0] };
    row.length = round3(grossLength);
    row.sideLength = round3(totalSideLength);
    row.breadth = selectedSize[0]; row.height = selectedSize[1];
    row.slabThicknessSide1 = round3(weightedThickness(1));
    row.slabThicknessSide2 = round3(weightedThickness(2));
    row.innerSideCount = Number(!!row.slabThicknessSide1) + Number(!!row.slabThicknessSide2);
    const supportLength = Math.max(grossLength - clearLength, 0);
    row.columnCapDeduction = round3(supportLength * row.breadth * row.height);
    row.bottomJointDeduction = round3(supportLength * row.breadth);
    row.nos = Math.max(physicalBeams.length, 1);
    if (lineGroups.length === 1) {
      const group = lineGroups[0];
      if (group[0].horizontal) {
        row.cadX0 = Math.min(...group.map((span) => span.lo)); row.cadX1 = Math.max(...group.map((span) => span.hi));
        row.cadY0 = row.cadY1 = group.reduce((sum, span) => sum + span.perpendicular, 0) / group.length;
      } else {
        row.cadY0 = Math.min(...group.map((span) => span.lo)); row.cadY1 = Math.max(...group.map((span) => span.hi));
        row.cadX0 = row.cadX1 = group.reduce((sum, span) => sum + span.perpendicular, 0) / group.length;
      }
    }
    row.measurementSource = spans.every((span) => span.measurementSource === 'marked dimension')
      ? 'marked dimension' : 'drawing geometry';
    row.needsReview = spans.some((span) => span.needsReview);
    row.reviewReason = [...new Set(spans.map((span) => span.reviewReason).filter(Boolean))].join('; ') || undefined;
    return row;
  });
  // Identical physical beams at different locations may share one MB row
  // using Nos. Different length or size (such as the two B12 beams) stay as
  // separate rows.
  const combined = new Map<string, MemberRow>();
  for (const row of consolidated) {
    const key = `${row.member}|${round3(row.length)}|${round3(row.breadth)}|${round3(row.height)}`;
    const prior = combined.get(key);
    if (prior) prior.nos += row.nos;
    else combined.set(key, { ...row });
  }
  return [...combined.values()];
}
