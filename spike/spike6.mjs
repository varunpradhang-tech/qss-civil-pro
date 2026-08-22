// Spike 6 — refine: drop "overall/chain" dims that span multiple panel labels,
// then pick the tightest bracketing dim per label.
import { readFileSync } from 'node:fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const ASSETS = new URL('../assets/', import.meta.url);
const FILE = 'GPL_SIG3-T3-BAS-ST-300-R1 Slab Dimension.dwg';
const libredwg = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const db = libredwg.convert(libredwg.dwg_read_data(new Uint8Array(readFileSync(new URL(FILE, ASSETS))), Dwg_File_Type.DWG));
const ents = db.entities || [];
const r2 = (n) => Math.round(n * 100) / 100;

const labels = ents.filter((e) => e.type === 'TEXT' && /^slab no$/i.test((e.layer || '').trim()))
  .map((t) => { const p = t.insertionPoint || t.startPoint; return { s: (t.text || '').trim(), x: p.x, y: p.y }; });

const dims = ents.filter((e) => e.type === 'DIMENSION' && /slabs no/i.test(e.layer || ''))
  .map((d) => { const p1 = d.subDefinitionPoint1, p2 = d.subDefinitionPoint2;
    const dx = Math.abs(p1.x - p2.x), dy = Math.abs(p1.y - p2.y);
    return { m: d.measurement, dir: dx > dy ? 'H' : 'V', mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2,
      x1: Math.min(p1.x, p2.x), x2: Math.max(p1.x, p2.x), y1: Math.min(p1.y, p2.y), y2: Math.max(p1.y, p2.y) }; });

// How many label centroids does a dim's span cover along its measuring axis?
const coversH = (d) => labels.filter((L) => L.x >= d.x1 && L.x <= d.x2).length;
const coversV = (d) => labels.filter((L) => L.y >= d.y1 && L.y <= d.y2).length;
// A panel dim should bracket few labels along-axis AND be spatially local.
const H = dims.filter((d) => d.dir === 'H' && coversH(d) <= 3);
const V = dims.filter((d) => d.dir === 'V' && coversV(d) <= 3);
console.log(`H kept ${H.length}/${dims.filter(d=>d.dir==='H').length}  V kept ${V.length}/${dims.filter(d=>d.dir==='V').length}`);

// Pick tightest bracketing dim (smallest measurement) near the label line.
const pick = (cands, inBracket, lineDist) => {
  const br = cands.filter(inBracket).sort((a, b) => (lineDist(a) - lineDist(b)));
  const near = br.slice(0, 4); // among the 4 closest lines, take the smallest span
  if (!near.length) return null;
  return near.reduce((best, c) => (c.m < best.m ? c : best), near[0]);
};

let total = 0; const rows = [];
for (const L of labels) {
  const len = pick(H, (d) => L.x >= d.x1 - 50 && L.x <= d.x2 + 50, (d) => Math.abs(d.my - L.y));
  const brd = pick(V, (d) => L.y >= d.y1 - 50 && L.y <= d.y2 + 50, (d) => Math.abs(d.mx - L.x));
  if (!len || !brd) continue;
  const area = (len.m * brd.m) / 1e6; total += area;
  rows.push({ s: L.s, L: r2(len.m / 1000), B: r2(brd.m / 1000), A: r2(area) });
}
console.log('panels:', rows.length, ' total:', r2(total), 'm²  Δ vs 610.9 =', r2((total - 610.9) / 610.9 * 100), '%');
console.log('largest 8:', JSON.stringify(rows.sort((a, b) => b.A - a.A).slice(0, 8), null, 0));
