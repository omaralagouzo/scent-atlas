// Marketplace: bottles members are selling. Search by fragrance or brand, "near me" or around a chosen area with a
// radius, filter by accords, brand, gender, currency, price, ml left and box / tester, sort, and scroll for more.
// Everything is in the URL (#/market?q=…&near=1&r=10&acc=woody~amber&sort=price…) so a search can be shared.
import { useEffect, useMemo, useState } from 'react'
import { BellRing, Loader2, LocateFixed, MapPin, PackageOpen, Search, SlidersHorizontal, Store, Tag as TagIcon, X } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { sync } from '@/lib/router'
import { myPosition, type Listing, type Place } from '@/lib/market'
import { plural } from '@/lib/format'
import { authDialog, useSession } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useInfinite } from '@/hooks/use-infinite'
import { AddressPicker } from '@/components/address-picker'
import { EmptyState, ListStatus, Page, PageHeader } from '@/components/page'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingCard, ListingGrid, ListingSkeletons } from '@/components/market/listing-card'
import {
  emptyMarketFilters,
  FilterPill,
  marketFilterCount,
  marketFilterPills,
  MarketFiltersLayout,
  MarketFiltersPanel,
  type Facets,
  type MarketFilterState,
} from '@/components/market/market-filters'
import { areaOf, RADII } from '@/components/market/prefs'
import { WantedDialog, type WantedPerfume } from '@/components/market/wanted-dialog'

const PAGE = 24
const TITLE = 'Marketplace'
const BLURB = 'Bottles members are selling, partly used or new. Message the seller to arrange a pickup.'

type Sort = 'newest' | 'price' | 'price_ml' | 'distance'
const SORTS: [Sort, string][] = [
  ['newest', 'Newest'],
  ['price', 'Lowest price'],
  ['price_ml', 'Lowest price per ml'],
  ['distance', 'Nearest'],
]

type Where = { mode: 'any' } | { mode: 'near'; pos: { lat: number; lng: number } | null } | { mode: 'area'; pos: { lat: number; lng: number }; label: string }

const num = (s: string | null) => (s != null && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null)

function readFilters(p: URLSearchParams): MarketFilterState {
  const tri = (v: string | null) => (v === '1' || v === '0' ? v : '')
  return {
    ...emptyMarketFilters(),
    accords: (p.get('acc') || '').split('~').filter(Boolean),
    brand: p.get('brand') || '',
    gender: p.get('gender') || '',
    currency: p.get('cur') || '',
    price_min: p.get('pmin') || '',
    price_max: p.get('pmax') || '',
    ml_min: p.get('ml') || '',
    box: tri(p.get('box')),
    tester: tri(p.get('tester')),
  }
}

function readWhere(p: URLSearchParams): Where {
  if (p.get('near') === '1') return { mode: 'near', pos: null }
  const lat = num(p.get('lat'))
  const lng = num(p.get('lng'))
  if (lat != null && lng != null) return { mode: 'area', pos: { lat, lng }, label: p.get('area') || 'Chosen area' }
  return { mode: 'any' }
}

