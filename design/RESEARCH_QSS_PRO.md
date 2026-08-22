# Research: QSS Pro (reference tool) — what to adopt, libraries, architecture

Full analysis of `varunpradhang-tech/qss-pro` (his rebuild target) vs our browser app, with a
recommendation for the best combined solution. Sources: his `server.js` (12k lines), `app.js`,
`cad-reading-rules.md`, `qss-rulebook.json`, `golden-tests.json`, Python/PowerShell helpers.

## 1. What his tool actually is (and its hard constraint)
- **Frontend**: vanilla JS, single 2.5k-line `app.js`, config-driven dropdown cascade
  (`quantityMenu` → `quantityRules` with pure `calculate(row)` fns). Overlay SVG is a placeholder.
- **Parse/convert pipeline is Windows-desktop-bound and license-bound**:
  - DWG→DXF via **Autodesk Core Console `accoreconsole.exe`** (needs a licensed **AutoCAD 2022** install), driven by a generated `.scr`, launched through a 5-strategy fallback ladder + a **PowerShell job-queue worker** (mutex + heartbeat + atomic rename) to bridge the sandboxed server to the desktop-privileged tool.
  - DXF parsed by a **hand-rolled 2-line-stride regex parser** (naive; first ENTITIES section only).
  - PDF via **Python** (`pypdfium2` raster, `pdfplumber` text, PIL/NumPy grid detect, Tesseract OCR).
- **Takeaway**: none of his parse/convert path can run in a browser, and it needs an AutoCAD licence.
  Our browser **WASM** parse (`libredwg-web`) needs none of it — this is a strict advantage for us.

## 2. Library re-evaluation (the decision)
### Parsing — KEEP `@mlightcad/libredwg-web`, add block expansion
- It parses DWG **directly in-browser** (no AutoCAD/ODA/DXF round-trip, no server, no licence). Strictly better than his accoreconsole+regex path for a browser app.
- Verified it exposes what the new findings require: `DwgBlockRecordTableEntry.entities[]` (block sub-entities) + `DwgInsertEntity{name, insertionPoint, xScale/yScale, rotation}` → **we can recurse/flatten INSERTs with transforms** to surface grid bubbles/lines and column blocks. Our "S-Grid is empty" problem is a **parser gap (no block recursion), not missing data.**
- Also strip MTEXT control words (e.g. `\pxql;{\W1;E1}` → `E1`).
- Keep it for the **headless Node golden-test harness** too (it already works there).

### Rendering — SWITCH from the hand-rolled canvas to `@mlightcad/cad-simple-viewer`
- Our custom canvas only draws LINE/LWPOLYLINE/DIMENSION/TEXT — it **misses INSERT blocks, ARC, CIRCLE, HATCH, splines**, so columns, grid bubbles, and title info don't render. Hand-rolling a faithful CAD renderer is a large, low-value reinvention.
- `cad-simple-viewer` (same **@mlightcad** ecosystem, `@mlightcad/three-renderer`, WebGL) renders **all** entity types, runs entirely in-browser, and exposes the **same AutoCAD-like data model** (`@mlightcad/data-model`, `AcDbDatabase`) we read for dims/blocks/topology. It shares the DWG path (`libredwg-converter`/`libredwg-web`) we already use — one coherent stack for parse + render + model.
- Overlay: draw our panel/cell/snap objects **into its THREE.js scene** (co-registered, pan/zoom-locked) — this is the originally-approved "overlay inside the viewer scene" design; the custom canvas was a prototyping detour.
- Costs to plan for: deploy its **web-worker + wasm** files and set `webworkerFileUrls`; heavier bundle; **GPL-3.0** on the DWG path (already true via libredwg-web — fine for this internal rebuild, revisit only if going closed-source commercial).
- **De-risk first**: a short spike to confirm (a) reading the parsed `AcDbDatabase` for our dims/blocks, (b) adding an interactive overlay + world-coord hit-testing in its scene. If the overlay integration fights us, fall back to extending the custom canvas with block-expansion + arc/circle rendering.

## 3. His calculation method (exact formulas — all mm internally, output m/m²/m³, round to 3 dp)
- **Slab soffit shuttering** = `max(L·B − openings, 0) · nos`; **slab concrete** = soffit `· thickness` (thickness default 0.15 m if unknown).
- **Beam bottom (soffit)** = `L·width − bottomJointDeduction`.
- **Beam side (both faces)** = `2 · sideLength · (depth − slabThickness) − sideJointDeduction`
  — the **exposed side height is reduced by the adjacent slab thickness** (dotted/hidden face = slab present → deduct; continuous outer face = full depth). Cap mode (included/excluded) adjusts cap-side faces.
