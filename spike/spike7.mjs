// Spike 7 — can BEAM lines form a grid of bays (= slab panels)?
import { readFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const ASSETS = new URL('../assets/', import.meta.url);
const FILE = 'GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg';
const libredwg = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const db = libredwg.convert(libredwg.dwg_read_data(new Uint8Array(readFileSync(new URL(FILE, ASSETS))), Dwg_File_Type.DWG));
const ents = db.entities || [];
const r = (n) => Math.round(n);

const beams = ents.filter((e) => e.type === 'LINE' && /^beam$/i.test((e.layer || '').trim()));
let horiz = 0, vert = 0, diag = 0, tot = 0;
let lens = [];
for (const b of beams) {
  const s = b.startPoint, e = b.endPoint; if (!s || !e) continue;
  const dx = Math.abs(s.x - e.x), dy = Math.abs(s.y - e.y);
  const len = Math.hypot(dx, dy); lens.push(len); tot += len;
  if (dx > dy * 10) horiz++; else if (dy > dx * 10) vert++; else diag++;
}
lens.sort((a, b) => a - b);
console.log(`BEAM lines: ${beams.length}  horizontal:${horiz} vertical:${vert} diagonal:${diag}`);
console.log('beam line length range (mm):', r(lens[0]), '..', r(lens[lens.length - 1]), ' median:', r(lens[Math.floor(lens.length/2)]));
console.log('total beam line length (m):', r(tot / 1000));
// Also check S-Grid presence in this file
const grid = ents.filter((e) => /grid/i.test(e.layer || ''));
const gridLayers = [...new Set(grid.map((e) => e.layer))];
console.log('\ngrid-ish layers present:', gridLayers.join(' | ') || '(none in model space)');
console.log('grid entities:', grid.length, ' types:', JSON.stringify(grid.reduce((a,e)=>{a[e.type]=(a[e.type]||0)+1;return a;},{})));
