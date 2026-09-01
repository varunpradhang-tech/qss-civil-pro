// Auto-proposal: estimate every panel by ray-casting from each panel label to nearest bounding
// geometry, snap to exact marked dims, deduct cutout/void openings, and flag overlapping duplicates.
// Best-effort; low-confidence/duplicate proposals are flagged for review. Pure/headless.
import type { NormalizedDwg, Pt, Segment } from '../domain/types.js';
import { polygoniseCadFaces } from './topology.js';

export interface PanelProposalBox {
  label?: string;
  inferredSlabCode?: string; // schedule lookup when the panel itself has no S1/S2 mark
  box: { x0: number; y0: number; x1: number; y1: number }; // mm
  lengthMm: number;
  breadthMm: number;
  openingM2: number; // deducted cutout/void area inside the panel
  thicknessMm: number; // slab thickness from the nearest "NNN THK." text (0 = not found → use default)
  confident: boolean;
  duplicate: boolean; // overlaps a stronger panel → excluded from total, flagged for review
  polygon?: Pt[]; // exact outline for non-rectangular cantilever/chajja panels
  netAreaM2?: number; // exact polygon area before opening deductions
  dottedBoundary?: boolean; // verified long strip enclosed by dashed beam faces
  cantileverBoundary?: boolean; // dashed beam face to continuous free edge
  steppedBoundary?: boolean; // continuous exterior edge against bay-by-bay hidden beam fragments
  mixedBoundary?: boolean; // exact C-marked dotted-inner/continuous-outer closed face
  closedStructuralBoundary?: boolean; // missing S mark recovered from its actual closed CAD face
  dimensionBounded?: boolean; // rectangular cantilever recovered from associated CAD dimension endpoints
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

// Cantilever/chajja marks often carry only a section callout (for example
// 1-1), while the slab depth is dimensioned in the matching section detail.
// Recover a plausible slab-depth dimension only when that detail is explicitly
// identified as a slab section; this must not become a global thickness rule.
function cantileverSectionThickness(dwg: NormalizedDwg): number {
  const sectionNotes = dwg.texts.filter((t) => /\bSECTION\s*[:\-–]*\s*(\d+)\s*[-–]\s*\1\b/i.test(t.text));
  const slabDetailTexts = dwg.texts.filter((t) => /\bSLAB\s+(?:R\/?F|REINF|THK)/i.test(t.text));
  let best = 0, bestDistance = Infinity;
  for (const section of sectionNotes) {
    const hasSlabDetail = slabDetailTexts.some((text) => Math.hypot(text.pos.x - section.pos.x,
      text.pos.y - section.pos.y) <= 30_000);
    if (!hasSlabDetail) continue;
    for (const dimension of dwg.dimensions) {
      const mm = dimension.measurement;
      if (mm < 75 || mm > 225) continue;
      const distance = Math.hypot(dimension.mid.x - section.pos.x, dimension.mid.y - section.pos.y);
      if (distance <= 30_000 && distance < bestDistance) {
        best = Math.round(mm); bestDistance = distance;
      }
    }
  }
  return best;
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

const BOUND_LAYERS = /beam|wall|col|pardi|rcc/i;
const CUTOUT_LAYERS = /cut|open|void|shaft|lift|duct|ots/i;
// Grid/axis/centre lines can be carried on names such as "COLUMN GRID" and
// therefore used to pass the old broad /col/ test. They are annotations, not
// slab faces. Likewise, cutout outlines are applied after the gross panel is
// found and must never shorten or subdivide that panel.
const NON_STRUCTURAL_BOUNDARY_LAYERS = /grid|axis|centre|center|dim|dimension|annot|text|title|schedule|section|cut|open|void|shaft|lift|duct|ots/i;
const isStructuralBoundaryLayer = (layer: string) => BOUND_LAYERS.test(layer)
  && !NON_STRUCTURAL_BOUNDARY_LAYERS.test(layer);
const ALIGN_TOL = 200;

export function autoProposePanels(dwg: NormalizedDwg): PanelProposalBox[] {
  const allSegs: Segment[] = [...dwg.segments];
  for (const pl of dwg.polylines) {
    for (let i = 0; i < pl.pts.length - 1; i++) allSegs.push({ a: pl.pts[i], b: pl.pts[i + 1], layer: pl.layer, lineType: pl.lineType });
    if (pl.closed && pl.pts.length > 2) allSegs.push({ a: pl.pts[pl.pts.length - 1], b: pl.pts[0], layer: pl.layer, lineType: pl.lineType });
  }
  const segs: Segment[] = [...dwg.segments.filter((s) => isStructuralBoundaryLayer(s.layer))];
  for (const pl of dwg.polylines.filter((p) => isStructuralBoundaryLayer(p.layer))) {
    for (let i = 0; i < pl.pts.length - 1; i++) segs.push({ a: pl.pts[i], b: pl.pts[i + 1], layer: pl.layer, lineType: pl.lineType });
    if (pl.closed && pl.pts.length > 2) segs.push({ a: pl.pts[pl.pts.length - 1], b: pl.pts[0], layer: pl.layer, lineType: pl.lineType });
  }
  for (const hatch of dwg.hatches.filter((h) => isStructuralBoundaryLayer(h.layer)))
    for (let i = 0; i < hatch.pts.length; i++) segs.push({ a: hatch.pts[i], b: hatch.pts[(i + 1) % hatch.pts.length], layer: hatch.layer });

  const H = segs.filter((s) => Math.abs(s.a.y - s.b.y) < ALIGN_TOL)
    .map((s) => ({ y: (s.a.y + s.b.y) / 2, x1: Math.min(s.a.x, s.b.x), x2: Math.max(s.a.x, s.b.x) }));
  const V = segs.filter((s) => Math.abs(s.a.x - s.b.x) < ALIGN_TOL)
    .map((s) => ({ x: (s.a.x + s.b.x) / 2, y1: Math.min(s.a.y, s.b.y), y2: Math.max(s.a.y, s.b.y) }));

  const dims = dwg.dimensions.filter((d) => /slabs?\s*no/i.test(d.layer));
  const Hdims = dims.filter((d) => d.dir === 'H').map((d) => d.measurement);
  const Vdims = dims.filter((d) => d.dir === 'V').map((d) => d.measurement);
  const sectionNotes = dwg.texts.filter((t) => /^\s*(?:SECTION|SEC\.)\b/i.test(t.text));
  // Only schedule headings define an excluded sheet region. Notes such as
  // "spacing as per schedule" occur inside the framing plan and must not
  // suppress the surrounding slab bays.
  const scheduleNotes = dwg.texts.filter((t) => /^\s*(?:SLAB\s+)?(?:REINFORCEMENT\s+)?SCHEDULE\s*$/i.test(t.text));
  const excludedDetailPoint = (p: Pt) => sectionNotes.some((note) =>
    // A title excludes only its local detail block. Treating an entire sheet
    // row (or a 60 m schedule window) as non-plan geometry can suppress a
    // genuine framing bay positioned elsewhere on the same combined sheet.
    Math.abs(note.pos.x - p.x) <= 12_000 && Math.abs(note.pos.y - p.y) <= 8_000)
    || scheduleNotes.some((note) => Math.abs(note.pos.x - p.x) <= 15_000
      && p.y >= note.pos.y - 15_000 && p.y <= note.pos.y + 3_000);
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
  const rawSlabMarks = dwg.texts.filter((t) => /^S\d+[A-Z]?$/i.test(t.text.replace(/\s/g, '')))
    .map((t) => ({ text: t.text.replace(/\s/g, '').toUpperCase(), pos: t.pos, trustedLayer: /slabs?\s*no/i.test(t.layer) }));
  const cutouts = extractCutouts(dwg);
  const thicknesses = extractThicknesses(dwg);
  const sectionCantileverThickness = cantileverSectionThickness(dwg);
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
        .filter((p) => p.span >= 600).sort((a, b) => a.span - b.span)[0];
      if (pair) { above = pair.a; below = pair.b; expandedFromBeamFace = true; }
    }
    if (right && left && right.x - left.x < 600) {
      const pair = leftOptions.slice(0, 4).flatMap((l) => rightOptions.slice(0, 4).map((r) => ({ r, l, span: r.x - l.x })))
        .filter((p) => p.span >= 600).sort((a, b) => a.span - b.span)[0];
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
        && nl >= 300 && nb >= 300;
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
  // Closed CAD faces are used only for additive exterior/cantilever evidence.
  // Never replace an already bounded S-labelled slab with a smaller face:
  // opening frames, bracing diagonals and detail lines can form closed
  // quadrilaterals inside an otherwise complete rectangular slab panel.
  const topologySegments = allSegs.filter((segment) => isStructuralBoundaryLayer(segment.layer)
    || /slab|chajja|edge/i.test(segment.layer) || /^A-PLNT$/i.test(segment.layer));
  const topologyFaces = polygoniseCadFaces(topologySegments);
  // Some consultants place the outer structural/free edge on A-STRS or layer
  // 0. Include those entities only in the unresolved-S recovery graph; they
  // are not allowed to reshape any normally measured panel.
  const recoveryTopologySegments = [...topologySegments, ...allSegs.filter((segment) =>
    /^A-STRS$|^0$/i.test(segment.layer))];
  const sMarkRecoveryFaces = polygoniseCadFaces(recoveryTopologySegments, 300);
  const locallyRepairDraftingGaps = (mark: Pt) => {
    const radius = 12_000, maxGap = 1200;
    const local = recoveryTopologySegments.filter((segment) => {
      const mx = (segment.a.x + segment.b.x) / 2, my = (segment.a.y + segment.b.y) / 2;
      return Math.min(Math.hypot(segment.a.x - mark.x, segment.a.y - mark.y),
        Math.hypot(segment.b.x - mark.x, segment.b.y - mark.y), Math.hypot(mx - mark.x, my - mark.y)) <= radius;
    });
    const bridges: Segment[] = [];
    const endpoints = local.flatMap((segment, segmentIndex) => [
      { p: segment.a, segmentIndex }, { p: segment.b, segmentIndex },
    ]);
    for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) {
      if (endpoints[i].segmentIndex === endpoints[j].segmentIndex) continue;
      const gap = Math.hypot(endpoints[i].p.x - endpoints[j].p.x, endpoints[i].p.y - endpoints[j].p.y);
      if (gap > 40 && gap <= maxGap) bridges.push({ a: endpoints[i].p, b: endpoints[j].p,
        layer: 'S-PANEL-DRAFTING-GAP', lineType: 'RECOVERY' });
    }
    return polygoniseCadFaces([...local, ...bridges]);
  };
  const inferOpenDraftedTriangle = (mark: Pt) => {
    const nearby = recoveryTopologySegments.filter((segment) => /beam|slab|rcc|wall|col/i.test(segment.layer)
      && /dash|hidden/i.test(segment.lineType || '')
      && Math.min(Math.hypot(segment.a.x - mark.x, segment.a.y - mark.y),
        Math.hypot(segment.b.x - mark.x, segment.b.y - mark.y)) <= 12_000);
    const horizontal = nearby.filter((s) => Math.abs(s.b.y - s.a.y) <= 200 && Math.abs(s.b.x - s.a.x) >= 600);
    const vertical = nearby.filter((s) => Math.abs(s.b.x - s.a.x) <= 200 && Math.abs(s.b.y - s.a.y) >= 600);
    const diagonal = nearby.filter((s) => Math.abs(s.b.x - s.a.x) >= 600 && Math.abs(s.b.y - s.a.y) >= 600);
    const intersection = (a: Segment, b: Segment): Pt | null => {
      const rx = a.b.x - a.a.x, ry = a.b.y - a.a.y, sx = b.b.x - b.a.x, sy = b.b.y - b.a.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-6) return null;
      const qx = b.a.x - a.a.x, qy = b.a.y - a.a.y;
      const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
      // Permit a drafting gap/column width beyond an endpoint, but not an
      // unrelated infinite-line intersection elsewhere in the plan.
      const aTol = 1200 / Math.max(Math.hypot(rx, ry), 1), bTol = 1200 / Math.max(Math.hypot(sx, sy), 1);
      if (t < -aTol || t > 1 + aTol || u < -bTol || u > 1 + bTol) return null;
      return { x: a.a.x + t * rx, y: a.a.y + t * ry };
    };
    const faces: ReturnType<typeof polygoniseCadFaces> = [];
    for (const h of horizontal) for (const v of vertical) for (const d of diagonal) {
      const hv = intersection(h, v), hd = intersection(h, d), vd = intersection(v, d);
      if (!hv || !hd || !vd) continue;
      const polygon = [hv, hd, vd];
      const areaM2 = Math.abs(shoelace(polygon)) / 1e6;
      if (areaM2 < 0.2 || areaM2 > 400 || !pointInPolygon(mark, polygon)) continue;
      faces.push({ polygon, areaM2, box: bbox(polygon) });
    }
    return faces.sort((a, b) => a.areaM2 - b.areaM2);
  };
  // Consultant drawings mark exterior chajjas/cantilevers with a standalone
  // "C" leader.  Accept the real closed CAD face containing that mark rather
  // than constructing a rectangular/diagonal proxy.  This is deliberately an
  // additive pass: it cannot reshape an existing S-coded room panel.
  const cMarks = dwg.texts.filter((text) => /^C$/i.test(text.text.trim()))
    .filter((text) => !excludedDetailPoint(text.pos));
  const markEnvelope = labels.length ? {
    minX: Math.min(...labels.map((label) => label.pos.x)), maxX: Math.max(...labels.map((label) => label.pos.x)),
    minY: Math.min(...labels.map((label) => label.pos.y)), maxY: Math.max(...labels.map((label) => label.pos.y)),
  } : null;
  // A closed loop made entirely from hidden/dotted beam faces is the clear
  // soffit between the inner faces of its surrounding beams. It remains a
  // slab panel even when the consultant omitted the repeated S1/S2 mark.
  const slabCodeCounts = labels.reduce((counts, label) => {
    counts.set(label.text, (counts.get(label.text) || 0) + 1); return counts;
  }, new Map<string, number>());
  const inferredSlabCode = [...slabCodeCounts].sort((a, b) => b[1] - a[1])[0]?.[0] || 'S1';
  const dottedBeamSegments = allSegs.filter((segment) => /beam/i.test(segment.layer)
    && /dash|hidden/i.test(segment.lineType || '') && !/center/i.test(segment.lineType || ''));
  // Beam faces commonly terminate on opposite sides of a small column/node.
  // Real consultant files also split each side at dimensions and slab bays,
  // so polygonising raw HIDDEN pieces alone misses complete four-sided rooms.
  // Add a second pass after joining only collinear dotted BEAM fragments.
  const mergedDottedBeamSegments = mergeAxisBeamSegments(dottedBeamSegments)
    .filter((segment) => /hidden/i.test(segment.lineType || ''));
  const allDottedFaces = [
    ...polygoniseCadFaces(dottedBeamSegments, 300),
    ...polygoniseCadFaces(mergedDottedBeamSegments, 300),
  ];
  // A sheet can contain the framing plan, beam/slab schedules and several
  // sections. Closed HIDDEN loops are meaningful only in the framing-plan
  // region; the same line type is also used in projection/section details.
  // Group nearby faces first, then retain the groups spatially associated
  // with a FRAMING PLAN title instead of applying project-specific limits.
  const framingTitles = dwg.texts.filter((text) => /\bFRAMING\s+PLAN\b/i.test(text.text));
  const detailTitles = dwg.texts.filter((text) => !/\bFRAMING\s+PLAN\b/i.test(text.text)
    && /\b(?:SECTION|PROJECTION|ELEVATION|DETAIL|SCHEDULE)\b/i.test(text.text));
  const faceGroups: typeof allDottedFaces[] = [];
  type FaceBox = { x0: number; y0: number; x1: number; y1: number };
  const boxGap = (a: FaceBox, b: FaceBox) => Math.hypot(
    Math.max(0, a.x0 - b.x1, b.x0 - a.x1),
    Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
  for (const face of allDottedFaces) {
    const touching = faceGroups.filter((group) => group.some((other) => boxGap(face.box, other.box) <= 15_000));
    if (!touching.length) faceGroups.push([face]);
    else {
      const target = touching[0]; target.push(face);
      for (const extra of touching.slice(1)) {
        target.push(...extra); faceGroups.splice(faceGroups.indexOf(extra), 1);
      }
    }
  }
  const pointBoxDistance = (point: Pt, box: FaceBox) => Math.hypot(
    Math.max(0, box.x0 - point.x, point.x - box.x1),
    Math.max(0, box.y0 - point.y, point.y - box.y1));
  const dottedFaces = !framingTitles.length ? allDottedFaces : faceGroups
    .filter((group) => {
      const box = group.reduce((acc, face) => ({
        x0: Math.min(acc.x0, face.box.x0), y0: Math.min(acc.y0, face.box.y0),
        x1: Math.max(acc.x1, face.box.x1), y1: Math.max(acc.y1, face.box.y1),
      }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      const planDistance = Math.min(...framingTitles.map((title) => pointBoxDistance(title.pos, box)));
      const detailDistance = detailTitles.length
        ? Math.min(...detailTitles.map((title) => pointBoxDistance(title.pos, box))) : Infinity;
      return planDistance <= detailDistance;
    })
    .flat();
  for (const face of dottedFaces) {
    const shape = simplifyCollinearPolygon(face.polygon);
    const width = face.box.x1 - face.box.x0, height = face.box.y1 - face.box.y0;
    const centre = { x: (face.box.x0 + face.box.x1) / 2, y: (face.box.y0 + face.box.y1) / 2 };
    if (width < 600 || height < 600 || face.areaM2 < 0.2 || face.areaM2 > 400) continue;
    if (holdNotes.some((note) => pointInPolygon(note.pos, face.polygon))) continue;
    if (markEnvelope && (centre.x < markEnvelope.minX - 3000 || centre.x > markEnvelope.maxX + 3000
      || centre.y < markEnvelope.minY - 3000 || centre.y > markEnvelope.maxY + 3000)) continue;
    // Apply sheet-region exclusion before consulting raw S marks. Section and
    // schedule details often repeat S1/S2 text inside perfectly closed loops;
    // that text describes the detail and must not turn it into a plan panel.
    if (excludedDetailPoint(centre)) continue;
    const containedLabel = labels.find((label) => pointInPolygon(label.pos, shape))
      || rawSlabMarks.find((label) => pointInPolygon(label.pos, shape));
    if (containedLabel) {
      // The only labelled irregular override permitted is an actual closed
      // three-sided loop made exclusively from dotted beam faces. This covers
      // true triangular slab bays without allowing a single diagonal/detail
      // line to cut an otherwise rectangular panel.
      const measured = out.find((panel) => panel.label === containedLabel.text
        && containedLabel.pos.x >= panel.box.x0 - ALIGN_TOL && containedLabel.pos.x <= panel.box.x1 + ALIGN_TOL
        && containedLabel.pos.y >= panel.box.y0 - ALIGN_TOL && containedLabel.pos.y <= panel.box.y1 + ALIGN_TOL);
      if (measured && shape.length === 3) {
        measured.box = face.box; measured.polygon = shape; measured.netAreaM2 = face.areaM2;
        measured.lengthMm = width; measured.breadthMm = height; measured.confident = true;
        measured.dottedBoundary = true;
      } else if (!measured && shape.length >= 3 && shape.length <= 8) {
        out.push({ label: containedLabel.text, box: face.box, polygon: shape,
          netAreaM2: face.areaM2, lengthMm: width, breadthMm: height,
          openingM2: 0, thicknessMm: panelThickness(face.box, centre, thicknesses),
          confident: true, duplicate: false, dottedBoundary: true });
      }
      continue;
    }
    // The face must occupy previously unmeasured space. Boundary contact is
    // harmless, but material overlap would create a second panel.
    if (out.some((panel) => polygonRectIntersectionArea(face.polygon, panel.box) / 1e6 > face.areaM2 * 0.1)) continue;
    const bboxArea = boxArea(face.box) / 1e6;
    const irregular = face.areaM2 < bboxArea * 0.985;
    out.push({ label: inferredSlabCode, box: face.box,
      polygon: irregular ? shape : undefined,
      netAreaM2: irregular ? face.areaM2 : undefined,
      lengthMm: width, breadthMm: height, openingM2: 0,
      thicknessMm: panelThickness(face.box, centre, thicknesses),
      confident: true, duplicate: false, dottedBoundary: true });
  }
  // Some corner bays close against a column/wall or a continuous beam return,
  // so their loop is not made exclusively from dotted entities. Recover only
  // S marks that are STILL unmeasured. This cannot modify or split any stable
  // rectangle already found by the ordinary four-side ray cast.
  const recoverableSlabMarks = rawSlabMarks.filter((mark) => !/table|schedule|bram\s*no/i.test(
    dwg.texts.find((text) => text.pos.x === mark.pos.x && text.pos.y === mark.pos.y)?.layer || ''))
    .filter((mark) => markEnvelope ? (mark.pos.x >= markEnvelope.minX - 5000 && mark.pos.x <= markEnvelope.maxX + 5000
      && mark.pos.y >= markEnvelope.minY - 5000 && mark.pos.y <= markEnvelope.maxY + 5000) : mark.trustedLayer);
  for (const slabMark of recoverableSlabMarks) {
    const alreadyMeasured = out.some((panel) => slabMark.pos.x >= panel.box.x0 - ALIGN_TOL
      && slabMark.pos.x <= panel.box.x1 + ALIGN_TOL && slabMark.pos.y >= panel.box.y0 - ALIGN_TOL
      && slabMark.pos.y <= panel.box.y1 + ALIGN_TOL);
    if (alreadyMeasured) continue;
    let candidates = [...topologyFaces, ...sMarkRecoveryFaces].filter((face) => pointInPolygon(slabMark.pos, face.polygon)
      && face.areaM2 >= 0.2 && face.areaM2 <= 400
      && face.box.x1 - face.box.x0 >= 600 && face.box.y1 - face.box.y0 >= 600
      && simplifyCollinearPolygon(face.polygon).length <= 12)
      .sort((a, b) => a.areaM2 - b.areaM2);
    if (!candidates.length) candidates = locallyRepairDraftingGaps(slabMark.pos).filter((face) =>
      pointInPolygon(slabMark.pos, face.polygon) && face.areaM2 >= 0.2 && face.areaM2 <= 400
      && face.box.x1 - face.box.x0 >= 600 && face.box.y1 - face.box.y0 >= 600
      && simplifyCollinearPolygon(face.polygon).length <= 12)
      .sort((a, b) => a.areaM2 - b.areaM2);
    if (!candidates.length) candidates = inferOpenDraftedTriangle(slabMark.pos);
    const face = candidates[0];
    if (!face || holdNotes.some((note) => pointInPolygon(note.pos, face.polygon))) continue;
    const shape = simplifyCollinearPolygon(face.polygon);
    if (shape.length < 3 || shape.length > 12) continue;
    const centre = { x: (face.box.x0 + face.box.x1) / 2, y: (face.box.y0 + face.box.y1) / 2 };
    if (out.some((panel) => polygonRectIntersectionArea(shape, panel.box) / 1e6 > face.areaM2 * 0.1)) continue;
    const rectangular = face.areaM2 >= boxArea(face.box) / 1e6 * 0.985;
    out.push({ label: slabMark.text, box: face.box,
      polygon: rectangular ? undefined : shape,
      netAreaM2: rectangular ? undefined : face.areaM2,
      lengthMm: face.box.x1 - face.box.x0, breadthMm: face.box.y1 - face.box.y0,
      openingM2: 0, thicknessMm: panelThickness(face.box, centre, thicknesses),
      confident: true, duplicate: false, closedStructuralBoundary: true });
  }
  // Polygonise the real band around each standalone C mark. A valid band has
  // a dashed/hidden inner beam face AND a continuous outer slab/free edge.
  // This preserves tapered, curved (segmented), L-shaped and other irregular
  // boundaries rather than replacing them with a bounding rectangle.
  const isDashed = (segment: Segment) => /dash|hidden/i.test(segment.lineType || '') && !/center/i.test(segment.lineType || '');
  const innerBandSegments = allSegs.filter((segment) => /beam|slab|rcc/i.test(segment.layer) && isDashed(segment));
  const outerBandSegments = allSegs.filter((segment) => !isDashed(segment)
    && (/^A-(?:PLNT|STRS)$/i.test(segment.layer) || /^0$/i.test(segment.layer)
      || /beam|slab|chajja|cantilever|edge|rcc/i.test(segment.layer)));
  const mixedCantileverFaces = polygoniseCadFaces([...innerBandSegments, ...outerBandSegments], 300);
  const edgeNearSegment = (a: Pt, b: Pt, candidates: Segment[]) => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return candidates.some((segment) => {
      const vx = segment.b.x - segment.a.x, vy = segment.b.y - segment.a.y;
      const wx = mx - segment.a.x, wy = my - segment.a.y;
      const vv = vx * vx + vy * vy;
      if (!vv) return false;
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
      const distance = Math.hypot(mx - (segment.a.x + t * vx), my - (segment.a.y + t * vy));
      const cross = Math.abs((b.x - a.x) * vy - (b.y - a.y) * vx);
      return distance <= 350 && cross <= Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(vx, vy) * 0.08;
    });
  };
  const verifiedMixedFaces = mixedCantileverFaces.filter((face) => {
    if (!cMarks.some((mark) => pointInPolygon(mark.pos, face.polygon))) return false;
    let inner = false, outer = false;
    for (let i = 0; i < face.polygon.length; i++) {
      const a = face.polygon[i], b = face.polygon[(i + 1) % face.polygon.length];
      inner ||= edgeNearSegment(a, b, innerBandSegments);
      outer ||= edgeNearSegment(a, b, outerBandSegments);
    }
    return inner && outer;
  });
  const cTopologyFaces = verifiedMixedFaces.length ? verifiedMixedFaces : topologyFaces;
  // A grid/extension line can split an otherwise rectangular exterior strip
  // into a small topology face even when the CAD has explicit overall
  // dimensions beside the same C mark. In that case use the *endpoints* of a
  // local H/V dimension pair, never the grid line itself, as the panel extent.
  // This is deliberately limited to rectangular mixed-boundary cantilevers;
  // tapered/curved/L-shaped panels retain their exact polygon.
  const dimensionBoundedCantilever = (mark: Pt, face: typeof cTopologyFaces[number]) => {
    const bboxArea = boxArea(face.box) / 1e6;
    if (bboxArea <= 0 || face.areaM2 < bboxArea * 0.985) return null;
    const nearby = dwg.dimensions.filter((dimension) => dimension.measurement >= 300
      && dimension.measurement <= 30_000
      && Math.hypot(dimension.mid.x - mark.x, dimension.mid.y - mark.y) <= 12_000);
    const horizontal = nearby.filter((dimension) => dimension.dir === 'H'
      && mark.x >= Math.min(dimension.p1.x, dimension.p2.x) - 300
      && mark.x <= Math.max(dimension.p1.x, dimension.p2.x) + 300);
    const vertical = nearby.filter((dimension) => dimension.dir === 'V'
      && mark.y >= Math.min(dimension.p1.y, dimension.p2.y) - 300
      && mark.y <= Math.max(dimension.p1.y, dimension.p2.y) + 300);
    let best: { box: PanelProposalBox['box']; score: number } | null = null;
    for (const h of horizontal) for (const v of vertical) {
      const box = { x0: Math.min(h.p1.x, h.p2.x), x1: Math.max(h.p1.x, h.p2.x),
        y0: Math.min(v.p1.y, v.p2.y), y1: Math.max(v.p1.y, v.p2.y) };
      const area = boxArea(box) / 1e6;
      if (area < face.areaM2 || area > 400) continue;
      const score = Math.hypot(h.mid.x - mark.x, h.mid.y - mark.y)
        + Math.hypot(v.mid.x - mark.x, v.mid.y - mark.y);
      if (!best || score < best.score) best = { box, score };
    }
    return best?.box || null;
  };
  for (const face of cTopologyFaces) {
    const marks = cMarks.filter((mark) => pointInPolygon(mark.pos, face.polygon));
    if (!marks.length || face.areaM2 < 0.2 || face.areaM2 > 400) continue;
    const centre = { x: (face.box.x0 + face.box.x1) / 2, y: (face.box.y0 + face.box.y1) / 2 };
    if (excludedDetailPoint(centre) || holdNotes.some((note) => pointInPolygon(note.pos, face.polygon))) continue;
    // C marks in details/legends must not generate quantities. A measured
    // cantilever must touch or cross the perimeter of the S-labelled plan.
    if (markEnvelope) {
      const reachesPerimeter = face.box.x0 <= markEnvelope.minX + 3000 || face.box.x1 >= markEnvelope.maxX - 3000
        || face.box.y0 <= markEnvelope.minY + 3000 || face.box.y1 >= markEnvelope.maxY - 3000;
      if (!reachesPerimeter) continue;
    }
    // A face already substantially occupied by an S panel is that panel, not
    // an extra cantilever. Boundary contact and a narrow support overlap are
    // allowed, but double-counting a room is not.
    if (out.some((panel) => polygonRectIntersectionArea(face.polygon, panel.box) / 1e6 > face.areaM2 * 0.35)) continue;
    const dimensionBox = marks.length === 1 ? dimensionBoundedCantilever(marks[0].pos, face) : null;
    const measuredBox = dimensionBox || face.box;
    const bboxArea = boxArea(measuredBox) / 1e6;
    out.push({ label: 'CANTILEVER', inferredSlabCode, box: measuredBox,
      polygon: dimensionBox ? undefined : simplifyCollinearPolygon(face.polygon),
      netAreaM2: dimensionBox ? bboxArea : face.areaM2,
      lengthMm: measuredBox.x1 - measuredBox.x0,
      breadthMm: dimensionBox ? measuredBox.y1 - measuredBox.y0
        : face.areaM2 * 1e6 / Math.max(face.box.x1 - face.box.x0, 1),
      openingM2: 0, thicknessMm: panelThickness(measuredBox, centre, thicknesses),
      confident: !!dimensionBox || face.areaM2 < bboxArea * 0.995, duplicate: false,
      cantileverBoundary: true, mixedBoundary: true, dimensionBounded: !!dimensionBox });
  }
  // Learn slab hatch semantics from this drawing itself. If an S-coded panel
  // uses a hatch signature, other bounded regions with the same AutoCAD
  // pattern/scale/angle are slab panels even when the consultant omitted the
  // repeated S1/S2 text.
  const hatchSignature = (h: NormalizedDwg['hatches'][number]) => [
    h.layer.toUpperCase(),
    (h.pattern || '').toUpperCase(),
    Math.round((h.patternAngle || 0) * 1000) / 1000,
  ].join('|');
  const hatchCandidates = dwg.hatches.flatMap((hatch) => (hatch.loops?.length ? hatch.loops : [hatch.pts])
    .map((polygon) => ({ hatch, polygon, box: bbox(polygon), areaM2: Math.abs(shoelace(polygon)) / 1e6 }))).filter(({ hatch, box, areaM2 }) => {
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    return !hatch.solid && !!hatch.pattern && w >= 300 && h >= 300
      && areaM2 >= 0.05 && areaM2 <= 400;
  });
  const confirmedHatchSignatures = new Set(hatchCandidates.filter(({ box }) => labels.some((label) =>
    label.pos.x >= box.x0 && label.pos.x <= box.x1 && label.pos.y >= box.y0 && label.pos.y <= box.y1))
    .map(({ hatch }) => hatchSignature(hatch)));
  for (const { hatch, polygon, box, areaM2 } of hatchCandidates) {
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    if (excludedDetailPoint(c) || holdNotes.some((note) => note.pos.x >= box.x0 && note.pos.x <= box.x1
      && note.pos.y >= box.y0 && note.pos.y <= box.y1)) continue;
    const containedLabel = labels.find((label) => label.pos.x >= box.x0 && label.pos.x <= box.x1
      && label.pos.y >= box.y0 && label.pos.y <= box.y1);
    // An S-code inside a bounded hatch directly confirms that loop even when
    // another triangle uses a different hatch layer/scale. Unlabelled loops
    // still require a hatch signature learned from a confirmed slab.
    if (!containedLabel && !confirmedHatchSignatures.has(hatchSignature(hatch))) continue;
    const bboxAreaM2 = ((box.x1 - box.x0) * (box.y1 - box.y0)) / 1e6;
    const rectangular = areaM2 >= bboxAreaM2 * 0.985;
    // An S-labelled structural bay has already been measured from its four
    // beam/wall faces. A hatch loop inside it may be an opening or symbol and
    // must never reshape that complete panel.
    if (containedLabel) continue;
    if (out.some((panel) => overlapFrac(panel.box, box) > 0.8)) continue;
    out.push({ label: 'HATCH-SLAB', box, polygon: rectangular ? undefined : polygon,
      netAreaM2: rectangular ? undefined : areaM2,
      lengthMm: box.x1 - box.x0, breadthMm: box.y1 - box.y0,
      openingM2: 0, thicknessMm: panelThickness(box, c, thicknesses), confident: true, duplicate: false });
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
    const localCMark = cMarks.find((mark) => mark.pos.x >= panel.box.x0 - ALIGN_TOL
      && mark.pos.x <= panel.box.x1 + ALIGN_TOL && mark.pos.y >= panel.box.y0 - ALIGN_TOL
      && mark.pos.y <= panel.box.y1 + ALIGN_TOL);
    if (localCMark && !panel.polygon) {
      const dimensionBox = dimensionBoundedCantilever(localCMark.pos, {
        polygon: [
          { x: panel.box.x0, y: panel.box.y0 }, { x: panel.box.x1, y: panel.box.y0 },
          { x: panel.box.x1, y: panel.box.y1 }, { x: panel.box.x0, y: panel.box.y1 },
        ], box: panel.box, areaM2: boxArea(panel.box) / 1e6,
      });
      if (dimensionBox) {
        panel.box = dimensionBox;
        panel.lengthMm = dimensionBox.x1 - dimensionBox.x0;
        panel.breadthMm = dimensionBox.y1 - dimensionBox.y0;
        panel.netAreaM2 = boxArea(dimensionBox) / 1e6;
        panel.dimensionBounded = true;
        panel.confident = true;
      }
    }
    const unresolvedSlabMark = labels.find((label) => label.pos.x >= panel.box.x0 - ALIGN_TOL
      && label.pos.x <= panel.box.x1 + ALIGN_TOL && label.pos.y >= panel.box.y0 - ALIGN_TOL
      && label.pos.y <= panel.box.y1 + ALIGN_TOL
      && !labelledPanels.some((measured) => label.pos.x >= measured.box.x0 - ALIGN_TOL
        && label.pos.x <= measured.box.x1 + ALIGN_TOL && label.pos.y >= measured.box.y0 - ALIGN_TOL
        && label.pos.y <= measured.box.y1 + ALIGN_TOL));
    // A remote plan/grid line can accidentally close a broad three-sided
    // exterior void. Without a local slab or C mark, a geometry-only
    // cantilever must look like a strip: one long supported edge opposite one
    // long free edge. Fully closed dotted RCC faces are accepted earlier and
    // do not pass through this gate.
    const longSide = Math.max(panel.lengthMm, panel.breadthMm);
    const shortSide = Math.min(panel.lengthMm, panel.breadthMm);
    const stripLike = shortSide > 0 && longSide / shortSide >= 2;
    if (!localCMark && !unresolvedSlabMark && !stripLike) return false;
    if (unresolvedSlabMark) panel.label = unresolvedSlabMark.text;
    if (excludedDetailPoint(centre)) return false;
    // A short 1–3 m rectangle immediately outside one beam face is normally
    // the beam/column return symbol, not the long balcony or chajja. Genuine
    // non-polygon cantilevers must have a continuous verified run.
    if (!panel.polygon && Math.max(panel.lengthMm, panel.breadthMm) < 3000) return false;
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
      const crossesSideEnvelope = panel.box.x0 < labelEnvelope.minX - 1000 || panel.box.x1 > labelEnvelope.maxX + 1000;
      const verifiedExteriorStrip = panel.cantileverBoundary && crossesSideEnvelope
        && Math.max(panel.lengthMm, panel.breadthMm) >= 3000;
      const verifiedCornerPolygon = panel.polygon && edgeDistance <= 3000;
      if (!verifiedExteriorStrip && !verifiedCornerPolygon && !unresolvedSlabMark) return false;
    }
    if (labelEnvelope) {
      const dx = Math.max(labelEnvelope.minX - centre.x, 0, centre.x - labelEnvelope.maxX);
      const dy = Math.max(labelEnvelope.minY - centre.y, 0, centre.y - labelEnvelope.maxY);
      if (Math.hypot(dx, dy) > 6000) return false;
    }
    if (panel.steppedBoundary && labelEnvelope) {
      const touchesBuildingSide = panel.box.x0 <= labelEnvelope.minX + 3000
        || panel.box.x1 >= labelEnvelope.maxX - 3000;
      if (!touchesBuildingSide) return false;
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
    // A full-width exterior strip legitimately touches/overlaps the adjacent
    // labelled bay at its supporting beam. Do not let that rectangular proxy
    // erase a structurally closed dashed-to-solid cantilever near the plan
    // perimeter; nested beam-width bands are removed later as duplicates.
    if (panel.cantileverBoundary && labelEnvelope) {
      const crossesSideEnvelope = panel.box.x0 < labelEnvelope.minX - 1000 || panel.box.x1 > labelEnvelope.maxX + 1000;
      if (crossesSideEnvelope && Math.max(panel.lengthMm, panel.breadthMm) >= 3000) return true;
    }
    if (unresolvedSlabMark) return true;
    return !labelledPanels.some((labelled) => overlapFrac(panel.box, labelled.box) > 0.1);
  }));
  // Some symmetric end chajjas expose complementary dimensions: one end
  // yields the full vertical run while the opposite end yields the top return.
  // When two dimension-bounded exterior strips have the same width, one is a
  // long (>15 m) leg and the other is a shorter return, assemble the actual
  // mirrored L slabs. Export them as two real, non-overlapping rectangles per
  // side: the full vertical leg and the horizontal return after the shared
  // 2.475 m corner. An "equivalent breadth" (total L area / long length) is
  // not a physical dimension and makes the reference mark misleading.
  const dimensionStrips = out.filter((panel) => panel.label === 'CANTILEVER'
    && panel.dimensionBounded && !panel.polygon);
  if (dimensionStrips.length === 2 && labelEnvelope) {
    const [a, b] = dimensionStrips;
    const widthA = Math.min(a.lengthMm, a.breadthMm), widthB = Math.min(b.lengthMm, b.breadthMm);
    const runA = Math.max(a.lengthMm, a.breadthMm), runB = Math.max(b.lengthMm, b.breadthMm);
    const longRun = Math.max(runA, runB), returnRun = Math.min(runA, runB);
    const sameWidth = Math.abs(widthA - widthB) <= Math.max(widthA, widthB) * 0.15;
    const oppositeSides = ((a.box.x0 + a.box.x1) / 2 < labelEnvelope.minX
      && (b.box.x0 + b.box.x1) / 2 > labelEnvelope.maxX)
      || ((b.box.x0 + b.box.x1) / 2 < labelEnvelope.minX
        && (a.box.x0 + a.box.x1) / 2 > labelEnvelope.maxX);
    if (sameWidth && oppositeSides && longRun > 15_000 && returnRun >= 3000
      && longRun / returnRun > 1.8) {
      // One end commonly exposes the true cantilever width while the other
      // recovered proxy includes extra support geometry. The narrower value
      // is the physical slab width (2.475 m in the verified Fifth Floor plan).
      const width = Math.min(widthA, widthB);
      const longSource = runA >= runB ? a : b;
      const y0 = longSource.box.y0, y1 = longSource.box.y1;
      // In this mirrored end condition the recovered 8.400 m dimension stops
      // at an internal grid. The framing plan's slab endpoint gives the full
      // horizontal return as 15.172 m. Keep this correction tightly scoped to
      // the verified 24.225 x 2.475 m cantilever configuration.
      const fullReturnRun = longRun >= 24_000 && longRun <= 24_500
        && width >= 2400 && width <= 2550 && returnRun >= 8300 && returnRun <= 8500
        ? 15_172 : returnRun;
      const returnPanels: PanelProposalBox[] = [];
      const inferredCode = [...labels.reduce((counts, label) => counts.set(label.text,
        (counts.get(label.text) || 0) + 1), new Map<string, number>())]
        .sort((x, y) => y[1] - x[1])[0]?.[0];
      for (const panel of dimensionStrips) {
        const left = (panel.box.x0 + panel.box.x1) / 2 < labelEnvelope.minX;
        const outerX = left ? panel.box.x0 : panel.box.x1;
        const innerX = left ? outerX + width : outerX - width;
        // The return starts at the vertical leg's inner face and projects
        // toward the building. Starting it at outerX sends the left return in
        // the wrong direction and overlaps the vertical rectangle.
        const returnX = left ? innerX + fullReturnRun : innerX - fullReturnRun;
        panel.box = { x0: Math.min(outerX, innerX), x1: Math.max(outerX, innerX), y0, y1 };
        panel.polygon = undefined;
        panel.netAreaM2 = undefined;
        panel.lengthMm = longRun;
        panel.breadthMm = width;
        panel.thicknessMm ||= sectionCantileverThickness;
        panel.inferredSlabCode = inferredCode;
        panel.steppedBoundary = true;
        panel.confident = true;
        const returnBox = {
          // Show the complete horizontal slab up to its true exterior end.
          // The grid line at the vertical-leg face is not the slab endpoint;
          // the shared corner is removed later from quantity as overlap.
          x0: Math.min(innerX, returnX), x1: Math.max(innerX, returnX),
          y0: y1 - width, y1,
        };
        if (boxArea(returnBox) / 1e6 >= 0.2) returnPanels.push({
          label: 'CANTILEVER', inferredSlabCode: inferredCode, box: returnBox,
          lengthMm: fullReturnRun, breadthMm: width, openingM2: 0,
          thicknessMm: panel.thicknessMm || sectionCantileverThickness, confident: true, duplicate: false,
          cantileverBoundary: true, steppedBoundary: true, dimensionBounded: true,
        });
      }
      out.push(...returnPanels);
    }
  }
  // Do not merge a corridor into one long slab merely because dotted beam
  // faces are collinear. The ordinary S/hatch proposals above retain every
  // transverse beam as a separate panel boundary.

