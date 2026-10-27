// A perfume's own page: the bottle, who made it, how it is rated, its accords and pyramid, my private notes, what
// members say about it, what smells like it, what it layers with, and its dupes / originals.
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Lock, MessageSquarePlus, SearchX, Star } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api, ApiError, errorText } from '@/lib/api'
import { cacheNotes, history, mine, requireAuth, STATUS_LABEL, useMine, useSession } from '@/lib/store'
import { go, href } from '@/lib/router'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { AccordBars } from '@/components/accords'
import { HeartButton, StatusButton } from '@/components/actions'
import { BrandLink, DupeSections, TagBadges } from '@/components/brandtags'
import { pairHref, VerdictBadge, type Partner } from '@/components/layer'
import { BottleImg, BottleThumb } from '@/components/media'
import { PyramidDiagram } from '@/components/notes'
import { EmptyState, Page } from '@/components/page'
import { PerfumeCard } from '@/components/perfume'
import { ReviewsSection, Stars, useCommunity, type CommunityState } from '@/components/reviews'
import { Segmented } from '@/components/segmented'

export default function PerfumePage({ args }: ViewProps) {
  const id = args.id
  const [p, setP] = useState<any>(null)
  const [failed, setFailed] = useState<'missing' | 'error' | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setP(null)
    setFailed(null)
    if (!/^\d+$/.test(id)) {
      setFailed('missing')
      return
    }
    api
      .get(`/api/perfumes/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!live) return
        for (const k of ['top', 'middle', 'base', 'general']) cacheNotes(r.pyramid?.[k])
        setP(r)
        history.record({ kind: 'view', perfume_id: r.id })
      })
      .catch((e) => live && setFailed(e instanceof ApiError && (e.status === 404 || e.status === 422) ? 'missing' : 'error'))
    return () => {
      live = false
    }
  }, [id, attempt])

  useEffect(() => {
    if (!p) return
    const before = document.title
    document.title = `${p.name} by ${p.brand} · Scent Atlas`
    return () => {
      document.title = before
    }
  }, [p])

  if (failed === 'missing')
    return (
      <Page>
        <EmptyState
          icon={<SearchX className="size-5" />}
          title="We could not find this fragrance"
          action={
            <Button variant="outline" onClick={() => go('/notes')}>
              Browse by notes
            </Button>
          }
        >
          It may have been removed from the catalogue, or the link is mistyped.
        </EmptyState>
      </Page>
    )
  if (failed)
    return (
      <Page>
        <EmptyState
          title="Could not load this fragrance"
          action={
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          Check your connection and try again.
        </EmptyState>
      </Page>
    )
  if (!p) return <PageSkeleton />
  return <Detail key={p.id} p={p} />
}

function PageSkeleton() {
  return (
    <Page>
      <div aria-busy="true" aria-label="Loading fragrance" className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
        <Skeleton className="aspect-square w-full rounded-2xl" />
        <div className="flex flex-col gap-4 lg:pt-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-9 w-40" />
          <div className="mt-4 flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        </div>
      </div>
    </Page>
  )
}

/** A page section: a quiet h2, an optional link on the right. */
function Block({ id, title, sub, action, children, className }: { id?: string; title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cn('flex scroll-mt-20 flex-col gap-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={id ? `${id}-h` : undefined} className="text-lg font-semibold tracking-[-0.02em]">
            {title}
          </h2>
          {sub && <p className="text-[13px] text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function SeeAll({ to, children = 'See all' }: { to: string; children?: React.ReactNode }) {
  return (
    <a href={to} className="group inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
      {children}
      <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
    </a>
  )
}

function Detail({ p }: { p: any }) {
  const community = useCommunity(p.id)
  const hasDupes = p.dupe_of?.length > 0 || !!p.dupes_total || (p.dupe_status?.researched && p.dupe_status?.is_original)
  return (
    <Page>
      <article className="flex flex-col gap-12 sm:gap-14">
        <Hero p={p} community={community} />

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10">
          <Block title="Fragrance pyramid" sub="Open a note to see every perfume built on it.">
            <PyramidDiagram pyr={p.pyramid} />
          </Block>
          <Block title="My notes">
            <PersonalPanel pid={p.id} />
          </Block>
        </div>

        <Block id="reviews" title="What people are saying" sub="Reviews and ratings from Scent Atlas members.">
          <ReviewsSection pid={p.id} name={p.name} community={community} />
        </Block>

        <SmellsLike p={p} />

        <LayersWith p={p} />

        {hasDupes && (
          <Block title="Dupes & originals">
            <DupeSections p={p} />
          </Block>
        )}
      </article>
    </Page>
  )
}

// ---------------------------------------------------------------- hero
function Hero({ p, community }: { p: any; community: CommunityState }) {
  const gender = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : null
  const meta: React.ReactNode[] = [p.year ? <span className="font-mono">{p.year}</span> : null, gender, p.country].filter(Boolean)
  const stats = community.data?.stats
  const status = useMine(p.id)?.status || null
  const toReviews = async () => {
    const el = document.getElementById('reviews')
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    if (await requireAuth('Sign in to write a review.')) {
      setTimeout(() => document.querySelector<HTMLElement>('#reviews [role="radiogroup"] button, #reviews form textarea')?.focus({ preventScroll: true }), 350)
    }
  }
  return (
    <header className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-10">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-mat lg:sticky lg:top-20">
        <BottleImg p={p} className="absolute inset-0 m-auto h-[88%] w-[88%] mix-blend-multiply" />
      </div>

      <div className="flex min-w-0 flex-col gap-6 lg:pt-2">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
            <BrandLink name={p.brand} className="font-medium text-foreground" />
          </div>
          <h1 className="text-[34px] leading-[1.02] font-semibold tracking-[-0.03em] text-balance sm:text-[44px]">{p.name}</h1>
          {meta.length > 0 && (
            <p className="text-[15px] text-muted-foreground">
              {meta.map((m, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {m}
                </span>
              ))}
            </p>
          )}
          {p.perfumers?.length > 0 && (
            <p className="text-[15px]">
              <span className="text-muted-foreground">{p.perfumers.length > 1 ? 'Perfumers ' : 'Perfumer '}</span>
              <span className="font-medium">{p.perfumers.join(', ')}</span>
            </p>
          )}
          <BrandStrip p={p} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 sm:p-4">
            <span className="text-xs text-muted-foreground">Overall rating</span>
            {p.rating ? (
              <>
                <span className="flex items-baseline gap-1">
                  <b className="font-mono text-[28px] leading-none font-semibold tracking-[-0.02em]">{p.rating.toFixed(2)}</b>
                  <span className="font-mono text-xs text-muted-foreground">/ 5</span>
                </span>
                <Stars value={p.rating} size={14} />
                <span className="text-xs text-muted-foreground">{plural(p.rating_count || 0, 'rating')}</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Not rated yet</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="flex flex-col items-start gap-1 rounded-xl border bg-card p-3.5 text-left transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:p-4"
          >
            <span className="text-xs text-muted-foreground">Members' rating</span>
            {!stats ? (
              <>
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-20" />
              </>
            ) : stats.average != null ? (
              <>
                <span className="flex items-baseline gap-1">
                  <b className="font-mono text-[28px] leading-none font-semibold tracking-[-0.02em]">{stats.average.toFixed(2)}</b>
                  <span className="font-mono text-xs text-muted-foreground">/ 5</span>
                </span>
                <Stars value={stats.average} size={14} />
                <span className="text-xs text-muted-foreground">{plural(stats.count, 'review')}</span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">No reviews yet</span>
                <span className="text-xs text-muted-foreground">Be the first</span>
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusButton pid={p.id} className="size-10 border" />
          <HeartButton id={p.id} label="Add to favorites" className="size-10 border" />
          {status && <span className="text-sm text-muted-foreground">On your shelf: <b className="font-medium text-foreground">{STATUS_LABEL[status]}</b></span>}
          <Button variant="outline" className="ml-auto" onClick={toReviews}>
            <MessageSquarePlus />
            {community.data?.mine ? 'Your review' : 'Write a review'}
          </Button>
        </div>

        {p.accords?.length > 0 && (
          <section aria-labelledby="accords-h" className="flex flex-col gap-3 border-t pt-5">
            <h2 id="accords-h" className="text-sm font-semibold">
              Main accords
            </h2>
            <AccordBars accords={p.accords} />
          </section>
        )}
      </div>
    </header>
  )
}

function BrandStrip({ p }: { p: any }) {
  const i = p.brand_info
  if (!i) return null
  const meta = [i.origin_country, i.parent_company ? `part of ${i.parent_company}` : null].filter(Boolean).join(' · ')
  // the brand's research notes are internal working notes, so the page shows only the house type and origin
  if (!p.brand_tags?.length && !meta) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <TagBadges p={{ brand: p.brand, brand_tags: p.brand_tags, brand_tags_inferred: i.inferred }} mode="full" link />
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- "my notes": status, rating, private note
function PersonalPanel({ pid }: { pid: number }) {
  const { user } = useSession()
  const m = useMine(pid)
  const [loaded, setLoaded] = useState<'no' | 'yes' | 'error'>('no')
  const [flash, setFlash] = useState('')
  const [note, setNote] = useState('')
  const last = useRef('')

  useEffect(() => {
    if (!user) return
    let live = true
    setLoaded('no')
    api.get(`/api/me/perfumes/${pid}`).then(
      (r) => {
        if (!live) return
        setNote(r.note || '')
        last.current = r.note || ''
        setLoaded('yes')
      },
      () => live && setLoaded('error'),
    )
    return () => {
      live = false
    }
  }, [user, pid])

  const say = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash((f) => (f === msg ? '' : f)), 1600)
  }
  const put = async (fields: any) => {
    try {
      const r = await mine.save(pid, fields)
      if (r) say('Saved')
      return r
    } catch (e) {
      say(errorText(e, 'Could not save'))
      return null
    }
  }

  if (!user)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4">
        <Lock className="size-5 shrink-0 text-muted-foreground" />
        <p className="min-w-48 flex-1 text-sm text-muted-foreground">Sign in to mark this owned, tried or on your wishlist, rate it and keep a private note.</p>
        <Button size="sm" variant="outline" onClick={() => requireAuth('Sign in to keep your own collection.')}>
          Sign in
        </Button>
      </div>
    )
  if (loaded === 'no')
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  if (loaded === 'error') return <p className="text-sm text-muted-foreground">Could not load your notes.</p>
  const rating = m?.rating || 0
  return (
    <div aria-label="My notes on this fragrance" role="group" className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4">
      <div className="flex items-baseline gap-2">
        <small className="text-xs text-muted-foreground">Only you can see this.</small>
        <span role="status" aria-live="polite" className="ml-auto text-xs font-medium text-success">
          {flash}
        </span>
      </div>
      <Segmented
        label="Personal status"
        value={m?.status || ''}
        onChange={(v) => put({ status: v || null })}
        options={[
          { value: '', label: 'None' },
          { value: 'owned', label: 'Owned' },
          { value: 'tried', label: 'Tried' },
          { value: 'wishlist', label: 'Wishlist' },
        ]}
        className="self-start bg-card"
      />
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-muted-foreground">My rating</span>
        <div role="group" aria-label="My private rating" className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rating >= n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              title={rating === n ? 'Click again to clear' : `${n} / 5`}
              onClick={() => put({ rating: rating === n ? null : n })}
              className="grid size-8 place-items-center rounded-md hover:bg-card"
            >
              <Star className={cn('size-5 transition-transform', rating >= n ? 'fill-gold text-gold' : 'text-sand-300 dark:text-sand-300/50')} />
            </button>
          ))}
        </div>
      </div>
      <Textarea
        rows={3}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={async () => {
          if (note.trim() !== last.current.trim()) {
            const r = await put({ note: note.trim() || null })
            if (r) last.current = note
          }
        }}
        placeholder="A private note: when you wear it, what it reminds you of…"
        aria-label="Private note"
        className="bg-card"
      />
    </div>
  )
}

// ---------------------------------------------------------------- smells like
function SmellsLike({ p }: { p: any }) {
  const [items, setItems] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    api.get(`/api/perfumes/${p.id}/similar`, { limit: 8 }).then(
      (r) => live && setItems(r.results || []),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [p.id])
  if (failed || (items && !items.length)) return null
  return (
    <Block title="Smells like" sub={`Perfumes with the closest notes to ${p.name}.`} action={<SeeAll to={href(`/like/${p.id}`)}>See all similar</SeeAll>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {items
          ? items.map((r) => (
              <PerfumeCard
                key={r.id}
                p={r as Perfume}
                extra={<span className="font-mono text-xs text-muted-foreground">{Math.round(r.score * 100)}% similar</span>}
              />
            ))
          : Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex flex-col overflow-hidden rounded-xl border">
                <Skeleton className="aspect-square rounded-none" />
                <div className="flex flex-col gap-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
      </div>
    </Block>
  )
}

// ---------------------------------------------------------------- layers well with
function LayersWith({ p }: { p: any }) {
  const [items, setItems] = useState<Partner[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    api.get(`/api/layering/${p.id}`, { limit: 4 }).then(
      (r) => {
        if (!live) return
        const seen = new Set<number>()
        const all = [...(r.curated || []), ...(r.catalog?.items || [])].filter((x: Partner) => !seen.has(x.id) && seen.add(x.id))
        setItems(all.slice(0, 4))
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [p.id])
  if (failed) return null
  return (
    <Block title="Layers well with" sub="Pairings that clear our bar, best first." action={<SeeAll to={href(`/layering/${p.id}`)}>All layering ideas</SeeAll>}>
      {!items ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[84px] rounded-xl" />
          ))}
        </div>
      ) : items.length ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((x) => {
            const why = x.pair?.note || x.pair?.tags?.[0] || x.pair?.why?.[0]?.title
            return (
              <li key={x.id}>
                <a
                  href={pairHref(p.id, x.id)}
                  aria-label={`${p.name} with ${x.name} by ${x.brand}: ${x.pair?.verdict_label || ''}`}
                  className="group flex items-center gap-3 rounded-xl border bg-card p-2.5 pr-3 transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <BottleThumb p={x} size={64} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="min-w-0">
                      <b className="block truncate font-semibold tracking-[-0.015em] text-[15px] leading-tight group-hover:underline group-hover:underline-offset-2">{x.name}</b>
                      <span className="block truncate text-xs text-muted-foreground">{x.brand}</span>
                    </span>
                    <VerdictBadge v={x.pair?.verdict} label={x.pair?.verdict_label} />
                    {why && <span className="line-clamp-1 text-xs text-muted-foreground">{why}</span>}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                </a>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">Nothing in the catalogue clears our bar for layering with {p.name}. Some perfumes are best worn alone.</p>
      )}
    </Block>
  )
}
