// "Smells like…": pick a perfume you love, see its pyramid and its nearest neighbours.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SearchX } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { history, useSession } from '@/lib/store'
import { go, openPerfume, sync } from '@/lib/router'
import { plural } from '@/lib/format'
import { filterParams, hydrateFilters, readFilters, type Filters } from '@/lib/filters'
import type { Perfume } from '@/lib/types'
import { useInfinite } from '@/hooks/use-infinite'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ListStatus, Page, PageHeader, SectionTitle } from '@/components/page'
import { PerfumePicker } from '@/components/picker'
import { Legend, PerfumeCard, PerfumeGrid, ResultRow } from '@/components/perfume'
import { FiltersButton, PillsBar, WithFilters } from '@/components/filters'
import { PyramidDiagram } from '@/components/notes'
import { AccordBars, RatingBadge } from '@/components/accords'
import { HeartButton, StatusButton } from '@/components/actions'
import { BrandLink, DupeBadges, TagBadges } from '@/components/brandtags'
import { BottleImg } from '@/components/media'

const PER = 24

export default function LikeView({ args, params }: ViewProps) {
  const pid = args.id ? Number(args.id) : null
  return (
    <Page wide={!!pid}>
      <PageHeader
        eyebrow="Smells like…"
        title={pid ? 'Kindred fragrances' : 'What do you love wearing?'}
        description="Pick a perfume and we will read its pyramid, then find the ones that share its notes — in the same layers first."
      />
      <PerfumePicker onPick={(p) => go(`/like/${p.id}`)} className="mb-8 max-w-2xl" autoFocus={!pid} />
      {pid ? <Similar pid={pid} params={params} /> : <Home />}
    </Page>
  )
}

// ---------------------------------------------------------------- no perfume chosen: starting points
function Home() {
  const { user } = useSession()
  const [favs, setFavs] = useState<Perfume[] | null>(null)
  const [pop, setPop] = useState<Perfume[] | null>(null)
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const fv = await api.get('/api/favorites')
        if (!dead) setFavs(fv.perfume_items.slice(0, 12))
      } catch {
        /* ignore */
      }
      if (pop) return
      try {
        const r = await api.get('/api/search', { per_page: 12, facets: 0 })
        if (!dead) setPop(r.results)
      } catch {
        if (!dead) setPop([])
      }
    })()
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])
  return (
    <div className="flex flex-col gap-10">
      {favs && favs.length > 0 && (
        <section>
          <SectionTitle>Your favorites</SectionTitle>
          <PerfumeGrid className="lg:grid-cols-5 xl:grid-cols-6">
            {favs.map((p) => (
              <PerfumeCard key={p.id} p={p} />
            ))}
          </PerfumeGrid>
        </section>
      )}
      <section>
        <SectionTitle>Popular starting points</SectionTitle>
        {pop ? (
          <PerfumeGrid className="lg:grid-cols-5 xl:grid-cols-6">
            {pop.map((p) => (
              <PerfumeCard key={p.id} p={p} />
            ))}
          </PerfumeGrid>
        ) : (
          <PerfumeGrid className="lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/7] rounded-xl" />
            ))}
          </PerfumeGrid>
        )}
        {pop && <p className="mt-4 text-sm text-muted-foreground">Click any card to open its details, then “Find similar”.</p>}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- the chosen perfume's summary
