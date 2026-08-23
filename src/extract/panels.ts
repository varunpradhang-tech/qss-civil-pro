// Auto-proposal: estimate every panel by ray-casting from each panel label to nearest bounding
// geometry, snap to exact marked dims, deduct cutout/void openings, and flag overlapping duplicates.
// Best-effort; low-confidence/duplicate proposals are flagged for review. Pure/headless.
import type { NormalizedDwg, Pt, Segment } from '../domain/types.js';

export interface PanelProposalBox {
  label?: string;
  box: { x0: number; y0: number; x1: number; y1: number }; // mm
  lengthMm: number;
  breadthMm: number;
  openingM2: number; // deducted cutout/void area inside the panel
  thicknessMm: number; // slab thickness from the nearest "NNN THK." text (0 = not found → use default)
  confident: boolean;
  duplicate: boolean; // overlaps a stronger panel → excluded from total, flagged for review
}

interface ThkText { pos: Pt; mm: number; }
function extractThicknesses(dwg: NormalizedDwg): ThkText[] {
  const out: ThkText[] = [];
  for (const t of dwg.texts) {
    if (!/slab thk|thk/i.test(t.layer) && !/thk/i.test(t.text)) continue;
    const m = t.text.match(/(\d{2,4})\s*(?:mm)?\s*thk/i);
    if (m) { const mm = +m[1]; if (mm >= 75 && mm <= 600) out.push({ pos: t.pos, mm }); }
  }
  return out;
}
const nearestThickness = (c: Pt, thks: ThkText[], maxDist = 4000): number => {
  let best = 0, bd = maxDist;
  for (const t of thks) { const d = Math.hypot(t.pos.x - c.x, t.pos.y - c.y); if (d < bd) { bd = d; best = t.mm; } }
  return best;
};
// Prefer the thickness text(s) INSIDE the panel box (most common); fall back to nearest to the centre.
function panelThickness(box: PanelProposalBox['box'], c: Pt, thks: ThkText[]): number {
  const counts = new Map<number, number>();
  for (const t of thks) if (t.pos.x >= box.x0 && t.pos.x <= box.x1 && t.pos.y >= box.y0 && t.pos.y <= box.y1) counts.set(t.mm, (counts.get(t.mm) || 0) + 1);
  let best = 0, bestN = 0;
  for (const [mm, n] of counts) if (n > bestN) { bestN = n; best = mm; }
  return best || nearestThickness(c, thks);
}

const BOUND_LAYERS = /beam|wall|col|pardi|rcc|cut/i;
const CUTOUT_LAYERS = /cut|open|void|shaft|lift|duct|ots/i;
const ALIGN_TOL = 200;

