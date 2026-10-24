// Build-a-pyramid: place notes in top / heart / base (or anywhere) and get ranked similar perfumes with per-note
// explanations. Notes can be typed per tier, pasted as a list, dragged between tiers, or loaded from an example.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, Layers } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { history, resolveSlugs } from '@/lib/store'
import { sync } from '@/lib/router'
import { csv, noteImg } from '@/lib/format'
import { filterBody, filterParams, hydrateFilters, readFilters, type Filters } from '@/lib/filters'
import { cn } from '@/lib/utils'
import type { Note } from '@/lib/types'
import { useInfinite } from '@/hooks/use-infinite'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ListStatus, Page, PageHeader } from '@/components/page'
import { LAYER_COLOR, NoteChip, NoteSearch, useDropZone, type DragNote } from '@/components/notes'
import { Legend, ResultRow } from '@/components/perfume'
import { FiltersButton, PillsBar, WithFilters } from '@/components/filters'
import { SavedBar } from '@/components/saved'

const PER = 30

type TierKey = 'top' | 'middle' | 'base' | 'any'
type Tiers = Record<TierKey, Note[]>

const TIERS: { key: TierKey; label: string; hint: string; width: string }[] = [
  { key: 'top', label: 'Top', hint: 'First impression · 5–30 min', width: 'w-[86%] sm:w-[64%]' },
  { key: 'middle', label: 'Heart', hint: 'The body · 30 min – 3 h', width: 'w-[93%] sm:w-[82%]' },
  { key: 'base', label: 'Base', hint: 'The drydown · hours', width: 'w-full' },
  { key: 'any', label: 'Anywhere', hint: 'In any layer', width: 'w-full' },
]
const NEXT: Record<TierKey, TierKey> = { top: 'middle', middle: 'base', base: 'any', any: 'top' }
const NEXT_LABEL: Record<TierKey, string> = { top: 'top', middle: 'heart', base: 'base', any: 'anywhere' }

const EXAMPLES = [
  { name: 'Fresh citrus', top: 'bergamot,lemon,mint', middle: 'lavender,geranium', base: 'cedar,vetiver,white-musk' },
  { name: 'Gourmand', top: 'bergamot,pear', middle: 'jasmine,rose', base: 'vanilla,tonka-bean,patchouli' },
  { name: 'Smoky oud', top: 'cardamom,pink-pepper', middle: 'oud,incense', base: 'leather,amber,sandalwood' },
  { name: 'White floral', top: 'orange-blossom,mandarin', middle: 'jasmine,tuberose', base: 'musk,sandalwood' },
]

const emptyTiers = (): Tiers => ({ top: [], middle: [], base: [], any: [] })
const slim = (n: Note): Note => ({ slug: n.slug, name: n.name, image: n.image || noteImg(n.slug), color: n.color })
const allSlugs = (t: Tiers) => Object.values(t).flat().map((n) => n.slug)
const queryNotes = (t: Tiers) => TIERS.flatMap(({ key }) => t[key].map((n) => ({ slug: n.slug, layer: key })))
const paramsOut = (t: Tiers, f: Filters) => ({
  top: t.top.map((n) => n.slug).join(','),
  middle: t.middle.map((n) => n.slug).join(','),
  base: t.base.map((n) => n.slug).join(','),
  any: t.any.map((n) => n.slug).join(','),
  ...filterParams(f),
})

// ---------------------------------------------------------------- paste parsing
const HEAD: Record<string, TierKey> = { top: 'top', head: 'top', opening: 'top', heart: 'middle', middle: 'middle', mid: 'middle', base: 'base', drydown: 'base', 'dry down': 'base' }
function parsePaste(text: string) {
  const out: { tier: TierKey; name: string }[] = []
  const parts = text.split(/\b(top|head|opening|heart|middle|mid|base|dry ?down)\b\s*(?:notes?)?\s*[:\-–]?/i)
  let tier: TierKey = 'any'
  parts.forEach((chunk, i) => {
    if (i % 2 === 1) {
      tier = HEAD[chunk.toLowerCase().replace(/\s+/, ' ')] || HEAD[chunk.toLowerCase().replace(/\s+/g, '')] || 'any'
      return
    }
    chunk
      .split(/[,;\n|•·]+|\s+and\s+/i)
      .map((s) => s.replace(/^[\s\-–*•.]+|[\s.]+$/g, ''))
      .filter(Boolean)
      .forEach((name) => out.push({ tier, name }))
  })
  return out
}