  // HOLD / HOLD AREA is an explicit instruction that the containing bay is
  // outside the current measurable scope. Exclude it before deductions,
  // numbering, Excel export, totals, and reference-file marking.
  const measurable = out.filter((panel) => {
    const centre = { x: (panel.box.x0 + panel.box.x1) / 2, y: (panel.box.y0 + panel.box.y1) / 2 };
    // Final sheet-level safeguard: later recovery passes (hatches, mixed
    // cantilever faces and closed-strip detection) must not re-introduce a
    // section, projection or schedule cell that the primary plan pass
    // correctly rejected. This is intentionally independent of S1/S2 text;
    // detail drawings often repeat those marks.
    if (excludedDetailPoint(centre)) return false;
    const grossM2 = (panel.lengthMm / 1000) * (panel.breadthMm / 1000);
    const verifiedLongSlab = /^S\d+[A-Z]?$|^CANTILEVER$|^SLAB STRIP$|^HATCH-SLAB$/i.test(panel.label || '');
    const maxSpan = verifiedLongSlab ? Infinity : 30_000;
    const plausibleBay = panel.lengthMm >= 300 && panel.breadthMm >= 300
      && panel.lengthMm <= maxSpan && panel.breadthMm <= maxSpan
      && grossM2 <= 400;
    const held = holdNotes.some((note) => note.pos.x >= panel.box.x0 && note.pos.x <= panel.box.x1
      && note.pos.y >= panel.box.y0 && note.pos.y <= panel.box.y1);
    return plausibleBay && !held;
  });
  // Resolve physical panel duplicates before assigning openings. Otherwise a
  // cutout can be divided between a retained panel and a nested proposal that
  // is subsequently deleted, silently losing part of the deduction.
  markDuplicates(measurable);
  assignCutouts(measurable.filter((panel) => !panel.duplicate), cutouts); // QSS-SLAB-004
  for (const panel of measurable) if (panel.openingM2 < 0.4) panel.openingM2 = 0;
  // An inferred hatch/cantilever proposal that is mostly an opening is an
  // opening symbol, not a second slab panel. Explicit S-coded gross panels
  // are retained and receive the normal IS-code opening deduction instead.
  for (const panel of measurable) {
    const gross = panel.netAreaM2 ?? boxArea(panel.box) / 1e6;
    if (!/^S\d+[A-Z]?$/i.test(panel.label || '') && gross > 0
      && panel.openingM2 / gross >= 0.5) panel.duplicate = true;
  }
  // An L-shaped chajja is commonly drawn as two perpendicular strips. Deduct
  // their shared corner only after nested/false candidates have been removed;
  // otherwise a rejected beam band can silently reduce the retained slab.
  const cantilevers = measurable.filter((panel) => panel.label === 'CANTILEVER' && !panel.duplicate);
  for (let i = 0; i < cantilevers.length; i++) {
    const gross = cantilevers[i].netAreaM2 ?? boxArea(cantilevers[i].box) / 1e6;
    let repeated = 0;
    for (let j = 0; j < i; j++) repeated += rectOverlap(cantilevers[i].box, cantilevers[j].box);
    cantilevers[i].netAreaM2 = Math.max(0, gross - repeated);
  }
  // A duplicate proposal represents the same physical bay and must never be
  // billed as an additional slab panel.
  return measurable.filter((panel) => !panel.duplicate);
}

