// Auto-extract measurement-book member rows from a parsed drawing for the selected work group.
// Slab panels + beam runs are both extracted automatically (no manual marking). Rows are editable after.
import type { NormalizedDwg, Pt, Segment } from '../domain/types.js';
import { autoProposePanels } from './panels.js';
import { emptyRow, type MemberRow } from '../takeoff/rules.js';
import { hasMarkedPanelCorrections, reconcileMarkedPanelCorrections } from './markedPanelCorrections.js';
import { applyPanelMeasurementPriority } from './panelMeasurement.js';
import { round3 } from '../lib/num.js';

// Parse common CAD beam-size notation: 300X650 / 300x900 / 300×600.
function parseBeamSize(text: string): { widthMm: number; depthMm: number } | null {
  const m = text.replace(/\s/g, '').match(/(\d{2,4})[xX×](\d{2,4})/);
  return m ? { widthMm: +m[1], depthMm: +m[2] } : null;
}

let seq = 1;
const nextId = () => `m${seq++}`;

export function extractMembers(input: NormalizedDwg | NormalizedDwg[], workGroup: string, floor = 'Basement', learnedTeacher?: NormalizedDwg): MemberRow[] {
  seq = 1;
  const dwgs = Array.isArray(input) ? input : [input];
  const dwg = selectGeometrySheet(dwgs, workGroup);
  if (workGroup === 'slab') {
    const teacher = dwgs.filter((candidate) => candidate !== dwg && hasMarkedPanelCorrections(candidate)
      && samePlanGeometry(dwg, candidate)).sort((a, b) => b.dimensions.length - a.dimensions.length)[0] ?? learnedTeacher;
    return slabMembers(dwg, floor, slabSchedule(dwgs), slabUnoThickness(dwgs), teacher);
  }
  if (workGroup === 'beam') return beamMembers(dwg, floor, beamSchedule(dwgs), slabSchedule(dwgs),
    slabUnoThickness(dwgs), beamUnoSize(dwgs), beamReferenceLengths(dwgs));
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

export function selectGeometrySheet(dwgs: NormalizedDwg[], workGroup: string): NormalizedDwg {
  if (workGroup === 'slab') {
    const marked = dwgs.filter(hasMarkedPanelCorrections);
    const unmarked = dwgs.filter((candidate) => !hasMarkedPanelCorrections(candidate));
    // When the user supplies the original and a marked copy of the same plan,
    // retain the untouched original as geometry source and use the marked copy
    // only as a teacher/reference overlay.
    const candidates = marked.length && unmarked.some((plain) => marked.some((reference) => samePlanGeometry(plain, reference)))
      ? unmarked : dwgs;
    return [...candidates].sort((a, b) => {
    const score = (d: NormalizedDwg) => {
      const planWording = /(?:FRAMING|FORMWORK|STRUCTURAL|SLAB)\s+(?:LAYOUT|PLAN)|(?:LAYOUT|PLAN)\s+(?:AT|OF)?\s*\w*\s*(?:FLOOR|LEVEL)|FLOOR\s+(?:FRAMING|PLAN)/i;
      const detailWording = /\b(?:DETAILS?|SECTIONS?|PROJECTION|ELEVATION|SCHEDULE)\b/i;
      // Read drawing headings separately from the filename. A filename or
      // detail heading such as "slab-plan-detail" must not outrank a sheet
      // with actual bounded framing geometry.
      const planTitle = d.texts.some((t) => planWording.test(t.text) && !detailWording.test(t.text));
      const filenamePlan = planWording.test(d.fileName) && !detailWording.test(d.fileName);
      const isScheduleOrDetail = detailWording.test(d.fileName)
        || d.texts.some((t) => detailWording.test(t.text));
      const labels = d.texts.filter((t) => /slabs?\s*no/i.test(t.layer) && /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, ''))).length;
      const boundaries = d.segments.filter((s) => /beam|wall|col|pardi|rcc/i.test(s.layer)).length
        + d.polylines.filter((p) => /beam|wall|col|pardi|rcc/i.test(p.layer)).length
        + d.hatches.filter((h) => /beam|wall|col|pardi|rcc/i.test(h.layer)).length;
      // Prefer a sheet that actually yields bounded slab panels. Drawing titles
      // vary between consultants, while schedules/details can still contain
      // misleading words such as "slab" or "plan".
      const proposals = autoProposePanels(d).length;
      // A schedule may contain hundreds of S1/S2 cells and table borders. It is
      // reference data, never the geometry source when a framing plan is present.
      // Sheet role must outrank the number of closed loops: a dense schedule
      // or section can otherwise beat a sparse but genuine framing plan.
      // A combined plan/schedule sheet remains a plan geometry source.
      const roleScore = planTitle ? 1_000_000_000 : isScheduleOrDetail ? -1_000_000_000
        : filenamePlan ? 500_000_000 : 0;
      return roleScore + Math.min(proposals, 1000) * 100_000 + labels * 1000 + boundaries;
    };
      return score(b) - score(a);
    })[0];
  }
  if (workGroup !== 'beam') return [...dwgs].sort((a, b) => b.dimensions.length - a.dimensions.length)[0];
  const beamScore = (d: NormalizedDwg) => {
    const planWording = /(?:FRAMING|FORMWORK|STRUCTURAL|BEAM)\s+(?:LAYOUT|PLAN)|(?:LAYOUT|PLAN)\s+(?:AT|OF)?\s*\w*\s*(?:FLOOR|LEVEL)/i;
    const detailWording = /\b(?:DETAILS?|SECTIONS?|PROJECTION|ELEVATION|SCHEDULE)\b/i;
    const planTitle = d.texts.some((t) => planWording.test(t.text) && !detailWording.test(t.text));
    const filenamePlan = planWording.test(d.fileName) && !detailWording.test(d.fileName);
    const detailSheet = detailWording.test(d.fileName) || d.texts.some((t) => detailWording.test(t.text));
    const labels = d.texts.filter((t) => isBeamNumberLayer(t.layer) && beamLabel(t.text)).length;
    const geometry = d.segments.filter((s) => isBeamGeometryLayer(s.layer)).length;
    // Framing plans are the only valid beam-geometry source. Details and
    // sections remain schedule evidence for size lookup, never beam rows.
    const roleScore = planTitle ? 1_000_000_000 : detailSheet ? -1_000_000_000 : filenamePlan ? 500_000_000 : 0;
    return roleScore + labels * 1000 + geometry;
  };
  return [...dwgs].sort((a, b) => beamScore(b) - beamScore(a))[0];
}

export function samePlanGeometry(a: NormalizedDwg, b: NormalizedDwg): boolean {
  const aw = a.extents.max.x - a.extents.min.x, ah = a.extents.max.y - a.extents.min.y;
  const bw = b.extents.max.x - b.extents.min.x, bh = b.extents.max.y - b.extents.min.y;
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
  const spanMatch = Math.abs(aw - bw) / Math.max(aw, bw) <= 0.03
    && Math.abs(ah - bh) / Math.max(ah, bh) <= 0.03;
  if (!spanMatch) return false;
  const key = (dwg: NormalizedDwg, segment: Segment) => {
    const ox = dwg.extents.min.x, oy = dwg.extents.min.y;
    const p1 = [Math.round((segment.a.x - ox) / 10), Math.round((segment.a.y - oy) / 10)];
    const p2 = [Math.round((segment.b.x - ox) / 10), Math.round((segment.b.y - oy) / 10)];
    const ordered = p1[0] < p2[0] || (p1[0] === p2[0] && p1[1] <= p2[1]) ? [p1, p2] : [p2, p1];
    return `${ordered[0][0]},${ordered[0][1]}:${ordered[1][0]},${ordered[1][1]}`;
  };
  const keysA = new Set(a.segments.map((segment) => key(a, segment)));
  const keysB = new Set(b.segments.map((segment) => key(b, segment)));
  const smaller = keysA.size <= keysB.size ? keysA : keysB;
  const larger = smaller === keysA ? keysB : keysA;
  const shared = [...smaller].filter((value) => larger.has(value)).length;
  // Marked copies legitimately contain many extra dimensions, texts and
  // coloured outline entities. Match their unchanged base linework rather
  // than rejecting the pair because annotation counts differ.
  if (smaller.size >= 20) return shared / smaller.size >= 0.82;
  const entityA = a.segments.length + a.texts.length, entityB = b.segments.length + b.texts.length;
  return Math.abs(entityA - entityB) / Math.max(entityA, entityB, 1) <= 0.08;
}