function SourceCard({ p }: { p: any }) {
  const gen = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : ''
  const tweak = () => {
    const q: Record<string, string> = {}
    for (const [k, qk] of [
      ['top', 'top'],
      ['middle', 'middle'],
      ['base', 'base'],
      ['general', 'any'],
    ]) {
      const s = (p.pyramid?.[k] || []).map((n: any) => n.slug).join(',')
      if (s) q[qk] = s
    }
    go('/pyramid', q)
  }
  return (
    <article className="grid gap-5 overflow-hidden rounded-xl border bg-card sm:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
      <div className="relative aspect-[4/5] w-full bg-white dark:bg-sand-100">
        <BottleImg p={p} alt={p.name} className="absolute inset-0 m-auto h-[94%] w-[94%] mix-blend-multiply" />
      </div>
      <div className="flex min-w-0 flex-col gap-2.5 px-5 pb-5 sm:py-6 sm:pl-0">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <BrandLink name={p.brand} className="font-medium text-foreground/80" />
          <TagBadges p={p} mode="full" link />
        </div>
        <h2 className="font-serif text-[34px] leading-[1.05] sm:text-[40px]">{p.name}</h2>
        <DupeBadges p={p} />
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {[p.year ? <span key="y" className="font-mono">{p.year}</span> : null, gen || null, p.country || null]
            .filter(Boolean)
            .map((x, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">·</span>}
                {x}
              </span>
            ))}
        </p>
        <RatingBadge p={p} className="text-sm" />
        {p.accords?.length > 0 && (
          <div className="mt-1">
            <AccordBars accords={p.accords.slice(0, 5)} />
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openPerfume(p.id)}>
            Full details
          </Button>
          <Button size="sm" variant="outline" onClick={tweak}>
            Tweak as pyramid
          </Button>
          <span className="flex">
            <StatusButton pid={p.id} />
            <HeartButton id={p.id} label="Add to favorites" />
          </span>
        </div>
      </div>
      <div className="min-w-0 px-5 pb-5 sm:col-span-2 lg:col-span-1 lg:py-6 lg:pl-0">
        <PyramidDiagram pyr={p.pyramid || {}} />
      </div>
    </article>
  )
}

// ---------------------------------------------------------------- a chosen perfume
function Similar({ pid, params }: { pid: number; params: URLSearchParams }) {
  const [f, setF] = useState<Filters>(() => readFilters(params))
  const [noSameBrand, setNoSameBrand] = useState(params.get('other_brands') === '1')
  const [onlyDupes, setOnlyDupes] = useState(params.get('only_dupes') === '1')
  const [source, setSource] = useState<any>(null)
  const [facets, setFacets] = useState<any>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [sheet, setSheet] = useState(false)
  const [dirty, setDirty] = useState(false)
  const recorded = useRef(false)

  useEffect(() => {
    hydrateFilters(f).then(setF)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = { exclude_brand: noSameBrand ? 'true' : '', only_dupes: onlyDupes ? 'true' : '', ...filterParams(f) }
  const qKey = JSON.stringify(q)
  useEffect(() => {
    if (!dirty) return
    sync(`/like/${pid}`, { ...filterParams(f), other_brands: noSameBrand ? '1' : '', only_dupes: onlyDupes ? '1' : '' }, { push: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey])

  const list = useInfinite<any>(
    async (page, signal) => {
      const off = (page - 1) * PER
      const r = await api.get(`/api/perfumes/${pid}/similar`, { ...q, limit: PER, offset: off, ff: page === 1 ? 1 : 0 }, signal)
      if (!recorded.current) {
        recorded.current = true
        setSource(r.source)
        history.record({ kind: 'like', perfume_id: r.source.id })
      }
      if (page === 1) {
        setTotal(r.total)
        setFacets(r.filter_facets)
      }
      return { items: r.results.map((x: any, i: number) => ({ ...x, _rank: off + i + 1 })), hasMore: off + PER < r.total }
    },
    [qKey],
  )
  const fetchFacet = useCallback(
    (name: string, { fq = '', offset = 0, limit = 12 }: { fq?: string; offset?: number; limit?: number }) => api.get(`/api/perfumes/${pid}/similar/facet`, { facet: name, fq, offset, limit, ...q }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qKey],
  )
  const setFilters = (nf: Filters) => {
    setDirty(true)
    setF(nf)
  }

  if (!source && list.error)
    return (
      <EmptyState icon={<SearchX className="size-5" />} title="Could not load this perfume" action={<Button variant="outline" onClick={list.retry}>Retry</Button>}>
        It may not exist, or the server is unreachable. Try another one with the search above.
      </EmptyState>
    )

  return (
    <div className="flex flex-col gap-6">
      {source ? <SourceCard p={source} /> : <Skeleton className="h-[340px] w-full rounded-xl" />}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Most similar</h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={noSameBrand}
              onCheckedChange={(v) => {
                setDirty(true)
                setNoSameBrand(v === true)
              }}
            />
            Other houses only
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm" title="Perfumes linked to this one as an original or an inspired-by version, plus fragrances from dupe houses">
            <Checkbox
              checked={onlyDupes}
              onCheckedChange={(v) => {
                setDirty(true)
                setOnlyDupes(v === true)
              }}
            />
            Only dupes / alternatives
          </label>
          <FiltersButton f={f} onClick={() => setSheet(true)} />
          <span className="font-mono text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
            {total != null && plural(total, 'perfume')}
          </span>
        </div>
        <Legend />
      </div>
      <WithFilters panel={{ f, onChange: setFilters, facets, total, fetchFacet, features: { notes: false, perfumers: true } }} open={sheet} onOpenChange={setSheet}>
        <PillsBar f={f} onChange={setFilters} className="mb-3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
          {list.items.map((it) => (
            <ResultRow key={it.id} r={it} rank={it._rank} />
          ))}
        </div>
        <ListStatus {...list} error={list.error && !!source} emptyText="Nothing similar found with those filters. If “Only dupes / alternatives” is ticked, untick it to see everything similar." />
      </WithFilters>
    </div>
  )
}