export default function MarketView({ params }: ViewProps) {
  const { user, loaded } = useSession()
  const [input, setInput] = useState(params.get('q') || '')
  const [q, setQ] = useState(input.trim())
  const [perfumeId, setPerfumeId] = useState<number | null>(() => num(params.get('perfume')))
  const [perfume, setPerfume] = useState<WantedPerfume | null>(null)
  const [f, setF] = useState<MarketFilterState>(() => readFilters(params))
  const [where, setWhere] = useState<Where>(() => readWhere(params))
  const [radius, setRadius] = useState(() => {
    const r = params.get('r')
    return r === 'any' ? '' : RADII.some((x) => x.value === r) ? (r as string) : '25'
  })
  const [sort, setSort] = useState<Sort>(() => (SORTS.some(([v]) => v === params.get('sort')) ? (params.get('sort') as Sort) : 'newest'))
  const [locating, setLocating] = useState(false)
  const [denied, setDenied] = useState(false)
  const [picking, setPicking] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [wantOpen, setWantOpen] = useState(false)
  const [meta, setMeta] = useState<{ total: number; facets: Facets; wanted?: number } | null>(null)

  // search box: debounced
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])

  // "near me" from a shared / reloaded URL: ask the browser again
  useEffect(() => {
    if (where.mode === 'near' && !where.pos) locate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // the "Only: <name>" chip
  useEffect(() => {
    if (!perfumeId) return setPerfume(null)
    let live = true
    api.get(`/api/perfumes/${perfumeId}`).then((r) => live && setPerfume({ id: r.id, name: r.name, brand: r.brand, image: r.image }), () => {})
    return () => {
      live = false
    }
  }, [perfumeId])

  const pos = where.mode === 'any' ? null : where.pos
  const effSort: Sort = sort === 'distance' && !pos ? 'newest' : sort

  // everything in the URL
  useEffect(() => {
    sync('/market', {
      q,
      perfume: perfumeId || '',
      near: where.mode === 'near' ? 1 : '',
      lat: where.mode === 'area' ? where.pos.lat.toFixed(4) : '',
      lng: where.mode === 'area' ? where.pos.lng.toFixed(4) : '',
      area: where.mode === 'area' ? where.label : '',
      r: where.mode === 'any' || radius === '25' ? '' : radius || 'any',
      acc: f.accords.join('~'),
      brand: f.brand,
      gender: f.gender,
      cur: f.currency,
      pmin: f.price_min,
      pmax: f.price_max,
      ml: f.ml_min,
      box: f.box,
      tester: f.tester,
      sort: sort === 'newest' ? '' : sort,
    })
  }, [q, perfumeId, where, radius, f, sort])

  const waitingForPosition = where.mode === 'near' && !where.pos
  const query = {
    q,
    perfume_id: perfumeId,
    accords: f.accords.join('~'),
    brand: f.brand,
    gender: f.gender,
    currency: f.currency,
    price_min: f.price_min,
    price_max: f.price_max,
    ml_min: f.ml_min,
    box: f.box === '' ? null : f.box === '1',
    tester: f.tester === '' ? null : f.tester === '1',
    lat: pos?.lat,
    lng: pos?.lng,
    radius_km: pos && radius ? Number(radius) : null,
    sort: effSort,
  }
  const key = JSON.stringify(query)
  const list = useInfinite<Listing>(
    async (page, signal) => {
      const r = await api.get<{ listings: Listing[]; total: number; next_offset: number | null; facets: Facets; wanted?: number }>(
        '/api/market/listings',
        { ...query, offset: (page - 1) * PAGE, limit: PAGE },
        signal,
      )
      if (page === 1) setMeta({ total: r.total, facets: r.facets, wanted: r.wanted })
      return { items: r.listings, hasMore: r.next_offset != null }
    },
    [key, user?.id],
    { enabled: !!user && !waitingForPosition },
  )

  // accord colours for the panel's dots, from the perfumes in the results
  const colors = useMemo(() => {
    const c: Record<string, string> = {}
    for (const l of list.items) for (const a of l.perfume?.accords || []) c[a.name] ??= a.color
    return c
  }, [list.items])

  async function locate() {
    setLocating(true)
    setPicking(false)
    const p = await myPosition()
    setLocating(false)
    if (p) {
      setDenied(false)
      setWhere({ mode: 'near', pos: p })
    } else {
      setDenied(true)
      setWhere({ mode: 'any' })
      setPicking(true) // fall back to choosing an area
    }
  }
  const chooseArea = (pl: Place | null) => {
    if (!pl) return
    setWhere({ mode: 'area', pos: { lat: pl.lat, lng: pl.lng }, label: areaOf(pl) || 'Chosen area' })
    setPicking(false)
  }
  const clearWhere = () => {
    setWhere({ mode: 'any' })
    setPicking(false)
    if (sort === 'distance') setSort('newest')
  }

  if (!loaded)
    return (
      <Page wide>
        <PageHeader title={TITLE} description={BLURB} />
        <Skeleton className="h-12 w-full max-w-xl" />
      </Page>
    )

  if (!user)
    return (
      <Page wide>
        <PageHeader title={TITLE} description={BLURB} />
        <EmptyState
          icon={<Store className="size-5" />}
          title="Sign in to buy and sell bottles"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => authDialog.open({ mode: 'signup' })}>Create a free account</Button>
              <Button variant="outline" onClick={() => authDialog.open({ mode: 'login' })}>
                Sign in
              </Button>
            </div>
          }
        >
          The marketplace is for members only: every seller and buyer is a real Scent Atlas member. Sell the bottles you no longer wear, or find the one you've been after near you.
        </EmptyState>
      </Page>
    )

  const pills = marketFilterPills(f)
  const nFilters = marketFilterCount(f)
  const total = meta?.total ?? null
  const narrowed = !!(q || perfumeId || nFilters || pos)
  const resetAll = () => {
    setInput('')
    setQ('')
    setPerfumeId(null)
    setF(emptyMarketFilters())
    clearWhere()
  }

  const panel = <MarketFiltersPanel f={f} onChange={setF} facets={meta?.facets || null} colors={colors} />

  return (
    <Page wide>
      <PageHeader
        title={TITLE}
        description={BLURB}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href="#/market/mine">My listings</a>
            </Button>
            <Button asChild className="bg-brand text-brand-foreground hover:bg-brand/90">
              <a href="#/market/new">
                <TagIcon />
                Sell a bottle
              </a>
            </Button>
          </>
        }
      />

      {/* search + where */}
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xl min-w-0 sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              data-search=""
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search by fragrance or brand…"
              aria-label="Search listings by fragrance or brand"
              autoComplete="off"
              className="h-12 w-full rounded-lg border border-input bg-card pr-3 pl-10 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {where.mode === 'any' ? (
              <>
                <Button variant="outline" className="h-12" onClick={locate} disabled={locating}>
                  {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}
                  Near me
                </Button>
                <Button variant={picking ? 'secondary' : 'ghost'} className="h-12" onClick={() => setPicking(!picking)} aria-expanded={picking}>
                  <MapPin />
                  Choose an area
                </Button>
              </>
            ) : (
              <>
                <span className="inline-flex h-12 items-center gap-2 rounded-lg border bg-card pr-1.5 pl-3 text-sm font-medium">
                  {where.mode === 'near' ? <LocateFixed className="size-4 text-brand" /> : <MapPin className="size-4 text-brand" />}
                  <span className="max-w-[12rem] truncate">{where.mode === 'near' ? (where.pos ? 'Near me' : 'Finding you…') : where.label}</span>
                  <button type="button" onClick={clearWhere} aria-label="Search anywhere" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="size-4" />
                  </button>
                </span>
                <Segmented label="Distance" value={radius} onChange={setRadius} options={RADII} />
              </>
            )}
          </div>
        </div>
        {picking && where.mode === 'any' && (
          <div className="flex max-w-xl flex-col gap-2 rounded-xl border bg-card p-3 sm:p-4">
            {denied && <p className="text-sm text-muted-foreground">Location is off for this site, so choose an area instead.</p>}
            <AddressPicker value={null} onChange={chooseArea} label="Choose an area" placeholder="Search for a neighbourhood or city…" />
          </div>
        )}
      </div>

      <MarketFiltersLayout panel={panel} open={sheet} onOpenChange={setSheet} total={total}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setSheet(true)} className="lg:hidden">
            <SlidersHorizontal />
            Filters
            {nFilters > 0 && <span className="grid size-5 place-items-center rounded-full bg-foreground font-mono text-[11px] text-background">{nFilters}</span>}
          </Button>
          <span aria-live="polite" className="font-mono text-sm text-muted-foreground">
            {total != null && plural(total, 'bottle')}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto hidden text-muted-foreground sm:inline-flex" onClick={() => setWantOpen(true)}>
            <BellRing />
            Can't find it? Post a request
          </Button>
          <Select value={effSort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger size="sm" aria-label="Sort listings" className="ml-auto bg-card sm:ml-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORTS.filter(([v]) => v !== 'distance' || pos).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(perfumeId || pills.length > 0) && (
          <div aria-label="Active filters" className="mb-4 flex flex-wrap items-center gap-1.5">
            {perfumeId && <FilterPill label={<>Only: {perfume ? perfume.name : '…'}</>} onRemove={() => setPerfumeId(null)} />}
            {pills.map((p) => (
              <FilterPill key={p.key} label={p.label} onRemove={() => setF(p.remove(f))} />
            ))}
            {pills.length + (perfumeId ? 1 : 0) > 1 && (
              <Button size="xs" variant="ghost" onClick={() => (setF(emptyMarketFilters()), setPerfumeId(null))}>
                Clear all
              </Button>
            )}
          </div>
        )}

        {perfumeId && perfume && meta?.wanted ? (
          <p className="mb-4 text-sm text-muted-foreground">
            <b className="font-mono font-medium text-foreground">{meta.wanted}</b> {meta.wanted === 1 ? 'member is' : 'members are'} looking for {perfume.name}.
          </p>
        ) : null}

        {waitingForPosition || (list.firstLoad && list.loading) ? (
          <ListingSkeletons />
        ) : list.empty ? (
          <EmptyState
            icon={<PackageOpen className="size-5" />}
            title={narrowed ? 'No bottles match' : 'Nothing for sale yet'}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {narrowed && (
                  <Button variant="outline" onClick={resetAll}>
                    Clear the search
                  </Button>
                )}
                <Button onClick={() => setWantOpen(true)}>
                  <BellRing />
                  Post a request
                </Button>
              </div>
            }
          >
            {narrowed
              ? pos && radius
                ? `Nothing within ${radius} km with these filters. Try a wider radius, or post a request and we'll tell you when one goes up.`
                : "Try fewer filters, or post a request and we'll tell you when one goes up."
              : 'Be the first: put up a bottle you no longer wear.'}
          </EmptyState>
        ) : (
          <ListingGrid>
            {list.items.map((l) => (
              <ListingCard key={l.id} l={l} />
            ))}
          </ListingGrid>
        )}
        <ListStatus {...list} loading={list.loading && !list.firstLoad} empty={false} />

        {!list.empty && list.done && (
          <div className={cn('mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-6 text-center')}>
            <p className="text-sm font-medium">Can't find it?</p>
            <p className="max-w-md text-sm text-muted-foreground">Post a request and we'll notify you as soon as someone puts it up for sale.</p>
            <Button variant="outline" size="sm" onClick={() => setWantOpen(true)}>
              <BellRing />
              Post a request
            </Button>
          </div>
        )}
      </MarketFiltersLayout>

      <WantedDialog open={wantOpen} onOpenChange={setWantOpen} perfume={perfume} />
    </Page>
  )
}
