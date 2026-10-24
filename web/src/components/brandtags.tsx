// Brand ("house") tags, dupe links and everything that renders them: badges with a hover card, brand links,
// the brand header, "inspired by" / "alternatives" sections and the compare-notes panel.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { href, openPerfume } from '@/lib/router'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BottleThumb } from './media'

export const TAGS: Record<string, { label: string; short: string; tip: string }> = {
  niche: { label: 'Niche', short: 'Niche', tip: 'A perfume-first house with limited distribution.' },
  designer: { label: 'Designer', short: 'Designer', tip: 'A fashion / luxury / lifestyle house or mainstream prestige brand.' },
  dupe: { label: 'Dupe house', short: 'Dupe', tip: 'A house whose catalogue is largely inspired by other perfumes.' },
  middle_eastern: { label: 'Middle Eastern', short: 'ME', tip: 'Founded or headquartered in the Middle East / GCC / Levant.' },
  middle_eastern_original: { label: 'ME original', short: 'ME original', tip: 'Middle Eastern house that makes its own originals.' },
  middle_eastern_dupe: { label: 'ME dupe', short: 'ME dupe', tip: 'Middle Eastern dupe house.' },
  untagged: { label: 'Untagged', short: 'Untagged', tip: 'No house type recorded for this brand yet.' },
}
export const CHIP_ORDER = ['niche', 'designer', 'dupe', 'middle_eastern', 'middle_eastern_original', 'middle_eastern_dupe', 'untagged']
const CONF: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
export const confLabel = (c?: string) => (c && CONF[c]) || c || ''

const encName = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/~/g, '\\~')
export const brandHref = (name: string) => href('/combine', { brands: encName(name) })
export const tagHref = (tag: string) => href('/combine', { btags: tag })

const infoCache = new Map<string, Promise<any>>()
export function brandInfo(name: string) {
  let p = infoCache.get(name)
  if (!p) {
    p = api.get('/api/brands/info', { name }).catch((e) => {
      infoCache.delete(name)
      throw e
    })
    infoCache.set(name, p)
  }
  return p
}

function useBrandInfo(name: string | null) {
  const [info, setInfo] = useState<any>(null)
  useEffect(() => {
    if (!name) return
    let live = true
    brandInfo(name).then((i) => live && setInfo(i), () => {})
    return () => {
      live = false
    }
  }, [name])
  return info
}

/** A tag pill. The colour is data (house type), kept muted. */
export function TagPill({ tag, children, inferred, link }: { tag: string; children: React.ReactNode; inferred?: boolean; link?: boolean }) {
  const cls = cn(
    'inline-flex h-5 items-center rounded-full border px-1.5 text-[11px] font-medium leading-none whitespace-nowrap text-(--tc) border-(--tc)/35 bg-(--tc)/8',
    inferred && 'border-dashed',
    link && 'hover:bg-(--tc)/15',
  )
  const style = { '--tc': `var(--t-${tag})` } as React.CSSProperties
  return link ? (
    <a className={cls} style={style} href={tagHref(tag)} title={`Show all ${TAGS[tag]?.label.toLowerCase()} houses`} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  ) : (
    <span className={cls} style={style}>
      {children}
    </span>
  )
}

function shownTags(tags: string[], mode: 'card' | 'full') {
  const main = ['niche', 'designer', 'dupe'].filter((t) => tags.includes(t))
  if (mode === 'card') {
    const out = main.slice(0, 1)
    if (tags.includes('middle_eastern')) out.push('middle_eastern')
    return out
  }
  const me = tags.find((t) => t === 'middle_eastern_original' || t === 'middle_eastern_dupe') || (tags.includes('middle_eastern') ? 'middle_eastern' : null)
  return me ? [...main, me] : main
}

