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

export function extractMembers(dwg: NormalizedDwg, workGroup: string, floor = 'Basement'): MemberRow[] {
  seq = 1;
  if (workGroup === 'slab') return slabMembers(dwg, floor);
  if (workGroup === 'beam') return beamMembers(dwg, floor);
  return []; // column/raft/wall/floor: start empty, user adds (auto-extraction not reliable on this data)
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
function beamMembers(dwg: NormalizedDwg, floor: string): MemberRow[] {
  const beams: Segment[] = dwg.segments.filter((s) => /^beam$/i.test(s.layer.trim()));
  const sizeTexts = dwg.texts.filter((t) => /beam size/i.test(t.layer));
  const noTexts = dwg.texts.filter((t) => /beam no/i.test(t.layer));
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

  let n = 1;
  return runs.map((run) => {
    const mid: Pt = { x: (run.a.x + run.b.x) / 2, y: (run.a.y + run.b.y) / 2 };
    const size = parseBeamSize(nearestText(mid, sizeTexts, 6000) ?? '');
    const label = nearestText(mid, noTexts, 4000);
    const r = emptyRow(nextId(), floor);
    r.member = label ?? `QB${n++}`;
    r.length = round3(Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y) / 1000);
    r.sideLength = r.length;
    r.breadth = round3((size?.widthMm ?? 300) / 1000);
    r.height = round3((size?.depthMm ?? 600) / 1000);
    r.slabThickness = 0.175;
    r.nos = 1;
    r.needsReview = !size;
    r.reviewReason = size ? undefined : 'no beam size found — set width×depth';
    return r;
  });
}
