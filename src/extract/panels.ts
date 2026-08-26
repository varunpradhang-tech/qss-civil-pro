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
  polygon?: Pt[]; // exact outline for non-rectangular cantilever/chajja panels
  netAreaM2?: number; // exact polygon area before opening deductions
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
  const allSegs: Segment[] = [...dwg.segments];
  for (const pl of dwg.polylines)
    for (let i = 0; i < pl.pts.length - 1; i++) allSegs.push({ a: pl.pts[i], b: pl.pts[i + 1], layer: pl.layer, lineType: pl.lineType });
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
  const sectionNotes = dwg.texts.filter((t) => /\b(?:SECTION|SEC\.)\s*[:\-–]*\s*\d+\s*[-–]\s*\d+/i.test(t.text));
  const scheduleNotes = dwg.texts.filter((t) => /\b(?:SLAB\s+)?(?:REINFORCEMENT\s+)?SCHEDULE\b/i.test(t.text));
  const excludedDetailPoint = (p: Pt) => sectionNotes.some((note) => Math.abs(note.pos.x - p.x) <= 30_000 && p.y >= note.pos.y - 2500 && p.y <= note.pos.y + 15_000)
    || scheduleNotes.some((note) => Math.abs(note.pos.x - p.x) <= 60_000 && p.y >= note.pos.y - 25_000 && p.y <= note.pos.y + 3000);
  const labels = dwg.texts
    .filter((t) => /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, '')))
    .filter((t) => !excludedDetailPoint(t.pos))
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
    const aboveOptions = H.filter((h) => h.x1 - ALIGN_TOL <= c.x && c.x <= h.x2 + ALIGN_TOL && h.y > c.y).sort((a, b) => a.y - b.y);
    const belowOptions = H.filter((h) => h.x1 - ALIGN_TOL <= c.x && c.x <= h.x2 + ALIGN_TOL && h.y < c.y).sort((a, b) => b.y - a.y);
    const rightOptions = V.filter((v) => v.y1 - ALIGN_TOL <= c.y && c.y <= v.y2 + ALIGN_TOL && v.x > c.x).sort((a, b) => a.x - b.x);
    const leftOptions = V.filter((v) => v.y1 - ALIGN_TOL <= c.y && c.y <= v.y2 + ALIGN_TOL && v.x < c.x).sort((a, b) => b.x - a.x);
    let above = aboveOptions[0], below = belowOptions[0], right = rightOptions[0], left = leftOptions[0];
    let expandedFromBeamFace = false;
    // If an S mark sits on a beam, the nearest two lines are merely that
    // beam's faces. Step outward to the first plausible slab bay instead of
    // rejecting the resulting 200–450 mm band as non-slab geometry.
    if (above && below && above.y - below.y < 600) {
      const pair = belowOptions.slice(0, 4).flatMap((b) => aboveOptions.slice(0, 4).map((a) => ({ a, b, span: a.y - b.y })))
        .filter((p) => p.span >= 600 && p.span <= 30_000).sort((a, b) => a.span - b.span)[0];
      if (pair) { above = pair.a; below = pair.b; expandedFromBeamFace = true; }
    }
    if (right && left && right.x - left.x < 600) {
      const pair = leftOptions.slice(0, 4).flatMap((l) => rightOptions.slice(0, 4).map((r) => ({ r, l, span: r.x - l.x })))
        .filter((p) => p.span >= 600 && p.span <= 30_000).sort((a, b) => a.span - b.span)[0];
      if (pair) { right = pair.r; left = pair.l; expandedFromBeamFace = true; }
    }

    if (!above || !below || !right || !left) {
      const thicknessMm = nearestThickness(c, thicknesses);
      const nl = nearestDimValue(c, dims, 'H'), nb = nearestDimValue(c, dims, 'V');
      // Consultant drawings often use a continuous free edge for a balcony or
      // corridor strip, so one RCC ray can legitimately be absent. Recover an
      // exact S-mark only when geometry exists in both axes and marked CAD
      // dimensions provide the missing span. Schedule/section marks were
      // already removed by excludedDetailPoint above.
      const structuralSides = Number(!!above) + Number(!!below) + Number(!!right) + Number(!!left);
      const partialBay = structuralSides >= 2 && !!(above || below) && !!(left || right)
        && nl >= 300 && nl <= 30_000 && nb >= 300 && nb <= 30_000;
      if (!L.trustedLayer && !partialBay) continue;
      const x0 = left?.x ?? (right ? right.x - nl : c.x - nl / 2);
      const x1 = right?.x ?? (left ? left.x + nl : c.x + nl / 2);
      const y0 = below?.y ?? (above ? above.y - nb : c.y - nb / 2);
      const y1 = above?.y ?? (below ? below.y + nb : c.y + nb / 2);
      const box = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
      out.push({ label: L.text, box, lengthMm: nl, breadthMm: nb, openingM2: 0, thicknessMm: panelThickness(box, c, thicknesses), confident: false, duplicate: false });
      continue;
    }
    const sL = snap(right.x - left.x, Hdims), sB = snap(above.y - below.y, Vdims);
    const box = { x0: left.x, y0: below.y, x1: right.x, y1: above.y };
    out.push({ label: L.text, box, lengthMm: sL.v, breadthMm: sB.v, openingM2: 0, thicknessMm: panelThickness(box, c, thicknesses), confident: sL.ok && sB.ok && !expandedFromBeamFace, duplicate: false });
  }
  // Cantilevers are an additive detector only. They never alter the stable
  // S-label ray-casting above: dashed inner face + continuous outer face +
  // continuous closures at both ends.
  const labelledPanels = [...out];
  // Use the actual S-mark positions for the plan envelope. A low-confidence
  // inferred box can extend several metres past its label and would otherwise
  // hide a genuine exterior chajja near that edge.
  const labelledCentres = labels.map((label) => label.pos);
  const labelEnvelope = labelledCentres.length ? {
    minX: Math.min(...labelledCentres.map((p) => p.x)), maxX: Math.max(...labelledCentres.map((p) => p.x)),
    minY: Math.min(...labelledCentres.map((p) => p.y)), maxY: Math.max(...labelledCentres.map((p) => p.y)),
  } : null;
  out.push(...detectClosedCantileverStrips(allSegs, thicknesses).filter((panel) => {
    const centre = { x: (panel.box.x0 + panel.box.x1) / 2, y: (panel.box.y0 + panel.box.y1) / 2 };
    const unresolvedSlabMark = labels.find((label) => label.pos.x >= panel.box.x0 - ALIGN_TOL
      && label.pos.x <= panel.box.x1 + ALIGN_TOL && label.pos.y >= panel.box.y0 - ALIGN_TOL
      && label.pos.y <= panel.box.y1 + ALIGN_TOL
      && !labelledPanels.some((measured) => label.pos.x >= measured.box.x0 - ALIGN_TOL
        && label.pos.x <= measured.box.x1 + ALIGN_TOL && label.pos.y >= measured.box.y0 - ALIGN_TOL
        && label.pos.y <= measured.box.y1 + ALIGN_TOL));
    if (unresolvedSlabMark) panel.label = unresolvedSlabMark.text;
    if (excludedDetailPoint(centre)) return false;
    // With no explicit cantilever text, accept geometry-only additions only
    // around the exterior of the labelled framing-plan envelope. This keeps
    // internal beam/grid cells out of the cantilever list.
    if (labelEnvelope && centre.x >= labelEnvelope.minX && centre.x <= labelEnvelope.maxX
      && centre.y >= labelEnvelope.minY && centre.y <= labelEnvelope.maxY) {
      // Sloping corner chajjas can sit just inside the rectangular envelope of
      // all slab labels. Only allow an exact polygonal candidate in this case,
      // and only within 3 m of an exterior envelope edge.
      const edgeDistance = Math.min(centre.x - labelEnvelope.minX, labelEnvelope.maxX - centre.x,
        centre.y - labelEnvelope.minY, labelEnvelope.maxY - centre.y);
      if ((!panel.polygon || edgeDistance > 3000) && !unresolvedSlabMark) return false;
    }
    if (labelEnvelope) {
      const dx = Math.max(labelEnvelope.minX - centre.x, 0, centre.x - labelEnvelope.maxX);
      const dy = Math.max(labelEnvelope.minY - centre.y, 0, centre.y - labelEnvelope.maxY);
      if (Math.hypot(dx, dy) > 6000) return false;
    }
    // Geometry-only additions must never compete with or replace an S-coded
    // panel. Any material overlap belongs to the authoritative labelled bay.
    if (panel.polygon) {
      // The polygon is the narrow band between the hidden beam face and the
      // solid free edge. Its centre lies on the support boundary and may fall
      // inside an adjacent panel's rectangular proxy, so rectangle overlap is
      // not a valid rejection test here. The structural-line and exterior-edge
      // gates above are the authoritative checks.
      return true;
    }
    if (unresolvedSlabMark) return true;
    return !labelledPanels.some((labelled) => overlapFrac(panel.box, labelled.box) > 0.1);
  }));

  // An L-shaped chajja is commonly drawn as two perpendicular strips. Keep
  // both legs, but deduct their shared corner once so the net area is a union,
  // not the sum of two overlapping rectangles.
  const cantilevers = out.filter((panel) => panel.label === 'CANTILEVER');
  for (let i = 0; i < cantilevers.length; i++) {
    const gross = cantilevers[i].netAreaM2 ?? boxArea(cantilevers[i].box) / 1e6;
    let repeated = 0;
    for (let j = 0; j < i; j++) repeated += rectOverlap(cantilevers[i].box, cantilevers[j].box);
    cantilevers[i].netAreaM2 = Math.max(0, gross - repeated);
  }

  // HOLD / HOLD AREA is an explicit instruction that the containing bay is
  // outside the current measurable scope. Exclude it before deductions,
  // numbering, Excel export, totals, and reference-file marking.
  const measurable = out.filter((panel) => {
    const grossM2 = (panel.lengthMm / 1000) * (panel.breadthMm / 1000);
    const plausibleBay = panel.lengthMm >= 300 && panel.breadthMm >= 300
      && panel.lengthMm <= 30_000 && panel.breadthMm <= 30_000
      && grossM2 <= 400;
    const held = holdNotes.some((note) => note.pos.x >= panel.box.x0 && note.pos.x <= panel.box.x1
      && note.pos.y >= panel.box.y0 && note.pos.y <= panel.box.y1);
    return plausibleBay && !held;
  });
  assignCutouts(measurable, cutouts); // contain-or-nearest panel, per QSS-SLAB-004
  markDuplicates(measurable);
  // A duplicate proposal represents the same physical bay and must never be
  // billed as an additional slab panel.
  return measurable.filter((panel) => !panel.duplicate);
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
    // A sloping polygon's bounding rectangle contains large triangular areas
    // that are not part of the slab. Do not compare that loose box with an
    // ordinary rectangular S-panel when deciding duplicates.
    const duplicate = p.polygon
      ? kept.some((k) => k.polygon && overlapFrac(p.box, k.box) > 0.8)
      : kept.some((k) => !k.polygon && overlapFrac(p.box, k.box) > 0.6);
    if (duplicate) { p.duplicate = true; p.confident = false; }
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

