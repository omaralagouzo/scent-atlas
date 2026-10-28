# Scent Atlas design system

The new front end lives in `web/` (React + Vite + Tailwind v4 + shadcn/ui) and builds into `app/static/next/`.
Tokens are in `web/src/index.css`; shadcn primitives in `web/src/components/ui/`; Scent Atlas components in
`web/src/components/`.

## Principles

1. **The bottle is the hero.** Wherever a perfume appears, its photo leads: large, frameless, filling its tile
   (photos have white backgrounds, so they are multiplied onto the warm `bg-mat` backdrop). Scores, notes and
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
- Perfume names: Geist semibold with slight negative tracking (clean, not condensed).
- **Geist Mono** (`font-mono`): anything that reads as a score: ranks, %, vote counts, years, XP.

## Shape & elevation

- `--radius` 14px. Cards `rounded-xl`, chips/pills `rounded-full`, bottle tiles `rounded-lg` (avatars and the app icon keep the logo's 23% squircle).
- Cards are flat with a 1px border; hover lifts with `shadow-md`. Popovers/dialogs use shadcn defaults.
- Bottle photos sit on `bg-mat` (a soft warm backdrop, a touch lighter in the middle for depth) at about 90% of the
  tile, `mix-blend-multiply` so the photo's white background disappears into it. No rings or frames.
- Image tiles are square (or as tall as the content beside them), never much taller than the text they belong to.

## Page headers

One title and at most one line of explanation (it may wrap on phones). No small eyebrow line above the title.

## Scores

Match percentages use `ScoreRing`: a thin ring gauge (full circle = 100%) coloured from red (≤ 50%) through yellow
(~70%) to green (≥ 90%). Long chip rows (note families, suggested notes) show one line with "Show more" (`OneLine`).

## The shelf

My Collection (and a friend's profile) opens on the shelf: the whole collection in one frame, bottles standing in lit
niches on wooden boards (`components/shelf/shelf.tsx`, styles under "the fragrance shelf" in `index.css`). The furniture
levels up with the collection: Floating ledge (1-5), Twin shelves (6-10), Wall cabinet (11-20), Display wall (21-40),
Collector's vault (41+). Niches stay light in both themes (plaster by day, warm LED-backlit at night, with LED strips
under the boards) because the bottle photos are multiplied onto them. Never use `transform` or `z-index` on a bottle
or its row: either starts a new stacking context and the photo's white background reappears.

## Navigation

Top bar: **Discover fragrances** (a menu of the exploring tools, each with a one-line explanation: Smells like,
Layering, Notes library, Combination search, Scent pyramid builder), **Discover people**, **Friends** and **My
Collection**; then search, the notifications bell, the theme switch and the account menu. Below `lg` the same links
scroll sideways under the header. The footer only names the site and links to About & credits.

## Pages for things

Every perfume has its own page (`#/perfume/:id`, `views/perfume.tsx`): the bottle as the hero with the key facts beside
it, accords and pyramid, private notes, member reviews, what smells like it, what layers with it and its dupes. Nothing
links out to other sites. Each member has a profile (`#/u/:username`): photo, name and @username, their podium (top 3 by
default, then top 5, top 10, the full ranking or the display wall), wishlist, tried and favourites; on your own
profile also your taste profile, saved searches and history (this replaced "My Atlas").

## People

People are shown by **name first, @username second**, with their photo (`UserAvatar` in `components/avatar.tsx`
falls back to their initial on a colour derived from the username). Wherever a photo of yourself or a friend
appears (24px and up), their #1 ranked bottle sits in a small translucent white disc at its bottom centre (`top`;
the API sends it only to the person and their friends, since collections are private). Accounts still called "User
Name" get one gentle, self-dismissing reminder per visit to add their name. The Friends page opens on "What your
circle loves": owned / liked / combined leaderboards of you and your friends, top 3, 5 or 10.

## Marketplace

Members sell bottles to each other (`#/market`). A listing is a catalogue perfume (live at once) or a custom one
(reviewed by the owner on the admin first), with size, ml left (always shown as a small fill gauge), price and price
per ml in mono, box / tester tags, photos and a pickup area. Strangers only see the area and a position rounded to
about a kilometre; the exact pickup point stays with the seller until they share it in a message. There are no
reservations: buyers message the seller (`#/messages`). "Wanted" requests notify the member when a matching bottle
is listed. Delivery addresses are private and never shown on profiles. Address fields always use `AddressPicker`.

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