function BrandCard({ name }: { name: string }) {
  const info = useBrandInfo(name)
  if (!info) return <div className="w-56 text-xs text-muted-foreground">Loading…</div>
  const tags = (info.tags || []).filter((t: string) => t !== 'middle_eastern' || !(info.tags || []).some((x: string) => x.startsWith('middle_eastern_')))
  const meta = [info.origin_country, info.parent_company ? `part of ${info.parent_company}` : null].filter(Boolean).join(' · ')
  return (
    <div className="flex max-w-72 flex-col gap-1.5 text-left">
      <strong className="text-sm">{info.name}</strong>
      {info.tagged ? (
        <div className="flex flex-wrap gap-1">
          {tags.map((t: string) => (
            <TagPill key={t} tag={t}>
              {TAGS[t]?.label || t}
            </TagPill>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground">No house type recorded yet.</div>
      )}
      {info.dupe_style && (
        <div>
          Dupe style:{' '}
          {info.dupe_style === 'open' ? 'openly inspired-by' : info.dupe_style === 'partial' ? 'mix of originals and inspired-by' : 'inspired-by, not stated publicly'}
        </div>
      )}
      {meta && <div className="text-muted-foreground">{meta}</div>}
      {info.notes && <p className="leading-snug">{info.notes}</p>}
      {info.tagged && (
        <div className="text-muted-foreground">
          Confidence: {info.confidence || 'unknown'}
          {info.inferred ? ' · inferred by heuristics, not individually researched' : ''}
        </div>
      )}
    </div>
  )
}

/** Small house-type badges for a brand; hovering shows what we know about the house. */
export function TagBadges({ p, mode = 'card', link = false }: { p: Pick<Perfume, 'brand' | 'brand_tags' | 'brand_tags_inferred'>; mode?: 'card' | 'full'; link?: boolean }) {
  const tags = p.brand_tags || []
  if (!tags.length) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex flex-wrap items-center gap-1" tabIndex={-1} onClick={(e) => link || e.stopPropagation()}>
          {shownTags(tags, mode).map((t) => (
            <TagPill key={t} tag={t} inferred={p.brand_tags_inferred} link={link}>
              {mode === 'card' ? TAGS[t].short : TAGS[t].label}
            </TagPill>
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="bg-popover text-popover-foreground border shadow-md [&>span]:hidden">
        <BrandCard name={p.brand} />
      </TooltipContent>
    </Tooltip>
  )
}

export function BrandLink({ name, className }: { name: string; className?: string }) {
  return (
    <a href={brandHref(name)} title={`All ${name} perfumes`} onClick={(e) => e.stopPropagation()} className={cn('hover:text-foreground hover:underline underline-offset-2', className)}>
      {name}
    </a>
  )
}

const dbadge = 'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap'
export function DupeBadges({ p }: { p: Pick<Perfume, 'is_dupe' | 'n_dupes'> }) {
  if (!p.is_dupe && !p.n_dupes) return null
  return (
    <div className="flex flex-wrap gap-1">
      {p.is_dupe && (
        <span className={cn(dbadge, 'bg-muted text-muted-foreground')} title="Inspired by a known original - open it to see which">
          Inspired by…
        </span>
      )}
      {!!p.n_dupes && (
        <span className={cn(dbadge, 'bg-muted text-foreground')} title={`${plural(p.n_dupes, 'known dupe')} / alternatives`}>
          {plural(p.n_dupes, 'alternative')}
        </span>
      )}
    </div>
  )
}

export function LinkBadge({ link }: { link?: Perfume['dupe_link'] }) {
  if (!link) return null
  return (
    <span className={cn(dbadge, 'bg-muted text-foreground')} title={`${link.basis_label} · ${confLabel(link.confidence)} confidence`}>
      {link.relation === 'dupe' ? 'Alternative to this' : 'The original it is inspired by'}
    </span>
  )
}

export function SourceLinks({ urls, max = 3 }: { urls?: string[]; max?: number }) {
  const list = (urls || []).filter((u) => /^https?:\/\//.test(u)).slice(0, max)
  if (!list.length) return null
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {list.map((u) => {
        let host = u
        try {
          host = new URL(u).hostname.replace(/^www\./, '')
        } catch {
          /* keep raw */
        }
        return (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" title={u} onClick={(e) => e.stopPropagation()} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {host}
          </a>
        )
      })}
    </span>
  )
}

/** Header shown on the Combine page when exactly one brand is selected. */
export function BrandHeader({ name }: { name: string }) {
  const i = useBrandInfo(name)
  if (!i) return null
  const meta = [i.origin_country, i.parent_company ? `part of ${i.parent_company}` : null, plural(i.count, 'perfume')].filter(Boolean)
  return (
    <section aria-label={`About ${name}`} className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{i.name}</h2>
        {i.tagged ? <TagBadges p={{ brand: i.name, brand_tags: i.tags, brand_tags_inferred: i.inferred }} mode="full" link /> : <span className="text-xs text-muted-foreground">No house type recorded yet</span>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{meta.join(' · ')}</p>
      {i.notes && (
        <p className="mt-2 max-w-3xl text-sm">
          {i.notes}
          {i.confidence && <span className="text-muted-foreground"> ({i.confidence} confidence{i.inferred ? ', inferred' : ''})</span>}
        </p>
      )}
      <div className="mt-2">
        <SourceLinks urls={i.sources} />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- drawer: inspired-by / alternatives / compare
function ConfPill({ c }: { c: string }) {
  const color = c === 'high' ? 'text-success bg-success/10' : c === 'medium' ? 'text-warning bg-warning/10' : 'text-muted-foreground bg-muted'
  return <span className={cn(dbadge, color)}>{confLabel(c)}</span>
}

function MiniCard({ it, active, onCompare }: { it: any; active: boolean; onCompare: (it: any) => void }) {
  return (
    <article
      tabIndex={0}
      role="link"
      aria-label={`${it.name} by ${it.brand}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a, button')) openPerfume(it.id)
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          openPerfume(it.id)
        }
      }}
      className={cn('flex w-60 shrink-0 cursor-pointer gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/40', active && 'border-brand ring-2 ring-brand/20')}
    >
      <BottleThumb p={it} size={52} />
      <div className="flex min-w-0 flex-col gap-1">
        <h4 className="truncate font-semibold tracking-[-0.015em] text-[15px] leading-tight">{it.name}</h4>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <BrandLink name={it.brand} />
          <TagBadges p={it} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <ConfPill c={it.confidence} />
          <span className="text-muted-foreground" title="How this link was established">
            {it.basis_label}
          </span>
        </div>
        <SourceLinks urls={it.sources} max={2} />
        <Button
          size="xs"
          variant="outline"
          className="mt-1 self-start"
          onClick={(e) => {
            e.stopPropagation()
            onCompare(it)
          }}
        >
          Compare notes
        </Button>
      </div>
    </article>
  )
}

export function DupeSections({ p }: { p: any }) {
  const [activeId, setActiveId] = useState<number | null>(null)
  const [cmp, setCmp] = useState<any>(null)
  const [cmpState, setCmpState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [items, setItems] = useState<any[]>(p.dupes || [])
  const [loadingMore, setLoadingMore] = useState(false)

  const compare = async (it: any) => {
    if (activeId === it.id) {
      setActiveId(null)
      setCmp(null)
      return
    }
    setActiveId(it.id)
    setCmp(null)
    setCmpState('loading')
    try {
      const r = await api.get(`/api/perfumes/${p.id}/compare/${it.id}`)
      setCmp(r)
      setCmpState('idle')
    } catch {
      setCmpState('error')
    }
  }
  const more = async () => {
    setLoadingMore(true)
    try {
      const r = await api.get(`/api/perfumes/${p.id}/dupes`, { offset: items.length, limit: 24 })
      setItems((x) => [...x, ...r.items])
    } catch {
      /* ignore */
    }
    setLoadingMore(false)
  }
  const c = p.dupes_counts || {}
  const original = p.dupe_status?.researched && p.dupe_status?.is_original
  if (!p.dupe_of?.length && !p.dupes_total && !original) return null
  return (
    <div className="flex flex-col gap-6">
      {p.dupe_of?.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold">Inspired by</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {p.name} is an alternative to {p.dupe_of.length === 1 ? 'this fragrance' : 'these fragrances'}. Open the original to see how close the notes are.
          </p>
          <div className="flex flex-wrap gap-3">
            {p.dupe_of.map((it: any) => (
              <MiniCard key={it.id} it={it} active={activeId === it.id} onCompare={compare} />
            ))}
          </div>
        </section>
      )}
      {p.dupes_total ? (
        <section>
          <h3 className="mb-1 text-sm font-semibold">Known dupes & alternatives</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {plural(p.dupes_total, 'perfume')} listed as alternatives to {p.name}:{' '}
            {[c.high ? `${c.high} high` : null, c.medium ? `${c.medium} medium` : null, c.low ? `${c.low} low` : null].filter(Boolean).join(' · ')} confidence. Best
            evidence first, then most popular.
          </p>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-none" role="list">
            {items.map((it) => (
              <MiniCard key={it.id} it={it} active={activeId === it.id} onCompare={compare} />
            ))}
          </div>
          {items.length < p.dupes_total && (
            <Button size="sm" variant="outline" className="mt-2" disabled={loadingMore} onClick={more}>
              Show more ({p.dupes_total - items.length})
            </Button>
          )}
        </section>
      ) : p.dupe_status?.researched && p.dupe_status?.is_original ? (
        <p className="text-xs text-muted-foreground">Checked for dupes: this looks like an original and no inspired-by versions are known.</p>
      ) : null}
      {activeId != null && (
        <section className="rounded-xl border bg-card p-4">
          {cmpState === 'loading' && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}
          {cmpState === 'error' && <p className="text-sm text-muted-foreground">Could not compare these two.</p>}
          {cmp && (
            <ComparePanel
              r={cmp}
              onClose={() => {
                setActiveId(null)
                setCmp(null)
              }}
            />
          )}
        </section>
      )}
    </div>
  )
}

const LAYER_ROWS: [string, string][] = [
  ['top', 'Top'],
  ['middle', 'Heart'],
  ['base', 'Base'],
  ['general', 'Notes'],
]
const LAYER_COLOR: Record<string, string> = { top: 'var(--note-top)', middle: 'var(--note-middle)', base: 'var(--note-base)', general: 'var(--note-general)' }

export function ComparePanel({ r, onClose }: { r: any; onClose: () => void }) {
  const slugsOf = (pyr: any) => new Set(Object.values(pyr).flat().map((n: any) => n.slug))
  const A = slugsOf(r.a.pyramid)
  const B = slugsOf(r.b.pyramid)
  const sameLayer = r.shared_same_layer || {}
  const side = (other: Set<unknown>, pyr: any) =>
    LAYER_ROWS.map(([k, label]) => {
      const notes = pyr[k] || []
      if (!notes.length) return null
      return (
        <div key={k} className="flex flex-col gap-1 border-l-[3px] pl-2" style={{ borderColor: LAYER_COLOR[k] }}>
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
          <div className="flex flex-wrap gap-1">
            {notes.map((n: any) => {
              const shared = other.has(n.slug)
              const same = (sameLayer[k] || []).includes(n.slug)
              return (
                <span
                  key={n.slug}
                  title={shared ? (same ? 'Shared, same layer' : 'Shared, different layer') : 'Only in this one'}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs',
                    shared ? (same ? 'border-success/50 bg-success/10 text-foreground' : 'border-dashed border-success/50 text-foreground') : 'text-muted-foreground',
                  )}
                >
                  {n.name}
                </span>
              )
            })}
          </div>
        </div>
      )
    })
  const head = (x: any) => (
    <div className="flex items-center gap-2">
      <BottleThumb p={x} size={40} />
      <div className="min-w-0">
        <b className="block truncate font-semibold tracking-[-0.015em] text-[15px]">{x.name}</b>
        <small className="text-muted-foreground">{x.brand}</small>
      </div>
    </div>
  )
  const pct = Math.round((r.score || 0) * 100)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Compare notes</h3>
        <Button size="icon-sm" variant="ghost" aria-label="Close comparison" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <div className="font-mono text-3xl font-semibold" title={`Our "smells like" score of ${r.b.name} against ${r.a.name}`}>
          {pct}
          <small className="text-base text-muted-foreground">%</small>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-foreground" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <small className="text-xs text-muted-foreground">
            {r.shared.length} shared notes · {r.only_a} only in {r.a.name} · {r.only_b} only in {r.b.name}
          </small>
          {r.link && (
            <small className="text-xs text-muted-foreground">
              {r.link.relation === 'dupe' ? `${r.b.name} is an alternative to ${r.a.name}` : `${r.b.name} is the original`} · {r.link.basis_label} · {confLabel(r.link.confidence)} confidence
            </small>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          {head(r.a)}
          {side(B, r.a.pyramid)}
        </div>
        <div className="flex flex-col gap-3">
          {head(r.b)}
          {side(A, r.b.pyramid)}
        </div>
      </div>
    </div>
  )
}
