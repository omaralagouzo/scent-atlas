import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { compact } from '@/lib/format'
import type { Accord } from '@/lib/types'

/** A thin segmented bar of the main accords (the perfume's own colours). */
export function MiniAccords({ accords, className }: { accords?: Accord[]; className?: string }) {
  if (!accords || !accords.length) return <div className={cn('h-1.5 rounded-full bg-muted', className)} />
  const total = accords.reduce((s, a) => s + a.strength, 0) || 1
  return (
    <div
      className={cn('flex h-1.5 gap-0.5 overflow-hidden rounded-full', className)}
      aria-label={'Main accords: ' + accords.map((a) => a.name).join(', ')}
      title={accords.map((a) => `${a.name} ${Math.round(a.strength * 100)}%`).join(' · ')}
    >
      {accords.map((a) => (
        <span key={a.name} style={{ flexGrow: a.strength / total, background: a.color }} />
      ))}
    </div>
  )
}

/** Accord strengths as quiet rows: name, a thin bar in the accord's colour, percentage. */
export function AccordBars({ accords }: { accords: Accord[] }) {
  return (
    <div className="flex flex-col gap-2">
      {accords.map((a) => (
        <div key={a.name} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-[13px]">
          <span className="flex items-center gap-2 truncate">
            <i className="size-2 shrink-0 rounded-full" style={{ background: a.color }} />
            {a.name}
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.round(a.strength * 100))}%`, background: a.color }} />
          </div>
          <span className="text-right font-mono text-[11px] text-muted-foreground">{Math.round(a.strength * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

export function RatingBadge({ p, className }: { p: { rating?: number | null; rating_count?: number | null }; className?: string }) {
  if (!p.rating) return <span className={cn('text-xs text-muted-foreground', className)}>unrated</span>
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)} title={`${p.rating} / 5`}>
      <Star className="size-3.5 fill-gold text-gold" />
      <b className="font-mono font-medium">{p.rating.toFixed(2)}</b>
      {p.rating_count ? <small className="text-muted-foreground">({compact(p.rating_count)})</small> : null}
    </span>
  )
}
