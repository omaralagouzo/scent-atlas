// Layering: what to wear with a fragrance. Home (#/layering), one perfume (#/layering/:id), a pair (#/layering/:id/:other).
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Layers, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api, errorText } from '@/lib/api'
import { go, openPerfume } from '@/lib/router'
import { authDialog, cacheNotes, requireAuth, session, useSession } from '@/lib/store'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Note, Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AccordBars, MiniAccords } from '@/components/accords'
import { HeartButton, StatusButton } from '@/components/actions'
import { BrandLink } from '@/components/brandtags'
import { BottleImg } from '@/components/media'
import { NoteChip } from '@/components/notes'
import { Page, PageHeader } from '@/components/page'
import { PerfumePicker } from '@/components/picker'
import { ComboCard, ComboGrid, PairList, PairRow, PartnerCard, PartnerGrid, Principles, VerdictBadge, VotePanel } from '@/components/layer'
import type { Combo, PairBrief, Partner } from '@/components/layer'

const PER = 12

export default function LayeringView({ args }: ViewProps) {
  const id = args.id ? Number(args.id) : null
  const other = args.other ? Number(args.other) : null
  if (id && other) return <PairPage a={id} b={other} />
  if (id) return <OnePage id={id} />
  return <Home />
}

// ---------------------------------------------------------------- bits
function Section({ title, sub, children, className }: { title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
        {sub && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

function Callout({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed bg-card p-4 text-sm sm:flex-row sm:items-center">
      <p className="flex-1 text-muted-foreground">
        <b className="font-semibold text-foreground">{title} </b>
        {children}
      </p>
      {action}
    </div>
  )
}

const EmptyNote = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2">{children}</p>

const Crumb = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft className="size-4" />
    {children}
  </a>
)

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
    {children}
  </a>
)

const Skel = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-xl bg-muted', className)} />

const Trait = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <span title={title} className="inline-flex min-h-6 max-w-full items-center justify-center rounded-full border bg-card px-2.5 py-0.5 text-center text-xs leading-tight text-muted-foreground">
    {children}
  </span>
)

const pickerInput = 'mb-8'

// ---------------------------------------------------------------- home
interface HomeData {
  community: Combo[]
  curated: { a: Perfume; b: Perfume; note: string; source: string; source_url: string }[]
  curated_total: number
}
interface ShelfData {
  owned: number
  pairs: { a: Perfume; b: Perfume; pair: PairBrief }[]
}

