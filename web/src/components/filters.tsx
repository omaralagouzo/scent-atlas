// Result filters + facets panel. Facet counts are computed by the server over the CURRENT result set; a
// multi-select shows the alternatives you could switch to (its own filter is left out of its counts).
// Desktop: a sticky column beside the results. Below lg: a sheet opened by <FiltersButton/>.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Minus, Search, SlidersHorizontal, X } from 'lucide-react'
import { cacheNotes } from '@/lib/store'
import { clamp, compact } from '@/lib/format'
import { describeFilters, filterCount, newFilters, type Filters } from '@/lib/filters'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { CHIP_ORDER, TAGS } from './brandtags'
import { NoteChip, NoteSearch } from './notes'

export type FetchFacet = (name: string, opts: { fq?: string; offset?: number; limit?: number }) => Promise<any>

export interface FiltersPanelProps {
  f: Filters
  onChange: (f: Filters) => void
  facets: any | null
  total: number | null
  fetchFacet: FetchFacet
  features?: { notes?: boolean; perfumers?: boolean }
}

const VOTES = [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ---------------------------------------------------------------- layout wrappers
export function FiltersButton({ f, onClick, className }: { f: Filters; onClick: () => void; className?: string }) {
  const n = filterCount(f)
  return (
    <Button variant="outline" onClick={onClick} className={cn('lg:hidden', className)}>
      <SlidersHorizontal />
      Filters
      {n > 0 && <span className="grid size-5 place-items-center rounded-full bg-foreground font-mono text-[11px] text-background">{n}</span>}
    </Button>
  )
}

/** Results with the filter panel beside them (desktop) or in a sheet (mobile). */
export function WithFilters({ panel, open, onOpenChange, children }: { panel: FiltersPanelProps; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setDesktop(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return (
    <div className="grid gap-6 lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-8">
      {desktop ? (
        <aside aria-label="Filter results" className="sticky top-20 max-h-[calc(100vh-6rem)] self-start overflow-y-auto pr-1 pb-6 scrollbar-none">
          <FiltersPanel {...panel} />
        </aside>
      ) : (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="left" className="w-[88vw] gap-0 p-0 sm:max-w-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription className="sr-only">Narrow down the results</SheetDescription>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <FiltersPanel {...panel} />
            </div>
            <div className="border-t p-3">
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                {panel.total == null ? 'Show results' : panel.total === 0 ? 'No results' : `Show ${panel.total.toLocaleString()} result${panel.total === 1 ? '' : 's'}`}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Removable pills for the active filters, above the results. */
export function PillsBar({ f, onChange, className }: { f: Filters; onChange: (f: Filters) => void; className?: string }) {
  const items = describeFilters(f)
  if (!items.length) return null
  return (
    <div aria-label="Active filters" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {items.map((p) => (
        <span key={p.key} className="inline-flex h-7 items-center gap-1 rounded-full border bg-card pr-1 pl-3 text-xs font-medium">
          {p.label}
          <button type="button" aria-label={`Remove filter ${p.label}`} onClick={() => onChange(p.remove(f))} className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {items.length > 1 && (
        <Button size="xs" variant="ghost" onClick={() => onChange(newFilters())}>
          Clear all
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- panel
function Section({ title, count = 0, hint, defaultOpen = false, children, hidden }: { title: string; count?: number; hint?: string; defaultOpen?: boolean; children: React.ReactNode; hidden?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || count > 0)
  if (hidden) return null
  return (
    <section className="border-b py-3 last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 py-1 text-left text-sm font-semibold">
        <span className="flex-1">{title}</span>
        {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 font-mono text-[11px] text-background">{count}</span>}
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 pt-2">
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {children}
        </div>
      )}
    </section>
  )
}

function MiniSearch({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="h-8 w-full rounded-md border border-input bg-card pr-2 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </div>
  )
}

function CheckRow({ checked, onChange, children, count, zero, title }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode; count?: number | null; zero?: boolean; title?: string }) {
  return (
    <label title={title} className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] hover:bg-muted/70', zero && !checked && 'opacity-45')}>
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {count != null && <span className="font-mono text-[11px] text-muted-foreground">{compact(count)}</span>}
    </label>
  )
}

type ListKey = 'brands' | 'perfumers' | 'accords' | 'genders' | 'countries'

function ListSection({
  title,
  k,
  facet,
  data,
  f,
  set,
  fetchFacet,
  hint,
  placeholder = 'Search…',
  label = (x: string) => x,
  dot = false,
  initial = 10,
  search = true,
  more = true,
  defaultOpen = false,
  children,
}: {
  title: string
  k: ListKey
  facet: string
  data: any
  f: Filters
  set: (patch: Partial<Filters>) => void
  fetchFacet: FetchFacet
  hint?: string
  placeholder?: string
  label?: (x: string) => string
  dot?: boolean
  initial?: number
  search?: boolean
  more?: boolean
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [fq, setFq] = useState('')
  const [own, setOwn] = useState<any>(null)
  const seq = useRef(0)
  const shownData = fq ? own : own && own.__base === data ? own : data
  useEffect(() => {
    if (!fq) return
    const my = ++seq.current
    const t = setTimeout(async () => {
      try {
        const r = await fetchFacet(facet, { fq, offset: 0, limit: 20 })
        if (my === seq.current) setOwn(r)
      } catch {
        /* ignore */
      }
    }, 180)
    return () => clearTimeout(t)
  }, [fq, facet, fetchFacet, data])
  const loadMore = async () => {
    const cur = shownData || { items: [], total: 0 }
    try {
      const r = await fetchFacet(facet, { fq, offset: cur.items.filter((i: any) => !i.selected).length, limit: fq ? 20 : initial })
      setOwn({ ...r, items: cur.items.concat(r.items), __base: fq ? undefined : data })
    } catch {
      /* ignore */
    }
  }
  const toggle = (name: string, on: boolean) => set({ [k]: on ? [...f[k].filter((x) => x !== name), name] : f[k].filter((x) => x !== name) } as Partial<Filters>)
  const items: any[] = shownData?.items || []
  const shown = items.filter((i) => i.count > 0).length
  const remaining = Math.max(0, (shownData?.total || 0) - shown)
  const cov = shownData?.coverage
  return (
    <Section title={title} count={f[k].length} hint={hint} defaultOpen={defaultOpen}>
      {children}
      {search && <MiniSearch value={fq} onChange={setFq} placeholder={placeholder} label={`Search ${title.toLowerCase()}`} />}
      <div role="group" aria-label={title} className="flex flex-col">
        {items.map((it) => (
          <CheckRow key={it.name} checked={f[k].includes(it.name)} onChange={(on) => toggle(it.name, on)} count={it.count} zero={it.count === 0}>
            {dot && it.color && <i className="size-2.5 shrink-0 rounded-full" style={{ background: it.color }} />}
            <span className="truncate">{label(it.name)}</span>
          </CheckRow>
        ))}
        {!items.length && <p className="text-xs text-muted-foreground">{fq ? 'No match' : 'Nothing here for this selection'}</p>}
      </div>
      {more && remaining > 0 && (
        <Button size="xs" variant="ghost" className="self-start" onClick={loadMore}>
          Show more ({remaining.toLocaleString()})
        </Button>
      )}
      {cov && k === 'perfumers' && (
        <p className="text-xs text-muted-foreground">
          Perfumer credits exist for {cov.all ? Math.round((cov.with / cov.all) * 100) : 0}% of these {cov.all.toLocaleString()} perfumes; the rest are not listed here.
        </p>
      )}
    </Section>
  )
}

function HouseSection({ f, set, facets }: { f: Filters; set: (p: Partial<Filters>) => void; facets: any }) {
  const bt = facets?.brand_tags
  const df = facets?.dupe_flags
  const counts: Record<string, number> = {}
  for (const it of bt?.items || []) counts[it.name] = it.count
  const stateOf = (tag: string) => (f.btags.includes(tag) ? 'include' : f.btags_not.includes(tag) ? 'exclude' : null)
  const setState = (tag: string, st: 'include' | 'exclude' | null) =>
    set({
      btags: [...f.btags.filter((x) => x !== tag), ...(st === 'include' ? [tag] : [])],
      btags_not: [...f.btags_not.filter((x) => x !== tag), ...(st === 'exclude' ? [tag] : [])],
    })
  return (
    <Section
      title="House type"
      defaultOpen
      hidden={bt?.available === false && df?.available === false}
      count={f.btags.length + f.btags_not.length + (f.has_dupes ? 1 : 0) + (f.is_dupe ? 1 : 0)}
      hint="Tap a type to include it (any of the selected); the minus excludes it."
    >
      {bt?.available !== false && (
        <div role="group" aria-label="House type" className="flex flex-wrap gap-1.5">
          {CHIP_ORDER.map((tag) => {
            const st = stateOf(tag)
            const c = counts[tag]
            return (
              <span
                key={tag}
                style={{ '--tc': `var(--t-${tag})` } as React.CSSProperties}
                className={cn(
                  'inline-flex h-7 items-stretch overflow-hidden rounded-full border text-xs',
                  st === 'include' && 'border-(--tc) bg-(--tc)/10',
                  st === 'exclude' && 'border-dashed border-destructive/50 bg-destructive/5',
                  c === 0 && !st && 'opacity-45',
                )}
              >
                <button type="button" aria-pressed={st === 'include'} title={TAGS[tag].tip} onClick={() => setState(tag, st === 'include' ? null : 'include')} className={cn('flex items-center gap-1.5 pr-1.5 pl-2.5 font-medium', st === 'exclude' && 'line-through')}>
                  <i className="size-1.5 rounded-full bg-(--tc)" />
                  {TAGS[tag].label}
                  {c != null && <small className="font-mono text-[10px] text-muted-foreground">{compact(c)}</small>}
                </button>
                <button
                  type="button"
                  aria-pressed={st === 'exclude'}
                  aria-label={`Exclude ${TAGS[tag].label}`}
                  title={st === 'exclude' ? `Stop excluding ${TAGS[tag].label}` : `Exclude ${TAGS[tag].label}`}
                  onClick={() => setState(tag, st === 'exclude' ? null : 'exclude')}
                  className={cn('grid w-6 place-items-center border-l text-muted-foreground hover:bg-muted', st === 'exclude' && 'text-destructive')}
                >
                  <Minus className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}
      {df?.available !== false && (
        <div className="flex flex-col">
          <CheckRow checked={f.has_dupes} onChange={(on) => set({ has_dupes: on })} count={df?.has_dupes?.count} title="Originals that have at least one known inspired-by version">
            Has known dupes
          </CheckRow>
          <CheckRow checked={f.is_dupe} onChange={(on) => set({ is_dupe: on })} count={df?.is_dupe?.count} title="Perfumes linked as inspired by / an alternative to a known original">
            Is a dupe
          </CheckRow>
        </div>
      )}
    </Section>
  )
}

function YearSection({ f, set, hist }: { f: Filters; set: (p: Partial<Filters>) => void; hist: any }) {
  const LO = hist?.lo ?? 1900
  const HI = hist?.hi ?? 2027
  const val = (): [number, number] => [f.year_min ? clamp(Number(f.year_min), LO, HI) : LO, f.year_max ? clamp(Number(f.year_max), LO, HI) : HI]
  const [range, setRange] = useState<[number, number]>(val)
  const [from, setFrom] = useState(f.year_min)
  const [to, setTo] = useState(f.year_max)
  useEffect(() => {
    setRange(val())
    setFrom(f.year_min)
    setTo(f.year_max)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.year_min, f.year_max, LO, HI])
  const buckets: { y: number; n: number }[] = []
  if (hist) for (let i = 0; i < hist.counts.length; i += 2) buckets.push({ y: LO + i, n: hist.counts.slice(i, i + 2).reduce((s: number, x: number) => s + x, 0) })
  const mx = Math.max(1, ...buckets.map((b) => b.n))
  const commitInputs = (a: string, b: string) => {
    let lo = a.trim()
    let hi = b.trim()
    if (lo && hi && +lo > +hi) hi = lo
    set({ year_min: lo, year_max: hi })
  }
  return (
    <Section title="Release year" defaultOpen count={f.year_min || f.year_max ? 1 : 0}>
      {hist && (
        <div className="flex h-12 items-end gap-px" aria-hidden="true">
          {buckets.map((b) => (
            <i
              key={b.y}
              title={`${b.y}–${b.y + 1}: ${b.n.toLocaleString()}`}
              className={cn('flex-1 rounded-t-[2px] bg-foreground/70', (b.y + 1 < range[0] || b.y > range[1]) && 'bg-foreground/15')}
              style={{ height: `${b.n ? Math.max(6, Math.round((b.n / mx) * 100)) : 2}%` }}
            />
          ))}
        </div>
      )}
      <Slider
        min={LO}
        max={HI}
        step={1}
        value={range}
        onValueChange={(v) => setRange([v[0], v[1]])}
        onValueCommit={(v) => set({ year_min: v[0] <= LO ? '' : String(v[0]), year_max: v[1] >= HI ? '' : String(v[1]) })}
        aria-label="Release year range"
      />
      <div className="flex items-center gap-2">
        <input type="number" min={1500} max={2100} placeholder="from" aria-label="From year" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => commitInputs(from, to)} onKeyDown={(e) => e.key === 'Enter' && commitInputs(from, to)} className="h-8 w-full rounded-md border border-input bg-card px-2 font-mono text-[13px] outline-none focus-visible:border-ring" />
        <span className="text-muted-foreground">–</span>
        <input type="number" min={1500} max={2100} placeholder="to" aria-label="To year" value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => commitInputs(from, to)} onKeyDown={(e) => e.key === 'Enter' && commitInputs(from, to)} className="h-8 w-full rounded-md border border-input bg-card px-2 font-mono text-[13px] outline-none focus-visible:border-ring" />
      </div>
      {hist?.before > 0 && <p className="text-xs text-muted-foreground">{hist.before.toLocaleString()} released before {LO}</p>}
      <CheckRow checked={f.year_unknown} onChange={(on) => set({ year_unknown: on })} zero={!(f.year_min || f.year_max)}>
        Include unknown year{hist?.unknown ? ` (${hist.unknown.toLocaleString()})` : ''}
      </CheckRow>
    </Section>
  )
}

function RateSection({ f, set }: { f: Filters; set: (p: Partial<Filters>) => void }) {
  const [r, setR] = useState(Number(f.rating_min || 0))
  const vi0 = VOTES.indexOf(Number(f.votes_min || 0))
  const [v, setV] = useState(vi0 < 0 ? 0 : vi0)
  useEffect(() => {
    setR(Number(f.rating_min || 0))
    const i = VOTES.indexOf(Number(f.votes_min || 0))
    setV(i < 0 ? 0 : i)
  }, [f.rating_min, f.votes_min])
  return (
    <Section title="Rating & votes" count={(f.rating_min ? 1 : 0) + (f.votes_min ? 1 : 0)} hint="Votes are the number of ratings behind a score; low-vote perfumes have noisy ratings.">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[13px]">
          <span>Minimum rating</span>
          <output className="font-mono text-muted-foreground">{r ? `≥ ${r.toFixed(1)}` : 'Any'}</output>
        </div>
        <Slider min={0} max={5} step={0.1} value={[r]} onValueChange={(x) => setR(x[0])} onValueCommit={(x) => set({ rating_min: x[0] > 0 ? String(Math.round(x[0] * 10) / 10) : '' })} aria-label="Minimum rating" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[13px]">
          <span>Minimum votes</span>
          <output className="font-mono text-muted-foreground">{VOTES[v] ? `≥ ${compact(VOTES[v])}` : 'Any'}</output>
        </div>
        <Slider min={0} max={VOTES.length - 1} step={1} value={[v]} onValueChange={(x) => setV(x[0])} onValueCommit={(x) => set({ votes_min: VOTES[x[0]] ? String(VOTES[x[0]]) : '' })} aria-label="Minimum number of votes" />
      </div>
    </Section>
  )
}

function NotesSection({ f, set, fetchFacet }: { f: Filters; set: (p: Partial<Filters>) => void; fetchFacet: FetchFacet }) {
  const tray = (title: string, key: 'must' | 'not', kind?: 'exclude') => (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <NoteSearch
        compact
        placeholder={title}
        label={title}
        skip={() => new Set([...f.must, ...f.not].map((n) => n.slug))}
        source={async (q) => (await fetchFacet('note', { fq: q, limit: 24 })).items}
        onPick={(n) => {
          cacheNotes([n])
          set({ [key]: [...f[key], { slug: n.slug, name: n.name, image: n.image, color: n.color, variants: false }] } as Partial<Filters>)
        }}
      />
      {f[key].length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {f[key].map((n) => (
            <NoteChip
              key={n.slug}
              n={n}
              kind={kind}
              draggable={false}
              onRemove={() => set({ [key]: f[key].filter((x) => x.slug !== n.slug) } as Partial<Filters>)}
              variant={{
                on: n.variants,
                count: null,
                title: n.variants ? 'Includes notes containing this word' : 'Also match notes containing this word',
                onToggle: () => set({ [key]: f[key].map((x) => (x.slug === n.slug ? { ...x, variants: !x.variants } : x)) } as Partial<Filters>),
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
  return (
    <Section title="More notes" count={f.must.length + f.not.length} hint="Quick refinements on top of your main query. Pick from notes that occur in the current results.">
      {tray('Must also have…', 'must')}
      {tray('Must not have…', 'not', 'exclude')}
    </Section>
  )
}

export function FiltersPanel({ f, onChange, facets, fetchFacet, features = {} }: FiltersPanelProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch })
  const [name, setName] = useState(f.name)
  const fRef = useRef(f)
  fRef.current = f
  useEffect(() => setName(f.name), [f.name])
  useEffect(() => {
    if (name === fRef.current.name) return
    const t = setTimeout(() => onChange({ ...fRef.current, name }), 280)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
  const n = filterCount(f)
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-sm font-semibold">Filters</h2>
        {n > 0 && (
          <Button size="xs" variant="ghost" onClick={() => onChange(newFilters())}>
            Clear all
          </Button>
        )}
      </div>
      <MiniSearch value={name} onChange={setName} placeholder="Search results by perfume or brand…" label="Search within results" />
      <div className="mt-1">
        <HouseSection f={f} set={set} facets={facets} />
        <YearSection f={f} set={set} hist={facets?.years} />
        <ListSection title="Brand" k="brands" facet="brand" data={facets?.brands} f={f} set={set} fetchFacet={fetchFacet} placeholder="Find a brand…" defaultOpen />
        {features.perfumers !== false && (
          <ListSection title="Perfumer" k="perfumers" facet="perfumer" data={facets?.perfumers} f={f} set={set} fetchFacet={fetchFacet} placeholder="Find a perfumer…" hint="Perfumer credits are known for only about 38% of perfumes." />
        )}
        <ListSection title="Accords" k="accords" facet="accord" data={facets?.accords} f={f} set={set} fetchFacet={fetchFacet} placeholder="Find an accord…" dot initial={12} defaultOpen>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="accmode" checked={!f.acc_any} onChange={() => set({ acc_any: false })} className="accent-foreground" />
              All selected
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="accmode" checked={f.acc_any} onChange={() => set({ acc_any: true })} className="accent-foreground" />
              Any of them
            </label>
            <label className="flex items-center gap-1.5">
              <Checkbox checked={f.acc_main} onCheckedChange={(v) => set({ acc_main: v === true })} />
              Main accords only (top 3)
            </label>
          </div>
        </ListSection>
        <ListSection title="Gender" k="genders" facet="gender" data={facets?.genders} f={f} set={set} fetchFacet={fetchFacet} label={cap} search={false} more={false} defaultOpen />
        <ListSection title="Brand country" k="countries" facet="country" data={facets?.countries} f={f} set={set} fetchFacet={fetchFacet} placeholder="Find a country…" hint="Known for about half of the brands." initial={8} />
        <RateSection f={f} set={set} />
        {features.notes && <NotesSection f={f} set={set} fetchFacet={fetchFacet} />}
      </div>
    </div>
  )
}