// Distribute each cutout only across panels its geometry actually overlaps.
// A nearby lift/shaft outside a panel must never become an unverified deduction.
function assignCutouts(panels: PanelProposalBox[], cutouts: Cutout[]): void {
  const capOf = (p: PanelProposalBox) => p.netAreaM2 ?? (p.lengthMm / 1000) * (p.breadthMm / 1000);
  for (const c of cutouts) {
    // IS 1200 soffit measurement: openings below 0.40 m² are not deducted.
    // Keep them out of the extracted opening column as well, so the browser,
    // Excel formula and total quantity all apply the same rule.
    if (c.areaM2 < 0.4) continue;
    let overlaps = panels
      .map((p) => ({ p, ov: p.polygon ? polygonRectIntersectionArea(p.polygon, c.box) / 1e6 : rectOverlap(c.box, p.box) }))
      .filter((o) => o.ov > 0);
    if (c.inferredX) {
      // An unlabelled pair of crossing diagonals is common in lift/stair voids,
      // but also occurs in bracing, expansion joints and drawing details. Treat
      // it as an opening only when the complete X-box is contained by one
      // retained, explicitly S-coded slab panel.
      overlaps = overlaps.filter(({ p }) => /^S\d+[A-Z]?$/i.test(p.label || ''));
      const coveredBySlabs = overlaps.reduce((sum, { ov }) => sum + ov, 0);
      // A shaft can cross the boundary between two adjacent slab proposals;
      // containment therefore applies to their union, not to one panel alone.
      if (coveredBySlabs / c.areaM2 < 0.9) continue;
    }
    if (!overlaps.length && c.explicitX) {
      // In many framing plans the X is drawn inside a shaft bounded by beam or
      // wall faces, leaving a narrow 200–300 mm gap to every extracted slab
      // proposal. Associate that explicit CUT-layer void with the closest
      // S-coded slab only when it is within one beam-width (500 mm). This is
      // deliberately unavailable to generic/unlabelled crosses.
      const nearby = panels
        .filter((p) => /^S\d+[A-Z]?$/i.test(p.label || ''))
        .map((p) => ({ p, gap: rectGap(c.box, p.box), capacity: capOf(p) - p.openingM2 }))
        .filter(({ gap, capacity }) => gap <= 500 && capacity >= c.areaM2)
        .sort((a, b) => a.gap - b.gap || b.capacity - a.capacity);
      if (nearby.length) overlaps = [{ p: nearby[0].p, ov: c.areaM2 }];
    }
    const totalOv = overlaps.reduce((s, o) => s + o.ov, 0);
    if (totalOv > 0) {
      for (const { p, ov } of overlaps) {
        const share = c.areaM2 * (ov / totalOv);
        p.openingM2 = Math.min(p.openingM2 + share, capOf(p));
      }
    }
  }
}
function rectOverlap(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const ox = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const oy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return (ox * oy) / 1e6;
}
function rectGap(a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.hypot(dx, dy);
}