function Home() {
  const { user, loaded } = useSession()
  const [home, setHome] = useState<HomeData | null>(null)
  const [mine, setMine] = useState<ShelfData | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!loaded) return
    let live = true
    Promise.all([
      api.get<HomeData>('/api/layering').catch(() => null),
      session.user ? api.get<ShelfData>('/api/me/collection/layering').catch(() => null) : Promise.resolve(null),
    ]).then(([h, m]) => {
      if (!live) return
      setHome(h)
      setMine(m)
      setReady(true)
    })
    return () => {
      live = false
    }
  }, [loaded, user?.id])

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Layers className="size-3.5" />
            Layering
          </span>
        }
        title="Wear two at once"
        description="Pick a fragrance and we will find what it layers with: from your own shelf, from what brands and perfumers recommend by name, from the community, and from the whole catalogue. Only pairs that clear our bar are suggested."
      />
      <PerfumePicker placeholder="Pick a fragrance to layer…" label="Pick a fragrance to layer" onPick={(p) => go(`/layering/${p.id}`)} autoFocus className={pickerInput} />
      {!ready ? (
        <div className="flex flex-col gap-3">
          <Skel className="h-6 w-48" />
          <Skel className="h-40" />
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {mine && mine.pairs.length > 0 ? (
            <Section title="From your shelf" sub={`The best pairs among the ${plural(mine.owned, 'fragrance')} you own.`}>
              <PairList>
                {mine.pairs.slice(0, 6).map((x) => (
                  <PairRow key={`${x.a.id}-${x.b.id}`} a={x.a} b={x.b} verdict={x.pair.verdict} label={x.pair.verdict_label} why={(x.pair.why || []).slice(0, 2).map((w) => w.title).join(' · ')} />
                ))}
              </PairList>
              {mine.pairs.length > 6 && (
                <Button variant="ghost" className="self-start" asChild>
                  <a href="#/collection?tab=layering">
                    All <span className="font-mono">{mine.pairs.length}</span> pairs
                    <ArrowRight />
                  </a>
                </Button>
              )}
            </Section>
          ) : !user ? (
            <Callout
              title="Layer what you already own."
              action={
                <Button size="sm" variant="outline" onClick={() => authDialog.open({ mode: 'signup' })}>
                  Create a free account
                </Button>
              }
            >
              Add your fragrances to My Collection and we will pair them up for you.
            </Callout>
          ) : null}
          {home && home.community.length > 0 && (
            <Section title="Community favourites" sub="Combos people vouch for, ranked by thumbs up (with a confidence correction, so 3 of 3 does not beat 40 of 45).">
              <ComboGrid>
                {home.community.slice(0, 10).map((c) => (
                  <ComboCard key={c.id} c={c} />
                ))}
              </ComboGrid>
            </Section>
          )}
          {home && home.curated.length > 0 && (
            <Section title="Recommended by brands & perfumers" sub={`${home.curated_total} pairs named in brand guides, perfumer interviews and magazines, each with its source.`}>
              <PairList>
                {home.curated.map((x) => (
                  <PairRow key={`${x.a.id}-${x.b.id}`} a={x.a} b={x.b} note={x.note} source={<Ext href={x.source_url}>{x.source}</Ext>} />
                ))}
              </PairList>
            </Section>
          )}
          {!home && <p className="text-sm text-muted-foreground">Could not load community and curated pairs.</p>}
          <Principles />
        </div>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------- one perfume
interface Traits {
  role: string
  role_label: string
  style: string
  style_label: string
}
type Source = Perfume & { traits: Traits }
interface OneData {
  source: Source
  catalog: { total: number; offset: number; items: Partner[] }
  curated: (Perfume & { pair: PairBrief })[]
  community: Combo[]
  collection?: { owned: number; items: Partner[] }
}

function OnePage({ id }: { id: number }) {
  const { user, loaded } = useSession()
  const [r, setR] = useState<OneData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [community, setCommunity] = useState<Combo[]>([])
  const [catalog, setCatalog] = useState<Partner[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  useEffect(() => {
    if (!loaded) return
    let live = true
    api.get<OneData>(`/api/layering/${id}`, { limit: PER }).then(
      (x) => {
        if (!live) return
        setR(x)
        setCommunity(x.community)
        setCatalog(x.catalog.items)
        setOffset(0)
        setHasMore(x.catalog.total > PER)
      },
      (e) => live && setErr(e.status === 404 ? 'That fragrance is not in the catalogue.' : 'Could not load layering ideas.'),
    )
    return () => {
      live = false
    }
  }, [id, loaded, user?.id])

  async function more() {
    setMoreBusy(true)
    try {
      const next = offset + PER
      const n = await api.get<OneData>(`/api/layering/${id}`, { limit: PER, offset: next })
      setCatalog((c) => [...c, ...n.catalog.items])
      setOffset(next)
      setHasMore(!(next + PER >= n.catalog.total || next + PER >= 96))
    } catch {
      toast('Could not load more.')
    }
    setMoreBusy(false)
  }

  async function suggest() {
    if (!session.user && !(await requireAuth('Sign in to suggest layering combos.'))) return
    setSuggesting(true)
  }
  async function submit(src: Perfume, p: Perfume) {
    try {
      await api.post('/api/layering/combos', { a: src.id, b: p.id })
      setSuggesting(false)
      toast(`Thanks! ${src.name} + ${p.name} is up for votes.`)
      const fresh = await api.get<OneData>(`/api/layering/${id}`, { limit: 1 })
      setCommunity(fresh.community)
    } catch (e) {
      toast(errorText(e, 'Could not save it.'))
    }
  }

  if (err)
    return (
      <Page>
        <Crumb href="#/layering">Layering</Crumb>
        <p className="py-16 text-center text-muted-foreground">{err}</p>
      </Page>
    )
  if (!r)
    return (
      <Page>
        <Crumb href="#/layering">Layering</Crumb>
        <Skel className="h-72" />
      </Page>
    )
  const s = r.source
  const c = r.collection
  return (
    <Page>
      <Crumb href="#/layering">Layering</Crumb>
      <div className="mb-10 grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl border bg-card p-4 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)_280px]">
        <button type="button" onClick={() => openPerfume(s.id)} aria-label={`${s.name} details`} className="mx-auto grid aspect-square w-40 place-items-center overflow-hidden rounded-[23%] bg-white ring-1 ring-border sm:w-48 lg:w-full dark:bg-sand-100">
          <BottleImg p={s} className="h-[86%] w-[86%] mix-blend-multiply" />
        </button>
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <p className="font-mono text-xs tracking-[.08em] text-muted-foreground uppercase">Layering with</p>
            <h1 className="mt-1 font-serif text-[36px] leading-[1.05] font-normal sm:text-[44px]">{s.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <BrandLink name={s.brand} />
              {s.year ? (
                <>
                  {' · '}
                  <span className="font-mono">{s.year}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Trait title="Heavier, base-rich scents go on first; lighter ones on top">{s.traits.role_label}</Trait>
            <Trait>{s.traits.style_label}</Trait>
          </div>
          {s.accords.length > 0 && (
            <div className="max-w-md">
              <AccordBars accords={s.accords.slice(0, 4)} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => openPerfume(s.id)}>
              Full details
            </Button>
            <Button size="sm" onClick={suggest}>
              <Plus />
              Suggest a combo
            </Button>
            <StatusButton pid={s.id} className="size-8 border" />
            <HeartButton id={s.id} label="Add to favorites" className="size-8 border" />
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <small className="text-xs text-muted-foreground">Layer something else</small>
          <PerfumePicker size="default" placeholder="Another fragrance…" label="Layer another fragrance" onPick={(p) => go(`/layering/${p.id}`)} />
        </div>
      </div>

      <div className="flex flex-col gap-10">
        {c ? (
          <Section title="From your collection" sub={c.owned ? `Checked against the ${plural(c.owned, 'other fragrance')} you own.` : null}>
            {c.items.length ? (
              <PartnerGrid>
                {c.items.map((p) => (
                  <PartnerCard key={p.id} anchorId={s.id} p={p} />
                ))}
              </PartnerGrid>
            ) : (
              <EmptyNote>
                {c.owned ? (
                  `None of your fragrances is a strong partner for ${s.name}. We only suggest pairs that clear our bar; the catalogue picks below are the place to look.`
                ) : (
                  <>
                    Add the fragrances you own to <a href="#/collection">My Collection</a> and we will tell you which of them layer with this one.
                  </>
                )}
              </EmptyNote>
            )}
          </Section>
        ) : (
          <Callout
            title="What do you already own?"
            action={
              <Button size="sm" variant="outline" onClick={() => authDialog.open({ mode: 'login' })}>
                Sign in
              </Button>
            }
          >
            Sign in and add your shelf: we will tell you which of your fragrances layer with {s.name}.
          </Callout>
        )}

        {r.curated.length > 0 && (
          <Section title="Recommended by name" sub="Pairs a brand, perfumer or editor recommends, with the source.">
            <PairList>
              {r.curated.map((p) => (
                <PairRow key={p.id} a={s} b={p} verdict={p.pair.verdict} label={`Our read: ${p.pair.verdict_label}`} note={p.pair.note} source={<Ext href={p.pair.source_url!}>{p.pair.source}</Ext>} />
              ))}
            </PairList>
          </Section>
        )}

        <Section title="Community combos">
          {community.length ? (
            <ComboGrid>
              {community.map((x) => (
                <ComboCard key={x.id} c={x} anchorId={s.id} />
              ))}
            </ComboGrid>
          ) : (
            <EmptyNote>No community combos for {s.name} yet. Tried one that works? Suggest it, and vote on the ones others share.</EmptyNote>
          )}
          <Button size="sm" variant="outline" className="self-start" onClick={suggest}>
            <Plus />
            Suggest a combo
          </Button>
        </Section>

        <Section title="Best matches across the catalogue" sub={r.catalog.total ? 'Well-known, well-rated fragrances that clear our bar, best first (at most two per house).' : null}>
          {r.catalog.total ? (
            <PartnerGrid>
              {catalog.map((p) => (
                <PartnerCard key={p.id} anchorId={s.id} p={p} />
              ))}
            </PartnerGrid>
          ) : (
            <EmptyNote>Nothing in the catalogue clears our bar for {s.name}. Some perfumes are best worn alone, and many perfumers would say that is the point.</EmptyNote>
          )}
          {hasMore && (
            <Button variant="ghost" className="self-center" disabled={moreBusy} onClick={more}>
              {moreBusy ? <Loader2 className="animate-spin" /> : null}
              Show more
              <ChevronDown />
            </Button>
          )}
        </Section>
        <Principles short />
      </div>

      <Dialog open={suggesting} onOpenChange={setSuggesting}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Suggest a combo</DialogTitle>
            <DialogDescription>What do you layer with {s.name}? It starts with your thumbs up; others can vote.</DialogDescription>
          </DialogHeader>
          <div className="min-h-[min(27rem,60vh)]">
          <PerfumePicker size="default" placeholder="Search the other fragrance…" label="Search the other fragrance" autoFocus skip={() => new Set([s.id])} onPick={(p) => submit(s, p)} />
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

// ---------------------------------------------------------------- a pair
type Side = Perfume & { traits: Traits }
interface Reason {
  title: string
  text: string
  url?: string
  source?: string
}
interface PairData {
  a: Side
  b: Side
  community: Combo | null
  report: {
    verdict: string
    verdict_label: string
    top: number | null
    recommended: boolean
    curated: { note: string; source: string; source_url: string } | null
    pros: Reason[]
    cons: Reason[]
    how_to: { first: number; second: number; steps: string[]; ratio: string; tip: string }
    blend: { facet: string; label: string; share: number }[]
    shared_notes: Note[]
  }
}

const FACET_COLORS: Record<string, string> = {
  citrus: '#f4e04d', fresh: '#7fd0d9', aquatic: '#4aa3d6', green: '#5aa645', aromatic: '#4f9d6b', fspice: '#d9822b', wspice: '#b8452c',
  floral: '#e98bb4', wfloral: '#f1d3df', rose: '#d6476b', powdery: '#b7a4d6', fruity: '#f0643c', gourmand: '#d9467f', vanilla: '#f0d9a0',
  amber: '#c27a2c', boozy: '#a8553a', woody: '#8b5a2b', oud: '#4a2c1a', smoky: '#6b3e26', animalic: '#7d5a4a', musky: '#d9c9d6',
}
const facetColor = (f: string) => FACET_COLORS[f] || '#8a8f98'

function PairPage({ a, b }: { a: number; b: number }) {
  const { user, loaded } = useSession()
  const [r, setR] = useState<PairData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [votes, setVotes] = useState<number | null>(null)
  useEffect(() => {
    if (!loaded) return
    let live = true
    api.get<PairData>(`/api/layering/${a}/with/${b}`).then(
      (x) => {
        if (!live) return
        cacheNotes(x.report.shared_notes)
        setR(x)
        setVotes(x.community ? x.community.up + x.community.down : null)
      },
      (e) => live && setErr(e.status === 404 ? 'One of these fragrances is not in the catalogue.' : 'Could not load this pair.'),
    )
    return () => {
      live = false
    }
  }, [a, b, loaded, user?.id])

  if (err || !r)
    return (
      <Page>
        <Crumb href={`#/layering/${a}`}>All partners</Crumb>
        {err ? <p className="py-16 text-center text-muted-foreground">{err}</p> : <Skel className="h-80" />}
      </Page>
    )
  const rep = r.report
  const first = rep.how_to.first === r.a.id ? r.a : r.b
  const second = first === r.a ? r.b : r.a
  const side = (p: Side, order: 1 | 2) => (
    <button
      type="button"
      onClick={() => openPerfume(p.id)}
      aria-label={`${p.name} by ${p.brand}, ${order === 1 ? 'apply first' : 'then on top'}`}
      className="group flex min-w-0 flex-1 flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="font-mono text-[11px] tracking-[.06em] text-muted-foreground uppercase">{order === 1 ? '1 · apply first' : '2 · then on top'}</span>
      <span className="grid aspect-square w-full max-w-44 place-items-center overflow-hidden rounded-[23%] bg-white ring-1 ring-border dark:bg-sand-100">
        <BottleImg p={p} className="h-[86%] w-[86%] mix-blend-multiply transition-transform duration-200 group-hover:scale-[1.03]" />
      </span>
      <b className="font-serif text-[22px] leading-tight font-normal sm:text-[26px]">{p.name}</b>
      <span className="-mt-1.5 text-xs text-muted-foreground">{p.brand}</span>
      <Trait>{p.traits.role_label}</Trait>
      <MiniAccords accords={p.accords} className="w-full max-w-40" />
    </button>
  )
  const rows = (list: Reason[], tone: 'pro' | 'con') => (
    <ul className="flex flex-col gap-3">
      {list.map((x) => (
        <li key={x.title} className="flex gap-2.5">
          <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', tone === 'pro' ? 'bg-success' : 'bg-warning')} aria-hidden="true" />
          <div className="min-w-0">
            <b className="text-sm font-semibold">{x.title}</b>
            <p className="text-sm leading-snug text-muted-foreground">
              {x.text}
              {x.url ? (
                <>
                  {' '}
                  <Ext href={x.url}>({x.source})</Ext>
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
  const sub = 'mt-5 mb-2 text-sm font-semibold'
  return (
    <Page>
      <Crumb href={`#/layering/${a}`}>All partners</Crumb>
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl border bg-card p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
        <div className="flex items-start gap-1 sm:gap-3">
          {side(first, 1)}
          <span className="mt-[30%] grid size-9 shrink-0 place-items-center rounded-full border bg-background text-muted-foreground" aria-hidden="true">
            <Plus className="size-4" />
          </span>
          {side(second, 2)}
        </div>
        <div className="flex flex-col items-start gap-2 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <span className="font-mono text-xs tracking-[.08em] text-muted-foreground uppercase">Our verdict</span>
          <VerdictBadge v={rep.verdict} label={rep.verdict_label} big />
          {rep.top != null && (
            <p className="text-sm text-muted-foreground">
              Scores in the top <b className="font-mono font-medium text-foreground">{rep.top}%</b> of {rep.recommended ? 'all pairings we can make.' : 'pairings, below our bar for a recommendation.'}
            </p>
          )}
          {rep.curated && (
            <p className="flex gap-1.5 text-sm text-muted-foreground">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <b className="font-medium text-foreground">Recommended by name: </b>
                {rep.curated.note} <Ext href={rep.curated.source_url}>({rep.curated.source})</Ext>
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">{rep.pros.length ? 'Why it works' : 'What works'}</h2>
          {rep.pros.length ? rows(rep.pros, 'pro') : <p className="text-sm text-muted-foreground">Nothing in particular ties these two together.</p>}
          {rep.cons.length > 0 && (
            <>
              <h3 className={sub}>Watch out</h3>
              {rows(rep.cons, 'con')}
            </>
          )}
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">How to wear it</h2>
          <ol className="flex flex-col gap-2">
            {rep.how_to.steps.map((t, k) => (
              <li key={k} className="flex gap-2.5 text-sm">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[11px]">{k + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm">
            <b className="font-semibold">Ratio: </b>
            {rep.how_to.ratio}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{rep.how_to.tip}</p>
          <h3 className={sub}>The blend</h3>
          <div
            role="img"
            aria-label={'The blend: ' + rep.blend.map((x) => `${x.label} ${Math.round(x.share * 100)}%`).join(', ')}
            className="flex h-2 gap-0.5 overflow-hidden rounded-full"
          >
            {rep.blend.map((x) => (
              <span key={x.facet} style={{ flexGrow: x.share, background: facetColor(x.facet) }} title={`${x.label} ${Math.round(x.share * 100)}%`} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {rep.blend.map((x) => (
              <li key={x.facet} className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: facetColor(x.facet) }} />
                {x.label}
                <span className="font-mono text-[11px]">{Math.round(x.share * 100)}%</span>
              </li>
            ))}
          </ul>
          {rep.shared_notes.length > 0 && (
            <>
              <h3 className={sub}>Notes they share</h3>
              <div className="flex flex-wrap gap-1.5">
                {rep.shared_notes.map((n) => (
                  <NoteChip key={n.slug} n={n} draggable={false} onClick={() => go(`/note/${n.slug}`)} title={`About ${n.name}`} />
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="mb-6 flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <b className="font-semibold">Does it work for you?</b>
          <p className="text-sm text-muted-foreground">{votes ? <><span className="font-mono">{votes}</span> {votes === 1 ? 'vote' : 'votes'} so far.</> : 'Nobody has voted yet: be the first.'}</p>
        </div>
        <div className="self-start sm:self-auto">
          <VotePanel aId={r.a.id} bId={r.b.id} combo={r.community} onChange={(x) => setVotes(x.up + x.down)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <a href={`#/layering/${r.a.id}`}>
            More for <span className="font-serif text-[16px]">{r.a.name}</span>
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href={`#/layering/${r.b.id}`}>
            More for <span className="font-serif text-[16px]">{r.b.name}</span>
          </a>
        </Button>
      </div>
    </Page>
  )
}