export function autoProposePanels(dwg: NormalizedDwg): PanelProposalBox[] {
  const segs: Segment[] = [...dwg.segments.filter((s) => BOUND_LAYERS.test(s.layer))];
  for (const pl of dwg.polylines.filter((p) => BOUND_LAYERS.test(p.layer)))
    for (let i = 0; i < pl.pts.length - 1; i++) segs.push({ a: pl.pts[i], b: pl.pts[i + 1], layer: pl.layer });
  for (const hatch of dwg.hatches.filter((h) => BOUND_LAYERS.test(h.layer)))
    for (let i = 0; i < hatch.pts.length; i++) segs.push({ a: hatch.pts[i], b: hatch.pts[(i + 1) % hatch.pts.length], layer: hatch.layer });

  const H = segs.filter((s) => Math.abs(s.a.y - s.b.y) < ALIGN_TOL)
    .map((s) => ({ y: (s.a.y + s.b.y) / 2, x1: Math.min(s.a.x, s.b.x), x2: Math.max(s.a.x, s.b.x) }));
  const V = segs.filter((s) => Math.abs(s.a.x - s.b.x) < ALIGN_TOL)
    .map((s) => ({ x: (s.a.x + s.b.x) / 2, y1: Math.min(s.a.y, s.b.y), y2: Math.max(s.a.y, s.b.y) }));

  const dims = dwg.dimensions.filter((d) => /slabs?\s*no/i.test(d.layer));
  const Hdims = dims.filter((d) => d.dir === 'H').map((d) => d.measurement);
  const Vdims = dims.filter((d) => d.dir === 'V').map((d) => d.measurement);
  const labels = dwg.texts
    .filter((t) => /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, '')))
    .map((t) => ({
      text: t.text.replace(/\s/g, '').toUpperCase(),
      pos: t.pos,
      // Named slab layers are authoritative. Generic/numeric layers are
      // common in consultant drawings, but require a fully bounded RCC bay
      // so schedule/detail S-marks are not mistaken for slab panels.
      trustedLayer: /slabs?\s*no/i.test(t.layer),
    }));
  const cutouts = extractCutouts(dwg);
  const thicknesses = extractThicknesses(dwg);
  const holdNotes = dwg.texts.filter((t) => /HOLD/i.test(t.text.replace(/\s+/g, '')));

  const snap = (val: number, opts: number[]) => {
    if (!opts.length) return { v: val, ok: true }; // unmarked drawing: geometry is the source
    let best = val, bd = Infinity;
    for (const o of opts) { const d = Math.abs(o - val); if (d < bd) { bd = d; best = o; } }
    return { v: best, ok: bd <= Math.max(400, val * 0.12) };
  };

  const out: PanelProposalBox[] = [];
  for (const L of labels) {
    const c: Pt = L.pos;
    const above = H.filter((h) => h.x1 - ALIGN_TOL <= c.x && c.x <= h.x2 + ALIGN_TOL && h.y > c.y).sort((a, b) => a.y - b.y)[0];
    const below = H.filter((h) => h.x1 - ALIGN_TOL <= c.x && c.x <= h.x2 + ALIGN_TOL && h.y < c.y).sort((a, b) => b.y - a.y)[0];
    const right = V.filter((v) => v.y1 - ALIGN_TOL <= c.y && c.y <= v.y2 + ALIGN_TOL && v.x > c.x).sort((a, b) => a.x - b.x)[0];
    const left = V.filter((v) => v.y1 - ALIGN_TOL <= c.y && c.y <= v.y2 + ALIGN_TOL && v.x < c.x).sort((a, b) => b.x - a.x)[0];

    if (!above || !below || !right || !left) {
      if (!L.trustedLayer) continue;
      const thicknessMm = nearestThickness(c, thicknesses);
      const nl = nearestDimValue(c, dims, 'H'), nb = nearestDimValue(c, dims, 'V');
      out.push({ label: L.text, box: { x0: c.x - 1000, y0: c.y - 1000, x1: c.x + 1000, y1: c.y + 1000 }, lengthMm: nl, breadthMm: nb, openingM2: 0, thicknessMm, confident: false, duplicate: false });
      continue;
    }
    const sL = snap(right.x - left.x, Hdims), sB = snap(above.y - below.y, Vdims);
    const box = { x0: left.x, y0: below.y, x1: right.x, y1: above.y };
    out.push({ label: L.text, box, lengthMm: sL.v, breadthMm: sB.v, openingM2: 0, thicknessMm: panelThickness(box, c, thicknesses), confident: sL.ok && sB.ok, duplicate: false });
  }

  // HOLD / HOLD AREA is an explicit instruction that the containing bay is
  // outside the current measurable scope. Exclude it before deductions,
  // numbering, Excel export, totals, and reference-file marking.
  const measurable = out.filter((panel) => !holdNotes.some((note) =>
    note.pos.x >= panel.box.x0 && note.pos.x <= panel.box.x1
    && note.pos.y >= panel.box.y0 && note.pos.y <= panel.box.y1));
  assignCutouts(measurable, cutouts); // contain-or-nearest panel, per QSS-SLAB-004
  markDuplicates(measurable);
  return measurable;
}

