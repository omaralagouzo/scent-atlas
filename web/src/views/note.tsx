// A single note's page: hero, "pairs well with" chips, and the perfumes that carry it (layer + sort + filters).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Layers, Shapes } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { cacheNotes } from '@/lib/store'
import { go, href, sync } from '@/lib/router'
import { layerLabel, plural } from '@/lib/format'
import { filterParams, hydrateFilters, readFilters, type Filters } from '@/lib/filters'
import { cn } from '@/lib/utils'
import type { Note, Perfume } from '@/lib/types'
import { useInfinite } from '@/hooks/use-infinite'
import { HeartButton } from '@/components/actions'
import { FiltersButton, PillsBar, WithFilters, type FetchFacet } from '@/components/filters'
import { NoteImg } from '@/components/media'
import { LAYER_COLOR, NoteChip } from '@/components/notes'
import { EmptyState, ListStatus, Page, SectionTitle } from '@/components/page'
import { PerfumeCard, PerfumeGrid } from '@/components/perfume'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const PER = 36

const SORTS: [string, string][] = [
  ['popularity', 'Most reviewed'],
  ['rating', 'Top rated'],
  ['year', 'Newest first'],
  ['year_asc', 'Oldest first'],
  ['name', 'Name A – Z'],
  ['brand', 'Brand A – Z'],
  ['dupes', 'Most known dupes'],
]

type NoteFull = Note & { layer_counts: { top: number; middle: number; base: number; general: number } }
type Pair = Note & { cooccur: number; share: number }

