// Note-combination search. Simple = one tray of notes (all / any); Advanced = AND of OR-conditions with layers.
// Results can be filtered (column with facet counts), sorted, saved and deep-linked (everything lives in the URL).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { addAsRow, addExclude, advSentence, encodeAdv, hasAdvQuery, hydrateAdv, newAdv, newClause, readAdv, withRow, type Adv, type AdvLayer } from '@/lib/adv'
import { filterParams, hydrateFilters, readFilters, type Filters } from '@/lib/filters'
import { csv, noteImg, plural } from '@/lib/format'
import { sync } from '@/lib/router'
import { cacheNotes, history, resolveSlugs } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Note, Perfume } from '@/lib/types'
import { useInfinite } from '@/hooks/use-infinite'
import { AdvancedBuilder, useOwnDrop } from '@/components/advanced'
import { BrandHeader } from '@/components/brandtags'
import { FiltersButton, PillsBar, WithFilters } from '@/components/filters'
import { NoteChip, NoteSearch, useDropZone } from '@/components/notes'
import { ListStatus, Page, PageHeader, SectionTitle } from '@/components/page'
import { PerfumeCard, PerfumeGrid } from '@/components/perfume'
import { SavedBar } from '@/components/saved'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const PER = 36
type L = 'top' | 'middle' | 'base' | null
const CYCLE: L[] = [null, 'top', 'middle', 'base']
type TNote = Note & { layer: L }

export const SORT_OPTIONS: [string, string][] = [
  ['', 'Most reviewed'],
  ['rating', 'Top rated'],
  ['year', 'Newest first'],
  ['year_asc', 'Oldest first'],
  ['name', 'Name A – Z'],
  ['brand', 'Brand A – Z'],
  ['matches', 'Most notes matched'],
  ['dupes', 'Most known dupes'],
]
const POP = 'popular' // Select items cannot have an empty value

const parse = (s: string | null) =>
  csv(s).map((t) => {
    const [slug, layer] = t.split('@')
    return { slug, layer: layer && layer !== 'any' ? layer : null }
  })
const entry = (n: { slug: string; name: string; image?: string; color?: string }): TNote => ({ slug: n.slug, name: n.name, image: n.image || noteImg(n.slug), color: n.color, layer: null })
const tok = (n: TNote) => n.slug + (n.layer ? '@' + n.layer : '')

