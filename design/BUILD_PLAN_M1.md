# QSS — Milestone 1 Build Plan (slab shuttering slice)

Prereqs resolved: design finalized ([DESIGN_BRIEF](DESIGN_BRIEF.md), [UX_FLOWS](UX_FLOWS.md),
[DESIGN_SYSTEM](DESIGN_SYSTEM.md)); spike GO on data, algorithm scoped ([SPIKE_FINDINGS](../spike/SPIKE_FINDINGS.md)).

## 1. Goal & definition of done
Ship an end-to-end **slab-shuttering** takeoff for **DWG/DXF** files, browser-only:
upload → parse (worker) → layer map → **geometry-first bay detection** → world-coord overlay + member
table with provenance/confidence → edit & review flagged bays → results → export (CSV/MB-xlsx/PDF/JSON).

**Done when:**
- On `ST-300 Slab Dimension.dwg`, the engine proposes bays; after clearing flagged bays, the total is
  **within ±0.5% of 610.9 m²**, and ≥3 hand-traced panels match their drawing dims.
- Every displayed value carries provenance (marked/computed/manual) + confidence; **flagged bays block export**.
- Parse + first render of the real file in-browser completes in a reasonable time (target < ~8 s, measured).

## 2. Architecture (single Vite + React + TS app, layered)
```
src/
  workers/parse.worker.ts      libredwg-web: File → DwgDatabase (off main thread)
  parsing/                     DwgDatabase → normalized model; unit (INSUNITS) resolution
  domain/                      types: Project, Sheet, LayerRole, Bay, DimensionRef, Opening, Takeoff
  geometry/                    ★ face-extraction engine (pure, no React) — the core module
    segments.ts                extract/normalize beam segments; snap/cluster
    arrangement.ts             intersections, split, half-edge graph
    faces.ts                   minimal-cycle face extraction; drop outer/unbounded
    bays.ts                    faces → bays; clear-span (subtract beam widths); attach dims; openings
  takeoff/                     rule engine: member×rule → formula + IS-1200 deductions (slab first)
  state/                       Zustand stores (project, selection, provenance); IndexedDB persistence
  render/                      cad-simple-viewer integration; world-coord overlay layer + hit-testing
  ui/                          screens (Projects, Upload, Parse, LayerMap, Workspace, Results, Export)
  export/                      csv.ts, mb-xlsx.ts, pdf.ts, json.ts
  lib/units.ts                 mm↔m, converter widget
```
`geometry/` and `takeoff/` are **pure and headless** → unit-testable in Node with the real DWG, no browser.

## 3. Data model (core types)
```ts
type Provenance = 'marked' | 'computed' | 'manual';
interface Val { value: number; unit: 'mm'; prov: Provenance; confidence: 'high'|'med'|'low'; source?: string }
interface Bay {                    // a slab panel
  id: string; label?: string;      // e.g. "S6" from SLAB NO
  polygon: Pt[];                   // world coords (mm)
  length: Val; breadth: Val;       // clear spans
  depth?: Val;                     // from SLAB THK text (concrete later)
  openings: { area: Val }[];
  areaM2: number;                  // derived, rounded at display
  needsReview: boolean;            // computed/low-confidence → true
}
interface Sheet { id; fileName; role: 'slab-dim'|'reinforcement'|'other'; block; floor; db: NormalizedDwg }
interface Project { id; name; sheets: Sheet[]; mapping: LayerRoleMap; bays: Bay[]; createdAt; updatedAt }
```

## 4. ★ Marking engine (marking/) — REVISED after WU4 diagnostic
Auto-detection ruled out: beams are 93% dangling, no grid lines, no closed panel polylines
(see SPIKE_FINDINGS). Core is **assisted marking powered by the marked dimensions**.
1. **Dim index**: split marked dims (`SLABS NO T2`) into H (length) and V (breadth) sets with spatial
   extents; index for fast spatial query. Flag "overall/chain" dims (span covers many labels) as low-priority.
2. **Click → panel resolver**: given a click point C in a bay, return the best bracketing H dim (length)
   and V dim (breadth) — nearest local dim-line whose span brackets C — plus ranked alternatives for
   one-click disambiguation. Values are the exact marked measurements (prov='marked').