export default function NoteView({ args, params }: ViewProps) {
  const slug = args.slug
  const [layer, setLayer] = useState(params.get('layer') || '')
  const [sort, setSort] = useState(params.get('sort') || 'popularity')
  const [f, setF] = useState<Filters>(() => readFilters(params))
  const [hydrated, setHydrated] = useState(false)
  const [note, setNote] = useState<NoteFull | null>(null)
  const [pairs, setPairs] = useState<Pair[]>([])
  const [notFound, setNotFound] = useState(false)
  const [facets, setFacets] = useState<any>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    let dead = false
    hydrateFilters(f).then(
      (x) => {
        if (dead) return
        setF(x)
        setHydrated(true)
      },
      () => !dead && setHydrated(true),
    )
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // write state back to the URL on every change after mount (the old view's reload())
  const fp = filterParams(f)
  const fKey = JSON.stringify(fp)
  const mounted = useRef(false)
  useEffect(() => {
    if (!hydrated) return
    if (!mounted.current) {
      mounted.current = true
      return
    }
    sync(`/note/${slug}`, { layer, sort: sort === 'popularity' ? '' : sort, ...fp }, { push: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, sort, fKey, hydrated])

  const haveNote = useRef(false)
  const list = useInfinite<Perfume>(
    async (page, signal) => {
      const first = !haveNote.current
      let r: any
      try {
        r = await api.get(
          `/api/notes/${encodeURIComponent(slug)}`,
          { layer, sort, per_page: PER, page, ...(first ? {} : { pairs: 0 }), ff: page === 1 ? 1 : 0, ...fp },
          signal,
        )
      } catch (e: any) {
        if (first && e?.name !== 'AbortError') setNotFound(true)
        throw e
      }
      if (first) {
        haveNote.current = true
        cacheNotes([r.note, ...r.pairs])
        setNote(r.note)
        setPairs(r.pairs)
      }
      const ps = r.perfumes
      setTotal(ps.total)
      if (page === 1) setFacets(ps.filter_facets)
      return { items: ps.results, hasMore: page < ps.pages }
    },
    [layer, sort, fKey],
    { enabled: hydrated },
  )

  const inc = slug + (layer ? `@${layer}` : '')
  const fetchFacet: FetchFacet = (name, { fq = '', offset = 0, limit = 12 } = {}) =>
    api.get('/api/search/facet', { include: inc, ...fp, facet: name, fq, offset, limit })

  const layerOptions = useMemo(() => {
    if (!note) return []
    const lc = note.layer_counts
    const opt = (value: string, label: string, n: number) => ({
      value,
      title: `${n.toLocaleString()} perfumes`,
      label: (
        <>
          <i className="size-1.5 rounded-full" style={{ background: LAYER_COLOR[value] }} />
          {label}
          <span className="font-mono text-[11px] text-muted-foreground">{n.toLocaleString()}</span>
        </>
      ),
    })
    return [
      { value: '', label: 'All', title: `${(note.count || 0).toLocaleString()} perfumes` },
      opt('top', 'Top', lc.top),
      opt('middle', 'Heart', lc.middle),
      opt('base', 'Base', lc.base),
    ]
  }, [note])

  if (notFound)
    return (
      <Page>
        <EmptyState
          className="mt-10"
          icon={<Shapes className="size-5" />}
          title="Note not found"
          action={
            <Button asChild variant="outline">
              <a href="#/notes">Back to the library</a>
            </Button>
          }
        >
          There is no note called “{slug}”.
        </EmptyState>
      </Page>
    )

  if (!note)
    return (
      <Page wide>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
          <Skeleton className="size-36 rounded-2xl sm:size-44" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </Page>
    )

  const lc = note.layer_counts
  const stats: [string, number][] = [
    ['top', lc.top],
    ['middle', lc.middle],
    ['base', lc.base],
  ]

  return (
    <Page wide>
      {/* ---------------------------------------------------------------- hero */}
      <a href="#/notes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Note library
      </a>
      <header className="relative mb-10 overflow-hidden rounded-2xl border bg-card" style={{ '--fam': note.color } as React.CSSProperties}>
        {/* the note's own photo, blurred into a colour wash, fading into the page */}
        <div className="absolute inset-0" aria-hidden="true">
          <NoteImg n={note} className="h-full w-full scale-150 opacity-50 blur-[34px] saturate-[1.3]" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 to-background/40" />
        </div>
        <div className="relative flex flex-wrap items-center gap-5 p-5 sm:gap-8 sm:p-8">
          <div className="size-28 shrink-0 overflow-hidden rounded-full bg-muted sm:size-44">
            <NoteImg n={note} alt={note.name} className="h-full w-full" />
          </div>
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-card/70 px-2.5 py-0.5 text-xs font-medium capitalize backdrop-blur-sm">
              <i className="size-2 rounded-full bg-(--fam)" />
              {note.family}
            </span>
            <h1 className="text-[34px] leading-tight font-semibold tracking-[-0.03em] break-words sm:text-[48px]">{note.name}</h1>
            <p className="-mt-1 text-[15px] text-muted-foreground">
              Found in <span className="font-mono text-foreground">{(note.count || 0).toLocaleString()}</span> {note.count === 1 ? 'perfume' : 'perfumes'}
            </p>
            <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground" aria-label="Where it sits in the pyramid">
              {stats.map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <i className="size-2 rounded-full" style={{ background: LAYER_COLOR[k] }} />
                  <b className="font-mono font-medium text-foreground">{v.toLocaleString()}</b>
                  {layerLabel(k)}
                </span>
              ))}
              {lc.general > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <i className="size-2 rounded-full" style={{ background: LAYER_COLOR.general }} />
                  <b className="font-mono font-medium text-foreground">{lc.general.toLocaleString()}</b>
                  unlayered
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button asChild>
                <a href={href('/combine', { include: note.slug })}>
                  <Layers />
                  Combine with other notes
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={href('/pyramid', { any: note.slug })}>Build a pyramid</a>
              </Button>
              <HeartButton type="note" id={note.slug} label="Favorite this note" className="size-9 border bg-card" />
            </div>
            </div>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- pairs */}
      {pairs.length > 0 && (
        <section className="mb-10">
          <SectionTitle className="mb-1">Pairs well with</SectionTitle>
          <p className="mb-3 text-sm text-muted-foreground">Notes most often found with {note.name}; + searches the two together.</p>
          <div className="flex flex-wrap gap-1.5">
            {pairs.map((p) => (
              <NoteChip
                key={p.slug}
                n={p}
                count={p.cooccur}
                title={`${p.cooccur.toLocaleString()} perfumes contain both (${Math.round(p.share * 100)}% of ${note.name})`}
                onClick={() => go(`/note/${p.slug}`)}
                onAdd={() => go('/combine', { include: `${note.slug},${p.slug}` })}
                addTitle={`Search ${note.name} + ${p.name}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- perfumes */}
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <h2 className="mr-auto text-lg font-semibold tracking-[-0.02em] max-sm:w-full">Perfumes with {note.name}</h2>
          <Segmented label="Show perfumes where this is a… note" value={layer} onChange={setLayer} options={layerOptions} />
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort perfumes" className="w-44 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FiltersButton f={f} onClick={() => setSheet(true)} />
          <span className="font-mono text-sm text-muted-foreground" aria-live="polite">
            {total != null && plural(total, 'perfume')}
          </span>
        </div>
        <WithFilters
          open={sheet}
          onOpenChange={setSheet}
          panel={{ f, onChange: setF, facets, total, fetchFacet, features: { notes: true, perfumers: true } }}
        >
          <PillsBar f={f} onChange={setF} className="mb-4" />
          <PerfumeGrid className={cn('xl:grid-cols-4 2xl:grid-cols-5')}>
            {list.items.map((p) => (
              <PerfumeCard key={p.id} p={p} />
            ))}
          </PerfumeGrid>
          <ListStatus {...list} emptyText="No perfumes with this note in that layer." />
        </WithFilters>
      </section>
    </Page>
  )
}
