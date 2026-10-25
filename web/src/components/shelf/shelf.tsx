// The fragrance shelf: one frame of a whole collection, bottles standing in lit niches on wooden shelves.
// The furniture upgrades with the size of the collection (tiers), like levels in a game.
import { useLayoutEffect, useRef, useState } from 'react'
import { openPerfume } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { SmartImg } from '@/components/media'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface Tier {
  level: number
  name: string
  /** first collection size that unlocks it */
  from: number
  /** bottles per shelf on a wide screen */
  cols: number
  frame: 'ledge' | 'cabinet'
  material: 'oak' | 'walnut' | 'lacquer'
  trim?: 'brass'
  brackets?: boolean
}

export const TIERS: Tier[] = [
  { level: 1, name: 'Floating ledge', from: 0, cols: 5, frame: 'ledge', material: 'oak' },
  { level: 2, name: 'Twin shelves', from: 6, cols: 5, frame: 'ledge', material: 'oak', brackets: true },
  { level: 3, name: 'Wall cabinet', from: 11, cols: 7, frame: 'cabinet', material: 'walnut' },
  { level: 4, name: 'Display wall', from: 21, cols: 8, frame: 'cabinet', material: 'walnut', trim: 'brass' },
  { level: 5, name: "Collector's vault", from: 41, cols: 10, frame: 'cabinet', material: 'lacquer', trim: 'brass' },
]

export function tierFor(n: number) {
  let t = TIERS[0]
  for (const x of TIERS) if (n >= x.from) t = x
  return t
}
export const nextTier = (n: number) => TIERS.find((t) => t.from > n) || null

type ShelfItem = Pick<Perfume, 'id' | 'name' | 'brand' | 'image'> & { rank?: number | null }

function Bottle({ p }: { p: ShelfItem }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="shelf-bottle" onClick={() => openPerfume(p.id)} aria-label={`${p.rank ? `#${p.rank} ` : ''}${p.name} by ${p.brand}`}>
          <SmartImg src={p.image} fallback={`/img/perfume/${p.id}`} alt="" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-center">
        {p.rank ? <span className="font-mono text-[11px] opacity-70">#{p.rank} · </span> : null}
        <b className="font-semibold">{p.name}</b>
        <span className="block text-[11px] opacity-70">{p.brand}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function Board({ brackets }: { brackets?: boolean }) {
  return (
    <div className="shelf-board" aria-hidden="true">
      <div className="shelf-board-top" />
      <div className="shelf-board-edge" />
      {brackets && (
        <>
          <span className="shelf-bracket" style={{ left: '14%' }} />
          <span className="shelf-bracket" style={{ right: '14%', transform: 'scaleX(-1)' }} />
        </>
      )}
    </div>
  )
}

export function Shelf({ items, className, empty }: { items: ShelfItem[]; className?: string; empty?: React.ReactNode }) {
  const tier = tierFor(items.length)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const narrow = width < 560
  const slot = narrow ? 62 : width < 900 ? 84 : 100
  const fit = Math.max(3, Math.floor((width - (tier.frame === 'cabinet' ? 80 : 56)) / (slot + 12)))
  const cols = Math.min(tier.cols, fit)
  const minRows = tier.level === 1 ? 1 : tier.level === 2 ? 2 : 2
  const rows: ShelfItem[][] = []
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols))
  while (rows.length < minRows) rows.push([])
  const h = narrow ? 108 : width < 900 ? 132 : 156
  const style = { '--shelf-h': `${h}px`, '--shelf-slot': `${slot}px`, '--shelf-gap': narrow ? '8px' : '14px' } as React.CSSProperties

  const niches = rows.map((row, r) => (
    <div key={r} className={cn(tier.frame === 'cabinet' ? 'mb-3 last:mb-0' : 'mb-9 last:mb-0')}>
      <div className="shelf-niche">
        <Board brackets={tier.brackets} />
        <div className="shelf-bottles">
          {row.map((p) => (
            <Bottle key={p.id} p={p} />
          ))}
          {!row.length && r === 0 && empty ? <div className="self-center text-sm text-sand-600">{empty}</div> : null}
        </div>
      </div>
    </div>
  ))

  return (
    <div
      ref={box}
      className={cn('shelf-wall grain px-4 pt-8 pb-10 sm:px-8', tier.trim && 'shelf-trim', className)}
      data-material={tier.material}
      data-trim={tier.trim}
      style={{ ...style, '--grain-opacity': 0.05 } as React.CSSProperties}
      role="group"
      aria-label={`${tier.name}: ${items.length} ${items.length === 1 ? 'bottle' : 'bottles'}`}
    >
      <div className={cn('relative mx-auto', tier.frame === 'ledge' ? 'max-w-3xl' : 'max-w-6xl')}>
        {tier.frame === 'cabinet' ? <div className="shelf-cabinet">{niches}</div> : niches}
      </div>
    </div>
  )
}

/** The tier badge + progress towards the next shelf. */
export function ShelfProgress({ count, className }: { count: number; className?: string }) {
  const t = tierFor(count)
  const nx = nextTier(count)
  const pct = nx ? Math.round(((count - t.from) / (nx.from - t.from)) * 100) : 100
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <span className="inline-flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-foreground font-mono text-xs font-semibold text-background">{t.level}</span>
        <span className="flex flex-col leading-tight">
          <b className="text-sm font-semibold">{t.name}</b>
          <small className="text-xs text-muted-foreground">
            <span className="font-mono">{count}</span> {count === 1 ? 'bottle' : 'bottles'}
          </small>
        </span>
      </span>
      {nx ? (
        <span className="flex min-w-48 flex-1 items-center gap-3">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-brand-gradient" style={{ width: `${Math.max(4, pct)}%` }} />
          </span>
          <small className="text-xs whitespace-nowrap text-muted-foreground">
            <span className="font-mono text-foreground">{nx.from - count}</span> more to unlock <b className="font-medium text-foreground">{nx.name}</b>
          </small>
        </span>
      ) : (
        <small className="text-xs text-muted-foreground">Top tier unlocked</small>
      )}
    </div>
  )
}
