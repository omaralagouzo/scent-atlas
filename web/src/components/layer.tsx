// Layering building blocks shared by the Layering page and My Collection (port of layerui.js): verdict badges,
// partner cards, pair rows, community combo cards with thumbs up / down, "layering ideas" from a shelf, principles.
import { useEffect, useState } from 'react'
import { ArrowRight, Layers, Plus, ThumbsDown, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { go } from '@/lib/router'
import { requireAuth, session } from '@/lib/store'
import { plural, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { MiniAccords } from './accords'
import { BottleImg, BottleThumb } from './media'
import { EmptyState } from './page'

export const pairHref = (a: number, b: number) => `#/layering/${a}/${b}`
export const goPair = (a: number, b: number) => go(`/layering/${a}/${b}`)

export interface PairBrief {
  score?: number
  top?: number | null
  verdict: string
  verdict_label: string
  curated?: { note: string; source: string; source_url: string } | null
  why?: { title: string; text: string }[]
  tags?: string[]
  specific?: string | null
  caution?: { title: string; text: string } | null
  note?: string
  source?: string
  source_url?: string
}
export type Partner = Perfume & { pair: PairBrief }

export interface Combo {
  id: number
  up: number
  down: number
  rank?: number
  my_vote: number
  a: Perfume
  b: Perfume
  partner?: Perfume
  ours: { verdict: string; verdict_label: string; recommended?: boolean }
  /** not sent by the API yet; shown when present */
  by?: string | { username: string } | null
  created_at?: number | null
}

// ---------------------------------------------------------------- verdict badge (status colours at low tint)
const ink = (v: string) => `color-mix(in oklab, var(${v}) 72%, var(--foreground))`
const TONE: Record<string, { dot: string; bg: string; fg?: string }> = {
  classic: { dot: 'var(--success)', bg: 'color-mix(in oklab, var(--success) 14%, transparent)', fg: ink('--success') },
  great: { dot: 'var(--success)', bg: 'color-mix(in oklab, var(--success) 10%, transparent)', fg: ink('--success') },
  good: { dot: 'var(--info)', bg: 'color-mix(in oklab, var(--info) 10%, transparent)', fg: ink('--info') },
  neutral: { dot: 'var(--muted-foreground)', bg: 'var(--muted)' },
  weak: { dot: 'var(--warning)', bg: 'color-mix(in oklab, var(--warning) 12%, transparent)', fg: ink('--warning') },
  blocked: { dot: 'var(--destructive)', bg: 'color-mix(in oklab, var(--destructive) 10%, transparent)', fg: ink('--destructive') },
}
export const verdictInk = (v: string) => TONE[v]?.fg || 'var(--muted-foreground)'

export function VerdictBadge({ v, label, big = false, className }: { v?: string | null; label?: string | null; big?: boolean; className?: string }) {
  if (!v) return null
  const t = TONE[v] || TONE.neutral
  return (
    <span
      className={cn('inline-flex w-fit items-center gap-1.5 rounded-full font-medium whitespace-nowrap', big ? 'h-8 px-3.5 text-sm' : 'h-5 px-2 text-[11px]', className)}
      style={{ background: t.bg, color: t.fg || 'var(--muted-foreground)' }}
    >
      <i className={cn('shrink-0 rounded-full', big ? 'size-2' : 'size-1.5')} style={{ background: t.dot }} aria-hidden="true" />
      {label}
    </span>
  )
}

const chip = 'inline-flex h-5 items-center rounded-full border px-2 text-[11px] whitespace-nowrap text-muted-foreground'

// ---------------------------------------------------------------- partner card
/** One partner of an anchor perfume: bottle, verdict, the best reasons, a caution, and a link to the full pair page. */
export function PartnerCard({ anchorId, p, compact = false }: { anchorId: number; p: Partner; compact?: boolean }) {
  const pr = p.pair || ({} as PairBrief)
  const tags = (pr.tags || []).slice(0, compact ? 2 : 3)
  return (
    <a
      href={pairHref(anchorId, p.id)}
      aria-label={`${p.name} by ${p.brand}: ${pr.verdict_label || ''}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className={cn('relative block w-full bg-white dark:bg-sand-100', compact ? 'aspect-square' : 'aspect-[4/3]')}>
        <BottleImg p={p} className="absolute inset-0 m-auto h-[94%] w-[94%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.03]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 pt-1 pb-3">
        <span className="flex flex-wrap items-center gap-1.5">
          <VerdictBadge v={pr.verdict} label={pr.verdict_label} />
          {pr.curated && (
            <span className={chip} title={`Recommended in ${pr.curated.source}`}>
              Recommended by name
            </span>
          )}
        </span>
        <span className="min-w-0">
          <b className="block truncate font-serif text-[19px] leading-tight font-normal">{p.name}</b>
          <span className="block truncate text-xs text-muted-foreground">{p.brand}</span>
        </span>
        <MiniAccords accords={p.accords} className="max-w-48" />
        {tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground">
                {t}
              </span>
            ))}
          </span>
        )}
        {!compact && pr.specific && <p className="text-[13px] leading-snug text-foreground/80">{pr.specific}</p>}
        {!compact && pr.caution && (
          <p className="rounded-md px-2 py-1 text-xs leading-snug" style={{ background: TONE.weak.bg, color: TONE.weak.fg }}>
            <b className="font-semibold">{pr.caution.title}: </b>
            {pr.caution.text}
          </p>
        )}
        <span className="mt-auto inline-flex items-center gap-1 pt-0.5 text-xs font-medium text-muted-foreground group-hover:text-foreground">
          Why it works & how to wear it
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </a>
  )
}

export function PartnerGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
}

// ---------------------------------------------------------------- two bottles with a plus
export function Bottles({ a, b, size = 88 }: { a: Perfume; b: Perfume; size?: number }) {
  return (
    <span className="flex shrink-0 items-center">
      <BottleThumb p={a} size={size} />
      <span className="z-10 -mx-1.5 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-xs" aria-hidden="true">
        <Plus className="size-3" />
      </span>
      <BottleThumb p={b} size={size} />
    </span>
  )
}

/** A pair of two perfumes (collection ideas, curated showcase). */
export function PairRow({ a, b, verdict, label, why, note, source, extra }: { a: Perfume; b: Perfume; verdict?: string | null; label?: string | null; why?: string | null; note?: string | null; source?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-3 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:gap-4">
      <a href={pairHref(a.id, b.id)} aria-label={`${a.name} with ${b.name}`} className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <Bottles a={a} b={b} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <b className="font-serif text-[18px] leading-tight font-normal group-hover:underline group-hover:underline-offset-2">
            {a.name}
            <span className="font-sans text-sm text-muted-foreground"> + </span>
            {b.name}
          </b>
          <small className="truncate text-xs text-muted-foreground">
            {a.brand}
            {a.brand === b.brand ? '' : ' · ' + b.brand}
          </small>
          {verdict && <VerdictBadge v={verdict} label={label} />}
          {why && <span className="text-[13px] leading-snug text-foreground/80">{why}</span>}
          {note && <span className="text-[13px] leading-snug text-foreground/80">{note}</span>}
        </span>
      </a>
      {source && <small className="text-xs text-muted-foreground sm:max-w-40 sm:text-right [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-foreground">Source: {source}</small>}
      {extra}
    </article>
  )
}

export function PairList({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>
}

// ---------------------------------------------------------------- votes
/** Thumbs up / down for a community combo. combo may be null (nobody vouched yet): voting then creates it. */
export function VotePanel({ aId, bId, combo, onChange, size = 'default' }: { aId: number; bId: number; combo: Combo | null; onChange?: (c: Combo) => void; size?: 'sm' | 'default' }) {
  const [cur, setCur] = useState<Combo | null>(combo)
  const [busy, setBusy] = useState(false)
  async function cast(v: 1 | -1) {
    if (busy) return
    if (!session.user && !(await requireAuth('Sign in to vote on layering combos.'))) return
    const next = cur && cur.my_vote === v ? 0 : v
    const prev = cur
    if (cur) {
      // optimistic: move the counts right away, settle with the server's numbers
      const up = cur.up - (cur.my_vote === 1 ? 1 : 0) + (next === 1 ? 1 : 0)
      const down = cur.down - (cur.my_vote === -1 ? 1 : 0) + (next === -1 ? 1 : 0)
      setCur({ ...cur, up, down, my_vote: next })
    }
    setBusy(true)
    try {
      let r: Combo
      if (!prev) {
        r = await api.post('/api/layering/combos', { a: aId, b: bId })
        if (next === -1) r = await api.post(`/api/layering/combos/${r.id}/vote`, { vote: -1 })
      } else r = await api.post(`/api/layering/combos/${prev.id}/vote`, { vote: next })
      setCur(r)
      onChange?.(r)
    } catch (e) {
      setCur(prev)
      toast(errorText(e, 'Could not save your vote.'))
    } finally {
      setBusy(false)
    }
  }
  const mv = cur ? cur.my_vote : 0
  const h = size === 'sm' ? 'h-8' : 'h-9'
  const btn = cn('inline-flex items-center gap-1.5 px-3 text-sm transition-colors focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none', h)
  return (
    <div role="group" aria-label="Community vote" className="inline-flex shrink-0 items-stretch overflow-hidden rounded-full border bg-card shadow-xs">
      <button
        type="button"
        aria-pressed={mv === 1}
        title="This combo works"
        onClick={() => cast(1)}
        className={cn(btn, 'pl-3.5', mv === 1 ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
      >
        <ThumbsUp className={cn('size-4 transition-transform duration-300 ease-spring', mv === 1 && '-rotate-12 scale-110 fill-current')} />
        <Count n={cur ? cur.up : 0} />
        <span className="sr-only"> thumbs up</span>
      </button>
      <span className="w-px bg-border" aria-hidden="true" />
      <button
        type="button"
        aria-pressed={mv === -1}
        title="Does not work for me"
        onClick={() => cast(-1)}
        className={cn(btn, 'pr-3.5', mv === -1 ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
      >
        <ThumbsDown className={cn('size-4 transition-transform duration-300 ease-spring', mv === -1 && 'rotate-12 scale-110 fill-current')} />
        <Count n={cur ? cur.down : 0} />
        <span className="sr-only"> thumbs down</span>
      </button>
    </div>
  )
}

/** A vote count that pops (spring) when it changes. */
function Count({ n }: { n: number }) {
  return (
    <span key={n} className="inline-block min-w-[1ch] font-mono text-[13px] tabular-nums animate-in zoom-in-50 duration-300 ease-spring">
      {n}
    </span>
  )
}

// ---------------------------------------------------------------- community combo: a social feed card
const authorOf = (c: Combo) => (typeof c.by === 'string' ? c.by : c.by?.username) || null

export function ComboCard({ c, anchorId, onChange }: { c: Combo; anchorId?: number; onChange?: (c: Combo) => void }) {
  const partner = anchorId != null ? c.partner || (c.a.id === anchorId ? c.b : c.a) : c.b
  const first = anchorId != null ? (c.a.id === anchorId ? c.a : c.b) : c.a
  const author = authorOf(c)
  const total = c.up + c.down
  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
      <header className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground uppercase" aria-hidden="true">
          {author ? author.slice(0, 1) : <Layers className="size-4" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium">{author ? `@${author}` : 'Community combo'}</span>
          <span className="text-xs text-muted-foreground">
            {c.created_at ? <span className="font-mono">{timeAgo(c.created_at)}</span> : null}
            {c.created_at ? ' · ' : ''}
            <span className="font-mono">{total}</span> {total === 1 ? 'vote' : 'votes'}
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] tracking-[.06em] text-muted-foreground uppercase">Our read</span>
          <VerdictBadge v={c.ours.verdict} label={c.ours.verdict_label} />
        </span>
      </header>
      <a href={pairHref(first.id, partner.id)} aria-hidden="true" tabIndex={-1} className="group relative grid grid-cols-2 gap-1 overflow-hidden rounded-lg">
        {[first, partner].map((x) => (
          <span key={x.id} className="relative aspect-square bg-white dark:bg-sand-100">
            <BottleImg p={x} className="absolute inset-0 m-auto h-[94%] w-[94%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.03]" />
          </span>
        ))}
        <span className="absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-card text-muted-foreground shadow-xs">
          <Plus className="size-3.5" />
        </span>
      </a>
      <a href={pairHref(first.id, partner.id)} className="group flex items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="font-serif text-[18px] leading-tight font-normal group-hover:underline group-hover:underline-offset-2">
            {first.name}
            <span className="font-sans text-sm text-muted-foreground"> + </span>
            {partner.name}
          </b>
          <small className="truncate text-xs text-muted-foreground">
            {first.brand}
            {first.brand === partner.brand ? '' : ' · ' + partner.brand}
          </small>
        </span>
      </a>
      <footer className="flex items-center justify-between gap-2">
        <VotePanel aId={first.id} bId={partner.id} combo={c} onChange={onChange} size="sm" />
        <a href={pairHref(first.id, partner.id)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          See the pair
          <ArrowRight className="size-3.5" />
        </a>
      </footer>
    </article>
  )
}

export function ComboGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>
}

// ---------------------------------------------------------------- "Layering ideas" tab of My Collection
interface ShelfIdeas {
  owned: number
  pairs: { a: Perfume; b: Perfume; pair: PairBrief }[]
  partners: Record<string, number>
}

/** The best pairs inside the user's own shelf. */
export function LayeringIdeas({ items }: { items: Perfume[] }) {
  const [r, setR] = useState<ShelfIdeas | null>(null)
  const [error, setError] = useState(false)
  const key = items.map((x) => x.id).join(',')
  useEffect(() => {
    if (items.length < 2) return
    let live = true
    setError(false)
    api.get<ShelfIdeas>('/api/me/collection/layering').then(
      (x) => live && setR(x),
      () => live && setError(true),
    )
    return () => {
      live = false
    }
  }, [key])
  if (items.length < 2)
    return (
      <EmptyState icon={<Layers className="size-5" />} title="Add at least two fragrances">
        Layering ideas compare every bottle on your shelf with every other one and keep only the pairs that clear our bar.
      </EmptyState>
    )
  if (error) return <p className="py-10 text-center text-sm text-muted-foreground">Could not load layering ideas.</p>
  if (!r)
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((k) => (
          <div key={k} className="h-[74px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  const lonely = items.filter((it) => !r.partners[String(it.id)])
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-2xl text-[15px] text-muted-foreground">
        We checked all <Num n={(r.owned * (r.owned - 1)) / 2} one="pair" /> on your shelf against what perfumers say makes layering work.{' '}
        {r.pairs.length ? (
          <>
            <Num n={r.pairs.length} one="pair" /> made the cut.
          </>
        ) : (
          'None cleared the bar, and we would rather say so than pad the list.'
        )}
      </p>
      {r.pairs.length > 0 && (
        <PairList>
          {r.pairs.map((x) => (
            <PairRow key={`${x.a.id}-${x.b.id}`} a={x.a} b={x.b} verdict={x.pair.verdict} label={x.pair.verdict_label} why={(x.pair.why || []).slice(0, 2).map((w) => w.title).join(' · ')} />
          ))}
        </PairList>
      )}
      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h3 className="text-base font-semibold tracking-[-0.02em]">Find partners for a bottle</h3>
          <small className="text-xs text-muted-foreground">across the whole catalogue</small>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((it) => {
            const n = r.partners[String(it.id)]
            return (
              <a
                key={it.id}
                href={`#/layering/${it.id}`}
                title={n ? `${plural(n, 'partner')} on your shelf` : 'No partner on your shelf yet'}
                className={cn('inline-flex max-w-full items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-sm transition-colors hover:bg-muted', !n && 'opacity-55 hover:opacity-100')}
              >
                <BottleThumb p={it} size={28} className="rounded-full" />
                <span className="truncate font-serif text-[16px] leading-none">{it.name}</span>
                {n ? <span className="font-mono text-[11px] text-muted-foreground">{n}</span> : null}
              </a>
            )
          })}
        </div>
        {lonely.length > 0 && r.pairs.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{plural(lonely.length, 'bottle')} without a partner on your shelf (dimmed): open one to see matches from the whole catalogue.</p>
        )}
      </section>
    </div>
  )
}

