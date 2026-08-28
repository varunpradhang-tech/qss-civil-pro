import { describe, expect, it } from 'vitest';
import { autoProposePanels, detectClosedCantileverStrips, detectLongDottedSlabStrips, markDuplicates } from '../src/extract/panels.js';
import { extractMembers } from '../src/extract/extractMembers.js';
import type { NormalizedDwg } from '../src/domain/types.js';

const drawing = (): NormalizedDwg => ({
  fileName: 'unmarked-framing-plan.dwg', units: 4, unitScaleToMm: 1,
  layers: [], entityCountsByType: {}, dimensions: [], polylines: [], hatches: [],
  extents: { min: { x: 0, y: 0 }, max: { x: 4000, y: 3000 } },
  segments: [
    { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
    { layer: 'RCC WALL', a: { x: 0, y: 3000 }, b: { x: 4000, y: 3000 } },
    { layer: 'COLUMN', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 } },
    { layer: 'RCC WALL', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
  ],
  texts: [{ layer: 'SLABS NO T2', text: 'S1A', pos: { x: 2000, y: 1500 } }],
});

describe('unmarked slab geometry', () => {
  it('measures an unlabelled closed panel bounded on every side by dotted beam faces', () => {
    const dotted = drawing();
    dotted.texts = [];
    dotted.segments = [
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 3000 }, b: { x: 0, y: 3000 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 3000 }, b: { x: 0, y: 0 } },
    ];
    expect(autoProposePanels(dotted)).toMatchObject([{
      label: 'S1', lengthMm: 4000, breadthMm: 3000, dottedBoundary: true,
    }]);
  });

  it('measures an S-labelled closed dotted right triangle as length times breadth divided by two', () => {
    const triangle = drawing();
    triangle.texts = [{ layer: 'SLABS NO', text: 'S1', pos: { x: 2800, y: 1800 } }];
    triangle.segments = [
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 3000 }, b: { x: 0, y: 0 } },
    ];
    const [panel] = autoProposePanels(triangle);
    expect(panel.polygon).toHaveLength(3);
    expect(panel).toMatchObject({ label: 'S1', lengthMm: 4000, breadthMm: 3000, netAreaM2: 6 });
  });


  it('removes a smaller nested S proposal and retains the complete slab panel', () => {
    const panels = [
      { label: 'S1', box: { x0: 0, y0: 3000, x1: 4820, y1: 4000 }, lengthMm: 4820, breadthMm: 1000, openingM2: 0, thicknessMm: 150, confident: true, duplicate: false },
      { label: 'S1', box: { x0: 0, y0: 0, x1: 4820, y1: 4000 }, lengthMm: 4820, breadthMm: 4000, openingM2: 0, thicknessMm: 150, confident: true, duplicate: false },
    ];
    markDuplicates(panels);
    expect(panels[0].duplicate).toBe(true);
    expect(panels[1].duplicate).toBe(false);
  });

  it('measures a panel enclosed by mixed RCC member types without dimensions', () => {
    const [panel] = autoProposePanels(drawing());
    expect(panel).toMatchObject({ label: 'S1A', lengthMm: 4000, breadthMm: 3000, confident: true });
    const [member] = extractMembers(drawing(), 'slab');
    expect(member).toMatchObject({ length: 4, breadth: 3, needsReview: false });
  });

  it('uses the final closing edge of a closed structural polyline', () => {
    const closed = drawing();
    closed.segments = [];
    closed.polylines = [{ layer: 'RCC SLAB EDGE', closed: true,
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] }];
    expect(autoProposePanels(closed)).toContainEqual(expect.objectContaining({
      label: 'S1A', box: { x0: 0, y0: 0, x1: 4000, y1: 3000 },
    }));
  });

  it('selects the sheet with slab labels and RCC geometry instead of a dimension-heavy schedule', () => {
    const schedule = { ...drawing(), fileName: 'schedule.dwg', segments: [], texts: [], dimensions: Array.from({ length: 20 }, (_, i) => ({ layer: 'TABLE', measurement: 1000, dir: 'H' as const, mid: { x: i, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 } })) };
    expect(extractMembers([schedule, drawing()], 'slab')).toHaveLength(1);
  });

  it('reads slab thickness by slab mark from a separately drawn schedule', () => {
    const schedule = { ...drawing(), fileName: 'schedule.dwg', segments: [], dimensions: [], texts: [
      { layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } },
      { layer: 'BRAM NO.', text: 'S1A', pos: { x: 1000, y: 3000 } },
      { layer: 'BRAM NO.', text: '150', pos: { x: 2000, y: 3000 } },
    ] };
    const [member] = extractMembers([drawing(), schedule], 'slab');
    expect(member).toMatchObject({ height: 0.15, slabThickness: 0.15, needsReview: false });
  });

  it('uses the UNO general-note thickness only when the slab mark has no schedule row', () => {
    const notes = { ...drawing(), fileName: 'general-notes.dwg', segments: [], texts: [
      { layer: 'NOTES', text: 'ALL SLAB THICKNESS SHALL BE 160 mm THK. (U.N.O.)', pos: { x: 0, y: 0 } },
    ] };
    const [member] = extractMembers([drawing(), notes], 'slab');
    expect(member).toMatchObject({ height: 0.16, slabThickness: 0.16, needsReview: false });
  });

  it('prefers a slab schedule row over the UNO general-note default', () => {
    const references = { ...drawing(), fileName: 'references.dwg', segments: [], texts: [
      { layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } },
      { layer: 'BRAM NO.', text: 'S1A', pos: { x: 1000, y: 3000 } },
      { layer: 'BRAM NO.', text: '150', pos: { x: 2000, y: 3000 } },
      { layer: 'NOTES', text: 'ALL SLAB THICKNESS SHALL BE 175 mm THK. (U.N.O.)', pos: { x: 0, y: -5000 } },
    ] };
    expect(extractMembers([drawing(), references], 'slab')[0].height).toBe(0.15);
  });

  it('accepts a slab code on a numeric consultant layer when enclosed by RCC geometry', () => {
    const numericLayer = { ...drawing(), texts: [{ layer: '4', text: 'S1', pos: { x: 2000, y: 1500 } }] };
    expect(autoProposePanels(numericLayer)).toMatchObject([{ label: 'S1', lengthMm: 4000, breadthMm: 3000 }]);
    expect(extractMembers(numericLayer, 'slab')).toHaveLength(1);
  });

  it('rejects an impossible panel span instead of producing an extreme quantity', () => {
    const huge = drawing();
    huge.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 100000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 100000 }, b: { x: 100000, y: 100000 } },
      { layer: 'WALL', a: { x: 0, y: 0 }, b: { x: 0, y: 100000 } },
      { layer: 'WALL', a: { x: 100000, y: 0 }, b: { x: 100000, y: 100000 } },
    ];
    huge.texts = [{ layer: '4', text: 'S1', pos: { x: 50000, y: 50000 } }];
    expect(autoProposePanels(huge)).toHaveLength(0);
  });

  it('excludes a panel containing a HOLD or HOLD AREA note', () => {
    const held = { ...drawing(), texts: [...drawing().texts, { layer: 'NOTES', text: 'HOLD AREA', pos: { x: 2500, y: 1800 } }] };
    expect(autoProposePanels(held)).toHaveLength(0);
    expect(extractMembers(held, 'slab')).toHaveLength(0);
  });

  it('excludes S rows below a slab reinforcement schedule title', () => {
    const schedule = drawing();
    schedule.texts = [{ layer: 'TEXT', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } }, { layer: 'BRAM NO.', text: 'S1', pos: { x: 2000, y: 1500 } }];
    expect(autoProposePanels(schedule)).toHaveLength(0);
  });

  it('excludes S marks in consultant section details', () => {
    const section = drawing();
    section.texts = [{ layer: 'TEXT', text: 'SECTION:-10-10', pos: { x: 2000, y: -500 } }, { layer: '4', text: 'S1', pos: { x: 2000, y: 1500 } }];
    expect(autoProposePanels(section)).toHaveLength(0);
  });

  it('adds a closed cantilever without changing normal S-panel boundaries', () => {
    const cantilever = drawing();
    cantilever.texts = [];
    cantilever.segments = [
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } },
      { layer: 'BEAM', lineType: 'DASHED', a: { x: 0, y: 1500 }, b: { x: 6000, y: 1500 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: 1500 } },
      { layer: 'EDGE', lineType: 'CONTINUOUS', a: { x: 6000, y: 0 }, b: { x: 6000, y: 1500 } },
    ];
    expect(autoProposePanels(cantilever)).toMatchObject([{ label: 'CANTILEVER', lengthMm: 6000, breadthMm: 1500 }]);
  });

  it('recovers an S-marked corridor bay with one free edge from marked dimensions', () => {
    const corridor = drawing();
    corridor.segments = corridor.segments.filter((segment) => segment.layer !== 'RCC WALL' || segment.a.y !== 3000);
    corridor.dimensions = [
      { layer: 'SLABS NO T2', measurement: 4000, dir: 'H', mid: { x: 2000, y: 1500 }, p1: { x: 0, y: 1500 }, p2: { x: 4000, y: 1500 } },
      { layer: 'SLABS NO T2', measurement: 3000, dir: 'V', mid: { x: 2000, y: 1500 }, p1: { x: 2000, y: 0 }, p2: { x: 2000, y: 3000 } },
    ];
    expect(autoProposePanels(corridor)).toMatchObject([{ label: 'S1A', lengthMm: 4000, breadthMm: 3000, confident: false }]);
  });

  it('steps past the two faces of one beam when a corridor S mark sits on that beam', () => {
    const corridor = drawing();
    corridor.texts = [{ layer: '4', text: 'S1', pos: { x: 2000, y: 100 } }];
    corridor.segments = [
      { layer: '1-BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: '1-BEAM', a: { x: 0, y: 200 }, b: { x: 4000, y: 200 } },
      { layer: '1-BEAM', a: { x: 0, y: 1000 }, b: { x: 4000, y: 1000 } },
      { layer: '1-BEAM', a: { x: 0, y: 0 }, b: { x: 0, y: 1000 } },
      { layer: '1-BEAM', a: { x: 4000, y: 0 }, b: { x: 4000, y: 1000 } },
    ];
    expect(autoProposePanels(corridor)).toMatchObject([{ label: 'S1', lengthMm: 4000, breadthMm: 1000, confident: false }]);
  });

  it('keeps the exact area of a sloping cantilever between hidden and solid beam faces', () => {
    const panels = detectClosedCantileverStrips([
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 1200 }, b: { x: 4000, y: 5200 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 4000, y: 4000 } },
    ]);
    expect(panels).toHaveLength(1);
    expect(panels[0].polygon).toHaveLength(4);
    expect(panels[0].netAreaM2).toBeCloseTo(4.08, 3);
  });

  it('polygonises a C-marked tapered band from its dotted inner and continuous outer edges', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TEXT', text: 'C', pos: { x: 2000, y: -700 } }];
    plan.segments = [
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'A-PLNT', lineType: 'CONTINUOUS', a: { x: 0, y: -1000 }, b: { x: 4000, y: -2000 } },
      { layer: 'A-PLNT', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: -1000 } },
      { layer: 'A-PLNT', lineType: 'CONTINUOUS', a: { x: 4000, y: 0 }, b: { x: 4000, y: -2000 } },
    ];
    const panel = autoProposePanels(plan).find((candidate) => candidate.label === 'CANTILEVER');
    expect(panel?.polygon).toHaveLength(4);
    expect(panel?.netAreaM2).toBeCloseTo(6, 3);
    expect(panel?.inferredSlabCode).toBe('S1');
  });

  it('recovers an otherwise unmeasured S-coded triangle closed by mixed structural faces', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'SLABS NO', text: 'S1', pos: { x: 3000, y: 800 } }];
    plan.segments = [
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'RCC WALL', lineType: 'CONTINUOUS', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 4000, y: 3000 }, b: { x: 0, y: 0 } },
    ];
    const panel = autoProposePanels(plan)[0];
    expect(panel?.closedStructuralBoundary).toBe(true);
    expect(panel?.polygon).toHaveLength(3);
    expect(panel?.netAreaM2).toBeCloseTo(6, 3);
  });

  it('does not retain an inferred polygon inside an established S-coded panel', () => {
    const plan = drawing();
    plan.segments.push(
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 200, y: 200 }, b: { x: 2800, y: 2800 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 900, y: 200 }, b: { x: 3500, y: 2800 } },
    );
    const panels = autoProposePanels(plan);
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ label: 'S1A', box: { x0: 0, y0: 0, x1: 4000, y1: 3000 } });
  });

  it('joins a stepped dotted beam face into one exterior cantilever band', () => {
    const panels = detectClosedCantileverStrips([
      { layer: 'A-PLNT', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 12000, y: 0 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 2200 }, b: { x: 4000, y: 2200 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 2400 }, b: { x: 8000, y: 2400 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 8000, y: 2300 }, b: { x: 12000, y: 2300 } },
    ]);
    const band = panels.find((panel) => panel.steppedBoundary);
    expect(band?.polygon?.length).toBeGreaterThan(4);
    expect(band?.lengthMm).toBe(12000);
    expect(band?.netAreaM2).toBeCloseTo(27.6, 3);
  });

  it('keeps one structurally verified measurement for a 40 m dotted-beam corridor', () => {
    const corridor = drawing();
    corridor.extents.max.x = 40000;
    corridor.texts = [{ layer: '4', text: 'S1', pos: { x: 20000, y: 2000 } }];
    corridor.segments = [
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 40000, y: 0 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 4000 }, b: { x: 40000, y: 4000 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: 4000 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 40000, y: 0 }, b: { x: 40000, y: 4000 } },
    ];
    const direct = detectLongDottedSlabStrips(corridor.segments, [{ text: 'S1', pos: { x: 20000, y: 2000 } }]);
    expect(direct).toMatchObject([{ lengthMm: 40000, breadthMm: 4000, dottedBoundary: true }]);
    expect(autoProposePanels(corridor)).toMatchObject([{ lengthMm: 40000, breadthMm: 4000, dottedBoundary: true }]);
    expect(autoProposePanels(corridor)).toHaveLength(1);
  });

  it('uses slab-facing beam faces at expansion-joint supports', () => {
    const segments = [
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 40900, y: 0 } },
      { layer: '1-BEAM', lineType: 'HIDDEN', a: { x: 0, y: 4000 }, b: { x: 40900, y: 4000 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: 4000 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 450, y: 0 }, b: { x: 450, y: 4000 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 40450, y: 0 }, b: { x: 40450, y: 4000 } },
      { layer: '1-BEAM', lineType: 'CONTINUOUS', a: { x: 40900, y: 0 }, b: { x: 40900, y: 4000 } },
    ];
    expect(detectLongDottedSlabStrips(segments, [{ text: 'S1', pos: { x: 20000, y: 2000 } }]))
      .toMatchObject([{ lengthMm: 40000, breadthMm: 4000 }]);
  });

  it('does not deduct an opening that lies outside every panel', () => {
    const outside = drawing();
    outside.polylines = [{ layer: 'OPENING', closed: true, pts: [
      { x: 5000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 0 },
    ] }];
    expect(autoProposePanels(outside)[0].openingM2).toBe(0);
  });

  it('does not deduct an opening below the 0.40 square metre IS threshold', () => {
    const small = drawing();
    small.polylines = [{ layer: 'OPENING', closed: true, pts: [
      { x: 500, y: 500 }, { x: 1000, y: 500 }, { x: 1000, y: 1000 }, { x: 500, y: 1000 }, { x: 500, y: 500 },
    ] }];
    expect(autoProposePanels(small)[0].openingM2).toBe(0);
  });

  it('recognises an unmarked hatch when the same hatch is confirmed by an S-marked panel', () => {
    const hatched = drawing();
    hatched.extents.max.x = 41000;
    hatched.segments.push(
      { layer: 'BEAM', a: { x: 5000, y: 0 }, b: { x: 41000, y: 0 } },
      { layer: 'BEAM', a: { x: 5000, y: 3000 }, b: { x: 41000, y: 3000 } },
      { layer: 'BEAM', a: { x: 5000, y: 0 }, b: { x: 5000, y: 3000 } },
      { layer: 'BEAM', a: { x: 41000, y: 0 }, b: { x: 41000, y: 3000 } },
    );
    hatched.hatches = [
      { layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG', patternScale: 700,
        pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
      { layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG', patternScale: 1500,
        pts: [{ x: 5000, y: 0 }, { x: 41000, y: 0 }, { x: 41000, y: 3000 }, { x: 5000, y: 3000 }] },
    ];
    const panels = autoProposePanels(hatched);
    expect(panels).toHaveLength(2);
    expect(panels.some((panel) => panel.label === 'HATCH-SLAB' && panel.lengthMm === 36000 && panel.breadthMm === 3000)).toBe(true);
  });

  it('retains the exact polygon and area of an irregular matching slab hatch', () => {
    const hatched = drawing();
    hatched.texts = [{ layer: 'SLABS NO', text: 'S1', pos: { x: 1000, y: 1000 } }];
    hatched.hatches = [
      { layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG', pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 0, y: 2000 }] },
      { layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG', pts: [{ x: 5000, y: 0 }, { x: 9000, y: 0 }, { x: 8500, y: 2000 }, { x: 5000, y: 3000 }] },
    ];
    const irregular = autoProposePanels(hatched).find((panel) => panel.label === 'HATCH-SLAB');
    expect(irregular?.polygon).toHaveLength(4);
    expect(irregular?.netAreaM2).toBeCloseTo(9.25, 3);
  });

  it('does not let an internal irregular hatch reshape a bounded S-labelled rectangle', () => {
    const hatched = drawing();
    hatched.hatches = [{ layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG',
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }] }];
    const panel = autoProposePanels(hatched).find((candidate) => candidate.label === 'S1');
    expect(panel?.polygon).toBeUndefined();
    expect(panel).toMatchObject({ lengthMm: 4000, breadthMm: 3000 });
  });

  it('does not deduct a rectangular opening that only touches an irregular panel bounding box', () => {
    const hatched = drawing();
    hatched.hatches = [{ layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG',
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }] }];
    hatched.polylines = [{ layer: 'OPENING', closed: true,
      pts: [{ x: 3300, y: 2300 }, { x: 3900, y: 2300 }, { x: 3900, y: 2900 }, { x: 3300, y: 2900 }] }];
    const panel = autoProposePanels(hatched).find((candidate) => candidate.label === 'S1');
    expect(panel?.openingM2).toBe(0);
  });

  it('deducts one rectangular U-outline once and ignores decorative open geometry on the same shaft layer', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'SLAB NO', text: 'S1', pos: { x: 2000, y: 1500 } }];
    plan.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: 'BEAM', a: { x: 4000, y: 3000 }, b: { x: 0, y: 3000 } },
      { layer: 'BEAM', a: { x: 0, y: 3000 }, b: { x: 0, y: 0 } },
    ];
    plan.polylines = [
      { layer: 'PL-SHAFT', closed: false, pts: [
        { x: 1000, y: 500 }, { x: 1400, y: 500 }, { x: 1400, y: 1950 },
        { x: 1000, y: 1950 }, { x: 1000, y: 1950 },
      ] },
      { layer: 'PL-SHAFT', closed: false, pts: Array.from({ length: 12 }, (_, i) => ({ x: 2500 + i * 30, y: 1000 + (i % 2) * 100 })) },
    ];
    expect(autoProposePanels(plan)[0].openingM2).toBeCloseTo(0.58, 3);
  });

  it('ignores grid lines and cutout outlines when finding gross panel boundaries', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'SLAB NO', text: 'S1', pos: { x: 2410, y: 2000 } }];
    plan.segments = [
      { layer: 'BEAM', a: { x: 0, y: 0 }, b: { x: 4820, y: 0 } },
      { layer: 'BEAM', a: { x: 4820, y: 0 }, b: { x: 4820, y: 4000 } },
      { layer: 'BEAM', a: { x: 4820, y: 4000 }, b: { x: 0, y: 4000 } },
      { layer: 'BEAM', a: { x: 0, y: 4000 }, b: { x: 0, y: 0 } },
      // These cross the bay but are not structural slab faces.
      { layer: 'COLUMN GRID', a: { x: -1000, y: 2850 }, b: { x: 6000, y: 2850 } },
      { layer: 'CUTOUT', a: { x: 1000, y: 1000 }, b: { x: 3800, y: 1000 } },
    ];
    expect(autoProposePanels(plan)[0]).toMatchObject({ lengthMm: 4820, breadthMm: 4000 });
  });

  it('uses associated dimension endpoints for a rectangular C-marked cantilever fragmented by a grid', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TEXT', text: 'C', pos: { x: 1000, y: 3000 } }];
    plan.segments = [
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 2475, y: 0 }, b: { x: 2475, y: 8400 } },
      { layer: 'EDGE', a: { x: 0, y: 0 }, b: { x: 0, y: 8400 } },
      { layer: 'EDGE', a: { x: 0, y: 0 }, b: { x: 2475, y: 0 } },
      { layer: 'EDGE', a: { x: 0, y: 8400 }, b: { x: 2475, y: 8400 } },
      { layer: 'BEAM', a: { x: 0, y: 1150 }, b: { x: 2475, y: 1150 } },
    ];
    plan.dimensions = [
      { layer: 'ELE', measurement: 2475, dir: 'H', mid: { x: 1237.5, y: 100 }, p1: { x: 0, y: 100 }, p2: { x: 2475, y: 100 } },
      { layer: 'GRIDDIM', measurement: 8400, dir: 'V', mid: { x: -100, y: 4200 }, p1: { x: -100, y: 0 }, p2: { x: -100, y: 8400 } },
    ];
    expect(autoProposePanels(plan)).toContainEqual(expect.objectContaining({
      label: 'CANTILEVER', lengthMm: 2475, breadthMm: 8400, netAreaM2: 20.79,
    }));
  });

  it('keeps a true rectangular hatch as a normal length by breadth panel', () => {
    const hatched = drawing();
    hatched.texts = [];
    hatched.hatches = [
      { layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG', pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
      { layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG', pts: [{ x: 5000, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 3000 }, { x: 5000, y: 3000 }] },
    ];
    // Confirm the hatch signature with an S mark in the first bay, but retain
    // the second unmarked rectangle as an ordinary dimensional panel.
    hatched.texts = [{ layer: 'SLABS NO', text: 'S1', pos: { x: 1000, y: 1000 } }];
    const panel = autoProposePanels(hatched).find((candidate) => candidate.label === 'HATCH-SLAB');
    expect(panel?.polygon).toBeUndefined();
    expect(panel?.netAreaM2).toBeUndefined();
    expect(panel).toMatchObject({ lengthMm: 4000, breadthMm: 3000 });
  });

});
