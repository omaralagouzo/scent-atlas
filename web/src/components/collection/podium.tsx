// Leaderboard pieces for My Collection: medal tints, the top-3 podium, rank rows, stars and the item menu.
import { ArrowDownToLine, Info, Layers, ListOrdered, MoreHorizontal, Star, Swords, Trash2 } from 'lucide-react'
import { go, openPerfume } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { MiniAccords } from '@/components/accords'
import { BrandLink } from '@/components/brandtags'
import { BottleImg, BottleThumb } from '@/components/media'
import { openProps } from '@/components/perfume'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export type Item = Perfume & { my: { status: string | null; rating: number | null; note: string | null }; rank: number | null; added_at?: number }

const MEDAL = ['--gold', '--silver', '--bronze']
const MEDAL_NAME = ['Gold', 'Silver', 'Bronze']
/** Medal tint for ranks 1–3: a coloured 1px border, a faint wash and a readable ink. Never a large fill. */
export function medal(place: number): React.CSSProperties {
  const v = MEDAL[place - 1]
  if (!v) return {}
  return {
    borderColor: `color-mix(in oklab, var(${v}) 70%, transparent)`,
    background: `color-mix(in oklab, var(${v}) 12%, var(--card))`,
    color: `color-mix(in oklab, var(${v}) 55%, var(--foreground))`,
  }
}

export function Stars({ n }: { n?: number | null }) {
  if (!n) return null
  return (
    <span className="inline-flex items-center gap-px text-gold" title={`My rating: ${n} / 5`} aria-label={`My rating ${n} of 5`}>
      {Array.from({ length: 5 }, (_, k) => (
        <Star key={k} className={cn('size-3', k < n ? 'fill-current' : 'text-border')} aria-hidden="true" />
      ))}
    </span>
  )
}

export interface ItemActions {
  moveTo: (it: Item) => void
  rankOne: (it: Item) => void
  unrank: (it: Item) => void
  remove: (it: Item) => void
}

export function MoreMenu({ it, actions, className }: { it: Item; actions: ItemActions; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`More actions for ${it.name}`}
          onClick={(e) => e.stopPropagation()}
          className={cn('grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-muted', className)}
        >
          <MoreHorizontal className="size-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="truncate font-serif text-[15px] font-normal">{it.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => openPerfume(it.id)}>
          <Info />
          Details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go(`/layering/${it.id}`)}>
          <Layers />
          Layering ideas
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {it.rank ? (
          <>
            <DropdownMenuItem onSelect={() => actions.moveTo(it)}>
              <ListOrdered />
              Move to position…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.rankOne(it)}>
              <Swords />
              Re-rank with questions
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.unrank(it)}>
              <ArrowDownToLine />
              Take off the leaderboard
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => actions.rankOne(it)}>
            <Star />
            Rank it
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(it)}>
          <Trash2 />
          Remove from collection
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------- podium
export function Podium({ top, actions }: { top: Item[]; actions: ItemActions }) {
  // DOM (and mobile) order 1, 2, 3; on wider screens 2 · 1 · 3 so the winner stands in the middle
  const pos = top.length === 3 ? ['col-span-2 sm:col-span-1 sm:order-2', 'sm:order-1', 'sm:order-3'] : ['', '', '']
  return (
    <ol className={cn('mb-8 grid items-end gap-x-3 gap-y-6 pt-4', top.length === 3 ? 'grid-cols-2 sm:grid-cols-3' : top.length === 2 ? 'grid-cols-2 sm:mx-auto sm:max-w-2xl' : 'sm:mx-auto sm:max-w-sm')} aria-label="Your top 3">
      {top.map((it, k) => (
        <PodiumCard key={it.id} it={it} place={k + 1} actions={actions} className={pos[k]} />
      ))}
    </ol>
  )
}

function PodiumCard({ it, place, actions, className }: { it: Item; place: number; actions: ItemActions; className?: string }) {
  const lift = place === 1 ? 'sm:pb-8' : place === 2 ? 'sm:pb-4' : 'sm:pb-2'
  return (
    <li
      {...openProps(it.id, `#${place}: ${it.name} by ${it.brand}`)}
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-2xl border bg-card px-3 pt-4 pb-4 sm:px-4 text-center transition-[box-shadow,transform] duration-300 ease-spring hover:-translate-y-1 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500 ease-spring',
        lift,
        className,
      )}
      style={{ borderColor: medal(place).borderColor, animationDelay: `${(place === 1 ? 0 : place === 2 ? 1 : 2) * 70}ms` }}
    >
      <span
        className={cn('absolute -top-3.5 left-1/2 grid -translate-x-1/2 place-items-center rounded-full border font-mono font-semibold shadow-xs', place === 1 ? 'size-9 text-base' : 'size-8 text-sm')}
        style={medal(place)}
        aria-hidden="true"
        title={`${MEDAL_NAME[place - 1]}`}
      >
        {place}
      </span>
      <span className={cn('mt-3 grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-lg bg-white dark:bg-sand-100', place === 1 ? 'max-w-72' : 'max-w-60')}>
        <BottleImg p={it} alt={`${it.name} bottle`} className="h-full w-full mix-blend-multiply transition-transform duration-300 ease-spring group-hover:scale-105" />
      </span>
      <h3 className={cn('max-w-full font-serif leading-tight font-normal break-words', place === 1 ? 'text-[26px]' : 'text-[19px] sm:text-[22px]')}>{it.name}</h3>
      <span className="-mt-1.5 text-xs text-muted-foreground">
        <BrandLink name={it.brand} />
      </span>
      <MiniAccords accords={it.accords} className="w-full max-w-40" />
      {it.my.rating ? <Stars n={it.my.rating} /> : null}
      <MoreMenu it={it} actions={actions} className="absolute top-2 right-2" />
    </li>
  )
}

// ---------------------------------------------------------------- rows
export function RankNum({ n }: { n: number | null }) {
  return (
    <span className="w-8 shrink-0 text-right font-mono text-sm text-muted-foreground tabular-nums" aria-label={n ? `Rank ${n}` : 'Not ranked'}>
      {n ?? '–'}
    </span>
  )
}

export function RankRow({ it, place, trailing, lead, className, ref, ...rest }: { it: Item; place: number | null; trailing?: React.ReactNode; lead?: React.ReactNode; className?: string; ref?: React.Ref<HTMLLIElement> } & React.HTMLAttributes<HTMLLIElement>) {
  return (
    <li ref={ref} {...rest} className={cn('flex items-center gap-4 border-b px-2 py-2.5 last:border-b-0 sm:px-4', className)}>
      {lead}
      <RankNum n={place} />
      <BottleThumb p={it} size={84} />
      <button type="button" onClick={() => openPerfume(it.id)} className="flex min-w-0 flex-1 flex-col items-start text-left focus-visible:underline focus-visible:outline-none">
        <b className="max-w-full truncate font-serif text-[22px] leading-tight font-normal hover:underline hover:underline-offset-2">{it.name}</b>
        <span className="max-w-full truncate text-xs text-muted-foreground">
          {it.brand}
          {it.year ? (
            <>
              {' · '}
              <span className="font-mono">{it.year}</span>
            </>
          ) : null}
        </span>
      </button>
      <MiniAccords accords={it.accords} className="hidden w-28 shrink-0 md:flex" />
      <span className="hidden w-20 shrink-0 justify-end sm:flex">
        <Stars n={it.my.rating} />
      </span>
      {trailing}
    </li>
  )
}