/** "12 pairs" with the number in mono */
const Num = ({ n, one }: { n: number; one: string }) => (
  <>
    <span className="font-mono text-foreground">{n.toLocaleString()}</span> {n === 1 ? one : one + 's'}
  </>
)

// ---------------------------------------------------------------- how we decide
const PRINCIPLES: [string, string][] = [
  ['Fresh over deep', 'One scent carries the opening, the other the drydown. Two of the same weight compete.'],
  ['Simple + complex', 'A linear, few-note scent layers cleanly; two complex compositions usually clash.'],
  ['A shared thread', 'A bridge note in both (especially in the base) makes the seam disappear.'],
  ['Not too much of one thing', 'Two heavyweights or sweet on sweet turn muddy; aquatic with dense gourmand or oud clashes.'],
  ['Not the same scent twice', 'Near-twins and dupes only make one perfume louder, so we leave them out.'],
]

/** Small "how we decide" explainer, shared by the layering home and perfume pages. */
export function Principles({ short = false }: { short?: boolean }) {
  return (
    <section className="rounded-xl border bg-muted/40 p-5">
      <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em]">How we decide</h2>
      <div className={cn('grid gap-4 sm:grid-cols-2', short ? 'lg:grid-cols-3' : 'lg:grid-cols-5')}>
        {(short ? PRINCIPLES.slice(0, 3) : PRINCIPLES).map(([t, d], k) => (
          <div key={t} className="flex flex-col gap-1">
            <span className="font-mono text-xs text-muted-foreground">{String(k + 1).padStart(2, '0')}</span>
            <b className="text-sm font-semibold">{t}</b>
            <p className="text-[13px] leading-snug text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Built from perfumer and brand guidance (Experimental Perfume Club, D.S. & Durga, Jo Malone, Maison Margiela, Jean-Claude Ellena via ELLE) and checked against 64 pairs they recommend by name. It reads notes and accords, not your skin: treat matches as strong leads and test before committing.
      </p>
    </section>
  )
}
