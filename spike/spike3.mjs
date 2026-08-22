// Spike pass 3 — confirm slab dims carry orientation+location for L×B pairing.
import { readFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const ASSETS = new URL('../assets/', import.meta.url);
const FILE = 'GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg';
const libredwg = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const db = libredwg.convert(libredwg.dwg_read_data(new Uint8Array(readFileSync(new URL(FILE, ASSETS))), Dwg_File_Type.DWG));

const dims = (db.entities || []).filter((e) => e.type === 'DIMENSION' && /slabs no/i.test(e.layer || ''));
let horiz = 0, vert = 0, other = 0, withPts = 0;
const r = (n) => Math.round(n);
for (const d of dims) {
  const p1 = d.subDefinitionPoint1, p2 = d.subDefinitionPoint2;
  if (p1 && p2) {
    withPts++;
    const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
    if (dx > dy * 3) horiz++;
    else if (dy > dx * 3) vert++;
    else other++;
  }
}
console.log(`slab dims: ${dims.length}, with endpoint pair: ${withPts}`);
console.log(`orientation -> horizontal(length): ${horiz}, vertical(breadth): ${vert}, diagonal/other: ${other}`);
// Show a few with computed span from endpoints vs reported measurement (should match)
console.log('\nendpoint-span vs reported measurement (first 8):');
for (const d of dims.slice(0, 8)) {
  const p1 = d.subDefinitionPoint1, p2 = d.subDefinitionPoint2;
  if (!p1 || !p2) { console.log('  (no endpoints)'); continue; }
  const span = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  console.log(`  span=${r(span)}mm  measurement=${r(d.measurement)}mm  match=${Math.abs(span - d.measurement) < 2}`);
}
