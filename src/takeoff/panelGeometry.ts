import type { Pt } from '../domain/types.js';
import type { MemberRow } from './rules.js';

function area(points: Pt[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Return exact geometry only when a member is genuinely irregular.
 * This downstream guard also repairs older saved rows that retained a mildly
 * skewed four-point visual boundary after being measured as a rectangle.
 */
export function irregularPanelPolygon(member: MemberRow): Pt[] | undefined {
  const polygon = member.cadPolygon as Pt[] | undefined;
  if (!polygon?.length || polygon.length < 3) return undefined;
  if (polygon.length !== 4) return polygon;

  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const boxArea = width * height;
  const nearOrthogonal = polygon.every((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const dx = Math.abs(next.x - point.x), dy = Math.abs(next.y - point.y);
    return Math.min(dx, dy) <= Math.max(80, Math.max(dx, dy) * 0.07);
  });
  if (boxArea > 0 && nearOrthogonal && area(polygon) / boxArea >= 0.9) return undefined;
  return polygon;
}

/** Every visible outline belonging to one area-only quantity row. */
export function irregularPanelPolygons(member: MemberRow): Pt[][] {
  if (member.cadPolygonParts?.length) return member.cadPolygonParts
    .filter((part) => part.length >= 3) as Pt[][];
  const single = irregularPanelPolygon(member);
  return single ? [single] : [];
}
