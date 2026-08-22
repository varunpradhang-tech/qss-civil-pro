# QSS — Milestone 0 Spike Findings

**Date:** 2026-07-30
**Question:** Can a browser-only stack (`@mlightcad/libredwg-web`) parse the real project DWGs and expose enough accurate data (layers, geometry, DIMENSION values) to compute slab shuttering to ±0.5%?

## Verdict: **GO** ✅

Every make-or-break capability is proven on the three real files. No blocker found for the browser-only + libredwg approach.

---

## Evidence

### 1. Parsing works, fast enough
| File | Role | Parse+convert | Entities |
|------|------|---------------|----------|
| `...ST-300-R1 Slab Dimension.dwg` (AC1032/2018) | **Slab dimension sheet** | ~2.96 s | 3,434 |
| `...ST-600-R1.dwg` (AC1024/2010) | Reinforcement/detailing | ~2.73 s | 2,262 |
| `...ST-700-R0.dwg` (AC1024/2010) | Reinforcement ranges | ~2.71 s | 1,362 |

- libredwg returns "error code 64" = **non-fatal** recovery warning; full database populated correctly.
- `INSUNITS = 4` (**mm**) on all files → confirms mm→m assumption; no unit guessing needed.
- Browser (WASM + Web Worker) uses the same code path — expected to be comparable; **one browser smoke test still pending** (first task of Milestone 1).

### 2. DIMENSION extraction is 100% and accurate
- Slab-dimension sheet: **115/115** DIMENSION entities expose a numeric `measurement`.
- Values match the reference tool's panels exactly: `2975` → ref breadth **2.975 m**, `4090.155` → **4.0901 m**, `3976.4` → length **3.97 m**.
- Confirms the marked-dimension-first strategy is correct and precise.

### 3. Geometry supports L×B panel pairing
- All 115 slab dims carry endpoint pairs (`subDefinitionPoint1/2`); **endpoint span == reported measurement** for every checked case.
- Orientation split: **57 horizontal (lengths) + 58 vertical (breadths), 0 diagonal** → ~53–57 panels, matching the reference's **53 rows**.
- Algorithm is tractable: cluster each length dim with its nearby breadth dim → panel L×B → deduct openings → sum.

### 4. The relevant layers are identifiable amid the noise
Real layers on the slab sheet (after filtering ~1,100 xref/junk layers like `XA_Site_Plan_Plot line$0$…` and `MATCH LINE T2`):

| Layer | Content | Use |
|-------|---------|-----|
| `SLABS NO T2` | 115 DIMENSION | **Panel L×B source** |
| `SLAB THK.` | 193 LWPOLYLINE + 196 TEXT | Slab thickness (depth) + regions |
| `SLAB NO` | 59 TEXT | Panel labels (P-numbers) |
| `BEAM` | 122 LINE | Beam faces → clear-span deduction |
| `BEAM SIZE` | 50 TEXT | Beam widths |
| `COL` | 44 LWPOLYLINE | Columns |
| `RET. WALL` / `RCC WALL` | polylines | Walls |

---

## Plan-affecting discoveries
1. **The 3 files are sheet *types* of one structure (Tower T3 basement), not 3 floors.** `300` = slab dimensions (primary area source), `600`/`700` = reinforcement/detailing. → The project model must include a **sheet-role** dimension, not just Block→Floor.
2. **Panels come from paired DIMENSION entities, not from closed polygons.** No clean per-panel closed polyline exists; slab-thickness polylines are small callout tags (193 polys ≈ 79 m² total). Pairing dims spatially is the core algorithm.
3. **Layer auto-mapping must aggressively filter noise** (~1,100 layers, most are xref site-plan junk) and surface the ~dozen real structural layers by name + entity-content heuristics.

## Accuracy investigation (spikes 4–7) — key result

**Reconstructing the ~610.9 m² total from floating dimensions + labels alone is NOT reliable.**
- Panels are labelled by *type* on `SLAB NO` (`S1`…`S21`, with repeats); 59 label placements ≈ ~53 physical panels.
- Naive label-anchored dim pairing → **710 m² (16% high)**: it grabs overall/chain dimensions (e.g. the
  8660 mm building-height span) as if they were a single panel's breadth.