// Distribute each cutout across the panels its box overlaps (by overlap area), so a void straddling a
// beam between two bays is shared, not dumped on one small neighbour. Falls back to the nearest panel.
function assignCutouts(panels: PanelProposalBox[], cutouts: Cutout[]): void {
  const capOf = (p: PanelProposalBox) => (p.lengthMm / 1000) * (p.breadthMm / 1000);
  for (const c of cutouts) {
    const overlaps = panels
      .map((p) => ({ p, ov: rectOverlap(c.box, p.box) }))
      .filter((o) => o.ov > 0);
    const totalOv = overlaps.reduce((s, o) => s + o.ov, 0);
    if (totalOv > 0) {
      for (const { p, ov } of overlaps) {
        const share = c.areaM2 * (ov / totalOv);
        p.openingM2 = Math.min(p.openingM2 + share, capOf(p));
      }
    } else {
      // no overlap → nearest panel by centre
      let target: PanelProposalBox | undefined; let bd = Infinity;
      for (const p of panels) {
        const d = Math.hypot((p.box.x0 + p.box.x1) / 2 - c.cx, (p.box.y0 + p.box.y1) / 2 - c.cy);
        if (d < bd) { bd = d; target = p; }
      }
      if (target) target.openingM2 = Math.min(target.openingM2 + c.areaM2, capOf(target));
    }
  }
}
function rectOverlap(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const ox = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const oy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return (ox * oy) / 1e6;
}

// --- overlap gate: if two panels overlap materially, keep the smaller (true bay), flag the larger ---
function markDuplicates(panels: PanelProposalBox[]): void {
  const idx = panels.map((_, i) => i).sort((a, b) => boxArea(panels[a].box) - boxArea(panels[b].box));
  const kept: PanelProposalBox[] = [];
  for (const i of idx) {
    const p = panels[i];
    if (kept.some((k) => overlapFrac(p.box, k.box) > 0.6)) { p.duplicate = true; p.confident = false; }
    else kept.push(p);
  }
}
const boxArea = (b: PanelProposalBox['box']) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function overlapFrac(a: PanelProposalBox['box'], b: PanelProposalBox['box']): number {
  const ox = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const oy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ox * oy; const small = Math.min(boxArea(a), boxArea(b));
  return small > 0 ? inter / small : 0;
}

// --- cutouts: cutout-layer polylines + X-crossed diagonal pairs ---
interface Cutout { cx: number; cy: number; areaM2: number; box: { x0: number; y0: number; x1: number; y1: number }; }
function extractCutouts(dwg: NormalizedDwg): Cutout[] {
  const out: Cutout[] = [];
  for (const pl of dwg.polylines.filter((p) => CUTOUT_LAYERS.test(p.layer))) {
    const a = Math.abs(shoelace(pl.pts)) / 1e6;
    if (a > 0.05 && a < 100) out.push({ ...centroid(pl.pts), areaM2: a, box: bbox(pl.pts) });
  }
  // X-void diagonal pairs
  const diags = dwg.segments.filter((s) => {
    const dx = Math.abs(s.a.x - s.b.x), dy = Math.abs(s.a.y - s.b.y);
    const len = Math.hypot(dx, dy);
    return dx > 300 && dy > 300 && len > 800 && len < 20000;
  });
  for (let i = 0; i < diags.length; i++) for (let j = i + 1; j < diags.length; j++) {
    const s1 = diags[i], s2 = diags[j];
    const sl1 = (s1.b.y - s1.a.y) / (s1.b.x - s1.a.x), sl2 = (s2.b.y - s2.a.y) / (s2.b.x - s2.a.x);
    if (sl1 * sl2 >= 0) continue; // need opposite slopes to form an X
    const pts = [s1.a, s1.b, s2.a, s2.b];
    const b = bbox(pts);
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (w < 400 || h < 400 || w > 15000 || h > 15000) continue;
    // centres must be close (the diagonals cross)
    const c1 = mid(s1.a, s1.b), c2 = mid(s2.a, s2.b);
    if (Math.hypot(c1.x - c2.x, c1.y - c2.y) > Math.max(w, h) * 0.5) continue;
    const areaM2 = (w * h) / 1e6;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    if (!out.some((o) => Math.hypot(o.cx - cx, o.cy - cy) < 1500)) out.push({ cx, cy, areaM2, box: b });
  }
  return out;
}
function nearestDimValue(c: Pt, dims: NormalizedDwg['dimensions'], dir: 'H' | 'V'): number {
  let best = 0, bd = Infinity;
  for (const d of dims) { if (d.dir !== dir) continue; const dist = Math.hypot(d.mid.x - c.x, d.mid.y - c.y); if (dist < bd) { bd = dist; best = d.measurement; } }
  return best;
}
const shoelace = (pts: Pt[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
const centroid = (pts: Pt[]) => { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return { cx: x / pts.length, cy: y / pts.length }; };
const bbox = (pts: Pt[]) => ({ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) });
const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
