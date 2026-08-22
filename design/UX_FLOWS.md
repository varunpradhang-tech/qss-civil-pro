# QSS — UX Flows & Wireframes (v1, low-fidelity)

> Gate: this is approved **before** any UI code. Persona: civil / quantity-survey engineer.
> Scope reminder: v1 = **DWG/DXF only, slab shuttering**, browser-only, local-first.
> Design principle running through every screen: **explicit → computed → manual**, with
> **provenance + confidence** visible on every number.

---

## 1. Primary user journey

```
[Projects]                         ← local (IndexedDB) project list
    │  New Project
    ▼
(1) Upload & Tag  ──►  (2) Parse  ──►  (3) Layer Map  ──►  (4) Workspace: Detect & Review  ──►  (5) Results  ──►  (6) Export
     drop DWGs,          workers,        auto + confirm       drawing + overlay + member          roll-up totals    CSV / MB xlsx /
     tag sheet role      progress        roles per sheet      table, live edits, review flags     & compare         PDF / JSON
```

- Presented as a **guided stepper** (top progress rail: Upload › Map › Review › Results) with the
  **Workspace (step 4)** as the dominant, long-lived screen. Users can jump back to any completed step.
- A persistent **utility bar** (unit toggle m/mm, unit-converter widget, help) is available on every step.

---

## 2. Screen inventory

| # | Screen | Purpose | Key states |
|---|--------|---------|-----------|
| 0 | Projects | Open / create / delete local projects | empty, list, deleting |
| 1 | Upload & Tag | Add DWGs, tag sheet-role/block/floor, pre-checks | empty, files-added, validation-warning |
| 2 | Parsing | Show worker progress per file | in-progress, per-file error (recoverable), done |
| 3 | Layer Mapping | Confirm auto-detected layer→role map | auto-guessed, edited, unmapped-warning |
| 4 | **Workspace** | Render drawing + panel overlay + member table; edit & review | loading, detected, panel-selected, editing, review-needed |
| 5 | Results | Roll-up totals by member/floor/block/sheet + compare | ok, over-tolerance-warning |
| 6 | Export | Choose & generate outputs | idle, generating, done |
| — | Settings | IS-1200 rule set (versioned), units, layer-profile mgmt | — |

---

## 3. Wireframes (low-fi)

### Screen 0 — Projects
```
┌───────────────────────────────────────────────────────────────────────┐
│ QSS  Quantity Survey                              [ + New Project ]     │
├───────────────────────────────────────────────────────────────────────┤
│  Recent projects                                                        │
│  ┌───────────────────────────┐  ┌───────────────────────────┐          │
│  │ GPL SIG3 – T3 Basement    │  │ (empty)                   │          │
│  │ Slab shuttering · 3 sheets│  │  Start a new takeoff →    │          │
│  │ Total: 610.9 m²  ·  edited│  │                           │          │
│  │ 2026-07-30       [Open ▸] │  │        [ + New ]          │          │
│  └───────────────────────────┘  └───────────────────────────┘          │
└───────────────────────────────────────────────────────────────────────┘
```

### Screen 1 — Upload & Tag
```
┌─ Step 1/5 · Upload ───────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │        Drop DWG / DXF files here   or   [ Choose files ]         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  Files (drag to reorder)                                               │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ ST-300-R1 Slab Dimension.dwg                                     │   │
│  │   Sheet role [ Slab dimension ▾]  Block [ T3 ]  Floor [ Basement]│   │
│  │ ST-600-R1.dwg                                                    │   │
│  │   Sheet role [ Reinforcement ▾]   Block [ T3 ]  Floor [ Basement]│   │
│  │ ST-700-R0.dwg                                                    │   │
│  │   Sheet role [ Reinforcement ▾]   Block [ T3 ]  Floor [ Basement]│   │
│  └────────────────────────────────────────────────────────────────┘   │
│  Sheet role & block/floor auto-guessed from filename — confirm/edit.   │
│                                                                        │
│  Pre-checks (advisory, not blocking):                                  │
│   ☑ A slab-dimension sheet is present   ☑ Grid layer detected          │
│                                                    [ Parse files ▸ ]   │
└────────────────────────────────────────────────────────────────────────┘
```
- Note vs reference tool: their 3 mandatory checkboxes become **advisory pre-checks** — we detect
  grids/dims from the parsed file rather than trusting a human checkbox.

