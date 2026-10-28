// The marketplace filter panel: accords and brands (from the browse response's facets), gender, currency, price,
// minimum ml left, box / tester. Same look as the catalogue's filter panel (components/filters.tsx).
import { useEffect, useState } from 'react'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/market'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Segmented } from '@/components/segmented'

export interface MarketFilterState {
  accords: string[]
  brand: string
  gender: string
  currency: string
  price_min: string
  price_max: string
  ml_min: string
  box: '' | '1' | '0'
  tester: '' | '1' | '0'
}

export interface Facet {
  name: string
  count: number
}
export interface Facets {
  accords: Facet[]
  brands: Facet[]
  currencies: Facet[]
}

export const emptyMarketFilters = (): MarketFilterState => ({ accords: [], brand: '', gender: '', currency: '', price_min: '', price_max: '', ml_min: '', box: '', tester: '' })

export function marketFilterCount(f: MarketFilterState) {
  return f.accords.length + [f.brand, f.gender, f.currency, f.price_min || f.price_max, f.ml_min, f.box, f.tester].filter(Boolean).length
}

const GENDERS = [
  { value: '', label: 'Any' },
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'unisex', label: 'Unisex' },
]
const ML = ['', '10', '25', '50', '75', '100']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Removable chips for the active filters. */
export function marketFilterPills(f: MarketFilterState): { key: string; label: string; remove: (f: MarketFilterState) => MarketFilterState }[] {
  const out: { key: string; label: string; remove: (f: MarketFilterState) => MarketFilterState }[] = []
  for (const a of f.accords) out.push({ key: `a:${a}`, label: cap(a), remove: (x) => ({ ...x, accords: x.accords.filter((y) => y !== a) }) })
  if (f.brand) out.push({ key: 'brand', label: f.brand, remove: (x) => ({ ...x, brand: '' }) })
  if (f.gender) out.push({ key: 'gender', label: cap(f.gender), remove: (x) => ({ ...x, gender: '' }) })
  if (f.currency) out.push({ key: 'cur', label: f.currency, remove: (x) => ({ ...x, currency: '' }) })
  if (f.price_min || f.price_max) {
    const fmt = (v: string) => (f.currency ? formatPrice(Number(v), f.currency) : v)
    const label = f.price_min && f.price_max ? `${fmt(f.price_min)} – ${fmt(f.price_max)}` : f.price_min ? `From ${fmt(f.price_min)}` : `Up to ${fmt(f.price_max)}`
    out.push({ key: 'price', label, remove: (x) => ({ ...x, price_min: '', price_max: '' }) })
  }
  if (f.ml_min) out.push({ key: 'ml', label: `${f.ml_min}+ ml left`, remove: (x) => ({ ...x, ml_min: '' }) })
  if (f.box) out.push({ key: 'box', label: f.box === '1' ? 'With box' : 'No box', remove: (x) => ({ ...x, box: '' }) })
  if (f.tester) out.push({ key: 'tester', label: f.tester === '1' ? 'Testers' : 'No testers', remove: (x) => ({ ...x, tester: '' }) })
  return out
}

function Section({ title, count = 0, defaultOpen = true, children }: { title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen || count > 0)
  return (
    <section className="border-b py-3 last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 py-1 text-left text-sm font-semibold">
        <span className="flex-1">{title}</span>
        {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 font-mono text-[11px] text-background">{count}</span>}
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="flex flex-col gap-2.5 pt-2">{children}</div>}
    </section>
  )
}

function CheckRow({ checked, onChange, children, count }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode; count?: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] hover:bg-muted/70">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {count != null && <span className="font-mono text-[11px] text-muted-foreground">{count}</span>}
    </label>
  )
}

