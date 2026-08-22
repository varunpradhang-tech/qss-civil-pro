// Spike 4 — gather anchors + dims to design the pairing algorithm.
import { readFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const ASSETS = new URL('../assets/', import.meta.url);
const FILE = 'GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg';
const libredwg = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const db = libredwg.convert(libredwg.dwg_read_data(new Uint8Array(readFileSync(new URL(FILE, ASSETS))), Dwg_File_Type.DWG));
const ents = db.entities || [];
const r = (n) => Math.round(n);

// Panel-label candidates on SLAB NO (TEXT)
const labels = ents.filter((e) => e.type === 'TEXT' && /^slab no$/i.test((e.layer || '').trim()));
console.log(`SLAB NO texts: ${labels.length}`);
console.log('sample labels:', JSON.stringify(labels.slice(0, 12).map((t) => ({
  s: t.text, x: r((t.insertionPoint || t.startPoint || {}).x), y: r((t.insertionPoint || t.startPoint || {}).y),
})), null, 0));
// distinct label strings
const strs = [...new Set(labels.map((t) => (t.text || '').trim()))];
console.log('distinct label strings (first 30):', strs.slice(0, 30).join(' | '));

// Also SLAB THK texts (maybe these carry panel thickness like "150")
const thk = ents.filter((e) => e.type === 'TEXT' && /slab thk/i.test(e.layer || ''));
console.log(`\nSLAB THK texts: ${thk.length}  sample:`, thk.slice(0, 10).map((t) => (t.text || '').trim()).join(' | '));

// Dims with midpoint + orientation
const dims = ents.filter((e) => e.type === 'DIMENSION' && /slabs no/i.test(e.layer || ''));
const parsed = dims.map((d) => {
  const p1 = d.subDefinitionPoint1, p2 = d.subDefinitionPoint2;
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
  return { m: d.measurement, mx, my, dir: dx > dy ? 'H' : 'V', x1: Math.min(p1.x, p2.x), x2: Math.max(p1.x, p2.x), y1: Math.min(p1.y, p2.y), y2: Math.max(p1.y, p2.y) };
});
const H = parsed.filter((d) => d.dir === 'H'), V = parsed.filter((d) => d.dir === 'V');
console.log(`\ndims H=${H.length} V=${V.length}`);
console.log('H measurements (mm):', H.map((d) => r(d.m)).sort((a, b) => a - b).join(', '));
console.log('V measurements (mm):', V.map((d) => r(d.m)).sort((a, b) => a - b).join(', '));

// Baselines for tolerance discussion
console.log('\nSUM(H)/1000 =', r(H.reduce((s, d) => s + d.m, 0)) / 1000, 'm');
console.log('SUM(V)/1000 =', r(V.reduce((s, d) => s + d.m, 0)) / 1000, 'm');