3. **Snapping**: snap the click / drag to dim endpoints and beam lines (world coords) for precision.
4. **Clear span**: default = the marked dim (already a clear slab dim on this sheet). Where beam widths
   are relevant, subtract ½ beam-width (from `BEAM SIZE` text / default) — provenance/confidence set.
5. **Label**: nearest `SLAB NO` text → panel label (e.g. "S6").
6. **Openings**: user marks (or app detects) opening regions inside a panel → deduct per IS-1200 rule set.
7. **Confidence**: fully-marked + user-confirmed = high; alternatives-ambiguous or beam-derived = flag.

Accuracy contract: because panels use exact marked values and a human confirms pairing, total is
**±0.5% by construction** once all panels are marked. The engine's auto-proposal is a *starting point*,
not the source of truth.

## 5. Test strategy (TDD)
- **Geometry unit tests** (Node): synthetic fixtures — single bay, 2×2 grid, L-shaped, irregular, gap that
  must snap — assert exact face count + areas. Build the engine against these *first*.
- **Real-file integration test** (Node, uses `assets/ST-300…dwg`): assert proposed bays reconstruct total
  within a tolerance band; assert the set of flagged bays is non-empty and, once resolved with the marked
  dims, total ∈ [610.9 ±0.5%]. Encodes the "assisted ±0.5%" contract.
- **Hand-trace fixtures**: 3 panels measured by hand from the drawing → golden per-panel assertions.
- **Rule-engine tests**: slab soffit formula + opening-threshold deduction cases.
- **Export tests**: CSV/MB row counts + totals; JSON round-trip (export→import equality).

## 6. Work units (sequenced; ★ = critical path) — REVISED for assisted marking
- WU1 ✅ Project scaffold (headless): TS + vitest, npmrc→public registry, module layout.
- WU2 ✅ Parsing layer: `parseDwg` → NormalizedDwg (units, layers, segments, dims, texts, polylines).
- WU4 ★ Marking engine (marking/): dim index + click→panel resolver + snapping + label match. TDD.
- WU5 ★ Panel model: clear-span/beam deduction, openings, confidence/flagging, area compute.
- WU6  Takeoff rule engine (slab soffit) + running totals + roll-up.
- WU3  Layer auto-map + confirm (filter junk, role heuristics, confidence).
- WU7 ★ Render + interactive overlay: cad-simple-viewer render; overlay layer with click-to-mark,
   snapping, live panel highlight, selection sync. **The core UX; where 610.9 is validated by real clicks.**
- WU8  Workspace UI: member table, per-panel editor, live recompute, review flow, add/edit/delete panels.
- WU9  Results screen + tolerance/expected compare.
- WU10 Exports: CSV, MB xlsx, PDF (annotated), JSON.
- WU11 Persistence (IndexedDB autosave) + Projects screen; JSON import.
- WU12 End-to-end validation: real user marks the slab → total vs 610.9 ±0.5%; perf pass; polish.

**Current slice:** WU1 ✅ WU2 ✅ → WU4 (marking engine + tests) → then WU7 (render+overlay UI), where
accuracy is validated by actually marking the drawing. Note: full 610.9 validation is now a UI-level
(human-in-loop) test, not a pure-headless one.

## 7. Risks & mitigations
| Risk | Mitigation |
|------|-----------|
| Face extraction robustness on messy CAD | Snap tolerance + prune; extensive fixture suite; flag unclosed faces (never silently drop) |
| Beam width unknown → clear-span off | Parse `BEAM SIZE`; project default; mark computed + flag for review |
| Can't fully auto-hit ±0.5% | By design: human confirms flagged bays; ±0.5% is the *post-review* contract |
| In-browser perf on 9–11 MB files | Parse in worker; render only mapped layers; measure in WU1 |
| GPL-3.0 (libredwg) for closed-source | Decision deferred; isolate parser behind `parsing/` interface so it can be swapped |

## 8. Acceptance (M1 exit)
Real file → assisted takeoff → total within ±0.5% of 610.9 after review · 3 hand-traced panels pass ·
provenance+flagging enforced · all four exports produce valid output · autosave/reload works.
