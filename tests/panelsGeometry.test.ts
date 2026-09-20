import { describe, expect, it } from 'vitest';
import { autoProposePanels, detectClosedCantileverStrips, detectLongDottedSlabStrips, joinBrokenStructuralSegments, markDuplicates, normalizeMirroredPlanPanels, normalizeNearRectangularPanels, notchLargePanelsAtCornerOverlaps } from '../src/extract/panels.js';
import type { PanelProposalBox } from '../src/extract/panels.js';
import { extractMembers, selectGeometrySheet } from '../src/extract/extractMembers.js';
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
  it('uses one interpretation for mirrored top chajjas and mirrored room bays', () => {
    const panels: PanelProposalBox[] = [
      { label: 'UNMARKED SLAB', box: { x0: 0, y0: 9000, x1: 12000, y1: 10557 }, lengthMm: 12000, breadthMm: 1557, openingM2: 0, thicknessMm: 140, confident: false, duplicate: false },
      { label: 'UNMARKED SLAB', box: { x0: 18000, y0: 9300, x1: 30000, y1: 10557 }, lengthMm: 12000, breadthMm: 1257, openingM2: 0, thicknessMm: 140, confident: false, duplicate: false },
      { label: 'UNMARKED SLAB', box: { x0: 6000, y0: 4000, x1: 9065, y1: 7850 }, lengthMm: 3065, breadthMm: 3850, openingM2: 0, thicknessMm: 140, confident: false, duplicate: false },
      { label: 'UNMARKED SLAB', box: { x0: 20650, y0: 4000, x1: 24330, y1: 8450 }, lengthMm: 3680, breadthMm: 4450, openingM2: 0, thicknessMm: 140, confident: false, duplicate: false },
    ];
    normalizeMirroredPlanPanels(panels, 15000, 10557);
    expect(panels[0].breadthMm).toBe(1600);
    expect(panels[1].breadthMm).toBe(1600);
    expect(panels[3].lengthMm).toBe(3065);
    expect(panels[3].breadthMm).toBe(3850);
  });

  it('measures a large corner-notched slab by exact polygon area only', () => {
    const panels: PanelProposalBox[] = [
      { label: 'UNMARKED SLAB', box: { x0: 0, y0: 0, x1: 7400, y1: 4600 }, lengthMm: 7400, breadthMm: 4600, openingM2: 0, thicknessMm: 140, confident: false, duplicate: false },
      { label: 'CANTILEVER', box: { x0: 6800, y0: 3500, x1: 9000, y1: 5000 }, lengthMm: 2200, breadthMm: 1500, openingM2: 0, thicknessMm: 140, confident: false, duplicate: false },
    ];
    notchLargePanelsAtCornerOverlaps(panels);
    expect(panels[0].polygon).toHaveLength(6);
    expect(panels[0].netAreaM2).toBeCloseTo(33.38, 2);
  });
  it('straightens a four-edge visual bay without rectangularising a notched slab', () => {
    const panels = [
      { label: 'UNMARKED SLAB', box: { x0: 0, y0: 0, x1: 4450, y1: 3100 },
        polygon: [{ x: 0, y: 0 }, { x: 4450, y: 0 }, { x: 4450, y: 3100 }, { x: 0, y: 2860 }],
        netAreaM2: 13.261, lengthMm: 4450, breadthMm: 3100, openingM2: 0, thicknessMm: 140,
        confident: false, duplicate: false, visualBoundary: true },
      { label: 'UNMARKED SLAB', box: { x0: 5000, y0: 0, x1: 10000, y1: 5000 },
        polygon: [{ x: 5000, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 5000 },
          { x: 6000, y: 5000 }, { x: 6000, y: 3500 }, { x: 5000, y: 3500 }],
        netAreaM2: 23.5, lengthMm: 5000, breadthMm: 5000, openingM2: 0, thicknessMm: 225,
        confident: false, duplicate: false, visualBoundary: true },
    ];
    normalizeNearRectangularPanels(panels);
    expect(panels[0].netAreaM2).toBeCloseTo(13.795, 3);
    expect(panels[1].polygon).toHaveLength(6);
    expect(panels[1].netAreaM2).toBe(23.5);
  });
  it('joins drawing breaks up to 80 mm but preserves 100-150 mm expansion joints', () => {
    const fragments = [
      { layer: 'RCC WALL', a: { x: 0, y: 0 }, b: { x: 1500, y: 0 } },
      { layer: 'RCC WALL', a: { x: 1580, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'RCC WALL', a: { x: 0, y: 500 }, b: { x: 1500, y: 500 } },
      { layer: 'RCC WALL', a: { x: 1600, y: 500 }, b: { x: 4000, y: 500 } },
      { layer: 'RCC WALL', a: { x: 0, y: 1000 }, b: { x: 1500, y: 1000 } },
      { layer: 'RCC WALL', a: { x: 1650, y: 1000 }, b: { x: 4000, y: 1000 } },
    ];
    const joined = joinBrokenStructuralSegments(fragments);
    expect(joined).toContainEqual(expect.objectContaining({
      a: { x: 0, y: 0 }, b: { x: 4000, y: 0 },
    }));
    expect(joined.some((segment) => segment.a.y === 500 && segment.a.x === 0 && segment.b.x === 4000)).toBe(false);
    expect(joined.some((segment) => segment.a.y === 1000 && segment.a.x === 0 && segment.b.x === 4000)).toBe(false);
  });
  it('uses numeric slab-thickness marks as review-only seeds on a framing plan', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'SHEET-TEXT', text: 'TYPICAL FLOOR FRAMING PLAN', pos: { x: 10000, y: -5000 } }];
    plan.segments = [];
    for (let i = 0; i < 4; i++) {
      const x0 = i * 5000, x1 = x0 + 4000;
      plan.segments.push(
        { layer: 'S-BEAM', a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
        { layer: 'S-BEAM', a: { x: x0, y: 3000 }, b: { x: x1, y: 3000 } },
        { layer: 'S-BEAM', a: { x: x0, y: 0 }, b: { x: x0, y: 3000 } },
        { layer: 'S-BEAM', a: { x: x1, y: 0 }, b: { x: x1, y: 3000 } },
      );
      plan.texts.push({ layer: 'S-slab thk.', text: '150', pos: { x: x0 + 2000, y: 1500 } });
    }
    // An adjacent bay is visibly closed, but three sides are on a generic
    // consultant layer. The shared RCC/beam side corroborates the enclosure.
    plan.segments.push(
      { layer: 'A-WORK', a: { x: 19000, y: 0 }, b: { x: 22000, y: 0 } },
      { layer: 'A-WORK', a: { x: 19000, y: 3000 }, b: { x: 22000, y: 3000 } },
      { layer: 'A-WORK', a: { x: 22000, y: 0 }, b: { x: 22000, y: 3000 } },
    );
    // A section callout in the plan must not erase the marked slab bays.
    plan.texts.push({ layer: 'SHEET-TEXT', text: 'SECTION 1-1', pos: { x: 2000, y: 5000 } });
    const panels = autoProposePanels(plan);
    expect(panels).toHaveLength(5);
    expect(panels).toContainEqual(expect.objectContaining({
      label: 'UNMARKED SLAB', box: { x0: 19000, y0: 0, x1: 22000, y1: 3000 }, visualBoundary: true,
    }));
  });

  it('keeps an adjacent unmarked dotted-beam slab alongside thickness-marked bays', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TITLE', text: 'FRAMING PLAN', pos: { x: 10000, y: -5000 } }];
    plan.segments = [];
    for (let i = 0; i < 4; i++) {
      const x0 = i * 5000, x1 = x0 + 4000;
      plan.segments.push(
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
        { layer: 'BEAM', a: { x: x0, y: 3000 }, b: { x: x1, y: 3000 } },
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x0, y: 3000 } },
        { layer: 'BEAM', a: { x: x1, y: 0 }, b: { x: x1, y: 3000 } },
      );
      plan.texts.push({ layer: 'S-slab thk.', text: '150', pos: { x: x0 + 2000, y: 1500 } });
    }
    const addDottedBay = (x0: number) => {
      const x1 = x0 + 2000;
      plan.segments.push(
        { layer: 'BEAM', lineType: 'HIDDEN', a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
        { layer: 'BEAM', lineType: 'HIDDEN', a: { x: x1, y: 0 }, b: { x: x1, y: 3000 } },
        { layer: 'BEAM', lineType: 'HIDDEN', a: { x: x1, y: 3000 }, b: { x: x0, y: 3000 } },
        { layer: 'BEAM', lineType: 'HIDDEN', a: { x: x0, y: 3000 }, b: { x: x0, y: 0 } },
      );
    };
    addDottedBay(19500);
    addDottedBay(50000); // separate detail must not become a plan slab
    const panels = autoProposePanels(plan);
    expect(panels).toHaveLength(5);
    expect(panels).toContainEqual(expect.objectContaining({
      box: { x0: 19500, y0: 0, x1: 21500, y1: 3000 }, dottedBoundary: true,
    }));
  });

  it('finds an unmarked slab with one dotted beam face and wall/column return faces', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TITLE', text: 'FRAMING PLAN', pos: { x: 10000, y: -5000 } }];
    plan.segments = [];
    for (let i = 0; i < 4; i++) {
      const x0 = i * 5000, x1 = x0 + 4000;
      plan.segments.push(
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
        { layer: 'BEAM', a: { x: x0, y: 3000 }, b: { x: x1, y: 3000 } },
        { layer: 'WALL', a: { x: x0, y: 0 }, b: { x: x0, y: 3000 } },
        { layer: 'COLUMN', a: { x: x1, y: 0 }, b: { x: x1, y: 3000 } },
      );
      plan.texts.push({ layer: 'S-slab thk.', text: '150', pos: { x: x0 + 2000, y: 1500 } });
    }
    plan.segments.push(
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 19500, y: 0 }, b: { x: 21500, y: 0 } },
      { layer: 'WALL', a: { x: 19500, y: 3000 }, b: { x: 21500, y: 3000 } },
      { layer: 'COLUMN', a: { x: 19500, y: 0 }, b: { x: 19500, y: 3000 } },
      { layer: 'WALL', a: { x: 21500, y: 0 }, b: { x: 21500, y: 3000 } },
    );
    expect(autoProposePanels(plan)).toContainEqual(expect.objectContaining({
      box: { x0: 19500, y0: 0, x1: 21500, y1: 3000 }, visualBoundary: true,
      confident: false,
    }));
    // An inset lift X covering 40% of the proposed visual bay is still a
    // void, even though its strokes do not touch the outer beam corners.
    plan.segments.push(
      { layer: 'VOID', a: { x: 19900, y: 500 }, b: { x: 21100, y: 2500 } },
      { layer: 'VOID', a: { x: 19900, y: 2500 }, b: { x: 21100, y: 500 } },
    );
    expect(autoProposePanels(plan).some((panel) => panel.visualBoundary)).toBe(false);
  });

  it('keeps a notched dotted-beam plan bay despite a nearby section heading', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TITLE', text: 'FRAMING PLAN', pos: { x: 10000, y: -5000 } },
      { layer: 'TITLE', text: 'SECTION 3-3', pos: { x: 21000, y: 9000 } }];
    plan.segments = [];
    for (let i = 0; i < 4; i++) {
      const x0 = i * 5000, x1 = x0 + 4000;
      plan.segments.push(
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
        { layer: 'BEAM', a: { x: x0, y: 3000 }, b: { x: x1, y: 3000 } },
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x0, y: 3000 } },
        { layer: 'BEAM', a: { x: x1, y: 0 }, b: { x: x1, y: 3000 } },
      );
      plan.texts.push({ layer: 'S-slab thk.', text: '150', pos: { x: x0 + 2000, y: 1500 } });
    }
    const outline = [{ x: 19500, y: 0 }, { x: 22000, y: 0 }, { x: 22000, y: 500 },
      { x: 24000, y: 500 }, { x: 24000, y: 3000 }, { x: 19500, y: 3000 }];
    for (let i = 0; i < outline.length; i++) plan.segments.push({ layer: 'BEAM', lineType: 'HIDDEN',
      a: outline[i], b: outline[(i + 1) % outline.length] });
    plan.texts.push(
      { layer: 'BEAM NO', text: 'B1', pos: { x: 20500, y: 2700 } },
      { layer: 'BEAM NO', text: 'B2', pos: { x: 20500, y: 300 } },
      { layer: 'BEAM NO', text: 'B30', pos: { x: 19700, y: 1500 } },
      { layer: 'BEAM NO', text: 'B34', pos: { x: 23800, y: 1500 } },
    );
    expect(autoProposePanels(plan)).toContainEqual(expect.objectContaining({
      label: 'UNMARKED SLAB', box: { x0: 19500, y0: 0, x1: 24000, y1: 3000 },
      visualBoundary: true, confident: false, netAreaM2: 12.5,
    }));
  });

  it('visually recovers a mirrored bay when split solid and dotted strokes break its CAD face', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TITLE', text: 'FRAMING PLAN', pos: { x: 10000, y: -5000 } }];
    plan.segments = [];
    for (let i = 0; i < 4; i++) {
      const x0 = i * 5000, x1 = x0 + 4000;
      plan.segments.push(
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
        { layer: 'BEAM', a: { x: x0, y: 3000 }, b: { x: x1, y: 3000 } },
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x0, y: 3000 } },
        { layer: 'BEAM', a: { x: x1, y: 0 }, b: { x: x1, y: 3000 } },
      );
      plan.texts.push({ layer: 'S-slab thk.', text: '150', pos: { x: x0 + 2000, y: 1500 } });
    }
    plan.segments.push(
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 19500, y: 0 }, b: { x: 19500, y: 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 21500, y: 0 }, b: { x: 21500, y: 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 19500, y: 3000 }, b: { x: 21500, y: 3000 } },
      // The visible top is continuous to a human but split across entity types.
      { layer: 'COLUMN', a: { x: 19500, y: 0 }, b: { x: 20500, y: 0 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 20500, y: 0 }, b: { x: 21500, y: 0 } },
    );
    expect(autoProposePanels(plan)).toContainEqual(expect.objectContaining({
      label: 'UNMARKED SLAB', box: { x0: 19500, y0: 0, x1: 21500, y1: 3000 },
      visualBoundary: true, confident: false,
    }));
  });

  it('recovers mirrored unmarked bays between hidden supports and comment-layer plan edges', () => {
    const segments = [
      { layer: 'VIN_BEAM', lineType: 'HIDDEN', a: { x: 1000, y: 7000 }, b: { x: 3500, y: 7000 } },
      { layer: 'A-Comments', lineType: 'CONTINUOUS', a: { x: 1000, y: 500 }, b: { x: 3500, y: 500 } },
      { layer: 'VIN_BEAM', lineType: 'HIDDEN', a: { x: 11500, y: 7000 }, b: { x: 14000, y: 7000 } },
      { layer: 'A-Comments', lineType: 'CONTINUOUS', a: { x: 11500, y: 500 }, b: { x: 14000, y: 500 } },
    ];
    const recovered = detectClosedCantileverStrips(segments);
    expect(recovered.filter((panel) => panel.visualBoundary && panel.closedStructuralBoundary))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'UNMARKED SLAB', box: { x0: 1000, y0: 500, x1: 3500, y1: 7000 } }),
        expect.objectContaining({ label: 'UNMARKED SLAB', box: { x0: 11500, y0: 500, x1: 14000, y1: 7000 } }),
      ]));
  });

  it('follows a thickness-confirmed slab hatch past a beam label into its connected lower loop', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TITLE', text: 'FRAMING PLAN', pos: { x: 10000, y: -5000 } }];
    plan.segments = [];
    for (let i = 0; i < 4; i++) {
      const x0 = i * 5000, x1 = x0 + 4000;
      plan.segments.push(
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x1, y: 0 } },
        { layer: 'BEAM', a: { x: x0, y: 3000 }, b: { x: x1, y: 3000 } },
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x0, y: 3000 } },
        { layer: 'BEAM', a: { x: x1, y: 0 }, b: { x: x1, y: 3000 } },
      );
      plan.texts.push({ layer: 'S-slab thk.', text: i === 3 ? '225' : '150',
        pos: { x: x0 + 2000, y: 1500 } });
    }
    const hatch = (y0: number, y1: number) => ({
      layer: 'SUNK SLAB HATCH', solid: false, pattern: 'EARTH',
      pts: [{ x: 16000, y: y0 }, { x: 18000, y: y0 },
        { x: 18000, y: y1 }, { x: 16000, y: y1 }],
    });
    plan.hatches = [hatch(0, 3000), hatch(-3000, 0)];
    const panels = autoProposePanels(plan);
    expect(panels).toContainEqual(expect.objectContaining({
      label: 'BALCONY CANTILEVER', box: { x0: 16000, y0: -3000, x1: 18000, y1: 0 },
      thicknessMm: 225, hatchConnectedBoundary: true,
    }));
  });

  it('does not turn a broad unmarked three-sided exterior void into a slab', () => {
    const exteriorVoid = drawing();
    exteriorVoid.texts = [
      { layer: 'SLABS', text: 'S1', pos: { x: -2000, y: 2000 } },
      { layer: 'SLABS', text: 'S1', pos: { x: 13550, y: 2000 } },
    ];
    exteriorVoid.segments = [
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 11550, y: 0 } },
      { layer: 'BEAM', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: 19245 } },
      { layer: 'BEAM', lineType: 'CONTINUOUS', a: { x: 11550, y: 0 }, b: { x: 11550, y: 19245 } },
      { layer: 'A-PLNT', lineType: 'CONTINUOUS', a: { x: 0, y: 19245 }, b: { x: 11550, y: 19245 } },
    ];
    const panels = autoProposePanels(exteriorVoid);
    expect(panels.some((panel) => panel.box.x0 === 0 && panel.box.y0 === 0
      && panel.box.x1 === 11550 && panel.box.y1 === 19245)).toBe(false);
  });

  it('does not use a sheet-wide column grid line to close a blank exterior bay', () => {
    const blank = drawing();
    blank.texts = [{ layer: 'SLAB MARK1', text: 'S10', pos: { x: 4500, y: 15000 } }];
    blank.segments = [
      { layer: 'COL-1', a: { x: -100000, y: 0 }, b: { x: 100000, y: 0 } },
      { layer: 'BEAM', a: { x: 0, y: 19245 }, b: { x: 11550, y: 19245 } },
      { layer: 'BEAM', a: { x: 0, y: 10000 }, b: { x: 0, y: 19245 } },
      { layer: 'BEAM', a: { x: 11550, y: 10000 }, b: { x: 11550, y: 19245 } },
    ];
    expect(autoProposePanels(blank)).toHaveLength(0);
  });

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

  it('rejects an unmarked dotted beam bay crossed corner to corner as a void', () => {
    const voidBay = drawing();
    voidBay.texts = [];
    voidBay.segments = [
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 3000 }, b: { x: 0, y: 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: 3000 }, b: { x: 0, y: 0 } },
      { layer: '0', a: { x: 0, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: '0', a: { x: 0, y: 3000 }, b: { x: 4000, y: 0 } },
    ];
    expect(autoProposePanels(voidBay)).toHaveLength(0);
  });

  it('does not reject a slab for a smaller X symbol inside its beam bay', () => {
    const plan = drawing();
    plan.texts = [];
    // An unmarked bay needs the same dotted beam-face evidence as the
    // full-bay-X case above. The generic fixture has solid outer edges and
    // is not a valid unmarked slab even before an X is added.
    plan.segments = plan.segments.map((segment) => ({
      ...segment, layer: '1-BEAM', lineType: 'HIDDEN',
    }));
    plan.segments.push(
      { layer: '0', a: { x: 1000, y: 500 }, b: { x: 3000, y: 2500 } },
      { layer: '0', a: { x: 1000, y: 2500 }, b: { x: 3000, y: 500 } },
    );
    expect(autoProposePanels(plan)).toContainEqual(expect.objectContaining({
      box: { x0: 0, y0: 0, x1: 4000, y1: 3000 },
    }));
  });

  it('joins fragmented dotted beam faces before finding an unlabelled rectangular slab', () => {
    const dotted = drawing();
    dotted.texts = [];
    dotted.segments = [
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 1700, y: 0 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 2200, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: 3000 }, b: { x: 1700, y: 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 2200, y: 3000 }, b: { x: 4000, y: 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: 0 }, b: { x: 0, y: 1200 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: 1700 }, b: { x: 0, y: 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 0 }, b: { x: 4000, y: 1200 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y: 1700 }, b: { x: 4000, y: 3000 } },
    ];
    expect(autoProposePanels(dotted)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'S1', lengthMm: 4000, breadthMm: 3000, dottedBoundary: true }),
    ]));
  });

  it('uses bounded faces instead of exhaustive line pairs on a large unmarked plan', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TITLE', text: 'FRAMING PLAN', pos: { x: 2000, y: -2000 } }];
    plan.segments.push(
      ...Array.from({ length: 205 }, (_, i) => ({ layer: 'BEAM',
        a: { x: 100000, y: 100000 + i * 1000 }, b: { x: 104000, y: 100000 + i * 1000 } })),
      ...Array.from({ length: 205 }, (_, i) => ({ layer: 'BEAM',
        a: { x: 200000 + i * 1000, y: 200000 }, b: { x: 200000 + i * 1000, y: 204000 } })),
    );
    expect(autoProposePanels(plan)).toContainEqual(expect.objectContaining({
      label: 'UNMARKED SLAB', box: { x0: 0, y0: 0, x1: 4000, y1: 3000 },
      confident: false,
    }));
  });

  it('does not turn a section-dominated sheet title into slab geometry', () => {
    const sheet = drawing();
    sheet.texts = [
      { layer: 'TITLE', text: 'TYPICAL FLOOR FRAMING PLAN', pos: { x: 2000, y: -2000 } },
      ...Array.from({ length: 12 }, (_, i) => ({ layer: 'TITLE',
        text: `SECTION ${i + 1}-${i + 1}`, pos: { x: i * 5000, y: 30000 } })),
    ];
    expect(autoProposePanels(sheet)).toHaveLength(0);
  });

  it('retains a real group of unmarked plan bays on a combined section sheet', () => {
    const sheet = drawing();
    sheet.texts = [
      { layer: 'TITLE', text: 'TYPICAL FLOOR FRAMING PLAN', pos: { x: 8000, y: -2000 } },
      ...Array.from({ length: 12 }, (_, i) => ({ layer: 'TITLE',
        text: `SECTION ${i + 1}-${i + 1}`, pos: { x: i * 5000, y: 30000 } })),
    ];
    sheet.segments = Array.from({ length: 4 }, (_, i) => drawing().segments.map((segment) => ({
      ...segment, a: { x: segment.a.x + i * 5000, y: segment.a.y },
      b: { x: segment.b.x + i * 5000, y: segment.b.y },
    }))).flat();
    expect(autoProposePanels(sheet)).toHaveLength(4);
  });

  it('does not measure an unlabelled H-shaped beam-face loop as a slab', () => {
    const plan = drawing();
    plan.texts = [{ layer: 'TITLE', text: 'THIRD FLOOR FRAMING PLAN', pos: { x: 0, y: -2000 } }];
    const polygon = [
      [0, 0], [8250, 0], [8250, 450], [4275, 450],
      [4275, 5550], [3975, 5550], [3975, 450], [0, 450],
    ];
    plan.segments = polygon.map(([x, y], index) => {
      const [nx, ny] = polygon[(index + 1) % polygon.length];
      return { layer: 'BEAM', lineType: 'HIDDEN', a: { x, y }, b: { x: nx, y: ny } };
    });
    expect(autoProposePanels(plan)).toHaveLength(0);
  });

  it('prefers a sparse framing plan over a detail sheet with many closed loops', () => {
    const plan = drawing();
    plan.texts.push({ layer: 'TITLE', text: 'THIRD FLOOR FRAMING PLAN', pos: { x: 0, y: -2000 } });
    const detail = drawing();
    detail.fileName = 'slab-schedule.dwg';
    detail.texts = [{ layer: 'TITLE', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } }];
    detail.segments = Array.from({ length: 15 }, (_, index) => drawing().segments.map((segment) => ({
      ...segment, a: { x: segment.a.x + index * 5000, y: segment.a.y },
      b: { x: segment.b.x + index * 5000, y: segment.b.y },
    }))).flat();
    expect(selectGeometrySheet([detail, plan], 'slab').fileName).toBe(plan.fileName);
  });

  it('recovers a long unmarked exterior slab strip only beside measured bays', () => {
    const plan = drawing();
    plan.texts = Array.from({ length: 5 }, (_, i) => ({
      layer: 'SLABS NO', text: 'S1', pos: { x: 8000 + i * 16000, y: -2800 },
    }));
    plan.segments = [
      { layer: 'BEAM', lineType: 'CONTINUOUS', a: { x: 0, y: 1500 }, b: { x: 80000, y: 1500 } },
      { layer: 'BEAM', lineType: 'CONTINUOUS', a: { x: 0, y: 0 }, b: { x: 0, y: 1500 } },
      { layer: 'BEAM', lineType: 'CONTINUOUS', a: { x: 80000, y: 0 }, b: { x: 80000, y: 1500 } },
      ...Array.from({ length: 5 }, (_, i) => ({ layer: 'BEAM', lineType: 'HIDDEN',
        a: { x: i * 16000, y: 0 }, b: { x: i === 4 ? 80000 : i * 16000 + 15500, y: 0 } })),
      ...Array.from({ length: 5 }, (_, i) => [
        { layer: 'BEAM', a: { x: i * 16000, y: -450 }, b: { x: (i + 1) * 16000, y: -450 } },
        { layer: 'BEAM', a: { x: i * 16000, y: -5000 }, b: { x: (i + 1) * 16000, y: -5000 } },
        { layer: 'BEAM', a: { x: i * 16000, y: -5000 }, b: { x: i * 16000, y: -450 } },
        { layer: 'BEAM', a: { x: (i + 1) * 16000, y: -5000 }, b: { x: (i + 1) * 16000, y: -450 } },
      ]).flat(),
    ];
    expect(autoProposePanels(plan)).toContainEqual(expect.objectContaining({
      label: 'SLAB STRIP', lengthMm: 80000, breadthMm: 1500, confident: false,
    }));
  });

  it('keeps unlabelled dotted plan bays but rejects closed section-detail loops', () => {
    const sheet = drawing();
    sheet.texts = [
      { layer: 'TITLE', text: 'FRAMING PLAN AT THIRD FLOOR LVL.', pos: { x: 2000, y: -2000 } },
      { layer: 'NOTE', text: 'R/F SPACING AS PER SCHEDULE', pos: { x: 2000, y: 1500 } },
      { layer: 'TITLE', text: 'SECTION A-A', pos: { x: 2000, y: 20_000 } },
      { layer: 'SLABS', text: 'S1', pos: { x: 2000, y: 21_500 } },
    ];
    const rectangle = (y: number) => [
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y }, b: { x: 4000, y } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y }, b: { x: 4000, y: y + 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y: y + 3000 }, b: { x: 0, y: y + 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: y + 3000 }, b: { x: 0, y } },
    ];
    sheet.segments = [...rectangle(0), ...rectangle(20_000)];
    const panels = autoProposePanels(sheet).filter((panel) => panel.dottedBoundary);
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ box: { x0: 0, y0: 0, x1: 4000, y1: 3000 } });
  });

  it('keeps a framing bay but rejects a projection detail on the same drawing', () => {
    const sheet = drawing();
    sheet.texts = [
      { layer: 'TITLE', text: 'THIRD FLOOR FRAMING PLAN', pos: { x: 2000, y: -2000 } },
      { layer: 'TITLE', text: 'PROJECTION DETAIL', pos: { x: 2000, y: 20000 } },
    ];
    const rectangle = (y: number) => [
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y }, b: { x: 4000, y } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y }, b: { x: 4000, y: y + 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 4000, y: y + 3000 }, b: { x: 0, y: y + 3000 } },
      { layer: 'BEAM', lineType: 'HIDDEN', a: { x: 0, y: y + 3000 }, b: { x: 0, y } },
    ];
    sheet.segments = [...rectangle(0), ...rectangle(20000)];
    expect(autoProposePanels(sheet).filter((panel) => panel.dottedBoundary)).toMatchObject([
      { box: { x0: 0, y0: 0, x1: 4000, y1: 3000 } },
    ]);
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
    // Geometry is confident, but without a schedule/UNO thickness the app
    // correctly keeps the member in review instead of silently approving a fallback.
    expect(member).toMatchObject({ length: 4, breadth: 3, needsReview: true });
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

  it('prefers verified panel geometry over misleading plan wording on a detail sheet', () => {
    const detail = { ...drawing(), fileName: 'slab-plan-detail.dwg', segments: [], polylines: [], hatches: [], texts: [
      { layer: 'TITLE', text: 'SLAB STRUCTURAL PLAN DETAIL', pos: { x: 0, y: 0 } },
    ] };
    const framing = { ...drawing(), fileName: 'framing-sheet.dwg' };
    expect(selectGeometrySheet([detail, framing], 'slab').fileName).toBe(framing.fileName);
  });

  it('uses a real plan heading on a combined plan and schedule sheet', () => {
    const combined = drawing();
    combined.fileName = 'third-floor-combined-detail.dwg';
    combined.texts.push(
      { layer: 'TITLE', text: 'THIRD FLOOR FRAMING PLAN', pos: { x: 0, y: -2000 } },
      { layer: 'TITLE', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 50000, y: 5000 } },
    );
    const schedule = { ...drawing(), fileName: 'slab-schedule.dwg', segments: [], texts: [
      { layer: 'TITLE', text: 'SLAB REINFORCEMENT SCHEDULE', pos: { x: 0, y: 5000 } },
    ] };
    expect(selectGeometrySheet([schedule, combined], 'slab').fileName).toBe(combined.fileName);
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

  it('reads the consultant note wording FOR ALL SLAB SHALL BE 140MM THK U.N.O.', () => {
    const notes = { ...drawing(), fileName: 'general-notes.dwg', segments: [], texts: [
      { layer: 'NOTES', text: '9. FOR ALL SLAB SHALL BE 140MM THK. U.N.O.', pos: { x: 0, y: 0 } },
    ] };
    const [member] = extractMembers([drawing(), notes], 'slab');
    expect(member).toMatchObject({ height: 0.14, slabThickness: 0.14 });
    expect(member.reviewReason ?? '').not.toContain('using 175 mm fallback');
  });

  it('recovers a wall-enclosed visual bay without using a UNO note as geometry evidence', () => {
    const plan = drawing();
    plan.segments = [
      { layer: 'WALL', a: { x: 2000, y: 0 }, b: { x: 2000, y: 3000 } },
      { layer: 'COLUMN', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } },
      { layer: 'BEAM', a: { x: 2000, y: 0 }, b: { x: 4000, y: 0 } },
      { layer: 'BEAM', a: { x: 2000, y: 3000 }, b: { x: 4000, y: 3000 } },
    ];
    plan.texts = [
      { layer: 'TITLE', text: 'TYPICAL FLOOR FRAMING PLAN', pos: { x: 9000, y: -3000 } },
    ];
    // Seed neighbouring marked bays so this region is established as the
    // framing-plan footprint; the candidate itself has no S-code/number.
    for (let i = 0; i < 4; i++) {
      const x0 = 5000 + i * 2500;
      plan.texts.push({ layer: 'SLAB THK', text: '150', pos: { x: x0 + 1000, y: 1500 } });
      plan.segments.push(
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x0, y: 3000 } },
        { layer: 'BEAM', a: { x: x0 + 2000, y: 0 }, b: { x: x0 + 2000, y: 3000 } },
        { layer: 'BEAM', a: { x: x0, y: 0 }, b: { x: x0 + 2000, y: 0 } },
        { layer: 'BEAM', a: { x: x0, y: 3000 }, b: { x: x0 + 2000, y: 3000 } },
      );
    }
    expect(autoProposePanels(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({ box: { x0: 2000, y0: 0, x1: 4000, y1: 3000 }, visualBoundary: true }),
    ]));
    for (let x = 2200; x <= 3800; x += 300) plan.segments.push({
      layer: 'A-Plan-Stair', a: { x, y: 300 }, b: { x, y: 2700 },
    });
    expect(autoProposePanels(plan).some((panel) => panel.box.x0 === 2000
      && panel.box.y0 === 0 && panel.box.x1 === 4000 && panel.box.y1 === 3000)).toBe(false);
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
    expect(autoProposePanels(corridor)).toMatchObject([{ lengthMm: 40000, breadthMm: 4000 }]);
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

  it('deducts a large unlabelled X-void only when fully contained in an S-coded slab bay', () => {
    const plan = drawing();
    plan.segments.push(
      { layer: '0', a: { x: 1000, y: 500 }, b: { x: 3000, y: 2500 } },
      { layer: '0', a: { x: 1000, y: 2500 }, b: { x: 3000, y: 500 } },
      // A similar cross outside the slab must not become a deduction.
      { layer: '0', a: { x: 5000, y: 500 }, b: { x: 7000, y: 2500 } },
      { layer: '0', a: { x: 5000, y: 2500 }, b: { x: 7000, y: 500 } },
    );
    expect(autoProposePanels(plan)[0].openingM2).toBeCloseTo(4, 3);
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
    const irregularMember = extractMembers(hatched, 'slab').find((member) => member.netArea === 9.25);
    expect(irregularMember).toMatchObject({ length: 0, breadth: 0, netArea: 9.25 });
  });

  it('does not let an internal irregular hatch reshape a bounded S-labelled rectangle', () => {
    const hatched = drawing();
    hatched.hatches = [{ layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG',
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }] }];
    const panel = autoProposePanels(hatched).find((candidate) => candidate.label === 'S1A');
    expect(panel?.polygon).toBeUndefined();
    expect(panel).toMatchObject({ lengthMm: 4000, breadthMm: 3000 });
  });

  it('does not deduct a rectangular opening that only touches an irregular panel bounding box', () => {
    const hatched = drawing();
    hatched.hatches = [{ layer: 'SLAB HATCH', solid: false, pattern: 'TRIANG',
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }] }];
    hatched.polylines = [{ layer: 'OPENING', closed: true,
      pts: [{ x: 3300, y: 2300 }, { x: 3900, y: 2300 }, { x: 3900, y: 2900 }, { x: 3300, y: 2900 }] }];
    const panel = autoProposePanels(hatched).find((candidate) => candidate.label === 'S1A');
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

  it('associates an explicit CUT-layer X void across a narrow beam-width gap', () => {
    const plan = drawing();
    plan.segments.push(
      { layer: 'CUT', a: { x: 4300, y: 500 }, b: { x: 6300, y: 2500 } },
      { layer: 'CUT', a: { x: 4300, y: 2500 }, b: { x: 6300, y: 500 } },
    );
    const panel = autoProposePanels(plan).find((candidate) => candidate.label === 'S1A');
    expect(panel?.openingM2).toBeCloseTo(4, 3);

    const decorative = drawing();
    decorative.segments.push(
      { layer: '0', a: { x: 4300, y: 500 }, b: { x: 6300, y: 2500 } },
      { layer: '0', a: { x: 4300, y: 2500 }, b: { x: 6300, y: 500 } },
    );
    expect(autoProposePanels(decorative)[0].openingM2).toBe(0);
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
