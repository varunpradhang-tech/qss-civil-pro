import type { Pt, Segment } from '../domain/types.js';

export interface CadFace {
  polygon: Pt[];
  areaM2: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

const area2 = (pts: Pt[]) => pts.reduce((sum, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0);

/**
 * Polygonise CAD edges that already meet at beam/wall/column vertices.
 * This deliberately does not invent diagonal cuts or rectangular proxies:
 * every returned face is an actual closed walk in the supplied CAD graph.
 */
export function polygoniseCadFaces(segments: Segment[], snap = 40): CadFace[] {
  type Node = { p: Pt; neighbours: Set<string> };
  const nodes = new Map<string, Node>();
  const keyOf = (p: Pt) => `${Math.round(p.x / snap)}:${Math.round(p.y / snap)}`;
  const addNode = (p: Pt) => {
    const key = keyOf(p);
    let node = nodes.get(key);
    if (!node) { node = { p: { x: p.x, y: p.y }, neighbours: new Set() }; nodes.set(key, node); }
    return { key, node };
  };
  // Split crossing CAD entities first. Consultants frequently draw a long
  // beam face through several transverse members without breaking the LINE
  // entity at every junction; face traversal requires those intersections.
  const source = segments.filter((segment) => Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) >= snap);
  const cuts = source.map(() => [0, 1]);
  if (source.length <= 5000) for (let i = 0; i < source.length; i++) for (let j = i + 1; j < source.length; j++) {
    const a = source[i], b = source[j];
    const minAx = Math.min(a.a.x, a.b.x) - snap, maxAx = Math.max(a.a.x, a.b.x) + snap;
    const minAy = Math.min(a.a.y, a.b.y) - snap, maxAy = Math.max(a.a.y, a.b.y) + snap;
    if (Math.max(b.a.x, b.b.x) < minAx || Math.min(b.a.x, b.b.x) > maxAx
      || Math.max(b.a.y, b.b.y) < minAy || Math.min(b.a.y, b.b.y) > maxAy) continue;
    const rx = a.b.x - a.a.x, ry = a.b.y - a.a.y;
    const sx = b.b.x - b.a.x, sy = b.b.y - b.a.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-6) continue;
    const qx = b.a.x - a.a.x, qy = b.a.y - a.a.y;
    const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) cuts[i].push(t);
    if (u > 1e-6 && u < 1 - 1e-6 && t >= -1e-6 && t <= 1 + 1e-6) cuts[j].push(u);
  }
  const split: Segment[] = [];
  for (let i = 0; i < source.length; i++) {
    const segment = source[i], ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e8) / 1e8))].sort((a, b) => a - b);
    for (let j = 0; j < ts.length - 1; j++) {
      const at = (t: number): Pt => ({ x: segment.a.x + (segment.b.x - segment.a.x) * t, y: segment.a.y + (segment.b.y - segment.a.y) * t });
      split.push({ ...segment, a: at(ts[j]), b: at(ts[j + 1]) });
    }
  }
  for (const segment of split) {
    if (Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) < snap) continue;
    const a = addNode(segment.a), b = addNode(segment.b);
    if (a.key === b.key) continue;
    a.node.neighbours.add(b.key); b.node.neighbours.add(a.key);
  }

  const outgoing = new Map<string, string[]>();
  for (const [key, node] of nodes) outgoing.set(key, [...node.neighbours].sort((a, b) => {
    const pa = nodes.get(a)!.p, pb = nodes.get(b)!.p;
    return Math.atan2(pa.y - node.p.y, pa.x - node.p.x) - Math.atan2(pb.y - node.p.y, pb.x - node.p.x);
  }));

  const visited = new Set<string>();
  const faces: CadFace[] = [];
  const canonical = new Set<string>();
  const directed = (a: string, b: string) => `${a}>${b}`;
  for (const [start, list] of outgoing) for (const next of list) {
    if (visited.has(directed(start, next))) continue;
    const cycle: string[] = [];
    let a = start, b = next;
    for (let guard = 0; guard < 2000; guard++) {
      const edge = directed(a, b);
      if (visited.has(edge)) break;
      visited.add(edge); cycle.push(a);
      const around = outgoing.get(b) || [];
      const reverseIndex = around.indexOf(a);
      if (reverseIndex < 0 || !around.length) break;
      // Previous in CCW order keeps the traversed face on the left.
      const c = around[(reverseIndex - 1 + around.length) % around.length];
      a = b; b = c;
      if (a === start && b === next) {
        if (cycle.length < 3) break;
        const polygon = cycle.map((key) => nodes.get(key)!.p);
        const signed = area2(polygon) / 2;
        if (signed <= 0) break; // discard the unbounded/reverse walk
        const x = polygon.map((p) => p.x), y = polygon.map((p) => p.y);
        const box = { x0: Math.min(...x), y0: Math.min(...y), x1: Math.max(...x), y1: Math.max(...y) };
        const areaM2 = signed / 1e6;
        if (areaM2 < 0.05 || areaM2 > 500 || box.x1 - box.x0 < 200 || box.y1 - box.y0 < 200) break;
        const signature = [...cycle].sort().join('|');
        if (!canonical.has(signature)) { canonical.add(signature); faces.push({ polygon, areaM2, box }); }
        break;
      }
    }
  }
  return faces;
}