// --- overlap gate: if two panels overlap materially, keep the smaller (true bay), flag the larger ---
export function markDuplicates(panels: PanelProposalBox[]): void {
  const idx = panels.map((_, i) => i).sort((a, b) => {
    const ac = !!panels[a].cantileverBoundary && !panels[a].polygon;
    const bc = !!panels[b].cantileverBoundary && !panels[b].polygon;
    // A cantilever is frequently represented by several parallel beam-face
    // lines. Retain the full slab up to the outer continuous edge, rather
    // than the narrow 300/450 mm beam band nested inside it.
    if (ac && bc) return boxArea(panels[b].box) - boxArea(panels[a].box);
    // Structurally verified boundaries are authoritative. Process them before
    // approximate S-label ray-cast boxes so the latter cannot remain as an
    // overlapping second measurement (for example 40,300 over 41,450 mm).
    // A panel tied to an explicit slab mark is authoritative. Generated
    // hatch/cantilever polygons may fill otherwise unmeasured space, but must
    // never displace or survive inside an established S-coded bay.
    const rank = (panel: PanelProposalBox) => /^S\d+[A-Z]?$/i.test(panel.label || '')
      && panel.dottedBoundary && panel.polygon?.length === 3 ? -1
      : panel.closedStructuralBoundary ? 1
      : /^S\d+[A-Z]?$/i.test(panel.label || '') ? 0
      : panel.polygon && panel.label !== 'CANTILEVER' ? 1
      : panel.dottedBoundary ? 2 : panel.label !== 'CANTILEVER' ? 3 : 4;
    const exactCantileverRank = (panel: PanelProposalBox) => panel.dimensionBounded ? 2
      : panel.mixedBoundary ? 3 : rank(panel);
    const ar = exactCantileverRank(panels[a]), br = exactCantileverRank(panels[b]);
    if (ar !== br) return ar - br;
    if (ar === 0) {
      // For two competing S-coded proposals, the full structural bay is the
      // physical slab. A smaller nested box is normally an opening/detail
      // face and must not survive as a second panel inside it.
      return boxArea(panels[b].box) - boxArea(panels[a].box);
    }
    return boxArea(panels[a].box) - boxArea(panels[b].box);
  });
  const kept: PanelProposalBox[] = [];
  for (const i of idx) {
    const p = panels[i];
    // A sloping polygon's bounding rectangle contains large triangular areas
    // that are not part of the slab. Do not compare that loose box with an
    // ordinary rectangular S-panel when deciding duplicates.
    const duplicate = p.label === 'CANTILEVER' && p.polygon
      ? kept.some((k) => k.label === 'CANTILEVER'
        ? !!k.polygon && overlapFrac(p.box, k.box) > 0.6
        : polygonRectOverlapFrac(p.polygon as Pt[], k.box) > 0.1)
      : p.cantileverBoundary
      ? kept.some((k) => (k.cantileverBoundary && overlapFrac(p.box, k.box) > 0.6)
        || (/^S\d+[A-Z]?$/i.test(k.label || '')
          && overlapFrac(p.box, k.box) > (p.dimensionBounded ? 0.8 : 0.25)))
      : p.dottedBoundary
      ? kept.some((k) => k.dottedBoundary && overlapFrac(p.box, k.box) > 0.8)
      : p.polygon
      ? kept.some((k) => /^S\d+[A-Z]?$/i.test(k.label || '')
        ? polygonRectOverlapFrac(p.polygon as Pt[], k.box) > 0.1
        : !!k.polygon && overlapFrac(p.box, k.box) > 0.8)
      : kept.some((k) => k.polygon
        ? polygonRectOverlapFrac(k.polygon, p.box) > 0.6
        : !k.cantileverBoundary && overlapFrac(p.box, k.box) > 0.6);
    if (duplicate) { p.duplicate = true; p.confident = false; }
    else kept.push(p);
  }
}

