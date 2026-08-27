// WU2 — Parsing layer. Wraps @mlightcad/libredwg-web (WASM) and normalizes a DwgDatabase into our
// NormalizedDwg model. Now flattens INSERT/BLOCK references (with affine transforms) so geometry
// nested in blocks — grid lines/bubbles, column outlines — is surfaced. Pure/headless (Node + browser worker).
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import type { DimensionRef, NormalizedDwg, Pt, Segment, TextRef } from '../domain/types.js';

const UNIT_TO_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

let cached: Promise<any> | null = null;
function getLib(wasmPath?: string): Promise<any> {
  if (!cached) cached = LibreDwg.create(wasmPath);
  return cached;
}

// --- 2D affine transform: [a,b,c,d,e,f] maps (x,y) -> (a*x + c*y + e, b*x + d*y + f) ---
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const apply = (m: Mat, p: { x: number; y: number }): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
// compose(A, B): apply B first, then A.
function compose(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

// Strip AutoCAD MTEXT/format control codes: "\pxql;{\W1;E1}" -> "E1".
export function cleanCadText(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/\\[A-Za-z][^\\;{}]*;/g, '') // control words: \pxql; \W1; \fArial|b0|...; \H0.8x;
    .replace(/\\[A-Za-z]/g, ' ') // stray \P \L etc → space
    .replace(/[{}]/g, '')
    .replace(/%%[a-zA-Z]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_FLAT_ENTITIES = 400_000; // guard against pathological block blow-up
const MAX_BLOCK_ENTITIES = 300; // only expand small symbol blocks (columns, grid bubbles), not embedded drawings

// Skip whole-drawing / xref-style embeds; expand only small local symbol blocks.
// These sheets paste entire other drawings in as local blocks (XD_CLUB_FLOOR_PLANS, XB_Tower 8,
// XA-UNIT-*, XR_T3_*). Those must NOT be exploded into the measured region.
function shouldExpandBlock(name: string, entityCount: number, flags: number): boolean {
  if (flags & 4) return false; // xref
  if (entityCount === 0 || entityCount > MAX_BLOCK_ENTITIES) return false;
  if (/^\*/.test(name)) return false; // *Model_Space, *Paper_Space, anonymous
  if (/^A\$C/i.test(name)) return false; // anonymous hatch/assoc blocks
  if (/^X[A-Z]/.test(name)) return false; // XR_/XB_/XD_/XA- drawing/xref embeds
  if (name.includes('$')) return false; // xref-dependent names
  return true;
}

export async function parseDwg(bytes: Uint8Array, fileName: string, opts: { wasmPath?: string } = {}): Promise<NormalizedDwg> {
  const libredwg = await getLib(opts.wasmPath);
  const dwg = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  const db = libredwg.convert(dwg);
  try {
    return normalize(db, fileName);
  } finally {
    libredwg.dwg_free(dwg);
  }
}

export function normalize(db: any, fileName: string): NormalizedDwg {
  const header = db.header || {};
  const units = typeof header.INSUNITS === 'number' ? header.INSUNITS : 4;
  const unitScaleToMm = UNIT_TO_MM[units] ?? 1;
  const layers: string[] = (db.tables?.LAYER?.entries || []).map((l: any) => l.name);
  const layerLineTypes = new Map<string, string>((db.tables?.LAYER?.entries || []).map((l: any) => [l.name, l.lineType || 'CONTINUOUS']));

  // Block name -> { basePoint, entities, expandable } for INSERT expansion.
  const blocks = new Map<string, { base: Pt; entities: any[]; expandable: boolean }>();
  for (const b of db.tables?.BLOCK_RECORD?.entries || []) {
    const entities = b.entities || [];
    blocks.set(b.name, {
      base: { x: b.basePoint?.x || 0, y: b.basePoint?.y || 0 },
      entities,
      expandable: shouldExpandBlock(b.name, entities.length, b.flags || 0),
    });
  }

  const entityCountsByType: Record<string, number> = {};
  const segments: Segment[] = [];
  const dimensions: DimensionRef[] = [];
  const texts: TextRef[] = [];
  const polylines: NormalizedDwg['polylines'] = [];
  const hatches: NormalizedDwg['hatches'] = [];
  let count = 0;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (p: Pt) => {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  };

  const insertMatrix = (e: any, base: Pt): Mat => {
    const ins = e.insertionPoint || { x: 0, y: 0 };
    const sx = e.xScale ?? 1, sy = e.yScale ?? 1;
    const rot = e.rotation ?? 0; // libredwg gives radians
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const T: Mat = [1, 0, 0, 1, ins.x, ins.y];
    const R: Mat = [cos, sin, -sin, cos, 0, 0];
    const S: Mat = [sx, 0, 0, sy, 0, 0];
    const Tb: Mat = [1, 0, 0, 1, -base.x, -base.y];
    return compose(T, compose(R, compose(S, Tb)));
  };

  const bulgedLoop = (vertices: any[], closed: boolean, mat: Mat): Pt[] => {
    const out: Pt[] = [];
    const count = closed ? vertices.length : Math.max(0, vertices.length - 1);
    for (let i = 0; i < count; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const bulge = Number(a.bulge || 0);
      if (!out.length) out.push(apply(mat, a));
      if (Math.abs(bulge) < 1e-8) { out.push(apply(mat, b)); continue; }
      const dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
      if (!chord) continue;
      const theta = 4 * Math.atan(bulge);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const offset = chord * (1 - bulge * bulge) / (4 * bulge);
      const centre = { x: mid.x - dy / chord * offset, y: mid.y + dx / chord * offset };
      const start = Math.atan2(a.y - centre.y, a.x - centre.x);
      const steps = Math.max(4, Math.ceil(Math.abs(theta) / (Math.PI / 24)));
      for (let step = 1; step <= steps; step++) {
        const angle = start + theta * step / steps;
        const radius = Math.hypot(a.x - centre.x, a.y - centre.y);
        out.push(apply(mat, { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) }));
      }
    }
    if (!closed && vertices.length) out.push(apply(mat, vertices[vertices.length - 1]));
    if (closed && out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
    return out;
  };

  const process = (e: any, mat: Mat, depth: number, topLevel: boolean) => {
    if (count > MAX_FLAT_ENTITIES) return;
    if (topLevel) entityCountsByType[e.type] = (entityCountsByType[e.type] || 0) + 1;
    const layer = e.layer || '';
    const lineType = e.lineType && !/^BYLAYER$/i.test(e.lineType) ? e.lineType : (layerLineTypes.get(layer) || 'CONTINUOUS');

    if (e.type === 'INSERT' && depth < 8) {
      const blk = blocks.get(e.name);
      if (!blk || !blk.expandable) return; // skip embedded drawings / xrefs / huge blocks
      const m = compose(mat, insertMatrix(e, blk.base));
      for (const sub of blk.entities) { count++; process(sub, m, depth + 1, false); }
      return;
    }
    if (e.type === 'LINE' && e.startPoint && e.endPoint) {
      const a = apply(mat, e.startPoint), b = apply(mat, e.endPoint);
      segments.push({ a, b, layer, lineType }); grow(a); grow(b);
    } else if (e.type === 'ARC' && e.center && typeof e.radius === 'number') {
      // Preserve curved slab/free edges as short chords. The extractor can
      // then close and measure a curved cantilever instead of losing the arc.
      const start = e.startAngle ?? 0, end = e.endAngle ?? Math.PI * 2;
      let sweep = end - start;
      while (sweep <= 0) sweep += Math.PI * 2;
      const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 24)));
      let previous: Pt | undefined;
      for (let i = 0; i <= steps; i++) {
        const a = start + sweep * i / steps;
        const point = apply(mat, { x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) });
        if (previous) segments.push({ a: previous, b: point, layer, lineType });
        previous = point; grow(point);
      }
    } else if (e.type === 'DIMENSION' && e.subDefinitionPoint1 && e.subDefinitionPoint2) {
      const p1 = apply(mat, e.subDefinitionPoint1), p2 = apply(mat, e.subDefinitionPoint2);
      const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
      const dir: DimensionRef['dir'] = dx > dy * 3 ? 'H' : dy > dx * 3 ? 'V' : 'D';
      dimensions.push({ measurement: e.measurement ?? Math.hypot(dx, dy), p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, dir, layer });
      grow(p1); grow(p2);
    } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
      const p = e.insertionPoint || e.startPoint;
      if (p) { const w = apply(mat, p); texts.push({ text: cleanCadText(e.text), pos: w, layer }); }
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const raw = e.vertices || e.points || [];
      const closed = !!(e.closed || e.isClosed || ((e.flag || 0) & 1));
      const pts: Pt[] = bulgedLoop(raw, closed, mat);
      if (pts.length >= 2) { polylines.push({ pts, closed, layer, lineType }); pts.forEach(grow); }
    } else if (e.type === 'HATCH') {
      const loops: Pt[][] = [];
      for (const path of e.boundaryPaths || []) {
        if (path.vertices?.length >= 3) {
          const loop = bulgedLoop(path.vertices, path.isClosed !== 0, mat);
          if (loop.length >= 3) loops.push(loop);
          continue;
        }
        const loop: Pt[] = [];
        for (const edge of path.edges || []) {
          if (edge.start) loop.push(apply(mat, edge.start));
          else if (edge.center && typeof edge.radius === 'number') {
            const start = edge.startAngle ?? 0, end = edge.endAngle ?? Math.PI * 2;
            let sweep = end - start;
            while (sweep <= 0) sweep += Math.PI * 2;
            const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 24)));
            for (let i = 0; i < steps; i++) {
              const a = start + sweep * i / steps;
              loop.push(apply(mat, { x: edge.center.x + edge.radius * Math.cos(a), y: edge.center.y + edge.radius * Math.sin(a) }));
            }
          }
        }
        if (loop.length >= 3) loops.push(loop);
      }
      const pts: Pt[] = loops[0] || [];
      if (pts.length >= 3) {
        hatches.push({ pts, loops, layer, solid: e.solidFill === 1, pattern: e.patternName || undefined,
          patternScale: typeof e.patternScale === 'number' ? e.patternScale : undefined,
          patternAngle: typeof e.patternAngle === 'number' ? e.patternAngle : undefined });
        pts.forEach(grow);
      }
    }
  };

  for (const e of db.entities || []) { count++; process(e, IDENTITY, 0, true); }

  if (!isFinite(minX)) { minX = minY = maxX = maxY = 0; }
  return {
    fileName, units, unitScaleToMm, layers, entityCountsByType,
    segments, dimensions, texts, polylines, hatches,
    extents: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } },
  };
}