export function detectClosedCantileverStrips(segments: Segment[], thks: ThkText[] = []): PanelProposalBox[] {
  const dashed = segments.filter((s) => /dash|hidden|center/i.test(s.lineType || ''));
  const continuous = segments.filter((s) => !/dash|hidden|center/i.test(s.lineType || ''));
  const out: PanelProposalBox[] = [];
  const closes = (coord: number, lo: number, hi: number, horizontal: boolean) => continuous.some((s) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    if (horizontal ? Math.abs(dy) < Math.abs(dx) * 4 : Math.abs(dx) < Math.abs(dy) * 4) return false;
    const fixed = horizontal ? (s.a.x + s.b.x) / 2 : (s.a.y + s.b.y) / 2;
    const a = horizontal ? Math.min(s.a.y, s.b.y) : Math.min(s.a.x, s.b.x);
    const b = horizontal ? Math.max(s.a.y, s.b.y) : Math.max(s.a.x, s.b.x);
    return Math.abs(fixed - coord) <= ALIGN_TOL && a <= lo + ALIGN_TOL && b >= hi - ALIGN_TOL;
  });
  for (const dash of dashed) for (const solid of continuous) {
    if (!/beam|slab|chajja|edge/i.test(dash.layer) || !/beam|slab|chajja|edge/i.test(solid.layer)) continue;
    const ddx = dash.b.x - dash.a.x, ddy = dash.b.y - dash.a.y, sdx = solid.b.x - solid.a.x, sdy = solid.b.y - solid.a.y;
    const horizontal = Math.abs(ddx) >= Math.abs(ddy) * 4 && Math.abs(sdx) >= Math.abs(sdy) * 4;
    const vertical = Math.abs(ddy) >= Math.abs(ddx) * 4 && Math.abs(sdy) >= Math.abs(sdx) * 4;
    if (!horizontal && !vertical) continue;
    const dc = horizontal ? (dash.a.y + dash.b.y) / 2 : (dash.a.x + dash.b.x) / 2;
    const sc = horizontal ? (solid.a.y + solid.b.y) / 2 : (solid.a.x + solid.b.x) / 2;
    const width = Math.abs(dc - sc);
    if (width < 300 || width > 5000) continue;
    const lo = Math.max(horizontal ? Math.min(dash.a.x, dash.b.x) : Math.min(dash.a.y, dash.b.y), horizontal ? Math.min(solid.a.x, solid.b.x) : Math.min(solid.a.y, solid.b.y));
    const hi = Math.min(horizontal ? Math.max(dash.a.x, dash.b.x) : Math.max(dash.a.y, dash.b.y), horizontal ? Math.max(solid.a.x, solid.b.x) : Math.max(solid.a.y, solid.b.y));
    if (hi - lo < 600 || hi - lo > 15_000 || !closes(lo, Math.min(dc, sc), Math.max(dc, sc), horizontal) || !closes(hi, Math.min(dc, sc), Math.max(dc, sc), horizontal)) continue;
    const box = horizontal ? { x0: lo, y0: Math.min(dc, sc), x1: hi, y1: Math.max(dc, sc) } : { x0: Math.min(dc, sc), y0: lo, x1: Math.max(dc, sc), y1: hi };
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    if (out.some((p) => Math.hypot((p.box.x0 + p.box.x1) / 2 - c.x, (p.box.y0 + p.box.y1) / 2 - c.y) < 500)) continue;
    out.push({ label: 'CANTILEVER', box, lengthMm: box.x1 - box.x0, breadthMm: box.y1 - box.y0, openingM2: 0, thicknessMm: panelThickness(box, c, thks), confident: false, duplicate: false });
  }

  // Diagonal/sloping chajja edges occur at the two external L-shaped corners
  // of many framing plans. Pair a dashed slab-side line with a parallel solid
  // free edge and retain the exact quadrilateral instead of inflating it to
  // its rectangular bounding box.
  for (const dash of dashed) for (const solid of continuous) {
    if (!/beam|slab|chajja|edge/i.test(dash.layer) || !/beam|slab|chajja|edge/i.test(solid.layer)) continue;
    const dv = { x: dash.b.x - dash.a.x, y: dash.b.y - dash.a.y };
    const sv = { x: solid.b.x - solid.a.x, y: solid.b.y - solid.a.y };
    const dl = Math.hypot(dv.x, dv.y), sl = Math.hypot(sv.x, sv.y);
    if (dl < 800 || sl < 800 || dl > 20_000 || sl > 20_000) continue;
    // Axis-aligned strips were handled above.
    if (Math.abs(dv.x) < dl * 0.2 || Math.abs(dv.y) < dl * 0.2) continue;
    const u = { x: dv.x / dl, y: dv.y / dl };
    const su = { x: sv.x / sl, y: sv.y / sl };
    if (Math.abs(u.x * su.x + u.y * su.y) < 0.985) continue;
    const normal = { x: -u.y, y: u.x };
    const distance = Math.abs((solid.a.x - dash.a.x) * normal.x + (solid.a.y - dash.a.y) * normal.y);
    if (distance < 300 || distance > 5000) continue;
    const projection = (p: Pt) => (p.x - dash.a.x) * u.x + (p.y - dash.a.y) * u.y;
    const d0 = 0, d1 = dl;
    const sp0 = projection(solid.a), sp1 = projection(solid.b);
    const lo = Math.max(Math.min(d0, d1), Math.min(sp0, sp1));
    const hi = Math.min(Math.max(d0, d1), Math.max(sp0, sp1));
    if (hi - lo < 600 || hi - lo > 15_000) continue;
    const onDash = (t: number): Pt => ({ x: dash.a.x + u.x * t, y: dash.a.y + u.y * t });
    const onSolid = (t: number): Pt => {
      const base = projection(solid.a);
      return { x: solid.a.x + u.x * (t - base), y: solid.a.y + u.y * (t - base) };
    };
    const polygon = [onDash(lo), onDash(hi), onSolid(hi), onSolid(lo)];
    const areaM2 = Math.abs(shoelace(polygon)) / 1e6;
    if (areaM2 < 0.2 || areaM2 > 100) continue;
    const box = bbox(polygon);
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    if (out.some((p) => p.polygon && Math.hypot((p.box.x0 + p.box.x1 - box.x0 - box.x1) / 2,
      (p.box.y0 + p.box.y1 - box.y0 - box.y1) / 2) < 500)) continue;
    out.push({ label: 'CANTILEVER', box, polygon, netAreaM2: areaM2,
      lengthMm: hi - lo, breadthMm: distance, openingM2: 0,
      thicknessMm: panelThickness(box, c, thks), confident: false, duplicate: false });
  }
  return out;
}
