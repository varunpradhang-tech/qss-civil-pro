// Spike pass 2 — focus on the slab-dimension sheet.
// Goal: can we recover slab panel geometry / area near ~610.9 sqm?
import { readFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const ASSETS = new URL('../assets/', import.meta.url);
const FILE = 'GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg';
const WASM = './node_modules/@mlightcad/libredwg-web/wasm/';

const libredwg = await LibreDwg.create(WASM);
const bytes = new Uint8Array(readFileSync(new URL(FILE, ASSETS)));
const dwg = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
const db = libredwg.convert(dwg);

const ents = db.entities || [];

// 1) Which layers carry the meaningful geometry? Count entities per layer, ignore xref junk.
const perLayer = {};
for (const e of ents) {
  const L = e.layer || '?';
  perLayer[L] = perLayer[L] || { total: 0 };
  perLayer[L].total++;
  perLayer[L][e.type] = (perLayer[L][e.type] || 0) + 1;
}
const realLayers = Object.entries(perLayer)
  .filter(([n]) => !n.startsWith('XA_') && !n.includes('$'))
  .sort((a, b) => b[1].total - a[1].total)
  .slice(0, 25);
console.log('=== Top real layers (name -> counts) ===');
for (const [n, c] of realLayers) console.log(`  ${n}  ->`, JSON.stringify(c));

// 2) Look at LWPOLYLINEs: how many closed, and their areas (shoelace). Group by layer.
const shoelace = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};
const plines = ents.filter((e) => e.type === 'LWPOLYLINE');
const closedByLayer = {};
for (const p of plines) {
  const pts = p.vertices || p.points || [];
  if (pts.length < 3) continue;
  const closed = p.closed === true || p.flag === 1 || p.isClosed === true;
  const areaMm2 = shoelace(pts);
  if (areaMm2 <= 0) continue;
  const L = p.layer || '?';
  closedByLayer[L] = closedByLayer[L] || { n: 0, closed: 0, areaM2: 0 };
  closedByLayer[L].n++;
  if (closed) closedByLayer[L].closed++;
  closedByLayer[L].areaM2 += areaMm2 / 1e6; // mm^2 -> m^2
}
console.log('\n=== LWPOLYLINE area by layer (m^2, all polylines treated as regions) ===');
Object.entries(closedByLayer)
  .filter(([n]) => !n.startsWith('XA_') && !n.includes('$'))
  .sort((a, b) => b[1].areaM2 - a[1].areaM2)
  .slice(0, 20)
  .forEach(([n, c]) => console.log(`  ${n}: polys=${c.n} closed=${c.closed} totalArea=${Math.round(c.areaM2 * 100) / 100} m2`));

// 3) Inspect one dimension entity fully to understand available geometry for L/B pairing.
const dims = ents.filter((e) => e.type === 'DIMENSION');
console.log('\n=== One DIMENSION entity (full keys) ===');
console.log(Object.keys(dims[0] || {}).join(', '));
console.log(JSON.stringify(dims[0], (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 1));

// 4) Slab-layer dims specifically
const slabDims = dims.filter((d) => /slab/i.test(d.layer || ''));
console.log(`\n=== Slab-layer DIMENSION count: ${slabDims.length} ===`);
const vals = slabDims.map((d) => Math.round(d.measurement)).sort((a, b) => a - b);
console.log('values (mm):', vals.join(', '));