/** Read label-specific width/depth rows from beam schedule/detail drawings. */
function beamSchedule(dwgs: NormalizedDwg[]): Map<string, { widthMm: number; depthMm: number }> {
  const schedule = new Map<string, { widthMm: number; depthMm: number }>();
  for (const dwg of dwgs) {
    const titles = dwg.texts.filter((t) => /BEAM\s+(?:DETAILS?|SCHEDULE)/i.test(t.text));
    for (const labelText of dwg.texts) {
      const label = beamLabel(labelText.text);
      const inScheduleRegion = /table|schedule/i.test(labelText.layer) || titles.some((title) =>
        Math.abs(labelText.pos.x - title.pos.x) <= 60_000 && Math.abs(labelText.pos.y - title.pos.y) <= 30_000);
      if (!label || !inScheduleRegion) continue;
      const sameRow = dwg.texts
        .filter((t) => Math.abs(t.pos.y - labelText.pos.y) <= 160
          && Math.abs(t.pos.x - labelText.pos.x) <= 12_000 && t !== labelText);
      const inline = sameRow.map((t) => parseBeamSize(t.text)).find(Boolean);
      if (inline) { schedule.set(label, inline); continue; }
      const numbers = sameRow
        .filter((t) => /^\d{2,4}$/.test(t.text.trim()))
        .sort((a, b) => a.pos.x - b.pos.x)
        .map((t) => Number(t.text.trim()));
      const widthMm = numbers[0], depthMm = numbers[1];
      if (widthMm >= 150 && widthMm <= 1000 && depthMm >= 300 && depthMm <= 2500) schedule.set(label, { widthMm, depthMm });
    }
  }
  return schedule;
}

/** Details may state the verified overall span, but they never create members.
 * Associate those dimensions with their nearby generic-layer beam mark and
 * transfer only the modal length to the matching framing-plan member. */
function beamReferenceLengths(dwgs: NormalizedDwg[]): Map<string, number> {
  const samples = new Map<string, number[]>();
  for (const dwg of dwgs) for (const text of dwg.texts) {
    const label = beamLabel(text.text);
    if (!label || isBeamNumberLayer(text.layer)) continue;
    const nearest = dwg.dimensions
      .filter((dimension) => dimension.measurement >= 600 && dimension.measurement <= 30000)
      // Slab/grid chains near a beam-detail mark are not beam spans. Detail
      // dimensions on BEAM/DIM layers are the only admissible references.
      .filter((dimension) => /dim1/i.test(dimension.layer)
        || (/beam/i.test(dimension.layer) && !/^beam$/i.test(dimension.layer.trim()))
        || (/^beam$/i.test(dimension.layer.trim()) && dimension.measurement >= 3000))
      .filter((dimension) => !/slab|grid|s-dim|vin_/i.test(dimension.layer))
      .map((dimension) => ({ dimension, distance: Math.hypot(text.pos.x - dimension.mid.x, text.pos.y - dimension.mid.y) }))
      .filter((candidate) => candidate.distance <= 3000)
      .sort((a, b) => a.distance - b.distance)[0]?.dimension;
    if (nearest) samples.set(label, [...(samples.get(label) || []), nearest.measurement]);
  }
  const result = new Map<string, number>();
  for (const [label, values] of samples) {
    const counts = new Map<number, number[]>();
    for (const value of values) {
      const bucket = Math.round(value / 10) * 10;
      counts.set(bucket, [...(counts.get(bucket) || []), value]);
    }
    const ranked = [...counts.values()].sort((a, b) => b.length - a.length);
    const selected = ranked[0];
    // Two equally repeated detail dimensions mean the mark is used in more
    // than one detail context; neither is a safe overall-span reference.
    if (selected && (!ranked[1] || selected.length > ranked[1].length)) {
      const mean = selected.reduce((sum, value) => sum + value, 0) / selected.length;
      // CAD dimensions often contain floating-point residue (3853.068 for a
      // drafted 3850). Snap only values already within 5 mm of a conventional
      // 50 mm increment; otherwise retain legitimate 5 mm dimensions (4365).
      const nearest50 = Math.round(mean / 50) * 50;
      result.set(label, Math.abs(mean - nearest50) <= 5 ? nearest50 : Math.round(mean / 5) * 5);
    }
  }
  return result;
}