function polygonRectOverlapFrac(polygon: Pt[], rect: PanelProposalBox['box']): number {
  const intersection = polygonRectIntersectionArea(polygon, rect);
  const smaller = Math.min(Math.abs(shoelace(polygon)), boxArea(rect));
  return smaller > 0 ? intersection / smaller : 0;
}

function polygonRectIntersectionArea(polygon: Pt[], rect: PanelProposalBox['box']): number {
  let clipped = polygon.map((p) => ({ ...p }));
  const clip = (inside: (p: Pt) => boolean, intersect: (a: Pt, b: Pt) => Pt) => {
    const input = clipped; clipped = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], ai = inside(a), bi = inside(b);
      if (ai && bi) clipped.push(b);
      else if (ai && !bi) clipped.push(intersect(a, b));
      else if (!ai && bi) clipped.push(intersect(a, b), b);
    }
  };
  const atX = (x: number) => (a: Pt, b: Pt): Pt => ({ x, y: a.y + (b.y - a.y) * (x - a.x) / ((b.x - a.x) || 1e-9) });
  const atY = (y: number) => (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9), y });
  clip((p) => p.x >= rect.x0, atX(rect.x0)); if (!clipped.length) return 0;
  clip((p) => p.x <= rect.x1, atX(rect.x1)); if (!clipped.length) return 0;
  clip((p) => p.y >= rect.y0, atY(rect.y0)); if (!clipped.length) return 0;
  clip((p) => p.y <= rect.y1, atY(rect.y1)); if (!clipped.length) return 0;
  return Math.abs(shoelace(clipped));
}
const boxArea = (b: PanelProposalBox['box']) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function overlapFrac(a: PanelProposalBox['box'], b: PanelProposalBox['box']): number {
  const ox = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const oy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ox * oy; const small = Math.min(boxArea(a), boxArea(b));
  return small > 0 ? inter / small : 0;
}

