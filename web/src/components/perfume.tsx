// Perfume cards (grid) and similarity result rows (lists).
import { openPerfume } from '@/lib/router'
import { layerLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { HeartButton, StatusButton } from './actions'
import { MiniAccords, RatingBadge } from './accords'
import { BrandLink, DupeBadges, LinkBadge, TagBadges } from './brandtags'
import { BottleImg, BottleThumb } from './media'
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
        <BottleImg p={p} className="absolute inset-0 m-auto h-[82%] w-[82%] mix-blend-multiply" />
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-full bg-card/80 backdrop-blur-sm">
          <StatusButton pid={p.id} />
          <HeartButton id={p.id} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 border-t p-3">
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
  const totalNotes = Object.values(r.pyramid || {}).reduce((s: number, a: any) => s + a.length, 0)
  const pct = Math.round(r.score * 100)
  return (
    <article
      {...openProps(r.id, `${r.name} by ${r.brand}, ${pct}% match`)}
      className="group grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-3 rounded-xl border bg-card p-3 transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:grid-cols-[2rem_auto_1fr_auto] sm:gap-4 sm:p-4"
    >
      <div className="hidden pt-1 text-center font-mono text-sm text-muted-foreground sm:block">{rank}</div>
      <BottleThumb p={r} size={64} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="font-serif text-xl leading-tight">{r.name}</h3>
          <span className="text-[13px] text-muted-foreground">
            <BrandLink name={r.brand} />
            {r.year ? ` · ${r.year}` : ''}
          </span>
          <TagBadges p={r} />
          {r.dupe_link ? <LinkBadge link={r.dupe_link} /> : r.is_dupe || r.n_dupes ? <DupeBadges p={r} /> : null}
        </div>
        <MiniAccords accords={r.accords} className="max-w-sm" />
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Why it matched">
          {matched.map((e: any) => (
            <ExplainChip key={e.name + e.layer} e={e} />
          ))}
          {missing.length > 0 && (
            <span className="text-xs text-destructive/80" title="Query notes this perfume lacks">
              missing: {missing.map((m: any) => m.name).join(', ')}
            </span>
          )}
          {totalNotes > 0 && <span className="text-xs text-muted-foreground">{totalNotes} notes total</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex">
          <StatusButton pid={r.id} />
          <HeartButton id={r.id} />
        </div>
        <div className="font-mono text-2xl font-semibold leading-none" title={`Raw similarity ${r.score.toFixed(3)}`}>
          {pct}
          <small className="text-sm text-muted-foreground">%</small>
        </div>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-foreground/80" style={{ width: `${Math.max(3, Math.round(r.relative * 100))}%` }} />
        </div>
        {r.shared_accords?.length > 0 && (
          <div className="flex gap-1">
            {r.shared_accords.slice(0, 3).map((a: any) => (
              <i key={a.name} className="size-2.5 rounded-full" style={{ background: a.color }} title={`shared accord: ${a.name}`} />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
