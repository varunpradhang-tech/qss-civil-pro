# QSS — Design Brief (source of truth)

Civil quantity-survey takeoff app. Persona: civil / QS engineer. Updated with Milestone-0 spike findings.

## Product thesis
The incumbent (QSS Pro) over-measures — reports **645.78 m²** vs the true **~610.9 m²** (~5.7% high),
because it measures grid centre-to-centre and misses opening deductions. **Our edge is correctness:**
true clear spans (beams excluded) + IS-1200 opening deductions, validated to **±0.5%**.

## Resolved decisions
1. **Dimension source** — hybrid, accuracy-first: **explicit marked dim → computed from geometry/scale → manual override.**
2. **Pipeline** — browser-only; `@mlightcad/libredwg-web` (WASM, Web Worker) parse; `@mlightcad/cad-simple-viewer` (THREE.js) render.
3. **Scope** — end goal = everything (slab/beam/column/wall × shuttering/concrete) via a **rule engine**; **v1 = slab shuttering** first.
4. **Detection** — *Spike revision (spikes 4–7):* grid lines are **absent** in these files (`S-Grid` empty in model space) and floating-dim pairing is unreliable (naive = 710 m², 16% high). Correct core = **beam-bay reconstruction**: planar face extraction from the 122 orthogonal `BEAM` segments → each face = a slab bay; marked dims supply precise edge lengths + validation; openings deducted. Human review for flagged bays.
5. **Layer mapping** — auto-detect roles + user confirm; filter ~1,100 junk xref layers. Company profiles → M2.
6. **Clear span** — explicit clear dim → grid c/c − ½(beam A + beam B) from geometry → manual adjust.
7. **Deductions** — auto-detect openings + configurable, **versioned IS-1200 rule set** + override.
8. **Units/scale** — auto from DWG `$INSUNITS` (spike: **mm** confirmed); manual click-calibration for image/PDF; display m/sqm + converter widget.
9. **Overlay** — world-coordinate panels inside the viewer scene; click ⇄ table; live edits.
10. **Structure** — Project → Block → Floor → Member. *Spike revision:* add **sheet-role** (files are sheet types, not floors: 300=slab dims, 600/700=reinforcement).
11. **Outputs** — CSV · Excel Measurement Book · PDF report (annotated) · JSON project export/import.
12. **Persistence** — client-side (IndexedDB) now, **backend-ready** architecture; no accounts in v1.
13. **Stack** — React + TS + Vite + Zustand.
14. **Accuracy** — ground truth = **total ~610.9 m² only** (no per-panel breakdown); validate at total level ±0.5%; hand-trace 2–3 panels as spot-check.
15. **Confidence gate** — provenance (marked/computed/manual) + confidence on every value; **flagged panels block export.**
16. **Sequencing** — spike ✅ → slab slice → generalize. Input: **DWG/DXF only in v1**; image/PDF later.

## UX (see UX_FLOWS.md)
Guided steps (Upload›Parse›Map›Review›Results) with a **Workspace-centric** model; **member table = right sidebar**;
**minimal settings** (sane IS-1200 defaults). Provenance legend: ● marked · ◐ computed · ◔ manual · ⚑ review.

## Visual (see DESIGN_SYSTEM.md)
Fresh indigo + slate, light/dark, tabular numerals, flat/hairline. Mockups approved: Workspace, Layer mapping, Results/Export.

## Spike outcome (see spike/SPIKE_FINDINGS.md)
**GO.** All 3 files parse in ~3s; 100% of slab DIMENSIONs expose numeric measurements matching the reference;
57 length + 58 breadth dims → ~53 panels; endpoints present for L×B pairing.

## Open / next
- Prove the dim-pairing algorithm reconstructs ~610.9 m² to ±0.5% (extends spike).
- Browser smoke test (WASM+Worker parse time).
- ⚠️ Licensing: DWG path is GPL-3.0 — revisit if closed-source/commercial.