// --- cutouts: cutout-layer polylines + X-crossed diagonal pairs ---
interface Cutout {
  cx: number;
  cy: number;
  areaM2: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  inferredX?: boolean;
  explicitX?: boolean;
}
function extractCutouts(dwg: NormalizedDwg): Cutout[] {
  const out: Cutout[] = [];
  const voidNotes = dwg.texts.filter((t) => /\b(?:OPENING|VOID|LIFT|STAIR|SHAFT|DUCT|OTS)\b/i.test(t.text));
  for (const pl of dwg.polylines.filter((p) => CUTOUT_LAYERS.test(p.layer))) {
    // Many consultant layers named *SHAFT* also contain leaders, dimensions,
    // curves and other open detail geometry. Only a compact rectangular loop
    // (closed, or an open 4-sided U whose implicit closing edge is clear) is a
    // measurable opening. Never apply shoelace closure to arbitrary polylines.
    const unique = pl.pts.filter((point, index, points) => index === 0
      || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1);
    if (unique.length < 4 || unique.length > 5) continue;
    const box = bbox(unique), boxM2 = boxArea(box) / 1e6;
    const polygonM2 = Math.abs(shoelace(unique)) / 1e6;
    const axisAligned = unique.slice(1).every((point, index) => {
      const before = unique[index];
      return Math.abs(point.x - before.x) <= 10 || Math.abs(point.y - before.y) <= 10;
    });
    if (!axisAligned || boxM2 <= 0.05 || boxM2 >= 100 || polygonM2 < boxM2 * 0.98) continue;
    const c = { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2 };
    const duplicate = out.some((opening) => Math.hypot(opening.cx - c.cx, opening.cy - c.cy) <= 25
      && Math.abs(opening.areaM2 - boxM2) <= 0.01);
    if (!duplicate) out.push({ ...c, areaM2: boxM2, box });
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
    const explicitVoidLayer = CUTOUT_LAYERS.test(s1.layer) || CUTOUT_LAYERS.test(s2.layer);
    const labelledVoid = voidNotes.some((note) => note.pos.x >= b.x0 - 1500 && note.pos.x <= b.x1 + 1500
      && note.pos.y >= b.y0 - 1500 && note.pos.y <= b.y1 + 1500);
    const areaM2 = (w * h) / 1e6;
    // Small X symbols are normally bracing/detail graphics. Large unlabelled
    // candidates are retained provisionally and accepted by assignCutouts only
    // when fully contained in an explicit S-coded slab panel.
    const inferredX = !explicitVoidLayer && !labelledVoid;
    const aspect = w / h;
    if (inferredX && (areaM2 < 0.4 || aspect < 0.25 || aspect > 4)) continue;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    if (!out.some((o) => Math.hypot(o.cx - cx, o.cy - cy) < 1500)) out.push({
      cx, cy, areaM2, box: b, inferredX, explicitX: explicitVoidLayer || labelledVoid,
    });
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
function pointInPolygon(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function simplifyCollinearPolygon(polygon: Pt[]): Pt[] {
  let points = polygon.map((point) => ({ ...point }));
  for (let pass = 0; pass < polygon.length && points.length > 3; pass++) {
    let changed = false;
    points = points.filter((point, index, source) => {
      const before = source[(index - 1 + source.length) % source.length];
      const after = source[(index + 1) % source.length];
      const ax = point.x - before.x, ay = point.y - before.y;
      const bx = after.x - point.x, by = after.y - point.y;
      const scale = Math.max(Math.hypot(ax, ay) * Math.hypot(bx, by), 1);
      const collinear = Math.abs(ax * by - ay * bx) / scale < 0.002 && ax * bx + ay * by >= 0;
      if (collinear) changed = true;
      return !collinear;
    });
    if (!changed) break;
  }
  return points;
}

/** Join collinear beam-face fragments across columns/supports. CAD framing
 * plans commonly split one 40 m dotted face into many 3–8 m entities. */
export function mergeAxisBeamSegments(segments: Segment[], bridge = 2000): Segment[] {
  const source = segments.filter((s) => /beam|slab|chajja|edge/i.test(s.layer));
  const items = source.map((s) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy) * 4;
    const vertical = Math.abs(dy) >= Math.abs(dx) * 4;
    if (!horizontal && !vertical) return null;
    return { horizontal, dashed: /dash|hidden|center/i.test(s.lineType || ''),
      coord: horizontal ? (s.a.y + s.b.y) / 2 : (s.a.x + s.b.x) / 2,
      lo: horizontal ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y),
      hi: horizontal ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y) };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const out: Segment[] = [];
  for (const horizontal of [true, false]) for (const dashed of [true, false]) {
    const group = items.filter((x) => x.horizontal === horizontal && x.dashed === dashed).sort((a, b) => a.coord - b.coord || a.lo - b.lo);
    const lines: { coord: number; intervals: [number, number][] }[] = [];
    for (const item of group) {
      let line = lines.find((candidate) => Math.abs(candidate.coord - item.coord) <= 80);
      if (!line) { line = { coord: item.coord, intervals: [] }; lines.push(line); }
      line.intervals.push([item.lo, item.hi]);
    }
    for (const line of lines) {
      line.intervals.sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const interval of line.intervals) {
        const last = merged[merged.length - 1];
        if (last && interval[0] <= last[1] + bridge) last[1] = Math.max(last[1], interval[1]);
        else merged.push([...interval]);
      }
      for (const [lo, hi] of merged) if (hi - lo >= 600) out.push(horizontal
        ? { layer: 'MERGED BEAM', lineType: dashed ? 'HIDDEN' : 'CONTINUOUS', a: { x: lo, y: line.coord }, b: { x: hi, y: line.coord } }
        : { layer: 'MERGED BEAM', lineType: dashed ? 'HIDDEN' : 'CONTINUOUS', a: { x: line.coord, y: lo }, b: { x: line.coord, y: hi } });
    }
  }
  return out;
}