### Screen 2 — Parsing
```
┌─ Step 2/5 · Parsing ──────────────────────────────────────────────────┐
│   ST-300 Slab Dimension   ████████████████████  done  (2.9s)          │
│   ST-600                  ████████████░░░░░░░░   parsing…              │
│   ST-700                  ░░░░░░░░░░░░░░░░░░░░   queued                │
│                                                                        │
│   ⓘ 1,148 layers · 3,434 entities · units = mm (auto)                  │
│   ⚠ ST-600 recovered with warnings (non-fatal) — data intact          │
└────────────────────────────────────────────────────────────────────────┘
```

### Screen 3 — Layer Mapping  (per sheet, tabbed)
```
┌─ Step 3/5 · Layer mapping ·  [ST-300▸] [ST-600] [ST-700] ─────────────┐
│  We filtered 1,100+ xref/annotation layers. Confirm the structural    │
│  roles below (auto-detected).                              [Show all] │
│  ┌──────────────────────┬───────────────┬──────────────┬───────────┐  │
│  │ Layer                │ Content       │ Role (auto)  │ Confidence│  │
│  ├──────────────────────┼───────────────┼──────────────┼───────────┤  │
│  │ SLABS NO T2          │ 115 DIM       │ Slab dims ▾  │  ●●● high │  │
│  │ SLAB THK.            │ 193 poly+text │ Slab thick ▾ │  ●●● high │  │
│  │ SLAB NO              │ 59 text       │ Panel label ▾│  ●●○ med  │  │
│  │ BEAM                 │ 122 line      │ Beam ▾       │  ●●● high │  │
│  │ BEAM SIZE            │ 50 text       │ Beam width ▾ │  ●●○ med  │  │
│  │ COL                  │ 44 poly       │ Column ▾     │  ●●● high │  │
│  │ (unmapped: 6 layers) │ …             │ — Ignore ▾   │           │  │
│  └──────────────────────┴───────────────┴──────────────┴───────────┘  │
│  [ Save as company profile ]  (reuse for future T3/GPL sheets — M2)   │
│                                            [ ◂ Back ]  [ Detect ▸ ]    │
└────────────────────────────────────────────────────────────────────────┘
```

### Screen 4 — Workspace (the heart of the app)
```
┌─ Step 4/5 · Review ·  Slab shuttering ────────────────  m ⇄ mm  ⚙ ─────┐
│┌──────────────────────────────────────────────┐┌──────────────────────┐│
││  DRAWING + OVERLAY  (cad-simple-viewer/THREE) ││ MEMBERS      53 · 2 ⚑ ││
││                                                ││ ┌──────────────────┐ ││
││     ┌─────┐┌────────┐┌─────┐                   ││ │P1 3.97×2.975=11.8│ ││
││     │ P1  ││   P4   ││ P7 ⚑│   ← panels drawn  ││ │  ● marked        │ ││
││     └─────┘└────────┘└─────┘   as world-coord  ││ │P2 2.58×2.975=7.71│ ││
││     ┌─────┐┌────────┐┌─────┐   polygons+labels ││ │  ● marked        │ ││
││     │ P2  ││   P5   ││ P8  │                   ││ │P7 …  ⚑ review    │ ││
││     └─────┘└────────┘└─────┘   selected=P1 ▓   ││ │  ◐ computed 0.83 │ ││
││                                                ││ └──────────────────┘ ││
││  [zoom][pan][fit]  scale ✓ from header (mm)    ││ Selected: P1         ││
│└──────────────────────────────────────────────┘│  Length  3.970  ●     ││
│                                                 │  Breadth 2.975  ●     ││
│  Legend: ● marked  ◐ computed  ◔ manual  ⚑ review│  Depth   0.150  ◐     ││
│                                                 │  Openings 0     +     ││
│                                                 │  Area   11.830 m²     ││
│                                                 │ [ split ][ merge ][⌫] ││
│                                                 │ Running total 610.9 m²││
│                                                 │        [ Results ▸ ]  ││
└────────────────────────────────────────────────┴──────────────────────┘
```
Interactions:
- Click panel on canvas ⇄ selects row in table (bidirectional highlight).
- Editing Length/Breadth/Depth/Openings updates Area + running total **live**; edited value flips to
  `◔ manual` provenance.
