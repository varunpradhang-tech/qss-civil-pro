// Spike 5 — label-anchored dim pairing → slab soffit total, compared to ~610.9 m².
import { readFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const ASSETS = new URL('../assets/', import.meta.url);
const FILE = 'GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg';
const libredwg = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const db = libredwg.convert(libredwg.dwg_read_data(new Uint8Array(readFileSync(new URL(FILE, ASSETS))), Dwg_File_Type.DWG));
const ents = db.entities || [];
const r2 = (n) => Math.round(n * 100) / 100;

const labels = ents
  .filter((e) => e.type === 'TEXT' && /^slab no$/i.test((e.layer || '').trim()))
  .map((t) => { const p = t.insertionPoint || t.startPoint; return { s: (t.text || '').trim(), x: p.x, y: p.y }; });

const dims = ents.filter((e) => e.type === 'DIMENSION' && /slabs no/i.test(e.layer || ''))
  .map((d) => {
    const p1 = d.subDefinitionPoint1, p2 = d.subDefinitionPoint2;
    const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
    return { m: d.measurement, dir: dx > dy ? 'H' : 'V',
      mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2,
      x1: Math.min(p1.x, p2.x), x2: Math.max(p1.x, p2.x), y1: Math.min(p1.y, p2.y), y2: Math.max(p1.y, p2.y) };
  });
const H = dims.filter((d) => d.dir === 'H'), V = dims.filter((d) => d.dir === 'V');

// For a label, length = H dim bracketing lx with nearest dim-line (|my-ly|);
// breadth = V dim bracketing ly with nearest dim-line (|mx-lx|).
const pick = (cands, inBracket, dist) => {
  const br = cands.filter(inBracket);
  const pool = br.length ? br : cands;
  return pool.reduce((best, c) => (dist(c) < dist(best) ? c : best), pool[0]);
};

let total = 0; const rows = []; let unpaired = 0;
for (const L of labels) {
  const len = pick(H, (d) => L.x >= d.x1 - 50 && L.x <= d.x2 + 50, (d) => Math.abs(d.my - L.y));
  const brd = pick(V, (d) => L.y >= d.y1 - 50 && L.y <= d.y2 + 50, (d) => Math.abs(d.mx - L.x));
  if (!len || !brd) { unpaired++; continue; }
  const area = (len.m * brd.m) / 1e6;
  total += area;
  rows.push({ s: L.s, L: r2(len.m / 1000), B: r2(brd.m / 1000), A: r2(area) });
}

rows.sort((a, b) => b.A - a.A);
console.log('paired panels:', rows.length, ' unpaired:', unpaired);
console.log('first 12:', JSON.stringify(rows.slice(0, 12), null, 0));
console.log('\nGROSS soffit total  =', r2(total), 'm²');
console.log('target (true)       = 610.9 m²   ref tool = 645.78 m²');
console.log('Δ vs true           =', r2((total - 610.9) / 610.9 * 100), '%');