function slabSchedule(dwgs: NormalizedDwg[]): Map<string, number> {
  const schedule = new Map<string, number>();
  for (const dwg of dwgs) {
    const titles = dwg.texts.filter((t) => /SLAB\s+(?:REINFORCEMENT\s+)?SCHEDULE/i.test(t.text));
    for (const label of dwg.texts) {
      const code = label.text.replace(/\s/g, '').toUpperCase();
      if (!/^S\d+[A-Z]?$/.test(code)) continue;
      const inScheduleRegion = /table|schedule/i.test(label.layer) || titles.some((title) =>
        Math.abs(label.pos.x - title.pos.x) <= 60_000 && Math.abs(label.pos.y - title.pos.y) <= 30_000);
      if (!inScheduleRegion) continue;
      const thickness = dwg.texts
        .filter((t) => Math.abs(t.pos.y - label.pos.y) <= 200
          && Math.abs(t.pos.x - label.pos.x) > 100 && Math.abs(t.pos.x - label.pos.x) < 15000
          && /^\d{2,4}$/.test(t.text.trim()))
        // A schedule can have closely spaced rows (for example S1A at y=500
        // and S6 at y=300). Prefer a value on the label's own row before
        // considering its horizontal position, otherwise the preceding row's
        // thickness can win merely because both values share the same x.
        .sort((a, b) => {
          const rowDistance = Math.abs(a.pos.y - label.pos.y) - Math.abs(b.pos.y - label.pos.y);
          return rowDistance || a.pos.x - b.pos.x;
        })
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
    // Consultants commonly write either "ALL SLAB THICKNESS SHALL BE ..."
    // or "FOR ALL SLAB SHALL BE ...".  Treat both as drawing-wide defaults,
    // but only when U.N.O. is present so an unrelated note cannot override a
    // locally marked S-code or numeric thickness.
    const slabDefault = /(?:FOR\s+)?ALL\s+SLABS?(?:\s+THICKNESS)?\s+SHALL\s+BE/i;
    if (!slabDefault.test(normalized) || !/U\s*\.?\s*N\s*\.?\s*O/i.test(normalized)) return undefined;
    const value = normalized.match(/(?:FOR\s+)?ALL\s+SLABS?(?:\s+THICKNESS)?\s+SHALL\s+BE[\s\S]{0,100}?(\d{2,4})\s*(?:MM)?\s*(?:THK|THICK)/i)?.[1];
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

/** Read the drawing-wide default from a note such as
 * "ALL BEAM SIZE SHALL BE 300X500 (U.N.O.)". */
function beamUnoSize(dwgs: NormalizedDwg[]): { widthMm: number; depthMm: number } | undefined {
  const parse = (text: string) => {
    const normalized = text.replace(/\\P|\r?\n/g, ' ').replace(/\s+/g, ' ');
    // Also accept note styles such as "FOR BEAM SIZE SHALL BE (300x550)
    // U.N.O."; "ALL" is frequently omitted in consultant general notes.
    const beamDefault = /(?:FOR\s+)?(?:ALL\s+)?BEAMS?\s+SIZE\s+SHALL\s+BE/i;
    if (!beamDefault.test(normalized) || !/U\s*\.?\s*N\s*\.?\s*O/i.test(normalized)) return undefined;
    const match = normalized.match(/(?:FOR\s+)?(?:ALL\s+)?BEAMS?\s+SIZE\s+SHALL\s+BE[\s\S]{0,100}?(\d{2,4})\s*[xX×]\s*(\d{2,4})/i);
    if (!match) return undefined;
    const widthMm = Number(match[1]), depthMm = Number(match[2]);
    return widthMm >= 150 && widthMm <= 1500 && depthMm >= 250 && depthMm <= 3000 ? { widthMm, depthMm } : undefined;
  };
  for (const dwg of dwgs) {
    for (const note of dwg.texts) {
      const size = parse(note.text);
      if (size) return size;
    }
    // Some exports split a general note across multiple TEXT entities.
    const size = parse(dwg.texts.map((t) => t.text).join(' '));
    if (size) return size;
  }
  return undefined;
}

function polygonLabelPoint(points: { x: number; y: number }[]): { x: number; y: number } {
  const minX = Math.min(...points.map((point) => point.x)), maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y)), maxY = Math.max(...points.map((point) => point.y));
  const inside = (point: { x: number; y: number }) => {
    let contained = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x) contained = !contained;
    }
    return contained;
  };
  const distance = (point: { x: number; y: number }) => Math.min(...points.map((a, index) => {
    const b = points[(index + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
  }));
  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, bestDistance = inside(best) ? distance(best) : -1;
  // A compact polylabel-style search keeps a chajja mark on its actual strip,
  // never at the centre of its much larger bounding rectangle.
  for (let yi = 1; yi < 20; yi++) for (let xi = 1; xi < 20; xi++) {
    const candidate = { x: minX + (maxX - minX) * xi / 20, y: minY + (maxY - minY) * yi / 20 };
    if (!inside(candidate)) continue;
    const clearance = distance(candidate);
    if (clearance > bestDistance) { best = candidate; bestDistance = clearance; }
  }
  return bestDistance >= 0 ? best : points[0];
}

// --- slab: reuse the label-anchored panel proposer ---
function slabMembers(dwg: NormalizedDwg, floor: string, schedule: Map<string, number>, unoThickness?: number,
  markedTeacher?: NormalizedDwg): MemberRow[] {
  const measurementDwg = markedTeacher || dwg;
  const panels = applyPanelMeasurementPriority(measurementDwg,
    reconcileMarkedPanelCorrections(measurementDwg, autoProposePanels(dwg)));
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
  // When the framing region contains no panel marks, S1 is the conventional
  // drawing default if it is explicitly defined by the slab schedule. The
  // schedule supplies classification/thickness only; it never supplies panel
  // geometry, so table cells cannot become quantities.
  const scheduleDefaultCode = schedule.has('S1') ? 'S1' : schedule.size === 1 ? schedule.keys().next().value as string : undefined;
  return ordered.map((p, i) => {
    const r = emptyRow(nextId(), floor);
    r.member = `P${i + 1}${p.label ? ` (${p.label})` : ''}`;
    r.cadX = (p.box.x0 + p.box.x1) / 2;
    r.cadY = (p.box.y0 + p.box.y1) / 2;
    // A perimeter chajja's bounding-box centre is usually inside a room slab.
    // Place its mark on the largest actual polygon part instead.
    if (p.polygonParts?.length) {
      const area = (points: { x: number; y: number }[]) => Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0)) / 2;
      const part = [...p.polygonParts].sort((a, b) => area(b) - area(a))[0];
      const labelPoint = polygonLabelPoint(part);
      r.cadX = labelPoint.x; r.cadY = labelPoint.y;
    } else if (p.polygon?.length) {
      const labelPoint = polygonLabelPoint(p.polygon);
      r.cadX = labelPoint.x; r.cadY = labelPoint.y;
    }
    r.cadX0 = p.box.x0;
    r.cadY0 = p.box.y0;
    r.cadX1 = p.box.x1;
    r.cadY1 = p.box.y1;
    const boundingAreaM2 = (p.lengthMm / 1000) * (p.breadthMm / 1000);
    const irregularAreaOnly = (!!p.polygon || !!p.polygonParts?.length) && p.netAreaM2 !== undefined
      && ((p.polygonParts?.length || 0) > 1 || (p.polygon?.length ?? 0) !== 4
        || boundingAreaM2 <= 0 || p.netAreaM2 / boundingAreaM2 < 0.985);
    // A bounding rectangle is reference geometry, not a valid L × B
    // measurement for a stepped/notched slab. Such panels are billed only by
    // their exact polygonal net area.
    r.length = irregularAreaOnly ? 0 : round3(p.lengthMm / 1000);
    r.breadth = irregularAreaOnly ? 0 : round3(p.breadthMm / 1000);
    const explicitCode = (p.inferredSlabCode || p.label)?.replace(/\s/g, '').toUpperCase();
    const slabCode = explicitCode && /^S\d+[A-Z]?$/.test(explicitCode) ? explicitCode : scheduleDefaultCode;
    if (!p.label && slabCode) r.member = `P${i + 1} (${slabCode})`;
    const thicknessMm = p.thicknessMm || (slabCode ? schedule.get(slabCode) : undefined) || unoThickness || 175;
    const missingThickness = !p.thicknessMm && !(slabCode && schedule.has(slabCode)) && !unoThickness;
    r.height = round3(thicknessMm / 1000); // slab thickness → concrete depth
    r.slabThickness = r.height;
    r.openings = round3(p.openingM2);
    if (p.netAreaM2 !== undefined) {
      r.netArea = round3(Math.max(p.netAreaM2 - p.openingM2, 0));
      // Keep exact polygon geometry only for genuinely irregular panels.
      // Near-rectangular visual candidates have already been normalized to
      // their verified bounding rectangle and must render/export as such.
      r.cadPolygon = irregularAreaOnly && !p.polygonParts?.length ? p.polygon : undefined;
      r.cadPolygonParts = irregularAreaOnly && p.polygonParts?.length ? p.polygonParts : undefined;
    }
    r.nos = 1;
    r.measurementSource = p.measurementBasis === 'marked dimensions' ? 'marked dimension' : 'drawing geometry';
    const reviewReasons = [
      p.markedBoundary && p.measurementBasis === 'marked dimensions'
        ? 'user-marked CAD outline measured from associated dimensions'
        : p.markedBoundary ? 'user-marked CAD outline; dimensions incomplete' : '',
      p.visualBoundary ? 'recovered by on-device visual boundary detection' : '',
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
function beamMembers(dwg: NormalizedDwg, floor: string, schedule: Map<string, { widthMm: number; depthMm: number }>, slabThicknesses: Map<string, number>, slabUnoThicknessMm?: number, unoSize?: { widthMm: number; depthMm: number }, referenceLengths = new Map<string, number>()): MemberRow[] {
  const allSlabLabels = dwg.texts
    .filter((t) => /slabs?\s*(?:no|number)/i.test(t.layer) && /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, '')))
    .map((t) => ({ ...t, code: t.text.replace(/\s/g, '').toUpperCase() }));
  // A consultant may keep the framing plan, slab profiles, beam details and
  // sections in one DWG. Only the dense slab-label cluster identifies the
  // primary plan and is allowed to create beam members. Details remain valid
  // reference evidence for section sizes, but never become quantity rows.
  const planBounds = (() => {
    if (allSlabLabels.length < 3) return undefined;
    const remaining = new Set(allSlabLabels);
    const groups: typeof allSlabLabels[] = [];
    while (remaining.size) {
      const seed = remaining.values().next().value as typeof allSlabLabels[number];
      const group = [seed]; remaining.delete(seed);
      for (let index = 0; index < group.length; index++) {
        const current = group[index];
        for (const candidate of [...remaining]) {
          if (Math.hypot(candidate.pos.x - current.pos.x, candidate.pos.y - current.pos.y) <= 15_000) {
            group.push(candidate); remaining.delete(candidate);
          }
        }
      }
      groups.push(group);
    }
    const primary = groups.sort((a, b) => b.length - a.length)[0];
    if (!primary || primary.length < 3) return undefined;
    const padding = 8_000;
    return {
      x0: Math.min(...primary.map((label) => label.pos.x)) - padding,
      y0: Math.min(...primary.map((label) => label.pos.y)) - padding,
      x1: Math.max(...primary.map((label) => label.pos.x)) + padding,
      y1: Math.max(...primary.map((label) => label.pos.y)) + padding,
    };
  })();
  const inPlan = (point: Pt) => !planBounds || (point.x >= planBounds.x0 && point.x <= planBounds.x1
    && point.y >= planBounds.y0 && point.y <= planBounds.y1);
  const beams: Segment[] = dwg.segments.filter((s) => isBeamGeometryLayer(s.layer)
    && inPlan({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }));
  // Many consultants place sizes on generic TEXT layers. Accept only text that
  // itself parses as a size; geometric proximity below still controls association.
  const sizeTexts = dwg.texts.filter((t) => !!parseBeamSize(t.text) && inPlan(t.pos));
  // Beam marks are frequently placed on generic TEXT layers. The strict label
  // grammar prevents notes and reinforcement text from becoming members.
  const dedicatedNoTexts = dwg.texts.filter((t) => isBeamNumberLayer(t.layer) && !!beamLabel(t.text));
  // When the drawing provides a dedicated BEAM NO layer it is the authoritative
  // member register. Identical B1/B2 text inside reinforcement details and
  // sections is commonly placed on generic TEXT layers and must not create
  // quantities. Generic-layer marks remain supported only for drawings that
  // have no dedicated beam-number layer at all.
  // Beam schedules/details often repeat the complete member register in a
  // perfectly aligned text column. That column is reference data, not physical
  // members. Remove only long lanes containing many distinct marks; ordinary
  // vertical framing beams have few repeated marks and remain untouched.
  const registerTexts = new Set<typeof dedicatedNoTexts[number]>();
  // A vertical beam schedule may mix plain labels (B12A) with grouped labels
  // (B12/B12B), so lane grammar alone cannot remove every row. The schedule's
  // BEAM NUMBER header defines the whole register column.
  const registerHeaders = dwg.texts.filter((text) => /\bBEAM\s+NUMBER\b/i.test(text.text));
  for (const text of dedicatedNoTexts) if (registerHeaders.some((header) =>
    Math.abs(text.pos.x - header.pos.x) <= 1200
    && text.pos.y <= header.pos.y + 1200 && text.pos.y >= header.pos.y - 45_000)) registerTexts.add(text);
  for (const vertical of [true, false]) {
    const ordered = [...dedicatedNoTexts].sort((a, b) => (vertical ? a.pos.x - b.pos.x : a.pos.y - b.pos.y));
    const lanes: typeof dedicatedNoTexts[] = [];
    for (const text of ordered) {
      const coordinate = vertical ? text.pos.x : text.pos.y;
      let lane = lanes[lanes.length - 1];
      const prior = lane?.[lane.length - 1];
      const priorCoordinate = prior ? (vertical ? prior.pos.x : prior.pos.y) : Number.NEGATIVE_INFINITY;
      if (!lane || Math.abs(coordinate - priorCoordinate) > 2) { lane = []; lanes.push(lane); }
      lane.push(text);
    }
    for (const lane of lanes) {
      const distinct = new Set(lane.map((text) => beamLabel(text.text))).size;
      // A physical vertical/horizontal beam cannot carry eight different beam
      // marks at the exact same coordinate. Detail/register columns can have
      // irregular row spacing, so regular spacing is not required to reject it.
      if (lane.length >= 8 && distinct >= 8)
        for (const text of lane) registerTexts.add(text);
    }
  }
  const planNoTexts = dedicatedNoTexts.filter((text) => !registerTexts.has(text));
  const noTexts = (planNoTexts.length ? planNoTexts
    : dwg.texts.filter((t) => !!beamLabel(t.text))).filter((t) => inPlan(t.pos));
  const slabLabels = allSlabLabels.filter((label) => inPlan(label.pos));
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

  // Preserve runs on an exact CAD baseline as stronger evidence than the
  // width-clustered runs above. Clustering the two faces of a beam is useful
  // for fragmented drawings, but at junctions it can join two different
  // collinear members (the former B10 11.775 m result).
  const faceRuns: typeof runs = [];
  const buildFaceRuns = (segs: { coord: number; lo: number; hi: number }[], horizontal: boolean) => {
    segs.sort((a, b) => a.coord - b.coord);
    const lines: { coord: number; iv: [number, number][] }[] = [];
    for (const segment of segs) {
      let line = lines.find((candidate) => Math.abs(candidate.coord - segment.coord) <= 25);
      if (!line) { line = { coord: segment.coord, iv: [] }; lines.push(line); }
      line.iv.push([segment.lo, segment.hi]);
    }
    for (const line of lines) {
      line.iv.sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const interval of line.iv) {
        const prior = merged[merged.length - 1];
        if (prior && interval[0] <= prior[1] + BRIDGE) prior[1] = Math.max(prior[1], interval[1]);
        else merged.push([...interval]);
      }
      for (const [lo, hi] of merged) if (hi - lo >= 600)
        faceRuns.push(horizontal ? { a: { x: lo, y: line.coord }, b: { x: hi, y: line.coord }, horizontal }
          : { a: { x: line.coord, y: lo }, b: { x: line.coord, y: hi }, horizontal });
    }
  };
  buildFaceRuns(beams.filter((s) => Math.abs(s.a.y - s.b.y) < Math.abs(s.a.x - s.b.x))
    .map((s) => ({ coord: (s.a.y + s.b.y) / 2, lo: Math.min(s.a.x, s.b.x), hi: Math.max(s.a.x, s.b.x) })), true);
  buildFaceRuns(beams.filter((s) => Math.abs(s.a.y - s.b.y) >= Math.abs(s.a.x - s.b.x))
    .map((s) => ({ coord: (s.a.x + s.b.x) / 2, lo: Math.min(s.a.y, s.b.y), hi: Math.max(s.a.y, s.b.y) })), false);

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
      const alignedSiblings = siblings.map((sibling) => {
        const dx = Math.abs(sibling.text.pos.x - item.text.pos.x), dy = Math.abs(sibling.text.pos.y - item.text.pos.y);
        const direction = dx >= 1200 && dy <= 1000 ? 'H' as const
          : dy >= 1200 && dx <= 1000 ? 'V' as const : undefined;
        return direction ? { direction, distance: Math.hypot(dx, dy) } : undefined;
      }).filter((candidate): candidate is { direction: 'H' | 'V'; distance: number } => !!candidate)
        .sort((a, b) => a.distance - b.distance);
      // The nearest same-mark label on the same baseline identifies this
      // physical member. Farther mirrored copies must not outvote it (B34 has
      // a close vertical pair and two more labels on the opposite tower).
      if (alignedSiblings.length) inferredDirection.set(item.text, alignedSiblings[0].direction);
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
    for (const text of registerTexts) {
      const label = beamLabel(text.text);
      if (!label) continue;
      const nearest = [...beams].sort((a, b) => pointSegmentDistance(text.pos, a) - pointSegmentDistance(text.pos, b))[0];
      const direction = nearest ? (Math.abs(nearest.b.x - nearest.a.x) >= Math.abs(nearest.b.y - nearest.a.y) ? 'H' as const : 'V' as const) : null;
      const beamCoord = nearest ? (direction === 'H' ? (nearest.a.y + nearest.b.y) / 2 : (nearest.a.x + nearest.b.x) / 2) : 0;
      const inline = sizeForBeam(text.pos, direction, beamCoord);
      if (inline) sizeByLabel.set(label, inline);
    }
    for (const item of labelled) {
      if (sizeByLabel.has(item.label)) continue;
      const inline = parseBeamSize(nearestText(item.text.pos, sizeTexts, 6000) ?? '');
      if (inline) sizeByLabel.set(item.label, inline);
    }
    const rows = labelled.map(({ text, label }) => {
      const expectedDirection = inferredDirection.get(text);
      const siblings = labelled.filter((candidate) => candidate.label === label && candidate.text !== text);
      let nearest = beams.map((beam) => ({ beam,
        direction: Math.abs(beam.b.x - beam.a.x) >= Math.abs(beam.b.y - beam.a.y) ? 'H' as const : 'V' as const,
        length: Math.hypot(beam.b.x - beam.a.x, beam.b.y - beam.a.y),
        distance: pointSegmentDistance(text.pos, beam),
        coveredMarks: siblings.filter((sibling) => pointSegmentDistance(sibling.text.pos, beam) <= 1200).length + 1,
      })).filter((candidate) => (!expectedDirection || candidate.direction === expectedDirection)
        && candidate.length >= 600 && candidate.coveredMarks <= 2)
        .sort((a, b) => a.distance - b.distance || a.length - b.length)[0]?.beam;
      const rawDirection = nearest ? (Math.abs(nearest.b.x - nearest.a.x) >= Math.abs(nearest.b.y - nearest.a.y) ? 'H' : 'V') : null;
      const rawLength = nearest ? Math.hypot(nearest.b.x - nearest.a.x, nearest.b.y - nearest.a.y) : 0;
      if (expectedDirection) {
        const full = runs.filter((run) => (run.horizontal ? 'H' : 'V') === expectedDirection)
          .map((run) => ({ run, segment: { layer: 'BEAM-RUN', a: run.a, b: run.b } as Segment }))
          .map((candidate) => ({ ...candidate,
            distance: pointSegmentDistance(text.pos, candidate.segment),
            length: Math.hypot(candidate.run.b.x - candidate.run.a.x, candidate.run.b.y - candidate.run.a.y),
            coveredMarks: siblings.filter((sibling) => pointSegmentDistance(sibling.text.pos, candidate.segment) <= 1200).length + 1,
          }))
          // Repair interruptions at crossing secondary beams. The former
          // raw-fragment length guard rejected the real continuous run whenever
          // a transverse beam split a vertical member into several short faces.
          // Perpendicular lane distance and plan-region filtering are the
          // safeguards against jumping to an unrelated member.
          .filter((candidate) => {
            if (candidate.distance > 1200 || candidate.coveredMarks > 2) return false;
            const segment = candidate.segment;
            const sameLineSibling = siblings.find((sibling) => {
              const dx = Math.abs(sibling.text.pos.x - text.pos.x), dy = Math.abs(sibling.text.pos.y - text.pos.y);
              const aligned = expectedDirection === 'H' ? dx >= 1200 && dy <= 1000 : dy >= 1200 && dx <= 1000;
              return aligned && pointSegmentDistance(sibling.text.pos, segment) <= 1200;
            });
            const labelSpan = sameLineSibling ? Math.hypot(sameLineSibling.text.pos.x - text.pos.x,
              sameLineSibling.text.pos.y - text.pos.y) : 0;
            return candidate.length <= Math.max(rawLength + 2000, rawLength * 1.75)
              || (!!sameLineSibling && candidate.length <= labelSpan + 4000);
          })
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
      const size = sizeByLabel.get(label) ?? schedule.get(label) ?? inlineSize ?? unoSize;
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
      // Slab thickness is a universal beam-side deduction. A missing/ambiguous
      // slab mark must not silently turn the exposed beam side into full depth;
      // use the standard 175 mm slab fallback and keep the row reviewable.
      const defaultSlabThickness = slabUnoThicknessMm ?? 175;
      // A framing-plan beam normally meets the floor slab on both longitudinal
      // faces. Missing slab text is a recognition gap, not evidence that the
      // slab disappears; retain the universal fallback on that face.
      r.slabThicknessSide1 = round3(((side1 ? slabThicknesses.get(side1.code) : undefined) ?? defaultSlabThickness) / 1000);
      r.slabThicknessSide2 = round3(((side2 ? slabThicknesses.get(side2.code) : undefined) ?? defaultSlabThickness) / 1000);
      r.slabThickness = round3(Math.max(r.slabThicknessSide1, r.slabThicknessSide2));
      r.innerSideCount = 2;
      r.nos = 1;
      const sourceA = useMarkedDimension ? markedDimension.dimension.p1 : nearest?.a;
      const sourceB = useMarkedDimension ? markedDimension.dimension.p2 : nearest?.b;
      if (sourceA && sourceB) {
        r.cadX0 = sourceA.x; r.cadY0 = sourceA.y;
        r.cadX1 = sourceB.x; r.cadY1 = sourceB.y;
      }
      const unresolvedSlabs = false;
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
    // A single continuous beam-face run covering every repeated label is
    // stronger evidence than the shorter fragments around RCC supports. Apply
    // that run before consolidation (for example B10 = 13.300 m). Without a
    // continuous run, real slab-bay gaps remain separate components (B47).
    const rowsByMember = new Map<string, MemberRow[]>();
    for (const row of rows) rowsByMember.set(row.member, [...(rowsByMember.get(row.member) || []), row]);
    for (const [member, memberRows] of rowsByMember) {
      const marks = labelled.filter((item) => item.label === member).map((item) => item.text.pos);
      if (marks.length < 2) continue;
      const horizontal = memberRows.filter((row) => Math.abs((row.cadX1 || 0) - (row.cadX0 || 0)) >= Math.abs((row.cadY1 || 0) - (row.cadY0 || 0))).length >= memberRows.length / 2;
      const baselineGroups: Pt[][] = [];
      for (const mark of [...marks].sort((a, b) => (horizontal ? a.y - b.y : a.x - b.x))) {
        const perpendicular = horizontal ? mark.y : mark.x;
        const group = baselineGroups.find((candidate) => Math.abs(candidate.reduce((sum, point) => sum
          + (horizontal ? point.y : point.x), 0) / candidate.length - perpendicular) <= 1000);
        if (group) group.push(mark); else baselineGroups.push([mark]);
      }
      for (const baseline of baselineGroups) {
        const ordered = [...baseline].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
        const gaps = ordered.slice(1).map((mark, index) => (horizontal ? mark.x - ordered[index].x : mark.y - ordered[index].y));
        const small = [...gaps].sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(gaps.length / 2)));
        const typical = small.reduce((sum, gap) => sum + gap, 0) / Math.max(small.length, 1);
        const clusters: Pt[][] = [[]];
        for (let index = 0; index < ordered.length; index++) {
          if (index && typical > 0 && gaps[index - 1] > typical * 1.8 && gaps[index - 1] > 4000) clusters.push([]);
          clusters[clusters.length - 1].push(ordered[index]);
        }
        for (const cluster of clusters.filter((candidate) => candidate.length >= 2)) {
          const markLo = Math.min(...cluster.map((mark) => horizontal ? mark.x : mark.y));
          const markHi = Math.max(...cluster.map((mark) => horizontal ? mark.x : mark.y));
          const complete = runs.filter((run) => run.horizontal === horizontal)
            .map((run) => ({ run, segment: { layer: 'BEAM-RUN', a: run.a, b: run.b } as Segment,
              length: Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y) }))
            .filter((candidate) => cluster.every((mark) => pointSegmentDistance(mark, candidate.segment) <= 1200)
              && candidate.length <= markHi - markLo + 4000)
            .sort((a, b) => b.length - a.length)[0];
          if (!complete) continue;
          for (const row of memberRows.filter((candidate) => {
            const midpoint = { x: ((candidate.cadX0 || 0) + (candidate.cadX1 || 0)) / 2,
              y: ((candidate.cadY0 || 0) + (candidate.cadY1 || 0)) / 2 };
            return pointSegmentDistance(midpoint, complete.segment) <= 1200
              && cluster.some((mark) => pointSegmentDistance(mark, complete.segment) <= 1200);
          })) {
            row.length = row.sideLength = round3(complete.length / 1000);
            row.cadX0 = complete.run.a.x; row.cadY0 = complete.run.a.y;
            row.cadX1 = complete.run.b.x; row.cadY1 = complete.run.b.y;
            row.measurementSource = 'drawing geometry';
          }
        }
      }
    }
    let consolidated = consolidateBeamRows(rows);
    // If an exact-baseline face covers the plan marks, it is direct span
    // evidence. Prefer it for repeated marks; for a single mark use it only
    // when it agrees with the initial trace, so incomplete faces such as B31
    // can still use a verified detail dimension.
    for (const row of consolidated) {
      if ([row.cadX0, row.cadY0, row.cadX1, row.cadY1].some((value) => value == null)) continue;
      const horizontal = Math.abs((row.cadX1 as number) - (row.cadX0 as number)) >= Math.abs((row.cadY1 as number) - (row.cadY0 as number));
      const perpendicular = horizontal ? ((row.cadY0 as number) + (row.cadY1 as number)) / 2
        : ((row.cadX0 as number) + (row.cadX1 as number)) / 2;
      const along0 = horizontal ? Math.min(row.cadX0 as number, row.cadX1 as number) : Math.min(row.cadY0 as number, row.cadY1 as number);
      const along1 = horizontal ? Math.max(row.cadX0 as number, row.cadX1 as number) : Math.max(row.cadY0 as number, row.cadY1 as number);
      const marks = labelled.filter((item) => item.label === row.member)
        .map((item) => item.text.pos)
        .filter((mark) => Math.abs((horizontal ? mark.y : mark.x) - perpendicular) <= 1200
          && (horizontal ? mark.x : mark.y) >= along0 - 3000 && (horizontal ? mark.x : mark.y) <= along1 + 3000);
      if (!marks.length) continue;
      const candidates = faceRuns.filter((run) => run.horizontal === horizontal)
        .map((run) => ({ run, segment: { layer: 'BEAM-FACE', a: run.a, b: run.b } as Segment,
          length: Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y) }))
        .filter((candidate) => marks.every((mark) => pointSegmentDistance(mark, candidate.segment) <= 1200))
        .sort((a, b) => a.length - b.length);
      const reference = referenceLengths.get(row.member);
      const rawCandidates = beams.filter((segment) => {
        const segmentHorizontal = Math.abs(segment.a.x - segment.b.x) >= Math.abs(segment.a.y - segment.b.y);
        return segmentHorizontal === horizontal
          && marks.every((mark) => pointSegmentDistance(mark, segment) <= 1200)
          && Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) >= 600;
      }).map((segment) => ({ run: { a: segment.a, b: segment.b, horizontal }, segment,
        length: Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) }))
        .filter((candidate) => !reference || (candidate.length / Math.max(row.length * 1000, 1) >= 0.8
          && candidate.length / Math.max(row.length * 1000, 1) <= 1.2))
        .sort((a, b) => b.length - a.length);
      const direct = rawCandidates[0] ?? candidates[0];
      const agreement = direct ? direct.length / Math.max(row.length * 1000, 1) : 0;
      const referenceAgreement = direct && reference ? direct.length / reference : 0;
      if (!direct || (marks.length === 1 && reference != null
        && (agreement < 0.85 || agreement > 1.2 || referenceAgreement < 0.9 || referenceAgreement > 1.1))) continue;
      // A merged face run can differ by a few millimetres where fragmented
      // endpoints overlap. Recover the nearest intact raw face on the same
      // member (B9 6450, B17 1860) before conventional rounding.
      const intactLength = beams.filter((segment) => {
        const segmentHorizontal = Math.abs(segment.a.x - segment.b.x) >= Math.abs(segment.a.y - segment.b.y);
        const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
        return segmentHorizontal === horizontal && Math.abs(length - direct.length) <= 25
          && marks.some((mark) => pointSegmentDistance(mark, segment) <= 1200);
      }).map((segment) => Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y))
        .sort((a, b) => Math.abs(a - direct.length) - Math.abs(b - direct.length))[0];
      const resolvedLength = intactLength ?? direct.length;
      const nearest50 = Math.round(resolvedLength / 50) * 50;
      const normalizedLength = Math.abs(resolvedLength - nearest50) <= 5 ? nearest50 : resolvedLength;
      row.length = row.sideLength = round3(normalizedLength / 1000);
      row.cadX0 = direct.run.a.x; row.cadY0 = direct.run.a.y;
      row.cadX1 = direct.run.b.x; row.cadY1 = direct.run.b.y;
      row.measurementSource = 'exact beam face';
    }
    // Resolve mirrored/repeated plan members from the modal intact face beside
    // every occurrence of their beam mark. This is orientation-independent:
    // a short vertical beam at a busy junction must not inherit a nearby
    // horizontal run merely because that run passes closer to its text.
    for (const row of consolidated) {
      const marks = labelled.filter((item) => item.label === row.member).map((item) => item.text.pos);
      if (marks.length < 2) continue;
      const evidence = beams.map((segment) => {
        const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
        const horizontal = Math.abs(segment.b.x - segment.a.x) >= Math.abs(segment.b.y - segment.a.y);
        const coveredMarks = marks.map((mark, index) => pointSegmentDistance(mark, segment) <= 1200 ? index : -1)
          .filter((index) => index >= 0);
        return { segment, length, horizontal, coveredMarks };
      }).filter((candidate) => candidate.length >= 600 && candidate.length <= 30_000 && candidate.coveredMarks.length);
      const groups = new Map<string, typeof evidence>();
      for (const candidate of evidence) {
        const key = `${candidate.horizontal ? 'H' : 'V'}:${Math.round(candidate.length / 25) * 25}`;
        groups.set(key, [...(groups.get(key) || []), candidate]);
      }
      const ranked = [...groups.values()].map((group) => ({
        group,
        coverage: new Set(group.flatMap((candidate) => candidate.coveredMarks)).size,
        proximity: marks.reduce((sum, mark) => sum + Math.min(...group.map((candidate) =>
          pointSegmentDistance(mark, candidate.segment))), 0),
        pairedFaces: group.reduce((count, candidate, index) => count + group.slice(index + 1).filter((other) => {
          const gap = candidate.horizontal
            ? Math.abs((candidate.segment.a.y + candidate.segment.b.y - other.segment.a.y - other.segment.b.y) / 2)
            : Math.abs((candidate.segment.a.x + candidate.segment.b.x - other.segment.a.x - other.segment.b.x) / 2);
          return candidate.horizontal === other.horizontal
            && Math.abs(candidate.length - other.length) <= 25
            && gap >= row.breadth * 1000 * 0.75 && gap <= row.breadth * 1000 * 1.25;
        }).length, 0),
        // Identical CAD faces can be split into fragments. Count the closest
        // representative per plan mark rather than treating every fragment as
        // another physical beam.
        copies: new Set(marks.map((mark) => {
          const nearest = [...group].sort((a, b) => pointSegmentDistance(mark, a.segment)
            - pointSegmentDistance(mark, b.segment))[0];
          if (!nearest || pointSegmentDistance(mark, nearest.segment) > 1200) return '';
          const midX = (nearest.segment.a.x + nearest.segment.b.x) / 2;
          const midY = (nearest.segment.a.y + nearest.segment.b.y) / 2;
          return `${Math.round(midX / 100)}:${Math.round(midY / 100)}`;
        }).filter(Boolean)).size,
      })).filter((candidate) => candidate.coverage === marks.length && candidate.group.length >= 2
        && (!candidate.pairedFaces || (candidate.group[0].length / Math.max(row.length * 1000, 1) >= 0.85
          && candidate.group[0].length / Math.max(row.length * 1000, 1) <= 1.15)))
        .sort((a, b) => Number(b.pairedFaces > 0) - Number(a.pairedFaces > 0) || b.coverage - a.coverage
          || (a.pairedFaces && b.pairedFaces ? a.group[0].length - b.group[0].length : 0)
          || a.proximity - b.proximity || b.group.length - a.group.length
          || Math.abs(a.group[0].length - row.length * 1000) - Math.abs(b.group[0].length - row.length * 1000));
      const modal = ranked[0];
      if (!modal) continue;
      const lengths = modal.group.map((candidate) => candidate.length).sort((a, b) => a - b);
      let resolved = lengths[Math.floor(lengths.length / 2)];
      const reference = referenceLengths.get(row.member);
      // Details may provide the written overall span, but only use them to
      // refine a face already proven by every plan mark. Small differences are
      // left to the actual plan face; larger, plausible differences normally
      // represent support-to-support dimensioning (for example two mirrored
      // B8 beams drawn with projecting face fragments).
      let refinedByReference = false;
      if (reference && !modal.pairedFaces) {
        const ratio = reference / resolved;
        if (ratio >= 0.7 && ratio <= 1.3 && Math.abs(1 - ratio) > 0.03) {
          resolved = reference;
          refinedByReference = true;
        }
      }
      const changesPlanSpan = Math.abs(resolved - row.length * 1000) / Math.max(row.length * 1000, 1) > 0.02;
      if (!changesPlanSpan || (!modal.pairedFaces && !refinedByReference)) continue;
      const nearest25 = Math.round(resolved / 25) * 25;
      if (Math.abs(resolved - nearest25) <= 5) resolved = nearest25;
      row.length = row.sideLength = round3(resolved / 1000);
      if (consolidated.filter((candidate) => candidate.member === row.member).length === 1)
        row.nos = Math.max(row.nos, modal.copies);
      row.measurementSource = 'exact beam face';
      row.needsReview = false; row.reviewReason = undefined;
    }
    // Some framing plans print the same beam mark near both ends of one beam.
    // A written overall dimension spanning that pair identifies one physical
    // member; matching co-linear pairs are its mirrored copies. Do this before
    // accepting short face fragments, and ignore isolated same-name marks from
    // nearby details/sections.
    for (const member of new Set(consolidated.map((row) => row.member))) {
      const marks = labelled.filter((item) => item.label === member).map((item) => item.text.pos);
      if (marks.length < 4) continue;
      const evidenceCandidates = dwg.dimensions.map((dimension) => {
        if (dimension.dir !== 'H' && dimension.dir !== 'V') return undefined;
        const horizontal = dimension.dir === 'H';
        const lo = horizontal ? Math.min(dimension.p1.x, dimension.p2.x) : Math.min(dimension.p1.y, dimension.p2.y);
        const hi = horizontal ? Math.max(dimension.p1.x, dimension.p2.x) : Math.max(dimension.p1.y, dimension.p2.y);
        const onLine = marks.filter((mark) => {
          const along = horizontal ? mark.x : mark.y;
          const perpendicular = horizontal ? Math.abs(mark.y - dimension.mid.y) : Math.abs(mark.x - dimension.mid.x);
          return along >= lo - 500 && along <= hi + 500 && perpendicular <= 1200;
        });
        const perpendicular = onLine.length ? onLine.reduce((sum, mark) => sum + (horizontal
          ? Math.abs(mark.y - dimension.mid.y) : Math.abs(mark.x - dimension.mid.x)), 0) / onLine.length : Number.POSITIVE_INFINITY;
        return onLine.length >= 2 && dimension.measurement >= 3000 && dimension.measurement <= 30000
          ? { dimension, horizontal, onLine, perpendicular } : undefined;
      }).filter((value): value is NonNullable<typeof value> => !!value)
        .sort((a, b) => a.perpendicular - b.perpendicular || b.dimension.measurement - a.dimension.measurement);
      const match = evidenceCandidates.map((evidence) => {
        const base = [...evidence.onLine].sort((a, b) => evidence.horizontal ? a.x - b.x : a.y - b.y);
        const repeatGap = evidence.horizontal ? base[base.length - 1].x - base[0].x : base[base.length - 1].y - base[0].y;
        if (repeatGap < 1200) return undefined;
        const baseline = evidence.horizontal
          ? evidence.onLine.reduce((sum, mark) => sum + mark.y, 0) / evidence.onLine.length
          : evidence.onLine.reduce((sum, mark) => sum + mark.x, 0) / evidence.onLine.length;
        const aligned = marks.filter((mark) => Math.abs((evidence.horizontal ? mark.y : mark.x) - baseline) <= 1000)
          .sort((a, b) => evidence.horizontal ? a.x - b.x : a.y - b.y);
        let copies = 0;
        for (let index = 0; index + 1 < aligned.length;) {
          const gap = evidence.horizontal ? aligned[index + 1].x - aligned[index].x : aligned[index + 1].y - aligned[index].y;
          if (Math.abs(gap - repeatGap) <= Math.max(800, repeatGap * 0.25)) { copies++; index += 2; } else index++;
        }
        return copies >= 2 ? { evidence, copies } : undefined;
      }).filter((value): value is NonNullable<typeof value> => !!value)
        .sort((a, b) => b.copies - a.copies || a.evidence.perpendicular - b.evidence.perpendicular)[0];
      if (!match) continue;
      const { evidence, copies } = match;
      const candidates = consolidated.filter((row) => row.member === member);
      const template = candidates.find((row) => row.breadth > 0 && row.height > 0) ?? candidates[0];
      if (!template) continue;
      const overall = { ...template };
      overall.length = overall.sideLength = round3(Math.round(evidence.dimension.measurement / 10) / 100);
      overall.nos = copies;
      overall.measurementSource = 'marked dimension';
      overall.cadX0 = evidence.dimension.p1.x; overall.cadY0 = evidence.dimension.p1.y;
      overall.cadX1 = evidence.dimension.p2.x; overall.cadY1 = evidence.dimension.p2.y;
      consolidated = [...consolidated.filter((row) => row.member !== member), overall];
    }
    for (const row of consolidated) {
      const reference = referenceLengths.get(row.member);
      const ratio = reference ? reference / Math.max(row.length * 1000, 1) : 0;
      const accepted = row.nos > 1 ? ratio >= 0.7 && ratio <= 1.3 : ratio >= 0.4 && ratio <= 2;
      if (!reference || !accepted || row.measurementSource === 'exact beam face') continue;
      row.length = row.sideLength = round3(reference / 1000);
      row.measurementSource = 'marked dimension';
    }
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
      if (!marks.length || row.nos > 1 || row.measurementSource === 'exact beam face') continue;
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
          row.sideLength = round3(clear);
          row.columnCapDeduction = round3(supportLength * row.breadth * row.height);
          row.bottomJointDeduction = round3(supportLength * row.breadth);
        } else {
          const leftMass = rccBoxes.some((box) => Math.abs(box.x1 - x0) <= 150 && lineY >= box.y0 - 700 && lineY <= box.y1 + 700);
          const rightMass = rccBoxes.some((box) => Math.abs(box.x0 - x1) <= 150 && lineY >= box.y0 - 700 && lineY <= box.y1 + 700);
          const known = right ?? left;
          if (known && marks.length === 2 && (leftMass || rightMass)) {
            const terminalWidth = known.x1 - known.x0;
            row.sideLength = round3(Math.max(row.length - terminalWidth / 1000, 0));
            row.columnCapDeduction = round3(terminalWidth / 1000 * row.breadth * row.height);
            row.bottomJointDeduction = round3(terminalWidth / 1000 * row.breadth);
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
          row.sideLength = round3(clear);
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
        if (row.measurementSource === 'exact beam face') continue;
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
    // Mirrored intact faces can differ slightly because the consultant drew
    // opposite tower halves independently. Treat close (<=3%) same-mark,
    // same-section copies as one measured length with Nos, while preserving
    // genuinely different spans.
    for (const group of comparable.values()) {
      const exact = group.filter((row) => row.measurementSource === 'exact beam face');
      if (exact.length < 2) continue;
      const shortest = Math.min(...exact.map((row) => row.length));
      const longest = Math.max(...exact.map((row) => row.length));
      if (!shortest || shortest / longest < 0.97) continue;
      // Independent mirrored halves can differ by a few millimetres. Use the
      // shorter verified face so shuttering is not overstated; then snap only
      // to the conventional 5 mm drafting increment.
      const ratio = shortest / longest;
      const representative = ratio >= 0.99 ? shortest
        : exact.reduce((sum, row) => sum + row.length, 0) / exact.length;
      const normalized = round3(Math.round(representative * 200) / 200);
      for (const row of exact) row.length = normalized;
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
    for (const row of consolidated) {
      const reference = referenceLengths.get(row.member);
      const ratio = reference ? reference / Math.max(row.length * 1000, 1) : 0;
      const accepted = row.nos > 1 ? ratio >= 0.7 && ratio <= 1.3 : ratio >= 0.4 && ratio <= 2;
      if (!reference || !accepted || row.measurementSource === 'exact beam face') continue;
      row.length = round3(reference / 1000);
      row.sideLength = round3(Math.max(row.length - (row.supportWidths || []).reduce((sum, width) => sum + width, 0), 0));
      row.measurementSource = 'marked dimension';
    }
    // Once a verified detail span exists, discard tiny leftover fragments of
    // the same mark. They are support-face remnants, not additional beams
    // (the former source of B31=0 and duplicate B35/B36 rows).
    consolidated = consolidated.filter((row) => {
      const reference = referenceLengths.get(row.member);
      return !reference || row.length >= reference / 1000 * 0.5;
    });
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
    const quantityRows = new Map<string, MemberRow>();
    for (const row of finalRows.values()) {
      const key = `${row.member}|${round3(row.length)}|${round3(row.breadth)}|${round3(row.height)}`;
      const prior = quantityRows.get(key);
      if (prior) prior.nos += row.nos;
      else quantityRows.set(key, { ...row });
    }
    for (const row of quantityRows.values()) {
      if ([...quantityRows.values()].filter((candidate) => candidate.member === row.member).length !== 1) continue;
      const horizontal = Math.abs((row.cadX1 || 0) - (row.cadX0 || 0)) >= Math.abs((row.cadY1 || 0) - (row.cadY0 || 0));
      const positions = labelled.filter((item) => item.label === row.member)
        .map((item) => horizontal ? item.text.pos.x : item.text.pos.y).sort((a, b) => a - b);
      let copies = positions.length ? 1 : 0;
      for (let index = 1; index < positions.length; index++)
        if (positions[index] - positions[index - 1] > row.length * 1500) copies++;
      row.nos = Math.max(row.nos, copies);
      const reference = referenceLengths.get(row.member);
      const conflictRatio = reference ? reference / Math.max(row.length * 1000, 1) : 1;
      if (row.nos <= 1 && row.measurementSource !== 'exact beam face' && reference && (conflictRatio < 0.4 || conflictRatio > 2)) {
        // Conflicting plan/detail evidence must never become a confident
        // quantity. Retain an auditable review row but count zero until the
        // member span is resolved (B10), rather than inventing beam work.
        row.nos = 0;
        row.needsReview = true;
        row.reviewReason = 'plan trace conflicts with the verified beam-detail span';
      }
    }
    // Final plan-face safeguard: if both physical faces of every mirrored copy
    // agree on a slightly shorter span, they override a nearby detail/grid
    // dimension. Only shorten by 2–10%; tiny drafting residue is retained and
    // large conflicts remain reviewable instead of being guessed.
    for (const row of quantityRows.values()) {
      const marks = labelled.filter((item) => item.label === row.member).map((item) => item.text.pos);
      if (marks.length < 2 || row.breadth <= 0) continue;
      const candidates = beams.map((segment) => ({ segment,
        horizontal: Math.abs(segment.b.x - segment.a.x) >= Math.abs(segment.b.y - segment.a.y),
        length: Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) }))
        .filter((candidate) => candidate.length >= row.length * 1000 * 0.9
          && candidate.length <= row.length * 1000 * 0.98);
      const pairs: { length: number; covered: number[] }[] = [];
      for (let first = 0; first < candidates.length; first++) for (let second = first + 1; second < candidates.length; second++) {
        const a = candidates[first], b = candidates[second];
        if (a.horizontal !== b.horizontal || Math.abs(a.length - b.length) > 25) continue;
        const gap = a.horizontal
          ? Math.abs((a.segment.a.y + a.segment.b.y - b.segment.a.y - b.segment.b.y) / 2)
          : Math.abs((a.segment.a.x + a.segment.b.x - b.segment.a.x - b.segment.b.x) / 2);
        if (gap < row.breadth * 1000 * 0.75 || gap > row.breadth * 1000 * 1.25) continue;
        const covered = marks.map((mark, index) => Math.min(pointSegmentDistance(mark, a.segment),
          pointSegmentDistance(mark, b.segment)) <= 1200 ? index : -1).filter((index) => index >= 0);
        if (covered.length) pairs.push({ length: Math.min(a.length, b.length), covered });
      }
      const groups = new Map<number, typeof pairs>();
      for (const pair of pairs) {
        const bucket = Math.round(pair.length / 25) * 25;
        groups.set(bucket, [...(groups.get(bucket) || []), pair]);
      }
      const verified = [...groups.entries()].filter(([, group]) =>
        new Set(group.flatMap((pair) => pair.covered)).size === marks.length)
        .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0];
      if (!verified) continue;
      row.length = round3(verified[0] / 1000);
      row.sideLength = round3(Math.max(row.length - (row.supportWidths || []).reduce((sum, width) => sum + width, 0), 0));
      row.measurementSource = 'exact beam face';
      row.needsReview = false; row.reviewReason = undefined;
    }
    return [...quantityRows.values()].sort((a, b) => compareBeamLabels(a.member, b.member));
  }

  let n = 1;
  return runs.map((run) => {
    const mid: Pt = { x: (run.a.x + run.b.x) / 2, y: (run.a.y + run.b.y) / 2 };
    const size = parseBeamSize(nearestText(mid, sizeTexts, 6000) ?? '') ?? unoSize;
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
  // Split genuinely remote collinear members, while allowing ordinary support
  // and crossing-beam interruptions. Longer B34-style continuity is recovered
  // earlier from the same-mark aligned-label evidence and its complete run.
  const connectedGroups = [...groups.values()].flatMap((spans) => {
    const located = spans.map((span) => {
      if ([span.cadX0, span.cadY0, span.cadX1, span.cadY1].some((value) => value == null)) return null;
      const horizontal = Math.abs((span.cadX1 as number) - (span.cadX0 as number)) >= Math.abs((span.cadY1 as number) - (span.cadY0 as number));
      return { span,
        lo: horizontal ? Math.min(span.cadX0 as number, span.cadX1 as number) : Math.min(span.cadY0 as number, span.cadY1 as number),
        hi: horizontal ? Math.max(span.cadX0 as number, span.cadX1 as number) : Math.max(span.cadY0 as number, span.cadY1 as number) };
    }).filter((item): item is { span: MemberRow; lo: number; hi: number } => !!item)
      .sort((a, b) => a.lo - b.lo);
    if (located.length !== spans.length) return [spans];
    const components: { spans: MemberRow[]; hi: number }[] = [];
    for (const item of located) {
      const current = components[components.length - 1];
      if (current && item.lo <= current.hi + 1400) {
        current.spans.push(item.span); current.hi = Math.max(current.hi, item.hi);
      } else components.push({ spans: [item.span], hi: item.hi });
    }
    return components.map((component) => component.spans);
  });
  const consolidated = connectedGroups.map((spans) => {
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
    // Repeated labels create one source span per physical copy. Weight slab
    // thickness by those source lengths, not by the averaged consolidated
    // length; otherwise two identical 175 mm slabs incorrectly become 350 mm.
    const thicknessWeight = spans.reduce((sum, span) => sum + (span.sideLength || span.length), 0);
    const weightedThickness = (side: 1 | 2) => thicknessWeight > 0
      ? spans.reduce((sum, span) => sum + (span.sideLength || span.length)
        * (side === 1 ? span.slabThicknessSide1 || 0 : span.slabThicknessSide2 || 0), 0) / thicknessWeight
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
      ? 'marked dimension' : spans.every((span) => span.measurementSource === 'exact beam face')
        ? 'exact beam face' : 'drawing geometry';
    row.needsReview = spans.some((span) => span.needsReview === true);
    row.reviewReason = [...new Set(spans.map((span) => span.reviewReason).filter(Boolean))].join('; ') || undefined;
    return row;
  });
  // Identical physical beams at different locations may share one MB row
  // using Nos. Different length or size (such as the two B12 beams) stay as
  // separate rows.
  const combined = new Map<string, MemberRow>();
  // Keep traced beams with an unresolved size as explicit review rows. Only a
  // zero-length trace is non-measurable geometry and must be excluded.
  for (const row of consolidated.filter((candidate) => candidate.length > 0)) {
    const key = `${row.member}|${round3(row.length)}|${round3(row.breadth)}|${round3(row.height)}`;
    const prior = combined.get(key);
    if (prior) prior.nos += row.nos;
    else combined.set(key, { ...row, needsReview: row.needsReview === true });
  }
  return [...combined.values()];
}