- `⚑ review` = computed or low-confidence; badge count in header; **cannot export** until reviewed
  (per ±0.5% confidence gate). "Review" = user opens panel, confirms/edits, clears flag.
- Panel tools: **split** (one detected region into two), **merge**, **add**, **delete**, **rename**.
- Overlay + table share one selection model; both driven by world coordinates.

### Screen 5 — Results
```
┌─ Step 5/5 · Results ──────────────────────────────────────────────────┐
│  Slab shuttering — Tower T3 · Basement                                 │
│  ┌───────────────┬───────────────┬───────────────┐                     │
│  │ TOTAL         │ PANELS        │ FLAGGED       │                     │
│  │ 610.9 m²      │ 53            │ 0 (all clear) │                     │
│  └───────────────┴───────────────┴───────────────┘                     │
│  Breakdown ▾ by Sheet / Floor / Member type                            │
│    Basement · ST-300 · Slab soffit   53 panels   610.9 m²              │
│                                                                        │
│  Expected (optional): [ 610.9 ] m²   Δ = 0.0%   ✓ within ±0.5%         │
│  IS-1200 basis: net slab soffit after opening deductions (rule set v1) │
│                                            [ ◂ Back ]  [ Export ▸ ]     │
└────────────────────────────────────────────────────────────────────────┘
```

### Screen 6 — Export
```
┌─ Export ──────────────────────────────────────────────────────────────┐
│  ☑ CSV (member table)                                                  │
│  ☑ Excel — Measurement Book (grouped, subtotals, IS notes)             │
│  ☑ PDF report (annotated drawing + table)                              │
│  ☐ JSON project (mappings + edits + provenance, re-loadable)           │
│                                             [ Generate selected ▸ ]    │
└────────────────────────────────────────────────────────────────────────┘
```

### Utility — Unit converter (available everywhere)
```
┌ Converter ┐   value [ 3.970 ]  from [ m ▾ ]  →  [ 3970 ] [ mm ▾ ]
└───────────┘   presets: mm · cm · m · ft · in
```

---

## 4. Cross-cutting UX rules
- **Provenance colours** consistent everywhere: marked ●, computed ◐, manual ◔, needs-review ⚑.
- **Never silently trust a guess** — computed/low-confidence values are flagged and block export.
- **Everything editable, always** — any auto value can be overridden (flips to manual).
- **Non-destructive** — edits keep the original detected value (revert available); undo/redo on member edits.
- **Local-first** — autosave to IndexedDB; JSON export for portability; no login in v1.

## 5. Resolved UX decisions
1. **Member table = right sidebar** (as wireframed) — drawing stays wide, list scrolls.
2. **Workspace-centric navigation** — after parse+map, users live in the Workspace; Upload/Map/Results
   are reachable side-trips, not a forced wizard. (Parsing/mapping still gate the first entry.)
3. **Sensible defaults, minimal settings** — ship IS-1200 rule set v1 as a sane default (opening
   threshold + net-soffit basis); expose only unit prefs and layer profiles. Editable rule set → M2.