export default function CombineView({ params }: ViewProps) {
  // ---- state (initialised from the URL; notes are hydrated below)
  const [mode, setMode] = useState<'simple' | 'adv'>(params.get('adv') === '1' || params.has('q') ? 'adv' : 'simple')
  const [include, setInclude] = useState<TNote[]>([])
  const [exclude, setExclude] = useState<TNote[]>([])
  const [matchMode, setMatchMode] = useState<'all' | 'any'>(params.get('mode') === 'any' ? 'any' : 'all')
  const [adv, setAdvRaw] = useState<Adv>(() => withRow(newAdv()))
  const setAdv = (a: Adv) => setAdvRaw(withRow(a))
  const [sort, setSort] = useState(() => (SORT_OPTIONS.some(([v]) => v && v === params.get('sort')) ? params.get('sort')! : ''))
  const [f, setF] = useState<Filters>(() => readFilters(params))
  const [ready, setReady] = useState(false)
  const [facets, setFacets] = useState<any>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<Note[]>([])
  const [sheet, setSheet] = useState(false)

  const hasQuery = mode === 'adv' ? hasAdvQuery(adv) : include.length > 0

  const out = useMemo(
    () => ({
      ...(mode === 'adv'
        ? encodeAdv(adv)
        : { include: include.map(tok).join(','), exclude: exclude.map(tok).join(','), mode: matchMode === 'any' ? 'any' : '' }),
      ...filterParams(f),
      sort,
    }),
    [mode, adv, include, exclude, matchMode, f, sort],
  )
  const key = JSON.stringify(out)
  const outRef = useRef(out)
  outRef.current = out

  // ---- initial hydrate from the URL
  useEffect(() => {
    let dead = false
    ;(async () => {
      const hf = await hydrateFilters(readFilters(params))
      let a: Adv | null = null
      let inc: TNote[] = []
      let exc: TNote[] = []
      if (mode === 'adv') a = await hydrateAdv(readAdv(params))
      else {
        const pi = parse(params.get('include'))
        const pe = parse(params.get('exclude'))
        const notes = await resolveSlugs([...pi, ...pe].map((x) => x.slug))
        const by = Object.fromEntries(notes.map((n) => [n.slug, n]))
        inc = pi
          .filter((x) => by[x.slug])
          .map((x) => ({ ...by[x.slug], layer: (['top', 'middle', 'base'].includes(x.layer || '') ? x.layer : x.layer === 'heart' ? 'middle' : null) as L }))
        exc = pe.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], layer: null }))
      }
      if (dead) return
      setF(hf)
      if (a) setAdv(a)
      setInclude(inc)
      setExclude(exc)
      setReady(true)
    })()
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- URL + history (the first run after hydrating only loads; it does not rewrite the URL)
  const synced = useRef(false)
  useEffect(() => {
    if (!ready) return
    if (synced.current) sync('/combine', outRef.current, { push: true })
    synced.current = true
    const t = setTimeout(() => {
      if (hasQuery) history.record({ kind: 'combine', state: outRef.current })
    }, 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready])

  // ---- results
  const list = useInfinite<Perfume>(
    async (page, signal) => {
      const r = await api.get('/api/search', { ...outRef.current, page, per_page: PER, facets: page === 1 ? 1 : 0, facet_limit: 30, ff: page === 1 ? 1 : 0 }, signal)
      cacheNotes(r.facets)
      if (page === 1) {
        setSuggestions(r.facets || [])
        setTotal(r.total)
        setFacets(r.filter_facets)
      }
      return { items: r.results, hasMore: page < r.pages }
    },
    [key],
    { enabled: ready },
  )
  const fetchFacet = (name: string, { fq = '', offset = 0, limit = 12 }: { fq?: string; offset?: number; limit?: number } = {}) =>
    api.get('/api/search/facet', { ...outRef.current, facet: name, fq, offset, limit })

  // ---- edits
  function addSimple(n: { slug: string; name: string; image?: string; color?: string }, ex: boolean) {
    const e = entry(n)
    const inc = include.filter((x) => x.slug !== n.slug)
    const exc = exclude.filter((x) => x.slug !== n.slug)
    setInclude(ex ? inc : [...inc, e])
    setExclude(ex ? [...exc, e] : exc)
  }
  function addSuggestion(n: Note, ex: boolean) {
    if (mode === 'adv') setAdv(ex ? addExclude(adv, n) : addAsRow(adv, n))
    else addSimple(n, ex)
  }
  const cycle = (n: TNote) => setInclude(include.map((x) => (x === n ? { ...x, layer: CYCLE[(CYCLE.indexOf(x.layer) + 1) % CYCLE.length] } : x)))
  const clearQuery = () => {
    setInclude([])
    setExclude([])
    setAdv(newAdv())
  }

  function switchMode(v: 'simple' | 'adv') {
    if (v === mode) return
    if (v === 'adv') {
      const a = newAdv()
      if (matchMode === 'any') {
        const layers = new Set(include.map((n) => n.layer || 'any'))
        if (include.length) a.clauses = [newClause((layers.size === 1 ? [...layers][0] : 'any') as AdvLayer, include.map(({ layer: _l, ...n }) => ({ ...n, variants: false })))]
        if (layers.size > 1) toast('Notes pinned to different layers were put in one “any layer” condition.')
      } else a.clauses = include.map(({ layer, ...n }) => newClause(layer || 'any', [{ ...n, variants: false }]))
      a.exclude = exclude.map(({ layer: _l, ...n }) => ({ ...n, variants: false }))
      a.gen = !include.some((n) => n.layer) // keeps the result set identical to the simple query
      setAdv(a)
      setMode('adv')
    } else {
      const cl = adv.clauses.filter((c) => c.notes.length)
      const anyVar = cl.some((c) => c.notes.some((n) => n.variants)) || adv.exclude.some((n) => n.variants)
      const allSingle = cl.every((c) => c.notes.length === 1)
      if (anyVar || (!allSingle && cl.length > 1)) {
        toast('Simple mode cannot express this query (several OR groups or “similar notes”). Staying in Advanced.', { duration: 5200 })
        return
      }
      const asL = (l: AdvLayer): L => (l === 'any' ? null : l)
      if (allSingle) {
        setMatchMode('all')
        setInclude(cl.map((c) => ({ ...c.notes[0], layer: asL(c.layer) })))
      } else {
        setMatchMode('any')
        setInclude(cl[0].notes.map((n) => ({ ...n, layer: asL(cl[0].layer) })))
      }
      setExclude(adv.exclude.map((n) => ({ ...n, layer: null })))
      setMode('simple')
    }
  }

  // ---- text
  const sentence = (() => {
    if (mode === 'adv') return advSentence(adv, { must: f.must, not: f.not }) || 'Add a condition to start — e.g. “Top has tea or mint”.'
    if (!include.length) return 'Showing the whole catalogue.'
    const bits = include.map((n) => n.name + (n.layer ? ` (${n.layer === 'middle' ? 'heart' : n.layer})` : ''))
    let s = bits.join(matchMode === 'all' ? ' + ' : ' or ')
    if (f.must.length) s += `, also ${f.must.map((n) => n.name).join(', ')}`
    const o = [...exclude, ...f.not]
    if (o.length) s += `, without ${o.map((n) => n.name).join(', ')}`
    return s
  })()
  const suggestTitle = (n: Note) =>
    hasQuery
      ? `${n.count} of these ${mode === 'simple' && matchMode === 'any' ? 'perfumes also have it' : 'would remain'}${mode === 'adv' ? ' — adds a new AND condition' : ''}`
      : `${n.count} perfumes`
  const showClear = hasQuery || exclude.length > 0 || adv.exclude.length > 0

  // ---- drop zones: the simple box adds, the "Without" tray excludes
  const trayDrop = useDropZone((d) => addSimple(d, false))
  const exDrop = useOwnDrop((d) => addSimple(d, true))

  const panel = { f, onChange: setF, facets, total, fetchFacet, features: { notes: true, perfumers: true } }

  return (
    <Page wide>
      <PageHeader
        eyebrow="Combination search"
        title="Find the notes together"
        description="Build a tray of notes and see every perfume that carries them. Pin a note to a layer, exclude what you cannot stand — or switch to Advanced for AND / OR conditions per layer."
      />

      <section aria-label="Your query" className="mb-6 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented
            label="Query mode"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'simple', label: 'Simple', title: 'One tray of notes: match all or any' },
              { value: 'adv', label: 'Advanced', title: 'AND / OR conditions per layer, e.g. (top: tea OR mint) AND (base: amber)' },
            ]}
          />
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {showClear && (
              <Button size="sm" variant="ghost" onClick={clearQuery}>
                Clear query
              </Button>
            )}
            <SavedBar
              kind="combine"
              getState={() => outRef.current}
              hasNotes={() => hasQuery}
              suggest={() =>
                (mode === 'adv' ? adv.clauses.flatMap((c) => c.notes) : include)
                  .map((n) => n.name)
                  .slice(0, 4)
                  .join(' + ')
              }
            />
          </div>
        </div>

        {mode === 'simple' ? (
          <div {...trayDrop.props} className={cn('-m-2 flex flex-col gap-3 rounded-xl p-2 transition-colors', trayDrop.over && 'bg-accent/50')}>
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Your notes</h2>
              {include.length >= 2 && (
                <Segmented
                  size="sm"
                  label="Match mode"
                  value={matchMode}
                  onChange={setMatchMode}
                  options={[
                    { value: 'all', label: 'Match all', title: 'Perfumes must contain every note' },
                    { value: 'any', label: 'Match any', title: 'Perfumes with at least one of the notes' },
                  ]}
                />
              )}
            </div>
            <div aria-label="Selected notes" className={cn('flex min-h-12 flex-wrap items-center gap-1.5 rounded-xl border border-dashed px-2.5 py-2', include.length && 'border-solid bg-muted/30')}>
              {include.length ? (
                include.map((n) => <NoteChip key={n.slug} n={n} from="in" layer={{ value: n.layer, onCycle: () => cycle(n) }} onRemove={() => setInclude(include.filter((x) => x !== n))} />)
              ) : (
                <p className="px-1 text-sm text-muted-foreground">Add a note to start — or drag one here.</p>
              )}
            </div>
            <NoteSearch
              placeholder="Add a note… (Shift+Enter to exclude)"
              label="Add a note to the search"
              allowExclude
              skip={() => new Set([...include, ...exclude].map((n) => n.slug))}
              onPick={(n, { exclude: ex }) => addSimple(n, ex)}
            />
            <div
              {...exDrop.props}
              aria-label="Excluded notes"
              className={cn('flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-destructive/25 px-2.5 py-1.5 transition-colors', exDrop.over && 'border-foreground/40 bg-accent/50')}
            >
              <span className="mr-1 font-mono text-[11px] font-medium tracking-[.08em] text-destructive/80 uppercase">Without</span>
              {exclude.length ? (
                exclude.map((n) => <NoteChip key={n.slug} n={n} kind="exclude" from="ex" onRemove={() => setExclude(exclude.filter((x) => x !== n))} />)
              ) : (
                <span className="text-[13px] text-muted-foreground">Nothing excluded</span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-muted/40 p-3 sm:p-4">
              <AdvancedBuilder adv={adv} onChange={setAdv} />
            </div>
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {sentence}
            </p>
          </div>
        )}
      </section>

      {f.brands.length === 1 && (
        <div className="mb-6">
          <BrandHeader key={f.brands[0]} name={f.brands[0]} />
        </div>
      )}

      {suggestions.length > 0 && (
        <section className="mb-8">
          <SectionTitle>{hasQuery ? 'Add another note' : 'Start with a popular note'}</SectionTitle>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
            {suggestions.slice(0, 28).map((n) => (
              <NoteChip
                key={n.slug}
                n={n}
                count={n.count}
                className="shrink-0"
                onClick={() => addSuggestion(n, false)}
                title={suggestTitle(n)}
                extra={
                  hasQuery ? (
                    <button
                      type="button"
                      title={`Exclude ${n.name}`}
                      aria-label={`Exclude ${n.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        addSuggestion(n, true)
                      }}
                      className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Minus className="size-3.5" />
                    </button>
                  ) : null
                }
              />
            ))}
          </div>
        </section>
      )}

      <WithFilters panel={panel} open={sheet} onOpenChange={setSheet}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FiltersButton f={f} onClick={() => setSheet(true)} />
          <span aria-live="polite" className="font-mono text-sm text-muted-foreground">
            {total != null && plural(total, 'perfume')}
          </span>
          <Select value={sort || POP} onValueChange={(v) => setSort(v === POP ? '' : v)}>
            <SelectTrigger size="sm" aria-label="Sort results" className="ml-auto bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_OPTIONS.map(([v, l]) => (
                <SelectItem key={v || POP} value={v || POP}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <PillsBar f={f} onChange={setF} className="mb-3" />
        {mode === 'simple' && (
          <p className="mb-4 text-sm text-muted-foreground">
            {sentence}
          </p>
        )}
        <PerfumeGrid>
          {list.items.map((p) => (
            <PerfumeCard key={p.id} p={p} />
          ))}
        </PerfumeGrid>
        <ListStatus {...list} emptyText="No perfume matches. Loosen a condition, switch “Match all” to “any”, or clear some filters." />
      </WithFilters>
    </Page>
  )
}