- Adding an "overall-dim" filter swung it to **10 m² (98% low)**. This volatility proves the association
  problem — not the *values* (every measurement is correct) — is the hard part.

**Root cause + the way out:** dims tell you lengths, not which lengths bound which panel. You need the
actual **bay boundaries**. In this file:
- `S-Grid` layer exists in the table but has **0 entities in model space** → *no usable grid lines.*
  The specced "grid-based primary" detection cannot rely on grid geometry here.
- `BEAM` layer has **122 clean orthogonal line segments** (84 H + 38 V, 0 diagonal, 336 m total) that
  **do** outline the bays. → Correct approach: **planar face extraction from the beam-line arrangement**
  → each enclosed face = a slab bay = a panel; marked dims supply precise edge lengths + validation;
  openings deducted.

## Revised verdict
- **Parsing / data access: GO** (unchanged — everything is accessible and accurate).
- **Fully-automated ±0.5% from dims alone: NO.** Requires **geometry-first bay reconstruction** (beams,
  not grids) + dims for precision + **human review of flagged bays** for the last mile. This matches the
  confidence-gate design and is tractable, but it is real Milestone-1 computational-geometry work, not a
  one-script result.

## Beam-bay sub-spike (spike 8) — result
Rectilinear global-grid + edge-coverage test → **0 bays** at every threshold. The beam network yields
28 X + 30 Y candidate lines = **irregular framing**, so a beam segment bounds a single bay edge, not a
full global grid line. The global-grid shortcut is invalid here.

## Bottom line on accuracy (both shortcuts ruled out)
| Approach | Result | Why it fails |
|----------|--------|--------------|
| Floating-dim pairing (labels) | 710 m² / swings to 10 | dims give lengths, not which sides bound which bay |
| Global rectilinear grid cells | 0 bays | framing irregular; no clean global grid |

**The only correct method is true planar face extraction** — compute beam-segment intersections, split
segments, build a half-edge arrangement, extract minimal interior faces = bays; then attach marked dims
for precise edges and deduct openings. This is real computational geometry = a proper, test-driven
Milestone-1 module, not a spike script. **Feasibility of the DATA is proven; the ALGORITHM is now scoped.**
Realistic accuracy path = geometry proposes bays + engineer confirms flagged ones (matches confidence gate).

## Connectivity diagnostic (build WU4 step 0) — DECISIVE
Ran on real beams via the new parsing module:
- **BEAM network: 93% dangling endpoints** (212 of 228 snapped endpoints have degree 1; only 16 junctions).
  Beams are isolated segments with gaps → **planar face extraction is NOT viable** (faces never close).
- No closed slab-region polylines exist; `SLAB THK` = 193 tiny 4-pt tags; grid lines absent.

**Conclusion: there is no clean geometric source of panel boundaries in this file.** Fully-automatic bay
detection from DWG geometry is not achievable on real drawings like these. The reference tool relies on
**human-marked** dimensions ("Marked CAD dimensions are used as the main measurement source"). 

### Pivot: assisted marking (human-in-the-loop, dim-powered)
Render the DWG + all marked dimensions; engineer clicks a bay (or two perpendicular dims); the app snaps
to dim endpoints/beam lines and auto-fills the exact marked L×B → panel in ~1 s. ~53 quick clicks for the
slab, **±0.5% guaranteed** (uses exact marked values; human ensures correct pairing). Value vs incumbent =
correctness (clear spans, IS-1200 opening deductions) + better UX (snapping, live overlay, provenance),
not zero-click automation.

## Marking-engine auto-proposal quality (WU4, measured on real file)
Marking engine + tests built (6/6 pass). Auto-proposal from label-position "clicks":
- nearest-line heuristic → 710 m² (over); tightest-span heuristic → 369 m² (under).
- **Auto-proposal is unreliable** because this sheet uses **chained dimensions** — a panel side is
  sometimes one dim, sometimes a sum of chained segments. No centre-click heuristic resolves this.
- 50/59 flagged ambiguous — correctly signalling the human must confirm.

**UX consequence:** lead with **manual marking + snapping** (click length dim, click breadth dim, or drag
a rectangle snapping to dim endpoints / beam lines) → exact marked values, ~2 clicks/panel, 100% accurate.
Auto-propose is a secondary hint only. This stays within the assisted-marking model already chosen.