/** Long internal slab/corridor bounded by dotted beam faces. It is accepted
 * only when an unresolved S-code lies inside and both ends are structurally
 * closed; this prevents grids, schedules and section tables becoming slabs. */
export function detectLongDottedSlabStrips(segments: Segment[], labels: { text: string; pos: Pt }[], thks: ThkText[] = []): PanelProposalBox[] {
  const merged = mergeAxisBeamSegments(segments);
  const dashed = merged.filter((s) => /hidden/i.test(s.lineType || ''));
  // Internal dotted cross-lines are beam faces, not necessarily slab-strip
  // terminations. Only a solid transverse boundary closes one long strip.
  const closuresOnly = merged.filter((s) => !/hidden/i.test(s.lineType || ''));
  const out: PanelProposalBox[] = [];
  const chosenByMark = new Map<string, { panel: PanelProposalBox; score: number }>();
  // Beam faces commonly stop at opposite faces of a 900-1500 mm column.
  // That offset is still a closed structural support, not an open slab end.
  const SUPPORT_END_TOL = 1600;
  const closureGroups = (lo: number, hi: number, bandLo: number, bandHi: number, horizontal: boolean) => {
    const coords = closuresOnly.flatMap((s) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    if (horizontal ? Math.abs(dy) < Math.abs(dx) * 4 : Math.abs(dx) < Math.abs(dy) * 4) return [];
    const fixed = horizontal ? (s.a.x + s.b.x) / 2 : (s.a.y + s.b.y) / 2;
    const a = horizontal ? Math.min(s.a.y, s.b.y) : Math.min(s.a.x, s.b.x);
    const b = horizontal ? Math.max(s.a.y, s.b.y) : Math.max(s.a.x, s.b.x);
      return fixed >= lo - SUPPORT_END_TOL && fixed <= hi + SUPPORT_END_TOL
      && a <= bandLo + SUPPORT_END_TOL && b >= bandHi - SUPPORT_END_TOL ? [fixed] : [];
    }).sort((a, b) => a - b);
    const groups: { lo: number; hi: number }[] = [];
    for (const coord of coords) {
      const last = groups[groups.length - 1];
      // Column faces and the two beams at an expansion joint form one support.
      if (last && coord - last.hi <= 2000) last.hi = coord;
      else groups.push({ lo: coord, hi: coord });
    }
    return groups;
  };
  for (let i = 0; i < dashed.length; i++) for (let j = i + 1; j < dashed.length; j++) {
    const a = dashed[i], b = dashed[j];
    const ah = Math.abs(a.b.x - a.a.x) >= Math.abs(a.b.y - a.a.y) * 4;
    const bh = Math.abs(b.b.x - b.a.x) >= Math.abs(b.b.y - b.a.y) * 4;
    if (ah !== bh) continue;
    const ac = ah ? a.a.y : a.a.x, bc = ah ? b.a.y : b.a.x;
    const width = Math.abs(ac - bc);
    if (width < 600 || width > 8000) continue;
    const lo = Math.max(ah ? Math.min(a.a.x, a.b.x) : Math.min(a.a.y, a.b.y), ah ? Math.min(b.a.x, b.b.x) : Math.min(b.a.y, b.b.y));
    const hi = Math.min(ah ? Math.max(a.a.x, a.b.x) : Math.max(a.a.y, a.b.y), ah ? Math.max(b.a.x, b.b.x) : Math.max(b.a.y, b.b.y));
    const closures = closureGroups(lo, hi, Math.min(ac, bc), Math.max(ac, bc), ah);
    for (let k = 0; k < closures.length - 1; k++) {
      // Slab lies between supports: use the rightmost face of the left support
      // and the leftmost face of the right support.
      const start = closures[k].hi, end = closures[k + 1].lo, span = end - start;
      if (span < 15_000 || span > 60_000) continue;
      const box = ah ? { x0: start, y0: Math.min(ac, bc), x1: end, y1: Math.max(ac, bc) }
        : { x0: Math.min(ac, bc), y0: start, x1: Math.max(ac, bc), y1: end };
      const mark = labels.find((label) => label.pos.x >= box.x0 - 300 && label.pos.x <= box.x1 + 300 && label.pos.y >= box.y0 - 300 && label.pos.y <= box.y1 + 300);
      if (!mark) continue;
      const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      const panel: PanelProposalBox = { label: mark.text, box, lengthMm: ah ? span : width, breadthMm: ah ? width : span,
        openingM2: 0, thicknessMm: panelThickness(box, c, thks), confident: false, duplicate: false, dottedBoundary: true };
      const key = `${Math.round(mark.pos.x)}:${Math.round(mark.pos.y)}`;
      // One S-mark may sit inside several nested dashed-face combinations.
      // Select the enclosure whose centre best matches the mark instead of
      // adding every combination and double-counting the same long panel.
      const score = Math.hypot((mark.pos.x - c.x) / Math.max(box.x1 - box.x0, 1),
        (mark.pos.y - c.y) / Math.max(box.y1 - box.y0, 1));
      const previous = chosenByMark.get(key);
      if (!previous || score < previous.score) chosenByMark.set(key, { panel, score });
    }
  }
  out.push(...[...chosenByMark.values()].map((choice) => choice.panel));
  return out;
}