- **Beam concrete** = `L·width·depth − columnCapDeduction(if caps excluded)`, `· nos`.
- **Support/joint deductions** (continuous beam through a column/wall): `bottomDeduction = overlap·width`, `sideDeduction = 2·overlap·(depth−slabThickness)`.
- **Openings/cutouts**: auto-detected 3 ways — polylines on `CUT|OPEN|VOID|SHAFT|LIFT|DUCT` layers, **X-crossed diagonal pairs**, and void text — then deducted from slab area (`openings = min(cutoutArea, panelArea)`).
- **Dimension authority**: marked CAD DIMENSION (`code 42` actual measurement) or endpoint-aligned dimension text **overrides geometry** when self-consistent and aligned; conflicts → `needsReview`. Multi-source reconciliation ladder: CAD↔grid agree (tol `max(25mm,1%)`) → marked dim wins → geometry only overrides when support-stopped or clearly drawn and CAD conflicts > `max(150mm,2.5%)`.
- **Review/failure gate**: if >5% of slab area or marks are in review, result is **not** presented as final billable quantity.

### Two gaps in *his* implementation (opportunities to beat him)
1. **No real IS 1200 table** — deductions are all-or-nothing by detected void area; the small-opening thresholds (e.g. ignore openings < 0.1 m², the IS-1200 rules) are **not encoded**.
2. **Dash-pattern discrimination is documented but NOT implemented** — `cad-reading-rules.md` describes "grid = unequal long-short dashes, beam = equal dashes," but `server.js` actually classifies by **layer/linetype name**, not dash geometry.

## 4. Best practices to adopt (strong yes)
- **First-class evidence/provenance on every row**: keep both `geometry*` and `authoritative*` values + `dimensionConflict`, `valueSource` (`written-cad-dimension`, `cad-grid-agree`, `support-stopped-geometry`…), panel bbox, `qssRuleIds`. Never overwrite geometry silently. (We already started this with our provenance dots — deepen it.)
- **"Block instead of guess" review gates** + aggregate `reviewRatio` / `panelCoverageRatio` + the 5% failure gate.
- **Rule registry + audit + golden + linter** (his `QSS-PROC-001` discipline): a versioned JSON rule registry, a post-hoc `buildRuleAudit`, golden tests at per-unit tolerance (0.3%) each tagging the `ruleIds` it protects, and a CI linter (`rulebook-check.js`) enforcing rule↔code↔test traceability. In TS this is cleaner (ruleId enums, typed `QuantityRule`, colocated Vitest).
- **Golden harness with an independent recompute oracle** (runner recomputes quantities separately from the engine) + **"issue tests"** that lock bad behaviour as fixed.
- **MB/CSV export**: 23-column Measurement-Book format ending in a **"Measurement basis"** provenance column; RFC-4180 quoting; real `.xlsx` for premium.
- **Deterministic cache key** hashing file+role+params.

## 5. Your specific questions answered
**Q: He uses JS + Python + shell — is that a problem for us (currently a browser UI app)?**
No. His Python (PDF) and PowerShell/AutoCAD (DWG→DXF) exist **only because he shells out to desktop tools**. We replace that entire layer with **in-browser WASM** (`libredwg-web`), so we need **no Python and no shell** for the DWG path. His **JS calculation logic ports directly to our TS**; his **rulebook is JSON** (portable as-is). PDF is deferred; when we do it, it's **pdf.js in the browser**, not Python.

**Q: Do we need to change our architecture?**
Not a rewrite — targeted additions to what we have (browser-first React+TS+Vite+Zustand, local-first):
1. **Parser**: add INSERT/BLOCK recursion + MTEXT strip to `src/parsing`.
2. **Rendering layer swap** to `cad-simple-viewer` (after the spike).
3. **New `src/geometry` topology engine**: block-expanded entities → support-gap-bridged beam faces → topology cells (bays) → panels. This is the real auto-detector (replaces the ray-cast heuristic) and it's exactly what his `cad-reading-rules.md` prescribes.
4. **New `src/rules` layer**: typed rule registry + evidence model + audit + review gate.
5. **New `tests/golden`**: golden harness + independent oracle + rulebook linter.
6. Keep calc/geometry **pure and headless** (Node-testable) — unchanged stance.
Backend stays **optional/future** (Node, so his JS ports over) for accounts/batch; not needed for v1.

**Q: With his logic + our approach, can we get better?**
Yes — the combined target genuinely beats both:
- **Browser-native, zero-licence** (our WASM) — beats his AutoCAD-dependent desktop pipeline.
- **Rigorous + auditable + correct** (his evidence/rules/review + real beam-side & cutout deductions) — beats our earlier 3%-off ray-cast heuristic.
- **Close his two gaps**: encode a **real IS-1200 deduction table** (versioned rule set), and implement **actual linetype dash-geometry classification** (grid vs beam) instead of relying on layer names.
- **Plus our UX edge**: exact-marked-value marking, live overlay, auto-fit, provenance surfaced in the UI, multi-sheet upload.

## 6. Recommended immediate next steps
1. **Parser**: add block-expansion + MTEXT strip; re-check whether grid lines/bubbles now appear on `S-Grid`.
2. **Spike**: `cad-simple-viewer` render + overlay + read `AcDbDatabase` (go/no-go for the renderer swap).
3. **Topology engine v0**: expanded beam faces + support-gap bridging + cell extraction → compare auto total to 610.9 (should beat the 629 heuristic and be explainable).
4. **Evidence + review-gate model** and a **golden-test harness** ported to TS/Vitest.
