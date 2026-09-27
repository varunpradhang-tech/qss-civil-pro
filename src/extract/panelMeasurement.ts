import type { DimensionRef, NormalizedDwg } from '../domain/types.js';
import type { PanelProposalBox } from './panels.js';

type Box = PanelProposalBox['box'];

function associatedDimension(dwg: NormalizedDwg, box: Box, dir: 'H' | 'V'): DimensionRef | undefined {
  const lo = dir === 'H' ? box.x0 : box.y0;
  const hi = dir === 'H' ? box.x1 : box.y1;
  const crossLo = dir === 'H' ? box.y0 : box.x0;
  const crossHi = dir === 'H' ? box.y1 : box.x1;
  const span = Math.max(hi - lo, 1);
  const otherSpan = Math.max(crossHi - crossLo, 1);
  const crossTolerance = Math.max(600, Math.min(span, otherSpan) * 0.3);
  return dwg.dimensions.filter((dimension) => dimension.dir === dir
    && dimension.measurement >= 200 && dimension.measurement <= 60_000)
    .map((dimension) => {
      const p1 = dir === 'H' ? dimension.p1.x : dimension.p1.y;
      const p2 = dir === 'H' ? dimension.p2.x : dimension.p2.y;
      const d0 = Math.min(p1, p2), d1 = Math.max(p1, p2);
      const covered = Math.max(0, Math.min(hi, d1) - Math.max(lo, d0)) / span;
      const cross = dir === 'H' ? dimension.mid.y : dimension.mid.x;
      const crossDistance = cross < crossLo ? crossLo - cross : cross > crossHi ? cross - crossHi : 0;
      const endpointError = (Math.abs(d0 - lo) + Math.abs(d1 - hi)) / span;
      const geometricError = Math.abs((d1 - d0) - span) / span;
      return { dimension, covered, crossDistance,
        score: endpointError + geometricError + crossDistance / crossTolerance };
    }).filter((candidate) => candidate.covered >= 0.65
      && candidate.crossDistance <= crossTolerance && candidate.score <= 1.1)
    .sort((a, b) => a.score - b.score)[0]?.dimension;
}

/** Apply the same dimension-first rule to every panel, whether the panel was
 * explicitly marked or found automatically. Dimensions associate per panel;
 * therefore marked and unmarked panels may safely coexist on one drawing. */
export function applyPanelMeasurementPriority(dwg: NormalizedDwg, panels: PanelProposalBox[]): PanelProposalBox[] {
  return panels.map((panel) => {
    if (panel.markedBoundary && panel.dimensionBounded) return panel;
    const width = panel.box.x1 - panel.box.x0, height = panel.box.y1 - panel.box.y0;
    if (width <= 0 || height <= 0) return panel;
    const horizontal = associatedDimension(dwg, panel.box, 'H');
    const vertical = associatedDimension(dwg, panel.box, 'V');
    if (!horizontal && !vertical) return { ...panel,
      measurementBasis: panel.polygon || panel.polygonParts?.length ? 'exact polygon' : 'drawing geometry' };
    const lengthMm = horizontal?.measurement || panel.lengthMm;
    const breadthMm = vertical?.measurement || panel.breadthMm;
    let netAreaM2 = panel.netAreaM2;
    // Never average arbitrary sides. Exact irregular area is calibrated only
    // along axes backed by associated overall dimensions.
    if (netAreaM2 != null && (panel.polygon || panel.polygonParts?.length)) {
      const sx = horizontal ? lengthMm / width : 1;
      const sy = vertical ? breadthMm / height : 1;
      netAreaM2 *= sx * sy;
    }
    return { ...panel, lengthMm, breadthMm, netAreaM2,
      dimensionBounded: true, confident: panel.confident || (!!horizontal && !!vertical),
      measurementBasis: 'marked dimensions' };
  });
}
