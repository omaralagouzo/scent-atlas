// Advanced note-query builder for the Combine page:
//   WHERE (layer: a OR b)  AND (layer: c OR d) ...  WITHOUT (e OR f)
// Controlled: the parent owns the `Adv` object (lib/adv.ts) and gets a new one on every edit.
import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { addExclude, getVariants, LAYER_OPTS, newClause, toAdvNote, type Adv, type AdvLayer, type AdvNote, type Clause, type Variants } from '@/lib/adv'
import { compact } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { NoteImg } from './media'
import { NoteChip, NoteSearch, useDropZone, type DragNote } from './notes'
import { Segmented } from './segmented'

/** Drop-zone props that do not let the drop bubble to an outer zone (useDropZone alone does). */
export function useOwnDrop(onDrop: (d: DragNote) => void) {
  const z = useDropZone(onDrop)
  return {
    over: z.over,
    props: {
      ...z.props,
      onDragOver: (e: React.DragEvent) => {
        z.props.onDragOver(e)
        if ([...e.dataTransfer.types].includes('text/x-note')) e.stopPropagation()
      },
      onDrop: (e: React.DragEvent) => {
        z.props.onDrop(e)
        e.stopPropagation()
      },
    },
  }
}

const dropRing = 'border-foreground/40 bg-accent/50'