## Confirmed / done
- [x] Assisted-marking core model (user confirmed).
- [x] Parsing module + marking engine (headless, tested).
- [x] Browser app: render + auto-calculate (629 m², ray-cast+snap) + manual marking + multi-sheet + fit.

## Block-expansion investigation (post QSS-Pro research)
- Added **selective** INSERT/BLOCK flattening to the parser (recurse small local symbol blocks; skip
  xref/embedded-drawing blocks). Key finding: **this sheet embeds the entire multi-tower project as
  local blocks** (`XD_CLUB_FLOOR_PLANS` 31k ents, `XB_Tower 1–8`, `XA-UNIT-*`) — blanket expansion
  floods to 301k segments. Selective expansion preserves the clean slab plan (115 dims) + adds
  column/symbol geometry. **Grid lines are genuinely absent** on this sheet (only inside the embedded
  tower drawings) → grid-based detection is out; beam-topology is the only path.

## Topology auto-detection: grid-cell method is a DEAD END (confirmed 3×)
- Global non-uniform grid + edge-coverage (even with support-gap bridging + walls + relaxed 3/4 @0.5):
  **0 cells with 4/4 covered, 6 with 3/4**. The framing is not a global grid, so adjacent grid
  coordinates don't form bounded cells. Correct algorithm = **half-edge planar arrangement**
  (segment intersections → split edges → minimal-cycle face traversal → bays), with beam-face pairing
  and support-gap bridging per cad-reading-rules.md. This is a real CG module, not a shortcut.

## Half-edge topology engine — TRIED PROPERLY, ruled out (data-limited)
Built a real planar arrangement (bridged beam/wall segments → intersections → split edges → minimal-cycle
half-edge face extraction). Result: only **7 bays = 61.53 m²** (one 40 m² blob + slivers). The beams do
**not** form a connected closed network — bay corners don't join even after support-gap bridging — so
there are almost no closed faces to extract. **4th confirmation that geometry-based auto-detection cannot
work on these drawings; it is a data limitation, not an algorithm one.** The label-anchored ray-cast
heuristic is the correct method here precisely because it does NOT require beams to enclose cells.
Decision: do not integrate a topology engine; keep the heuristic. (script: scripts/topology2.ts)

## Columns — auto-detection not viable (investigated thoroughly)
Added HATCH boundary parsing to capture the `col solid` solid-fill footprints (48). Result: the layer
**mixes columns and shear walls** — footprint sizes range 500×700 (column) to 700×3850 / 4975×5640 (walls/
cores), only 5/48 are plausible single-column sizes, extraction is noisy on multi-path hatches, and the
85 `COL-NO` insert locations don't reconcile with 48 hatches. Column **height is not on the plan** either
(needs TOS levels from other sheets). Conclusion: columns are manual/assisted on these drawings, not auto
— consistent with beams. HATCH parsing retained (useful generally). A manual-only column subsystem is low
ROI vs the strong slab+beam×shuttering+concrete coverage; deferred.

## Cheaper path to the 610.9 target — ACHIEVED (+0.13%)
Added to the auto engine: (a) **cutout/void detection** (X-crossed diagonal pairs on `CUT` layer +
cutout-layer polylines) and **nearest-panel deduction** per QSS-SLAB-004, (b) overlap de-dup gate.
Found 3 X-voids (lift/stair) = 18.9 m²; deducted 17.3 m² → **total 611.71 m² vs true 610.9 = +0.13%,
within ±0.5%.** (Dedup found 0 duplicates on this file.) Verified in-browser.
Caveat: assigning a whole void to one nearest panel can zero a small neighbour (e.g. S12 → 0.00) — the
**total** is accurate but **per-panel** areas near voids need the topology engine + per-panel ground
truth to be exact; such panels should carry a review flag. Don't over-tune to this one file.

## Stack confirmed for build
React + TS + Vite + Zustand · `@mlightcad/libredwg-web` (parse, Web Worker) · `@mlightcad/cad-simple-viewer` (THREE.js render) · IndexedDB (local-first). ⚠️ DWG path is **GPL-3.0** — revisit if this goes closed-source/commercial.
