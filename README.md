# QSS Pro — rule-based quantity takeoff (web)

Shared web/mobile processing architecture: [design/REMOTE_PROCESSING.md](design/REMOTE_PROCESSING.md). Remote processing is disabled by default and the existing local extraction engine remains the fallback.

A browser reimplementation of the QSS Pro civil quantity-surveying app (reference:
`varunpradhang-tech/qss-pro`), rebuilt on a modern web stack. Upload structural drawings, auto-extract
members, and get IS-1200 quantities across the full member × rule matrix — as a deployable static app.

## Stack
React + TypeScript + Vite + Zustand. **In-browser DWG/DXF parsing** via `@mlightcad/libredwg-web`
(WASM, in a Web Worker) — no AutoCAD, no Python, no backend (the reference app needed all three).

## What it does (ported from qss-pro)
- **Extract form** — Drawing type → Work group → Quantity rule cascade, plus Column-cap mode (beams),
  Output (member/floor/total), and Floor/level. Exactly the reference UI.
- **Full rule engine** (`src/takeoff/rules.ts`) — all 17 rules faithfully ported:
  column/beam/slab/raft × concrete/shuttering/steel, and brickwork/plaster/paint/flooring. Same formulas
  (`d²/162` steel, beam bottom+side with slab-thickness deduction, column main+cap, cap-mode logic).
- **Auto-extraction** (`src/extract/extractMembers.ts`) — on upload/extract, members are populated
  automatically: **slab panels** (label-anchored, void-deducted; 611.7 m² on the sample) and **beam runs**
  (collinear beam-face grouping with support-gap bridging; real `BEAM NO` names, sizes from `BEAM SIZE`
  text). Beams are **auto-calculated for shuttering and concrete** — no manual marking.
- **Editable member table** — Add / Duplicate / Delete; every field editable; per-row quantity + live
  total recompute; rule-specific columns; review flags on uncertain rows.
- **Result cards** — Selected item · Total quantity (unit) · Rows counted, plus the IS-code note per rule.
- **Exports** — CSV, Excel Measurement Book (per selected rule), and JSON project export/import.
- **Local-first persistence** — IndexedDB autosave; open/rename/delete saved projects.

## Run / deploy
```bash
npm install
npm run dev        # http://localhost:5173 → Upload DWGs → pick assets/…ST-300… .dwg
npm run build      # dist/ — static, deployable to any static host (Netlify/Vercel/S3)
npm test           # 11 tests (exports, persistence, golden accuracy + extraction→rules)
npm run typecheck
```
`.npmrc` points at the public npm registry.

## Honest limits (data-driven)
- **Slab auto-extraction is accurate** (±0.5% on the sample, golden-tested). **Beam auto-extraction is
  approximate** — beams have no length dimensions and disconnected faces, so runs/sizes are best-effort
  and every beam is flagged for review + fully editable. This matches the reference app's reliance on
  human-verified marked input.
- Column/raft/wall/floor start empty (add rows manually) — their footprints/heights aren't reliably in
  these drawings (columns mix with shear walls; heights live on other sheets).
- Steel/BBS uses the reference's estimator formulas; true BBS needs reinforcement detail sheets.

Design history and CAD-reading investigation: `design/`, `spike/SPIKE_FINDINGS.md`.
