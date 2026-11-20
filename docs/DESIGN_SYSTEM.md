# Design System

FamilyPulse's visual language carries over the HCII prototype: mint paper, forest-green ink, the multicolour segmented **F·PULSE** wordmark, and thick coloured section rules. It refines them for density, accessibility and data clarity. Tokens are in `apps/web/src/styles/tokens.css`; components are in `components.css`, `layout.css` and `pages.css`, and the React components in `src/components/ui.tsx`. **Reuse these; don't create one-off variants.**

## Principles
1. **The data is the loudest thing.** Borders and whitespace do the separating; shadows are reserved for floating layers.
2. **One signature motif:** the logo's 45° chamfer appears on section rules, the active-nav marker, feature-card corners and empty-state tiles. Nowhere else.
3. **Explain numbers.** Every computed figure gets plain-language context ("74% spent with 37% of the month left") and a way to see how it was derived.
4. **Status never relies on colour alone.** Status always comes with an icon and a label.

## Colour

| Token | Hex | Use |
|---|---|---|
| `--pulse-500` | `#22E522` | Logo green: rules, active indicators, fills. **Never text** (fails contrast). |
| `--leaf-300` / `--leaf-100` | `#8EE89B` / `#DCF6E0` | Selection fills, meter tracks, tags |
| `--forest-800` | `#0C3E28` | Primary buttons, strong ink |
| `--signal-600` | `#3048FD` | Logo blue: links, focus ring, projections, "shared" badges |
| `--bg` / `--bg-header` | `#F4FAF5` / `#EFFBF1` | App background / header and sidebar (prototype mint) |
| `--ink-900/700/500/400` | `#14231A` … `#7A8B80` | Text: primary, body, secondary (5.6:1), meta |
| `--line` / `--line-strong` | `#DCE7DF` / `#B8C9BD` | Borders: hairline / control |
| Status | good `#1A7F3C`, warn `#995C00` (text) / `#E8A317` (fill), critical `#C2321F` | Reserved for state |

### Data-visualisation palettes (validated)
These were checked with a colour-vision-deficiency validator covering lightness band, chroma floor, adjacent-pair ΔE under deutan, protan and tritan simulation, normal-vision floor, and contrast on white. All checks pass.
- **Spending groups** (categorical, fixed order): Living `#D9700D` · Entertainment `#8E3AA6` · Unexpected `#0A8FA8`. The prototype used red for "Unexpected"; red is reserved for over-budget status, so teal replaces it.
- **Series:** income/baseline `#167A47` · spending `#D9700D` · projection/scenario `#3048FD` (dashed).

## Typography

| Role | Face | Size / weight |
|---|---|---|
| Page and section headings, brand moments | Montserrat (self-hosted) | 22 / 18 / 16 px · 600 |
| UI, body, numbers | IBM Plex Sans (self-hosted) | 15 px body (16 px inputs on phones, to prevent iOS zoom) · 400/500/600 |
| Hero figure (one per view) | IBM Plex Sans 600 | 40 px (34 px on phones), proportional figures |
| Table and axis numbers | IBM Plex Sans | `tabular-nums` |
| Negative money | — | True minus sign "−", e.g. `−$54.20`; percentages too (`−30%`) |

## Spacing, shape and elevation
- Spacing scale (4 px base): 4, 8, 12, 16, 20, 24, 32, 40, 56.
- Radii: 4 (tags), 6 (controls), 10 (cards), pill (badges). Chamfer: 10 px on feature cards.
- Elevation: none on cards (1 px border). `--shadow-float` only on menus, dialogs and toasts.
- Control heights: 40 px; icon buttons 44 px (the touch target); compact buttons 32 px.

## Breakpoints and layout

| Width | Layout |
|---|---|
| ≥ 1024 px | 232 px sidebar + sticky top bar; main column + 360 px side column |
| 768–1023 px | 76 px icon rail; single column |
| < 768 px | Prototype header (avatar · logo · search, bell), **bottom tabs** (Spend · Budget · Dashboard · Planner), floating "Add" button; dialogs become bottom sheets; the ledger table becomes day-grouped cards |

## Components (`src/components/ui.tsx`)
Button (primary, secondary, accent, ghost, danger; sm/md; loading), IconButton, Field (label, hint and error wiring with `aria-invalid` and `aria-describedby`), Input, Select, Textarea, **MoneyInput** (exact parsing to cents), Dialog (focus trap, Escape, returns focus; becomes a drawer or sheet), ConfirmDialog, Menu, Tabs, Segmented, Meter (with today's pace tick), Badge, StatusBadge, VisibilityBadge, Avatar, Amount, EmptyState, ErrorState, FormError, Skeleton, Spinner, PageLoading. Toasts come from `lib/toast.tsx` (with an optional Undo action).

## Charts (`src/components/charts.tsx`)
D3 scales and shapes rendered as React SVG.
- **Rules:** 2 px lines, ~10% area wash, bars ≤ 24 px with 4 px rounded data-ends, solid hairline grid, one tick style per axis (compact once an axis reaches $10K).
- **Interaction:** crosshair tooltip listing every series (keyboard: arrow keys), and a legend for two or more series.
- **Accessibility:** every chart has a "View as table" alternative and an `aria-label` summary.
- **Forms in use:** LineChart (net worth, forecast), ColumnChart (income vs spending), SegmentedBar (part-to-whole, replacing the prototype's donut), RankedBars, ProgressRing (goals).

## Interaction and motion
- Transitions are 120–200 ms with ease-out, and are disabled under `prefers-reduced-motion`.
- Focus is a 2 px Signal-blue outline with a 2 px offset.
- During a refetch the previous render stays visible at reduced opacity (no skeleton flash). Skeletons appear only on first load.
- Every mutation gives feedback: a success toast, an inline field error, or a conflict dialog. Destructive actions confirm first, or offer Undo.

## Iconography and imagery
Lucide line icons at 16–22 px, used consistently by meaning (category, account type and goal icons are mapped in `components/icons.tsx`). There is no decorative illustration; the logo is the only brand imagery (see `brand/README.md`).

## Not yet done
Dark mode (the tokens are ready to be redefined), a texture fill for print and forced-colours charts, and a multilingual UI.