// ---------------------------------------------------------------- one tier
function Tier({
  t,
  notes,
  skip,
  onAdd,
  onDrop,
  onRemove,
  onNext,
}: {
  t: (typeof TIERS)[number]
  notes: Note[]
  skip: () => Set<string>
  onAdd: (n: Note) => void
  onDrop: (d: DragNote) => void
  onRemove: (n: Note) => void
  onNext: (n: Note) => void
}) {
  const drop = useDropZone(onDrop)
  const any = t.key === 'any'
  return (
    <section
      aria-label={`${t.label} notes`}
      {...drop.props}
      className={cn(
        'flex flex-col gap-2.5 rounded-xl border bg-card px-3 pt-2.5 pb-3 transition-[border-color,background-color,box-shadow] duration-150 sm:px-4',
        t.width,
        any && 'border-dashed bg-card/60',
        drop.over && 'border-foreground/45 bg-muted/60 shadow-md',
      )}
    >
      <header className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: LAYER_COLOR[t.key] }} />
        <h3 className="text-sm font-semibold">{t.label}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.hint}</span>
        <small className="font-mono text-xs text-muted-foreground" aria-label={`${notes.length} notes`}>
          {notes.length}
        </small>
      </header>
      {notes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {notes.map((n) => (
            <NoteChip
              key={n.slug}
              n={n}
              from={t.key}
              onRemove={() => onRemove(n)}
              extra={
                <button
                  type="button"
                  title={`Move to ${NEXT_LABEL[NEXT[t.key]]}`}
                  aria-label={`Move ${n.name} to next layer`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onNext(n)
                  }}
                  className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowDownUp className="size-3.5" />
                </button>
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/80">{drop.over ? 'Drop it here' : any ? 'Notes that may sit in any layer' : 'Type below, or drag a note here'}</p>
      )}
      <NoteSearch compact placeholder={`Add ${any ? 'a note' : t.label.toLowerCase() + ' note'}…`} label={`Add a ${t.label} note`} skip={skip} onPick={onAdd} />
    </section>
  )
}

