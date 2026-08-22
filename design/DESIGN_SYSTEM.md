# QSS — Design System (v1, fresh/modern)

Engineering-instrument feel: precise, calm, data-dense, trustworthy. Distinct from the reference
tool's teal. Light + dark mode from day one. All values are design tokens implemented as CSS custom
properties in the React app.

## 1. Brand & palette

**Primary accent — Indigo** (confident, technical; not teal):
`--accent-50 #EEF2FF · 100 #E0E7FF · 300 #A5B4FC · 500 #6366F1 · 600 #4F46E5 · 700 #4338CA · 900 #312E81`
Primary actions use `--accent-600`; hover `--accent-700`.

**Neutrals — Slate** (cool gray):
`50 #F8FAFC · 100 #F1F5F9 · 200 #E2E8F0 · 300 #CBD5E1 · 400 #94A3B8 · 500 #64748B · 600 #475569 · 700 #334155 · 800 #1E293B · 900 #0F172A`
- Light: page `--slate-50`, card `#FFFFFF`, text `--slate-900`, secondary `--slate-500`, hairline `--slate-200`.
- Dark: page `--slate-900`, card `--slate-800`, text `--slate-50`, secondary `--slate-400`, hairline `--slate-700`.

### Provenance colours (product-critical — always paired with a shape + icon, never colour alone)
| State | Token | Light hex | Glyph | Meaning |
|-------|-------|-----------|-------|---------|
| Marked | `--prov-marked` | `#2563EB` (blue) | ● | Read directly from a drawing dimension — authoritative |
| Computed | `--prov-computed` | `#D97706` (amber) | ◐ | Derived from geometry/scale — verify |
| Manual | `--prov-manual` | `#7C3AED` (violet) | ◔ | Human-edited override |
| Review | `--prov-review` | `#E11D48` (rose) | ⚑ | Low-confidence / must review before export |

Redundant encoding (colour + glyph + label) keeps it colour-blind safe and readable in both modes.

### Status
`--success #059669 (emerald, within ±0.5%) · --warning #D97706 (amber) · --danger #DC2626 (red)`

## 2. Typography
- **UI:** Inter (fallback: system-ui). **Two weights only: 400, 500.** Sentence case everywhere.
- **Numbers:** Inter with `font-feature-settings:'tnum' 1` (tabular) so table columns align. Optional
  mono (`JetBrains Mono`) for coordinates/converter.
- **Scale (px):** caption 12 · footnote 13 · body 14 · lead 16 · h3 18 · h2 22 · h1 28. Line-height 1.5 body, 1.25 headings.

## 3. Space, radius, elevation
- **Spacing (4px base):** 4 · 8 · 12 · 16 · 24 · 32 · 48.
- **Radius:** control `6px` · card `10px` · pill `999px`.
- **Borders:** 1px hairline `--slate-200`/`--slate-700`.
- **Elevation:** flat by default (hairline borders). One soft shadow for floating layers only:
  `0 4px 16px rgb(15 23 42 / 0.08)`. No gradients, no decorative shadows.
- **Grid:** 8pt; workspace = drawing (flex) + fixed 360px right sidebar.

## 4. Core components
- **Buttons:** primary (accent-600 fill, white text) · secondary (hairline, transparent) · ghost.
  36px height, radius 6px, active scale 0.98. One primary per view.
- **Inputs/selects:** 36px, hairline, focus ring `0 0 0 2px --accent-300`. Numeric inputs right-aligned, tabular.
- **Stepper rail:** top, 5 nodes (Upload›Parse›Map›Review›Results); done=accent fill, current=accent ring, todo=slate.
- **Data table (members):** 32px dense rows, zebra off, hairline row dividers, sticky header, tabular
  numerals, leading provenance dot per row; selected row = `--accent-50` bg + left accent bar.
- **Provenance badge:** glyph + optional label, uses `--prov-*` (bg = tint, text = darkest shade of family).
- **Confidence dots:** ●●● high / ●●○ med / ●○○ low, in `--slate-400`.
- **Panel overlay chip (on drawing):** rounded label `P#` + area; border colour = provenance; selected = accent, review = rose.
- **Metric card (results):** label 13px `--slate-500` over number 24px/500; `--slate-50` bg, radius 10px.
- **Toast:** bottom-right, hairline card + soft shadow; status colour bar.

## 5. Iconography & motion
- Icons: single outline set (Tabler/Lucide style), 16–20px, `currentColor`.
- Motion: 120–180ms ease-out for selection/hover; no bounce. Respect `prefers-reduced-motion`.

## 6. Accessibility
- WCAG AA contrast in both modes. Never colour-only signals (provenance/status always carry glyph+label).
- Full keyboard nav; visible focus ring; overlay panels reachable/selectable by keyboard, synced to table.