function FacetList({ items, selected, onToggle, colors, initial = 8, search }: { items: Facet[]; selected: string[]; onToggle: (name: string, on: boolean) => void; colors?: Record<string, string>; initial?: number; search?: string }) {
  const [all, setAll] = useState(false)
  const [fq, setFq] = useState('')
  // selected values stay visible even when the current results no longer contain them
  const merged = [...selected.filter((s) => !items.some((i) => i.name === s)).map((name) => ({ name, count: 0 })), ...items]
  const shown = merged.filter((i) => !fq || i.name.toLowerCase().includes(fq.toLowerCase()))
  const list = all || fq ? shown : shown.slice(0, Math.max(initial, selected.length))
  return (
    <>
      {search && merged.length > initial && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={fq}
            onChange={(e) => setFq(e.target.value)}
            placeholder={search}
            aria-label={search}
            autoComplete="off"
            className="h-8 w-full rounded-md border border-input bg-card pr-2 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      )}
      <div className="flex flex-col">
        {list.map((it) => (
          <CheckRow key={it.name} checked={selected.includes(it.name)} onChange={(on) => onToggle(it.name, on)} count={it.count}>
            {colors && <i className="size-2.5 shrink-0 rounded-full bg-muted" style={colors[it.name] ? { background: colors[it.name] } : undefined} />}
            <span className="truncate">{colors ? cap(it.name) : it.name}</span>
          </CheckRow>
        ))}
        {!list.length && <p className="text-xs text-muted-foreground">{fq ? 'No match' : 'Nothing here for this search'}</p>}
      </div>
      {!fq && shown.length > list.length && (
        <Button size="xs" variant="ghost" className="self-start" onClick={() => setAll(true)}>
          Show more ({shown.length - list.length})
        </Button>
      )}
    </>
  )
}

/** A number field that reports after a short pause (so typing "250" makes one request, not three). */
function NumberField({ value, onCommit, placeholder, label, suffix }: { value: string; onCommit: (v: string) => void; placeholder: string; label: string; suffix?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  useEffect(() => {
    if (v === value) return
    const t = setTimeout(() => onCommit(v && Number(v) > 0 ? String(Number(v)) : ''), 450)
    return () => clearTimeout(t)
  }, [v]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative min-w-0 flex-1">
      <Input type="number" inputMode="decimal" min={0} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} className="h-8 bg-card pr-11 font-mono text-[13px]" />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted-foreground">{suffix}</span>}
    </div>
  )
}

export function MarketFiltersPanel({ f, onChange, facets, colors }: { f: MarketFilterState; onChange: (f: MarketFilterState) => void; facets: Facets | null; colors: Record<string, string> }) {
  const set = (patch: Partial<MarketFilterState>) => onChange({ ...f, ...patch })
  const n = marketFilterCount(f)
  const currencies = facets?.currencies || []
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between pb-1">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          Filters
        </span>
        {n > 0 && (
          <Button size="xs" variant="ghost" onClick={() => onChange(emptyMarketFilters())}>
            Clear all
          </Button>
        )}
      </div>

      <Section title="Accords" count={f.accords.length}>
        <FacetList items={facets?.accords || []} selected={f.accords} colors={colors} onToggle={(a, on) => set({ accords: on ? [...f.accords.filter((x) => x !== a), a] : f.accords.filter((x) => x !== a) })} search="Search accords" />
      </Section>

      <Section title="Brand" count={f.brand ? 1 : 0}>
        <FacetList items={facets?.brands || []} selected={f.brand ? [f.brand] : []} onToggle={(b, on) => set({ brand: on ? b : '' })} search="Search brands" />
      </Section>

      <Section title="Gender" count={f.gender ? 1 : 0}>
        <Segmented size="sm" label="Gender" value={f.gender} onChange={(gender) => set({ gender })} options={GENDERS} className="self-start" />
      </Section>

      <Section title="Price" count={(f.price_min || f.price_max ? 1 : 0) + (f.currency ? 1 : 0)}>
        {currencies.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Currency">
            {[{ name: '', count: 0 }, ...currencies].map((c) => {
              const on = f.currency === c.name
              return (
                <button
                  key={c.name || 'any'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ currency: c.name })}
                  className={cn('inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors', on ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground')}
                >
                  {c.name || 'Any currency'}
                  {c.name && <span className={cn('font-mono text-[10px]', on ? 'text-background/70' : 'text-muted-foreground')}>{c.count}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <NumberField value={f.price_min} onCommit={(price_min) => set({ price_min })} placeholder="Min" label="Minimum price" suffix={f.currency || undefined} />
          <span className="text-muted-foreground">–</span>
          <NumberField value={f.price_max} onCommit={(price_max) => set({ price_max })} placeholder="Max" label="Maximum price" suffix={f.currency || undefined} />
        </div>
        {!f.currency && (f.price_min || f.price_max) && <p className="text-xs text-muted-foreground">Prices are compared as numbers; pick a currency to compare like with like.</p>}
      </Section>

      <Section title="Amount left" count={f.ml_min ? 1 : 0}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Minimum ml left">
          {ML.map((m) => {
            const on = f.ml_min === m
            return (
              <button
                key={m || 'any'}
                type="button"
                aria-pressed={on}
                onClick={() => set({ ml_min: m })}
                className={cn('inline-flex h-7 items-center rounded-full border px-2.5 font-mono text-xs transition-colors', on ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground')}
              >
                {m ? `${m}+ ml` : <span className="font-sans font-medium">Any</span>}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Box & tester" count={(f.box ? 1 : 0) + (f.tester ? 1 : 0)}>
        <div className="flex flex-col gap-2">
          <Segmented size="sm" label="Box" value={f.box} onChange={(box) => set({ box })} options={[{ value: '', label: 'Any' }, { value: '1', label: 'With box' }, { value: '0', label: 'No box' }]} className="self-start" />
          <Segmented size="sm" label="Tester" value={f.tester} onChange={(tester) => set({ tester })} options={[{ value: '', label: 'Any' }, { value: '0', label: 'Not a tester' }, { value: '1', label: 'Testers' }]} className="self-start" />
        </div>
      </Section>
    </div>
  )
}

/** Desktop: a sticky column beside the results. Below lg: a sheet opened by the Filters button. */
export function MarketFiltersLayout({ panel, open, onOpenChange, total, children }: { panel: React.ReactNode; open: boolean; onOpenChange: (o: boolean) => void; total: number | null; children: React.ReactNode }) {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setDesktop(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return (
    <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
      {desktop ? (
        <aside aria-label="Filter listings" className="sticky top-20 max-h-[calc(100vh-6rem)] self-start overflow-y-auto pr-1 pb-6 scrollbar-none">
          {panel}
        </aside>
      ) : (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="left" className="w-[88vw] gap-0 p-0 sm:max-w-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription className="sr-only">Narrow down the listings</SheetDescription>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">{panel}</div>
            <div className="border-t p-3">
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                {total == null ? 'Show listings' : total === 0 ? 'No listings' : `Show ${total.toLocaleString()} listing${total === 1 ? '' : 's'}`}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function FilterPill({ label, onRemove }: { label: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border bg-card pr-1 pl-3 text-xs font-medium">
      {label}
      <button type="button" aria-label={`Remove filter ${typeof label === 'string' ? label : ''}`} onClick={onRemove} className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="size-3" />
      </button>
    </span>
  )
}
