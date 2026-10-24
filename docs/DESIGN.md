# Scent Atlas design system

The new front end lives in `web/` (React + Vite + Tailwind v4 + shadcn/ui) and builds into `app/static/next/`.
Tokens are in `web/src/index.css`; shadcn primitives in `web/src/components/ui/`; Scent Atlas components in
`web/src/components/`.

## Principles

1. **The bottle is the hero.** Wherever a perfume appears, its photo leads: large, frameless, filling its tile
   (photos have white backgrounds, so they sit on a white tile with `mix-blend-multiply`). Scores, notes and
   accords come after the image and stay quieter than it. Prefer image cards in a grid over text rows.
2. **Calm canvas, loud moments.** The site already carries a lot of colour (note photos, bottles, accord colours).
   The UI chrome stays neutral (sand) so that colour always means *data*.
3. **Game meets social.** Feeds, profiles and combos behave like a social app (avatars, handles, counts, relative
   time). Ranks, podiums, scores and votes are the game layer: they get mono numerals, medal colours and motion.
4. **No glare.** Gradients are directional colour shifts only: no radial highlights, white hotspots, inner shine or
   glow. Brand surfaces get 15% monochrome static (`grain` utility).

## Colour budget

| Colour | Where it may appear |
| --- | --- |
| **Sand** neutrals (`background`, `card`, `muted`, `border`, `foreground`) | Everything by default. |
| **Ink** (`primary`, near-black / near-white in dark) | Default buttons, selected segments, active nav pill on mobile. |
| **Ember** (`brand`, `brand-soft`, `brand-ink`, `ring`) | The logo, focus rings, at most **one** `brand` call to action per screen, small "new" badges. |
| **Medals** (`gold`, `silver`, `bronze`) | Ranks 1–3 only (podium, leaderboard). |
| **Data colours** (accords, note layers `note-*`, house tags `--t-*`) | Small marks: dots, thin bars, 1px borders. Never large fills. |
| **Status** (`success`, `warning`, `destructive`) | Verdicts, confirmations, errors. Tinted backgrounds at ≤ 12%. |
| `mesh-soft` | At most one hero per page, and only on personal/summary moments (e.g. the scent-profile header). |
| `mesh` / `bg-brand-gradient` + `grain` | Brand moments only: logo, link-preview card, the signed-out welcome. |

## Type

- **Geist** (UI): headings 600 with negative tracking (`tracking-[-0.03em]` for H1, `-0.02em` for H2).
- **Instrument Serif** (`font-serif`): perfume names only, and the occasional editorial headline.
- **Geist Mono** (`font-mono`): anything that reads as a score: ranks, %, vote counts, years, XP.

## Shape & elevation

- `--radius` 14px. Cards `rounded-xl`, chips/pills `rounded-full`, bottle tiles `rounded-lg` (avatars and the app icon keep the logo's 23% squircle).
- Cards are flat with a 1px border; hover lifts with `shadow-md`. Popovers/dialogs use shadcn defaults.
- Bottle photos fill a white tile edge to edge (no ring, no inner padding), `mix-blend-multiply` so the photo's white
  background merges with the tile.

## Components

Use shadcn primitives first (`Button`, `Badge`, `Dialog`, `Sheet`, `DropdownMenu`, `Tabs`, `Tooltip`, `Command`,
`Checkbox`, `Slider`, `Skeleton`, `sonner` toasts). Scent Atlas building blocks:

- `PerfumeCard`, `PerfumeGrid`, `ResultRow`, `Legend` (`components/perfume.tsx`)
- `BottleImg`, `BottleThumb`, `NoteImg` (`components/media.tsx`)
- `HeartButton`, `StatusButton` (`components/actions.tsx`)
- `MiniAccords`, `AccordBars`, `RatingBadge` (`components/accords.tsx`)
- `NoteTile`, `NoteChip`, `NoteSearch`, `PyramidDiagram`, `useDropZone` (`components/notes.tsx`)
- `PerfumePicker` (`components/picker.tsx`), `Segmented` (`components/segmented.tsx`)
- `TagBadges`, `BrandLink`, `BrandHeader`, `DupeSections`, `ComparePanel` (`components/brandtags.tsx`)
- `FiltersPanel`, `WithFilters`, `FiltersButton`, `PillsBar` (`components/filters.tsx`)
- `SavedBar`, `SavedRow` (`components/saved.tsx`)
- `Page`, `PageHeader`, `SectionTitle`, `EmptyState`, `ListStatus` (`components/page.tsx`)
- `Logo`, `Glyph`, `Wordmark` (`components/brand.tsx`)

## Motion

150–200ms ease-out for state changes; a spring (`ease-spring`) only for game moments (rank changes, votes).
Everything respects `prefers-reduced-motion`.