// ---------------------------------------------------------------- view
export default function PyramidView({ params }: ViewProps) {
  const [tiers, setTiers] = useState<Tiers>(emptyTiers)
  const [f, setF] = useState<Filters>(() => readFilters(params))
  const [ready, setReady] = useState(false)
  const [paste, setPaste] = useState('')
  const [facets, setFacets] = useState<any>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [sheet, setSheet] = useState(false)
  const dirty = useRef(false)
  const tiersRef = useRef(tiers)
  tiersRef.current = tiers

  // hydrate filters + tiers from the URL
  useEffect(() => {
    let dead = false
    ;(async () => {
      const hf = await hydrateFilters(readFilters(params))
      const t = emptyTiers()
      for (const { key } of TIERS) t[key] = (await resolveSlugs(csv(params.get(key)))).map(slim)
      if (dead) return
      setF(hf)
      setTiers(t)
      setReady(true)
      if (allSlugs(t).length) history.record({ kind: 'pyramid', state: paramsOut(t, hf) })
    })()
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const has = allSlugs(tiers).length > 0
  const out = paramsOut(tiers, f)
  const outKey = JSON.stringify(out)

  // user changes: write the URL (with a history entry) and record history after a pause
  useEffect(() => {
    if (!dirty.current) return
    sync('/pyramid', out, { push: true })
    if (!has) return
    const t = setTimeout(() => history.record({ kind: 'pyramid', state: out }), 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outKey])

  // results query, debounced so quick edits don't fire a request each
  const query = useMemo(() => ({ notes: queryNotes(tiers), filters: filterBody(f) }), [tiers, f])
  const qKey = JSON.stringify(query)
  const [dq, setDq] = useState(query)
  useEffect(() => {
    if (!dirty.current) return setDq(query)
    const t = setTimeout(() => setDq(query), 220)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey])
  const dqKey = JSON.stringify(dq)
  const enabled = ready && dq.notes.length > 0 && has

  const list = useInfinite<any>(
    async (page, signal) => {
      const offset = (page - 1) * PER
      const r = await api.post('/api/similar', { ...dq, offset, limit: PER, ff: page === 1 }, signal)
      if (page === 1) {
        setTotal(r.total)
        setFacets(r.filter_facets)
      }
      return { items: r.results.map((x: any, i: number) => ({ ...x, _rank: offset + i + 1 })), hasMore: offset + PER < r.total }
    },
    [dqKey],
    { enabled },
  )
  const fetchFacet = useCallback(
    (name: string, { fq = '', offset = 0, limit = 12 }: { fq?: string; offset?: number; limit?: number }) => api.post('/api/similar/facet', { ...dq, facet: name, fq, offset, limit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dqKey],
  )

  // ---- state ops (every user edit goes through here)
  const edit = (fn: (t: Tiers) => Tiers) => {
    dirty.current = true
    setTiers((t) => fn(t))
  }
  const setFilters = (nf: Filters) => {
    dirty.current = true
    setF(nf)
  }
  const without = (t: Tiers, slug: string): Tiers => ({
    top: t.top.filter((x) => x.slug !== slug),
    middle: t.middle.filter((x) => x.slug !== slug),
    base: t.base.filter((x) => x.slug !== slug),
    any: t.any.filter((x) => x.slug !== slug),
  })
  const addNote = (tier: TierKey, n: Note) =>
    edit((t) => {
      const next = without(t, n.slug)
      next[tier] = [...next[tier], slim(n)]
      return next
    })
  const moveNote = (d: DragNote, tier: TierKey) => {
    const found = Object.values(tiersRef.current)
      .flat()
      .find((x) => x.slug === d.slug)
    addNote(tier, found || { slug: d.slug, name: d.name })
  }
  const removeNote = (tier: TierKey, n: Note) => edit((t) => ({ ...t, [tier]: t[tier].filter((x) => x.slug !== n.slug) }))
  const skip = () => new Set(allSlugs(tiersRef.current))

  async function loadExample(ex: (typeof EXAMPLES)[number]) {
    const t = emptyTiers()
    for (const k of ['top', 'middle', 'base'] as const) t[k] = (await resolveSlugs(csv(ex[k]))).map(slim)
    edit(() => t)
  }

  async function importPaste() {
    const items = parsePaste(paste)
    if (!items.length) {
      toast('Nothing to import — type or paste some notes first.')
      return
    }
    let r: any
    try {
      r = await api.post('/api/notes/resolve', { names: items.map((i) => i.name) })
    } catch {
      toast('Could not reach the server.')
      return
    }
    const bad: string[] = []
    let next = tiersRef.current
    r.matches.forEach((m: any, i: number) => {
      if (!m.slug) {
        bad.push(items[i].name)
        return
      }
      next = without(next, m.slug)
      next[items[i].tier] = [...next[items[i].tier], { slug: m.slug, name: m.name, image: m.image || noteImg(m.slug) }]
    })
    edit(() => next)
    setPaste('')
    toast(bad.length ? `Added ${items.length - bad.length}. Not found: ${bad.slice(0, 6).join(', ')}${bad.length > 6 ? '…' : ''}` : `Added ${items.length} notes.`, {
      duration: bad.length ? 5500 : 2600,
    })
  }

  return (
    <Page wide>
      <PageHeader
        title="Compose a scent"
        description="Place notes in the top, heart and base to find perfumes built the same way."
      />

      <div className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <div className="flex flex-col items-center gap-2" role="group" aria-label="Your pyramid">
          {TIERS.slice(0, 3).map((t) => (
            <Tier
              key={t.key}
              t={t}
              notes={tiers[t.key]}
              skip={skip}
              onAdd={(n) => addNote(t.key, n)}
              onDrop={(d) => moveNote(d, t.key)}
              onRemove={(n) => removeNote(t.key, n)}
              onNext={(n) => addNote(NEXT[t.key], n)}
            />
          ))}
          <div className="my-1 flex w-full items-center gap-3 text-[11px] tracking-[.08em] text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Tier
            t={TIERS[3]}
            notes={tiers.any}
            skip={skip}
            onAdd={(n) => addNote('any', n)}
            onDrop={(d) => moveNote(d, 'any')}
            onRemove={(n) => removeNote('any', n)}
            onNext={(n) => addNote(NEXT.any, n)}
          />
        </div>

        <aside className="flex flex-col gap-3 self-start rounded-xl border bg-card p-4" aria-label="Paste a list">
          <h2 className="text-sm font-semibold">Paste a list</h2>
          <Textarea
            rows={5}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                importPaste()
              }
            }}
            placeholder={'Top notes: bergamot, pear\nHeart notes: jasmine, rose\nBase notes: vanilla, musk\n\n…or just a comma-separated list.'}
            aria-label="Paste a list of notes"
            className="field-sizing-fixed min-h-32 resize-y bg-background text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={importPaste}>
              Add to pyramid
            </Button>
            {has && (
              <Button size="sm" variant="ghost" onClick={() => edit(emptyTiers)}>
                Clear pyramid
              </Button>
            )}
          </div>
          <div className="border-t pt-3">
            <SavedBar kind="pyramid" getState={() => paramsOut(tiersRef.current, f)} hasNotes={() => allSlugs(tiersRef.current).length > 0} suggest={() => Object.values(tiersRef.current).flat().map((n) => n.name).slice(0, 4).join(', ')} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <span className="mr-1 text-xs text-muted-foreground">Try:</span>
            {EXAMPLES.map((ex) => (
              <Button key={ex.name} size="xs" variant="outline" className="rounded-full" onClick={() => loadExample(ex)}>
                {ex.name}
              </Button>
            ))}
          </div>
        </aside>
      </div>

      {!has ? (
        ready && (
          <EmptyState icon={<Layers className="size-5" />} title="Closest matches appear here">
            Drop some notes into the pyramid and the closest perfumes appear here — ranked by how well each note, and the layer it sits in, lines up.
          </EmptyState>
        )
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Closest matches</h2>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {total != null && (
                <>
                  <span className="font-mono">{total.toLocaleString()}</span> {total === 1 ? 'perfume shares' : 'perfumes share'} at least one note
                </>
              )}
            </span>
            <FiltersButton f={f} onClick={() => setSheet(true)} />
            <Legend />
          </div>
          <WithFilters panel={{ f, onChange: setFilters, facets, total, fetchFacet, features: { notes: false, perfumers: true } }} open={sheet} onOpenChange={setSheet}>
            <PillsBar f={f} onChange={setFilters} className="mb-3" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
              {list.items.map((it) => (
                <ResultRow key={it.id} r={it} rank={it._rank} />
              ))}
            </div>
            <ListStatus {...list} emptyText="No perfume shares any of these notes." />
          </WithFilters>
        </>
      )}
    </Page>
  )
}
