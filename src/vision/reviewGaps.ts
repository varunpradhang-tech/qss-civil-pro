import type { NormalizedDwg, Pt } from '../domain/types.js';
import type { PanelProposalBox } from '../extract/panels.js';
import { framingPlanBounds, type PlanBounds } from './renderDwg.js';

function contains(point: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Choose high-resolution AI review crops from uncovered spaces in the
 * framing plan. This discovers possible missing bays; it never adds quantity
 * without a separately checked polygon and CAD-edge evidence. */
export function uncoveredReviewBounds(dwg: NormalizedDwg, panels: PanelProposalBox[], limit = 3): PlanBounds[] {
  const plan = framingPlanBounds(dwg);
  const marks = dwg.texts.filter((text) => /slab\s*(?:thk|thickness|depth)/i.test(text.layer)
    && /^(?:\d{2,3})(?:\s*mm)?$/i.test(text.text.trim()));
  if (marks.length < 4) return [];
  const footprint = { x0: Math.max(plan.x0, Math.min(...marks.map((m) => m.pos.x)) - 3000),
    x1: Math.min(plan.x1, Math.max(...marks.map((m) => m.pos.x)) + 3000),
    y0: Math.max(plan.y0, Math.min(...marks.map((m) => m.pos.y)) - 3000),
    y1: Math.min(plan.y1, Math.max(...marks.map((m) => m.pos.y)) + 3000) };
  const lines = dwg.segments.filter((line) => /beam|wall|col|pardi|rcc/i.test(line.layer)
    && !/text|number|dimension/i.test(line.layer));
  const vertical = lines.filter((line) => Math.abs(line.a.x - line.b.x) <= 100);
  const horizontal = lines.filter((line) => Math.abs(line.a.y - line.b.y) <= 100);
  const covered = (point: Pt) => panels.some((panel) => {
    if (point.x <= panel.box.x0 || point.x >= panel.box.x1 || point.y <= panel.box.y0 || point.y >= panel.box.y1) return false;
    if (panel.polygonParts?.length) return panel.polygonParts.some((polygon) => contains(point, polygon));
    return panel.polygon ? contains(point, panel.polygon) : true;
  });
  const candidates: Array<{ score: number; x: number; y: number }> = [];
  for (let x = footprint.x0 + 1000; x < footprint.x1 - 1000; x += 1200) {
    for (let y = footprint.y0 + 1000; y < footprint.y1 - 1000; y += 1200) {
      const point = { x, y };
      if (covered(point) || dwg.texts.some((text) => /^(?:T\d+)?M?B\d+[A-Z]?$/i.test(text.text.replace(/\s/g, ''))
        && Math.hypot(text.pos.x - x, text.pos.y - y) < 550)) continue;
      const left = vertical.filter((line) => line.a.x < x - 400 && line.a.x > x - 6500
        && Math.min(line.a.y, line.b.y) <= y + 350 && Math.max(line.a.y, line.b.y) >= y - 350)
        .sort((a, b) => b.a.x - a.a.x)[0];
      const right = vertical.filter((line) => line.a.x > x + 400 && line.a.x < x + 6500
        && Math.min(line.a.y, line.b.y) <= y + 350 && Math.max(line.a.y, line.b.y) >= y - 350)
        .sort((a, b) => a.a.x - b.a.x)[0];
      const bottom = horizontal.filter((line) => line.a.y < y - 400 && line.a.y > y - 6500
        && Math.min(line.a.x, line.b.x) <= x + 350 && Math.max(line.a.x, line.b.x) >= x - 350)
        .sort((a, b) => b.a.y - a.a.y)[0];
      const top = horizontal.filter((line) => line.a.y > y + 400 && line.a.y < y + 6500
        && Math.min(line.a.x, line.b.x) <= x + 350 && Math.max(line.a.x, line.b.x) >= x - 350)
        .sort((a, b) => a.a.y - b.a.y)[0];
      const sides = [left, right, bottom, top].filter(Boolean).length;
      if (sides < 3) continue;
      const nearestMark = Math.min(...marks.map((mark) => Math.hypot(mark.pos.x - x, mark.pos.y - y)));
      if (nearestMark > 9000) continue;
      const score = sides * 10 - nearestMark / 1800
        + (left && right ? Math.min(4, (right.a.x - left.a.x) / 2000) : 0)
        + (bottom && top ? Math.min(4, (top.a.y - bottom.a.y) / 2000) : 0);
      candidates.push({ score, x, y });
    }
  }
  const chosen: PlanBounds[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (chosen.length >= limit) break;
    if (chosen.some((box) => Math.hypot((box.x0 + box.x1) / 2 - candidate.x,
      (box.y0 + box.y1) / 2 - candidate.y) < 7000)) continue;
    chosen.push({ x0: Math.max(plan.x0, candidate.x - 5500), y0: Math.max(plan.y0, candidate.y - 5500),
      x1: Math.min(plan.x1, candidate.x + 5500), y1: Math.min(plan.y1, candidate.y + 5500) });
  }
  return chosen;
}