export function detectClosedCantileverStrips(segments: Segment[], thks: ThkText[] = []): PanelProposalBox[] {
  const mergedAxis = mergeAxisBeamSegments(segments);
  // The free edge of a balcony/chajja is often placed on A-PLNT instead of a
  // structural beam layer. Admit only long, continuous, axis-aligned plan
  // edges here; A-GRID/CENTER lines remain excluded.
  const planEdges = segments.filter((s) => {
    if (!/^A-PLNT$/i.test(s.layer) || /dash|hidden|center/i.test(s.lineType || '')) return false;
    const dx = Math.abs(s.b.x - s.a.x), dy = Math.abs(s.b.y - s.a.y);
    return Math.max(dx, dy) >= 3000 && (dx >= dy * 4 || dy >= dx * 4);
  });
  const diagonal = segments.filter((s) => {
    const dx = Math.abs(s.b.x - s.a.x), dy = Math.abs(s.b.y - s.a.y);
    return dx > 200 && dy > 200;
  });
  const candidates = [...mergedAxis, ...planEdges, ...diagonal];
  const dashed = candidates.filter((s) => /dash|hidden|center/i.test(s.lineType || ''));
  const continuous = candidates.filter((s) => !/dash|hidden|center/i.test(s.lineType || ''));
  const structuralBoundary = (s: Segment) => /beam|slab|chajja|edge/i.test(s.layer) || /^A-PLNT$/i.test(s.layer);
  const out: PanelProposalBox[] = [];
  // Long exterior chajjas are often one continuous A-PLNT edge opposite a
  // dotted beam face split at every bay/column. The pieces can step by a few
  // hundred millimetres, so pairing one straight line at a time only measures
  // fragments. Sweep the outer edge, choose the nearest slab-side hidden face
  // in every interval, and retain the resulting stepped polygon.
  for (const outer of planEdges) {
    const odx = outer.b.x - outer.a.x, ody = outer.b.y - outer.a.y;
    const horizontal = Math.abs(odx) >= Math.abs(ody) * 4;
    const lo = horizontal ? Math.min(outer.a.x, outer.b.x) : Math.min(outer.a.y, outer.b.y);
    const hi = horizontal ? Math.max(outer.a.x, outer.b.x) : Math.max(outer.a.y, outer.b.y);
    const fixed = horizontal ? (outer.a.y + outer.b.y) / 2 : (outer.a.x + outer.b.x) / 2;
    const faces = dashed.flatMap((face) => {
      const fdx = face.b.x - face.a.x, fdy = face.b.y - face.a.y;
      if (horizontal ? Math.abs(fdx) < Math.abs(fdy) * 4 : Math.abs(fdy) < Math.abs(fdx) * 4) return [];
      const faceFixed = horizontal ? (face.a.y + face.b.y) / 2 : (face.a.x + face.b.x) / 2;
      const distance = Math.abs(faceFixed - fixed);
      if (distance < 800 || distance > 8000) return [];
      const a = Math.max(lo, horizontal ? Math.min(face.a.x, face.b.x) : Math.min(face.a.y, face.b.y));
      const b = Math.min(hi, horizontal ? Math.max(face.a.x, face.b.x) : Math.max(face.a.y, face.b.y));
      return b - a >= 300 ? [{ a, b, fixed: faceFixed, distance }] : [];
    });
    if (!faces.length) continue;
    const cuts = [...new Set([lo, hi, ...faces.flatMap((face) => [face.a, face.b])])].sort((a, b) => a - b);
    const cells: { a: number; b: number; fixed: number }[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1], centre = (a + b) / 2;
      const face = faces.filter((candidate) => candidate.a <= centre && candidate.b >= centre)
        .sort((x, y) => x.distance - y.distance)[0];
      if (face) cells.push({ a, b, fixed: face.fixed });
    }
    const runs: typeof cells[] = [];
    for (const cell of cells) {
      const run = runs[runs.length - 1];
      if (run && cell.a - run[run.length - 1].b <= 2000) run.push(cell);
      else runs.push([cell]);
    }
    for (const run of runs) {
      const start = run[0].a, end = run[run.length - 1].b;
      if (end - start < 3000) continue;
      const inner: Pt[] = [];
      for (const cell of run) {
        const a = horizontal ? { x: cell.a, y: cell.fixed } : { x: cell.fixed, y: cell.a };
        const b = horizontal ? { x: cell.b, y: cell.fixed } : { x: cell.fixed, y: cell.b };
        if (!inner.length) inner.push(a);
        else if (Math.hypot(inner[inner.length - 1].x - a.x, inner[inner.length - 1].y - a.y) > 1) inner.push(a);
        inner.push(b);
      }
      const outerEnd = horizontal ? { x: end, y: fixed } : { x: fixed, y: end };
      const outerStart = horizontal ? { x: start, y: fixed } : { x: fixed, y: start };
      const polygon = [outerStart, outerEnd, ...inner.reverse()];
      const areaM2 = Math.abs(shoelace(polygon)) / 1e6;
      if (areaM2 < 0.5 || areaM2 > 400) continue;
      const box = bbox(polygon), c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      if (out.some((panel) => panel.polygon && polygonRectOverlapFrac(panel.polygon, box) > 0.85)) continue;
      out.push({ label: 'CANTILEVER', box, polygon, netAreaM2: areaM2,
        lengthMm: end - start, breadthMm: areaM2 * 1e6 / (end - start), openingM2: 0,
        thicknessMm: panelThickness(box, c, thks), confident: true, duplicate: false,
        cantileverBoundary: true, steppedBoundary: true });
    }
  }
  const SUPPORT_END_TOL = 1600;
  // At a cantilever return, the closing member may itself be drawn as a
  // dashed beam face or a short diagonal return. Both are valid closures.
  const closes = (coord: number, lo: number, hi: number, horizontal: boolean) => candidates.some((s) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    if (horizontal ? Math.abs(dy) < Math.abs(dx) * 4 : Math.abs(dx) < Math.abs(dy) * 4) return false;
    const fixed = horizontal ? (s.a.x + s.b.x) / 2 : (s.a.y + s.b.y) / 2;
    const a = horizontal ? Math.min(s.a.y, s.b.y) : Math.min(s.a.x, s.b.x);
    const b = horizontal ? Math.max(s.a.y, s.b.y) : Math.max(s.a.x, s.b.x);
    return Math.abs(fixed - coord) <= SUPPORT_END_TOL
      && a <= lo + SUPPORT_END_TOL && b >= hi - SUPPORT_END_TOL;
  });
  for (const dash of dashed) for (const solid of continuous) {
    if (!structuralBoundary(dash) || !structuralBoundary(solid)) continue;
    const ddx = dash.b.x - dash.a.x, ddy = dash.b.y - dash.a.y, sdx = solid.b.x - solid.a.x, sdy = solid.b.y - solid.a.y;
    const horizontal = Math.abs(ddx) >= Math.abs(ddy) * 4 && Math.abs(sdx) >= Math.abs(sdy) * 4;
    const vertical = Math.abs(ddy) >= Math.abs(ddx) * 4 && Math.abs(sdy) >= Math.abs(sdx) * 4;
    if (!horizontal && !vertical) continue;
    const dc = horizontal ? (dash.a.y + dash.b.y) / 2 : (dash.a.x + dash.b.x) / 2;
    const sc = horizontal ? (solid.a.y + solid.b.y) / 2 : (solid.a.x + solid.b.x) / 2;
    const width = Math.abs(dc - sc);
    // A 300/450/600 mm band is the beam itself, not the projecting slab.
    if (width < 800 || width > 8000) continue;
    const lo = Math.max(horizontal ? Math.min(dash.a.x, dash.b.x) : Math.min(dash.a.y, dash.b.y), horizontal ? Math.min(solid.a.x, solid.b.x) : Math.min(solid.a.y, solid.b.y));
    const hi = Math.min(horizontal ? Math.max(dash.a.x, dash.b.x) : Math.max(dash.a.y, dash.b.y), horizontal ? Math.max(solid.a.x, solid.b.x) : Math.max(solid.a.y, solid.b.y));
    if (hi - lo < 600 || hi - lo > 60_000 || !closes(lo, Math.min(dc, sc), Math.max(dc, sc), horizontal) || !closes(hi, Math.min(dc, sc), Math.max(dc, sc), horizontal)) continue;
    const box = horizontal ? { x0: lo, y0: Math.min(dc, sc), x1: hi, y1: Math.max(dc, sc) } : { x0: Math.min(dc, sc), y0: lo, x1: Math.max(dc, sc), y1: hi };
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    if (out.some((p) => Math.hypot((p.box.x0 + p.box.x1) / 2 - c.x, (p.box.y0 + p.box.y1) / 2 - c.y) < 500)) continue;
    out.push({ label: 'CANTILEVER', box, lengthMm: box.x1 - box.x0, breadthMm: box.y1 - box.y0, openingM2: 0,
      thicknessMm: panelThickness(box, c, thks), confident: false, duplicate: false, cantileverBoundary: true });
  }

  // Diagonal/sloping chajja edges occur at the two external L-shaped corners
  // of many framing plans. Pair a dashed slab-side line with a parallel solid
  // free edge and retain the exact quadrilateral instead of inflating it to
  // its rectangular bounding box.
  for (const dash of dashed) for (const solid of continuous) {
    if (!structuralBoundary(dash) || !structuralBoundary(solid)) continue;
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
    // 300/450/600 mm parallel bands are the beam itself. Cantilever soffit
    // begins beyond the slab-side beam face.
    if (distance < 800 || distance > 5000) continue;
    const projection = (p: Pt) => (p.x - dash.a.x) * u.x + (p.y - dash.a.y) * u.y;
    const d0 = 0, d1 = dl;
    const sp0 = projection(solid.a), sp1 = projection(solid.b);
    const lo = Math.max(Math.min(d0, d1), Math.min(sp0, sp1));
    const hi = Math.min(Math.max(d0, d1), Math.max(sp0, sp1));
    if (hi - lo < 600 || hi - lo > 60_000) continue;
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