// ---------------------------------------------------------------- one chip (with the "≈ similar notes" popover)
function AdvChip({ n, kind, count, onToggle, onRemove }: { n: AdvNote; kind?: 'exclude'; count: number | null; onToggle: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Variants | null | 'error'>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    setData(null)
    getVariants(n.slug)
      .then((r) => live && setData(r))
      .catch(() => live && setData('error'))
    return () => {
      live = false
    }
  }, [open, n.slug])
  useEffect(() => {
    if (!n.variants) setOpen(false)
  }, [n.variants])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex max-w-full">
          <NoteChip
            n={n}
            kind={kind}
            draggable={false}
            onRemove={onRemove}
            onClick={n.variants ? () => setOpen(true) : undefined}
            title={n.variants ? 'Show the notes this includes' : undefined}
            variant={{ on: n.variants, count, onToggle }}
          />
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-72 p-2" aria-label={`Notes matching “${n.name}”`}>
        {data === null ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>
        ) : data === 'error' ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Could not load the list.</p>
        ) : (
          <>
            <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
              <span className="font-mono">{data.count}</span> note{data.count === 1 ? '' : 's'} contain “{n.name.toLowerCase()}”
            </p>
            <ul className="flex max-h-72 flex-col overflow-y-auto">
              {data.notes.map((x) => (
                <li key={x.slug} className="flex items-center gap-2.5 rounded-md px-2 py-1 text-sm">
                  <NoteImg n={x} className="size-6 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <small className="font-mono text-xs text-muted-foreground">{compact(x.count)}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Chips({ list, kind, counts, onList, empty }: { list: AdvNote[]; kind?: 'exclude'; counts: Record<string, number>; onList: (l: AdvNote[]) => void; empty: string }) {
  if (!list.length) return <span className="px-1 text-[13px] text-muted-foreground">{empty}</span>
  return (
    <>
      {list.map((n, i) => (
        <span key={n.slug} className="inline-flex max-w-full items-center gap-1.5">
          {i > 0 && <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">or</span>}
          <AdvChip
            n={n}
            kind={kind}
            count={counts[n.slug] ?? null}
            onToggle={() => onList(list.map((x) => (x === n ? { ...x, variants: !x.variants } : x)))}
            onRemove={() => onList(list.filter((x) => x !== n))}
          />
        </span>
      ))}
    </>
  )
}

function Tag({ children, kind, className }: { children: React.ReactNode; kind?: 'not'; className?: string }) {
  return (
    <span className={cn(className, 'inline-flex h-6 w-[68px] shrink-0 items-center font-mono text-[11px] font-medium tracking-[.08em] uppercase', kind === 'not' ? 'text-destructive/80' : 'text-muted-foreground')}>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- one condition row
function Row({ clause, idx, counts, onClause, onRemove }: { clause: Clause; idx: number; counts: Record<string, number>; onClause: (c: Clause) => void; onRemove: () => void }) {
  const addNote = (n: { slug: string; name: string; image?: string; color?: string }) => {
    if (clause.notes.some((x) => x.slug === n.slug)) return
    onClause({ ...clause, notes: [...clause.notes, toAdvNote(n)] })
  }
  const drop = useOwnDrop((d) => addNote({ slug: d.slug, name: d.name }))
  return (
    <div
      data-row={clause.id}
      {...drop.props}
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border bg-card px-3 py-2.5 transition-colors',
        !clause.notes.length && 'border-dashed',
        drop.over && dropRing,
      )}
    >
      <Tag className="max-sm:order-[-2]">{idx ? 'and' : 'where'}</Tag>
      <Segmented<AdvLayer> size="sm" label="Layer" value={clause.layer} onChange={(v) => onClause({ ...clause, layer: v })} options={LAYER_OPTS} />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Chips list={clause.notes} counts={counts} onList={(notes) => onClause({ ...clause, notes })} empty="Pick one or more notes — any one of them is enough" />
      </div>
      <NoteSearch
        compact
        className="min-w-[160px] flex-1 basis-40"
        placeholder={clause.notes.length ? 'or…' : 'Add a note…'}
        label={`Add a note to condition ${idx + 1}`}
        skip={() => new Set(clause.notes.map((n) => n.slug))}
        onPick={(n) => addNote(n)}
      />
      <Button size="icon-sm" variant="ghost" aria-label={`Remove condition ${idx + 1}`} title="Remove this condition" onClick={onRemove} className="text-muted-foreground max-sm:order-[-1] max-sm:ml-auto">
        <X />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- builder
export function AdvancedBuilder({ adv, onChange }: { adv: Adv; onChange: (a: Adv) => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [focusId, setFocusId] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const blank = useRef<Clause>(newClause())
  const clauses = adv.clauses.length ? adv.clauses : [blank.current]

  // how many notes each "≈" toggle expands to
  const wanted = [...adv.clauses.flatMap((c) => c.notes), ...adv.exclude].filter((n) => n.variants && counts[n.slug] == null).map((n) => n.slug)
  const wantKey = [...new Set(wanted)].join(',')
  useEffect(() => {
    if (!wantKey) return
    for (const slug of wantKey.split(','))
      getVariants(slug)
        .then((r) => setCounts((c) => ({ ...c, [slug]: r.count })))
        .catch(() => setCounts((c) => ({ ...c, [slug]: 1 })))
  }, [wantKey])

  useEffect(() => {
    if (focusId == null) return
    root.current?.querySelector<HTMLInputElement>(`[data-row="${focusId}"] input`)?.focus()
    setFocusId(null)
  }, [focusId])

  const setClauses = (cl: Clause[]) => onChange({ ...adv, clauses: cl.length ? cl : [newClause()] })
  const addRow = () => {
    const c = newClause()
    onChange({ ...adv, clauses: [...clauses, c] })
    setFocusId(c.id)
  }
  // dropping on the gap between rows starts a new condition
  const gapDrop = useDropZone((d) => onChange({ ...adv, clauses: [...clauses, newClause('any', [toAdvNote(d)])] }))
  const exDrop = useOwnDrop((d) => onChange(addExclude(adv, { slug: d.slug, name: d.name })))

  return (
    <div ref={root} className="flex flex-col gap-3">
      <div {...gapDrop.props} className={cn('-m-1 flex flex-col gap-2 rounded-2xl p-1 transition-colors', gapDrop.over && 'bg-accent/40')}>
        {clauses.map((c, i) => (
          <Row
            key={c.id}
            clause={c}
            idx={i}
            counts={counts}
            onClause={(nc) => setClauses(clauses.map((x) => (x === c ? nc : x)))}
            onRemove={() => setClauses(clauses.filter((x) => x !== c))}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus />
          Add condition (AND)
        </Button>
        <label
          className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground"
          title="About a quarter of perfumes list their notes as one flat list instead of top / heart / base. When this is on they match a layered condition in any layer, so they are not silently dropped."
        >
          <Checkbox checked={adv.gen} onCheckedChange={(v) => onChange({ ...adv, gen: v === true })} />
          Include perfumes without a pyramid (match their notes in any layer)
        </label>
      </div>
      <div
        {...exDrop.props}
        className={cn('flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-dashed border-destructive/30 px-3 py-2.5 transition-colors', exDrop.over && dropRing)}
      >
        <Tag kind="not">without</Tag>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chips list={adv.exclude} kind="exclude" counts={counts} onList={(exclude) => onChange({ ...adv, exclude })} empty="Nothing excluded — these notes may not appear anywhere" />
        </div>
        <NoteSearch
          compact
          className="min-w-[160px] flex-1 basis-40"
          placeholder="Add a note to leave out…"
          label="Add a note to exclude"
          skip={() => new Set(adv.exclude.map((n) => n.slug))}
          onPick={(n) => onChange(addExclude(adv, n))}
        />
      </div>
    </div>
  )
}
