// QSS Spike — Milestone 0
// Prove libredwg-web can parse the real DWGs in Node and expose
// layers, entity-type counts, DIMENSION measurement values, units, extents.
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const ASSETS = new URL('../assets/', import.meta.url);
const WASM = './node_modules/@mlightcad/libredwg-web/wasm/';

const files = readdirSync(ASSETS).filter((f) => f.toLowerCase().endsWith('.dwg'));

const libredwg = await LibreDwg.create(WASM);

const short = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);

for (const file of files) {
  console.log('\n' + '='.repeat(70));
  console.log('FILE:', file);
  console.log('='.repeat(70));
  const buf = readFileSync(new URL(file, ASSETS));
  const bytes = new Uint8Array(buf);

  let db;
  const t0 = performance.now();
  try {
    const dwg = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
    db = libredwg.convert(dwg);
    libredwg.dwg_free(dwg);
  } catch (e) {
    console.log('  PARSE FAILED:', e && e.message ? e.message : e);
    continue;
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`  parse+convert: ${ms} ms`);

  // Header: units + extents
  const h = db.header || {};
  console.log('  INSUNITS:', h.INSUNITS, ' (6=m, 4=mm, 5=cm, 1=in, 2=ft)');
  console.log('  EXTMIN:', h.EXTMIN, ' EXTMAX:', h.EXTMAX);

  // Layers
  const layers = (db.tables?.LAYER?.entries || []).map((l) => l.name);
  console.log(`  layers (${layers.length}):`, layers.slice(0, 40).join(', '));

  // Entity counts by type
  const ents = db.entities || [];
  const byType = {};
  for (const e of ents) byType[e.type] = (byType[e.type] || 0) + 1;
  console.log(`  entities: ${ents.length}`);
  console.log('  by type:', JSON.stringify(byType, null, 0));

  // Dimensions: measurement values
  const dims = ents.filter((e) => String(e.type).toUpperCase().includes('DIMENSION'));
  const withVal = dims.filter((d) => typeof d.measurement === 'number');
  console.log(`  DIMENSION entities: ${dims.length}  (with numeric measurement: ${withVal.length})`);
  const sample = withVal.slice(0, 15).map((d) => ({
    type: d.type,
    m: short(d.measurement),
    text: d.text,
    layer: d.layer,
  }));
  console.log('  sample dims:', JSON.stringify(sample, null, 0));

  // Distribution of measurement magnitudes (mm vs m sanity)
  const mags = withVal.map((d) => d.measurement).filter((x) => x > 0).sort((a, b) => a - b);
  if (mags.length) {
    console.log('  measurement range:', short(mags[0]), '..', short(mags[mags.length - 1]),
      ' median:', short(mags[Math.floor(mags.length / 2)]));
  }
}
console.log('\nDONE.');
