// Spike 8 — beam-bay reconstruction via rectilinear cell + edge-coverage test.
import { readFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const ASSETS = new URL('../assets/', import.meta.url);
const FILE = 'GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg';
const libredwg = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const db = libredwg.convert(libredwg.dwg_read_data(new Uint8Array(readFileSync(new URL(FILE, ASSETS))), Dwg_File_Type.DWG));
const ents = db.entities || [];
const r2 = (n) => Math.round(n * 100) / 100;

const beams = ents.filter((e) => e.type === 'LINE' && /^beam$/i.test((e.layer || '').trim()))
  .map((b) => ({ s: b.startPoint, e: b.endPoint })).filter((b) => b.s && b.e);
const TOL = 120; // mm clustering tolerance

// vertical beams -> grid X lines (x, list of covered [ylo,yhi]); horizontal -> grid Y lines
const vSeg = [], hSeg = [];
for (const b of beams) {
  const dx = Math.abs(b.s.x - b.e.x), dy = Math.abs(b.s.y - b.e.y);
  if (dy > dx) vSeg.push({ x: (b.s.x + b.e.x) / 2, lo: Math.min(b.s.y, b.e.y), hi: Math.max(b.s.y, b.e.y) });
  else hSeg.push({ y: (b.s.y + b.e.y) / 2, lo: Math.min(b.s.x, b.e.x), hi: Math.max(b.s.x, b.e.x) });
}
const cluster = (segs, key) => {
  segs.sort((a, b) => a[key] - b[key]);
  const lines = [];
  for (const s of segs) {
    let L = lines[lines.length - 1];
    if (!L || Math.abs(s[key] - L.coord) > TOL) { L = { coord: s[key], iv: [] }; lines.push(L); }
    L.iv.push([s.lo, s.hi]);
  }
  return lines;
};
const gx = cluster(vSeg, 'x'), gy = cluster(hSeg, 'y');
console.log(`grid lines: X=${gx.length} (from ${vSeg.length} vert beams)  Y=${gy.length} (from ${hSeg.length} horiz beams)`);

// coverage fraction of [a,b] by union of intervals
const cover = (ivs, a, b) => {
  const span = b - a; if (span <= 0) return 0;
  const rel = ivs.map(([lo, hi]) => [Math.max(lo, a), Math.min(hi, b)]).filter(([lo, hi]) => hi > lo)
    .sort((p, q) => p[0] - q[0]);
  let covered = 0, cur = -Infinity;
  for (const [lo, hi] of rel) { const s = Math.max(lo, cur); if (hi > s) covered += hi - Math.max(s, lo <= cur ? cur : lo); cur = Math.max(cur, hi); }
  // simpler robust merge:
  covered = 0; cur = -Infinity; let start = null;
  const merged = []; for (const [lo, hi] of rel) { if (lo > cur) { if (start !== null) merged.push([start, cur]); start = lo; cur = hi; } else cur = Math.max(cur, hi); }
  if (start !== null) merged.push([start, cur]);
  for (const [lo, hi] of merged) covered += hi - lo;
  return covered / span;
};
const Xc = gx.map((l) => l.coord), Yc = gy.map((l) => l.coord);

for (const THRESH of [0.5, 0.6, 0.7, 0.8]) {
  let bays = 0, area = 0;
  for (let i = 0; i < Xc.length - 1; i++) for (let j = 0; j < Yc.length - 1; j++) {
    const x0 = Xc[i], x1 = Xc[i + 1], y0 = Yc[j], y1 = Yc[j + 1];
    const w = x1 - x0, h = y1 - y0; if (w < 400 || h < 400) continue; // skip slivers
    const left = cover(gx[i].iv, y0, y1), right = cover(gx[i + 1].iv, y0, y1);
    const bot = cover(gy[j].iv, x0, x1), top = cover(gy[j + 1].iv, x0, x1);
    const sides = [left, right, bot, top].filter((c) => c >= THRESH).length;
    if (sides >= 4) { bays++; area += (w * h) / 1e6; }
  }
  console.log(`thresh ${THRESH}: bays=${bays}  centerline area=${r2(area)} m²   Δ vs610.9=${r2((area-610.9)/610.9*100)}%  Δ vs645.78=${r2((area-645.78)/645.78*100)}%`);
}
