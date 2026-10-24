// Perfume cards (grid) and similarity result rows (lists).
import { openPerfume } from '@/lib/router'
import { layerLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { HeartButton, StatusButton } from './actions'
import { MiniAccords, RatingBadge } from './accords'
import { BrandLink, DupeBadges, LinkBadge, TagBadges } from './brandtags'
import { BottleImg } from './media'
import { LAYER_COLOR } from './notes'

const isControl = (t: EventTarget) => !!(t as HTMLElement).closest('button, a, [role="menu"], [data-no-open]')

export function openProps(id: number, label: string) {
  return {
    tabIndex: 0,
    role: 'link' as const,
    'aria-label': label,
    onClick: (e: React.MouseEvent) => {
      if (!isControl(e.target)) openPerfume(id)
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
        e.preventDefault()
        openPerfume(id)
      }
    },
  }
}

export function PerfumeCard({ p, extra, className }: { p: Perfume; extra?: React.ReactNode; className?: string }) {
  return (
    <article
      {...openProps(p.id, `${p.name} by ${p.brand}`)}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      <div className="relative aspect-[4/5] bg-white dark:bg-sand-100">
        <BottleImg p={p} className="absolute inset-0 m-auto h-[96%] w-[96%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.03]" />
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-full bg-card/80 backdrop-blur-sm">
          <StatusButton pid={p.id} />
          <HeartButton id={p.id} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pt-1 pb-3">
        <h3 className="line-clamp-2 font-serif text-[19px] leading-[1.1]">{p.name}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          <BrandLink name={p.brand} />
          <TagBadges p={p} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">{p.year || '—'}</span>
          <RatingBadge p={p} />
        </div>
        <DupeBadges p={p} />
        <MiniAccords accords={p.accords} className="mt-auto" />
        {extra ||
          (p.matched_names && p.matched_names.length ? (
            <p className="line-clamp-1 text-xs text-muted-foreground" title={`Matched: ${p.matched_names.join(', ')}`}>
              {p.matched_names.join(' · ')}
            </p>
          ) : null)}
      </div>
    </article>
  )
}

export function PerfumeGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5', className)}>{children}</div>
}

// ---------------------------------------------------------------- similarity result row
function ExplainChip({ e }: { e: any }) {
  const same = e.kind === 'exact'
  const label = same
    ? `${e.name} · ${layerLabel(e.layer).toLowerCase()}`
    : `${e.name} · ${layerLabel(e.query_layer === 'any' ? 'any' : e.query_layer).toLowerCase()} → ${layerLabel(e.layer).toLowerCase()}`
  const tip = same
    ? `Same layer: ${e.name} is a ${e.layer} note in both (${Math.round(e.contribution * 1000) / 10}% of score)`
    : e.kind === 'loose'
      ? `Loose match (${e.factor}×): layer unspecified on one side`
      : `Cross-layer match (${e.factor}×): you asked for ${e.query_layer}, it is a ${e.layer} note`
  return (
    <span title={tip} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap', !same && 'border-dashed')} style={{ borderColor: `color-mix(in srgb, ${LAYER_COLOR[e.layer] || LAYER_COLOR.general} 55%, transparent)` }}>
      <i className="size-1.5 rounded-full" style={{ background: LAYER_COLOR[e.layer] || LAYER_COLOR.general }} />
      {label}
    </span>
  )
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Legend">
      <ExplainChip e={{ kind: 'exact', name: 'same layer', layer: 'middle', contribution: 0 }} />
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5">other layer (dashed)</span>
      <span className="text-destructive/80">missing note</span>
    </div>
  )
}

export function ResultRow({ r, rank }: { r: any; rank: number }) {
  const matched = r.explanation.filter((e: any) => e.matched)
  const missing = r.explanation.filter((e: any) => !e.matched)
  const pct = Math.round(r.score * 100)
  return (
    <article
      {...openProps(r.id, `${r.name} by ${r.brand}, ${pct}% match`)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="relative aspect-square bg-white dark:bg-sand-100">
        <BottleImg p={r} className="absolute inset-0 m-auto h-[96%] w-[96%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="absolute top-2 left-2 font-mono text-xs text-muted-foreground">#{rank}</span>
        <span className="absolute top-2 right-2 rounded-full bg-card/90 px-2 py-0.5 font-mono text-sm font-semibold shadow-xs backdrop-blur-sm" title={`Raw similarity ${r.score.toFixed(3)}`}>
          {pct}%
        </span>
        <div className="absolute right-1.5 bottom-1.5 flex gap-0.5 rounded-full bg-card/85 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <StatusButton pid={r.id} />
          <HeartButton id={r.id} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 pt-1 pb-3">
        <h3 className="line-clamp-2 font-serif text-[19px] leading-[1.1]">{r.name}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
          <BrandLink name={r.brand} />
          {r.year ? <span className="font-mono text-xs">{r.year}</span> : null}
          <TagBadges p={r} />
        </div>
        {r.dupe_link ? <LinkBadge link={r.dupe_link} /> : r.is_dupe || r.n_dupes ? <DupeBadges p={r} /> : null}
        <p className="mt-auto line-clamp-2 pt-1 text-xs text-muted-foreground" title={missing.length ? `Missing: ${missing.map((m: any) => m.name).join(', ')}` : undefined}>
          <span className="text-foreground">{matched.map((e: any) => e.name).join(' · ') || 'No shared notes'}</span>
          {missing.length > 0 && <span> · {missing.length} missing</span>}
        </p>
        <MiniAccords accords={r.accords} className="h-1" />
      </div>
    </article>
  )
}
