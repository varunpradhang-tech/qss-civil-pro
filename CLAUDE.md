# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QSS Pro (web) — a browser reimplementation of a civil quantity-surveying tool. Users upload structural
DWG/DXF drawings, the app auto-extracts members (slab panels, beam runs), and computes IS-1200 quantities
(concrete, shuttering, steel) via a ported rule engine. Everything runs client-side: DWG/DXF parsing
happens in-browser via `@mlightcad/libredwg-web` (WASM) inside a Web Worker — no backend, no AutoCAD.

The reference app being ported is `varunpradhang-tech/qss-pro`. Design history and the CAD-format
investigation live in `design/` and `spike/SPIKE_FINDINGS.md` — read these before changing parsing or
extraction logic, since they document *why* certain heuristics (block-expansion cutoffs, gap-bridging
distances, etc.) were chosen.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173 — upload a DWG from assets/ to exercise the full pipeline
npm run build      # vite build -> dist/, static and deployable anywhere
npm run preview    # preview the production build
npm test           # vitest run — all tests, including golden accuracy tests against real DWG fixtures
npm run test:watch
npm run typecheck  # tsc --noEmit
```

Run a single test file: `npx vitest run tests/golden.test.ts`. The golden tests parse a real DWG file
under `assets/` with the WASM parser and take longer (30s timeout each); export/persistence tests are fast
unit tests.

There is no lint script configured — rely on `npm run typecheck` and `npm test`.

## Architecture

Data flows in one direction through four layers, each in its own directory under `src/`:

1. **Parsing** (`src/parsing/parse.ts`, `src/workers/`) — wraps the libredwg WASM binding, flattens
   `INSERT`/`BLOCK` references (applying 2D affine transforms) so geometry nested in blocks (grid lines,
   column outlines) is surfaced, and normalizes everything into a `NormalizedDwg` (`src/domain/types.ts`):
   segments, dimensions, texts, polylines, hatches, all in millimetres. Parsing runs inside
   `src/workers/parse.worker.ts` (via `parseClient.ts`) so the ~15s WASM parse doesn't block the UI.
   Block expansion is deliberately selective (`shouldExpandBlock` in `parse.ts`) — whole-drawing xref-style
   blocks (`XA-`, `XB_`, `XR_`, `XD_`, anonymous `*`/`A$C` blocks) must NOT be exploded into the measured
   region, only small local symbol blocks are.

2. **Extraction** (`src/extract/`) — turns a `NormalizedDwg` into `MemberRow[]` for a given work group.
   `panels.ts` auto-proposes slab panels (label-anchored, void-deducted). `extractMembers.ts` also derives
   beam runs by clustering collinear `BEAM` layer segments into runs (bridging gaps at supports) and
   pairing them with the nearest `BEAM SIZE`/`BEAM NO` text. Only `slab` and `beam` work groups
   auto-extract; column/raft/wall/floor intentionally start empty because their geometry isn't reliably
   inferable from this drawing data — users add rows manually for those. Rows with uncertain geometry are
   flagged via `needsReview`/`reviewReason` rather than silently shipped.

3. **Rule engine** (`src/takeoff/rules.ts`) — a faithful, pure-function port of the reference app's 17
   quantity rules (column/beam/slab/raft × concrete/shuttering/steel, plus brickwork/plaster/paint/
   flooring). `RULES[key].calculate(row, capMode)` takes one `MemberRow` and returns a quantity; `MENU`
   defines the drawing-type → work-group → rule cascade the Extract form UI walks through. `RULE_FIELDS`
   determines which numeric columns the editable member table shows per rule, so unrelated inputs (e.g.
   column cap height) don't clutter a beam table. Beam calculations are cap-mode aware
   (`beamShutteringBreakdown`/`beamConcreteBreakdown`) — whether column-cap overlap is included or excluded
   from beam quantities is a toggle, not a fixed formula.

4. **State & persistence** (`src/state/`) — a single Zustand store (`store.ts`) holds sheets, the active
   drawing, extract-form selections, and the editable member rows; every mutation triggers a debounced
   (600ms) autosave to IndexedDB (`persistence.ts`, local-first, no backend). Changing `drawingType`,
   `workGroup`, `activeSheet`, etc. re-runs `extractQuantity()` automatically. Projects are also portable as
   JSON (`projectToJson`/`projectFromJson`) for export/import across machines. The store is exposed on
   `window.__qss` for debugging.

`src/export/` renders results to CSV, an Excel "Measurement Book" (`mb.ts`/`xlsx.ts` via `exceljs`), and
project JSON. `src/pages/` + `src/components/Layout.tsx` are the routed UI shell (react-router); the
Extract flow (`ExtractPage.tsx`) is the primary surface and drives the store end-to-end.

## Working in this codebase

- All internal geometry/lengths are millimetres until extraction; extraction converts to metres
  (`src/lib/num.ts` `round3`) when populating `MemberRow` fields, since rules operate in metres/m²/m³/kg.
- When touching parsing or extraction heuristics (block expansion, beam clustering distances like
  `BRIDGE`/`CLUSTER`, panel confidence/duplicate logic), re-run `npm test` — the golden tests in
  `tests/golden.test.ts` lock known-good totals (e.g. 610.9 m² slab shuttering) against a real DWG fixture
  in `assets/` and will catch regressions numerically, not just via unit assertions.
- Rule changes must stay a faithful port of the reference app's formulas (e.g. steel unit weight is
  `d²/162`) — these encode IS-1200 conventions, not arbitrary business logic.
- `spike/` is a standalone throwaway Node project (own `package.json`/`.npmrc`) used to investigate DWG
  parsing before the real implementation existed; it's not part of the app build.
