// Notes: tiles, chips (with layer / variant / add / remove controls), drag & drop, autocomplete, pyramid diagram.
import { useEffect, useId, useRef, useState } from 'react'
import { Minus, Plus, Search, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cacheNotes } from '@/lib/store'
import { compact, layerLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Note, Pyramid } from '@/lib/types'
import { NoteImg } from './media'

export const LAYER_COLOR: Record<string, string> = {
  top: 'var(--note-top)',
  middle: 'var(--note-middle)',
  base: 'var(--note-base)',
  general: 'var(--note-general)',
  any: 'var(--muted-foreground)',
}

export function NoteTile({ n }: { n: Note }) {
  return (
    <a
      href={`#/note/${encodeURIComponent(n.slug)}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="aspect-square overflow-hidden bg-muted">
        <NoteImg n={n} alt={n.name} className="h-full w-full transition-transform duration-300 group-hover:scale-105" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="size-2 shrink-0 rounded-full" style={{ background: n.color }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{compact(n.count)}</span>
      </div>
    </a>
  )
}

// ---------------------------------------------------------------- drag & drop (between note pickers)
export type DragNote = { slug: string; name: string; from?: string | null }

export function dragProps(note: Note, from: string | null = null) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/x-note', JSON.stringify({ slug: note.slug, name: note.name, from }))
      e.dataTransfer.effectAllowed = 'copyMove'
      ;(e.currentTarget as HTMLElement).classList.add('opacity-50')
    },
    onDragEnd: (e: React.DragEvent) => (e.currentTarget as HTMLElement).classList.remove('opacity-50'),
  }
}

/** Spread on an element to make it accept dropped notes; `over` tells you when to highlight. */
export function useDropZone(onDrop: (n: DragNote) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if ([...e.dataTransfer.types].includes('text/x-note')) {
          e.preventDefault()
          setOver(true)
        }
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      },
      onDrop: (e: React.DragEvent) => {
        setOver(false)
        const raw = e.dataTransfer.getData('text/x-note')
        if (!raw) return
        e.preventDefault()
        try {
          onDrop(JSON.parse(raw))
        } catch {
          /* ignore */
        }
      },
    },
  }
}

// ---------------------------------------------------------------- chip
export interface NoteChipProps {
  n: Note
  count?: number | null
  onClick?: () => void
  title?: string
  onRemove?: () => void
  onAdd?: () => void
  addTitle?: string
  /** a layer the note must be in; click cycles it */
  layer?: { value: string | null; onCycle: () => void }
  /** "≈" toggle: also match every note containing this word */
  variant?: { on: boolean; count?: number | null; title?: string; onToggle: (e: React.MouseEvent) => void }
  kind?: 'exclude'
  draggable?: boolean
  from?: string | null
  extra?: React.ReactNode
  className?: string
}

const chipBtn = 'grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground'

export function NoteChip({ n, count, onClick, title, onRemove, onAdd, addTitle, layer, variant, kind, draggable = true, from = null, extra, className }: NoteChipProps) {
  const inner = (
    <>
      <NoteImg n={n} className="size-6 shrink-0 rounded-full" />
      <span className={cn('truncate text-[13px] font-medium', kind === 'exclude' && 'line-through decoration-destructive/60')}>{n.name}</span>
      {count != null && <span className="font-mono text-[11px] text-muted-foreground">{compact(count)}</span>}
    </>
  )
  return (
    <span
      data-slug={n.slug}
      {...(draggable ? dragProps(n, from) : {})}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-0.5 shadow-xs',
        kind === 'exclude' && 'border-dashed border-destructive/40 bg-destructive/5',
        draggable && 'cursor-grab active:cursor-grabbing',
        className,
      )}
    >
      {onClick ? (
        <button type="button" onClick={onClick} title={title} className="inline-flex min-w-0 items-center gap-1.5 rounded-full pr-1 hover:opacity-80">
          {inner}
        </button>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1.5 pr-1">{inner}</span>
      )}
      {layer && (
        <button
          type="button"
          title="Click to change which layer this note must be in"
          onClick={(e) => {
            e.stopPropagation()
            layer.onCycle()
          }}
          className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-[11px] font-medium whitespace-nowrap hover:bg-secondary"
        >
          <span className="size-1.5 rounded-full" style={{ background: LAYER_COLOR[layer.value || 'any'] }} />
          {layer.value ? layerLabel(layer.value) : 'Any layer'}
        </button>
      )}
      {variant && (
        <button
          type="button"
          aria-pressed={variant.on}
          title={variant.title || (variant.on ? 'Also matches every note containing this word (click to turn off)' : 'Also match every note containing this word')}
          onClick={(e) => {
            e.stopPropagation()
            variant.onToggle(e)
          }}
          className={cn('h-5 rounded-full px-1.5 font-mono text-[11px]', variant.on ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-muted')}
        >
          {variant.on ? `≈ ${variant.count == null ? '…' : variant.count}` : '≈'}
        </button>
      )}
      {onAdd && (
        <button
          type="button"
          title={addTitle || 'Add'}
          aria-label={addTitle || 'Add'}
          className={chipBtn}
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
        >
          <Plus className="size-3.5" />
        </button>
      )}
      {extra}
      {onRemove && (
        <button
          type="button"
          title="Remove"
          aria-label={`Remove ${n.name}`}
          className={chipBtn}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  )
}

// ---------------------------------------------------------------- autocomplete
export interface NoteSearchProps {
  placeholder?: string
  onPick: (n: Note, opts: { exclude: boolean }) => void
  allowExclude?: boolean
  label?: string
  skip?: () => Set<string>
  compact?: boolean
  source?: (q: string) => Promise<Note[]>
  className?: string
}

export function NoteSearch({ placeholder = 'Add a note…', onPick, allowExclude = false, label = 'Search notes', skip = () => new Set(), compact: small = false, source, className }: NoteSearchProps) {
  const id = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Note[]>([])
  const [active, setActive] = useState(-1)
  const seq = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const fetchNow = async (value: string) => {
    const my = ++seq.current
    try {
      const notes: Note[] = source ? await source(value) : (await api.get('/api/notes', { q: value, limit: 24 })).notes
      if (my !== seq.current) return
      cacheNotes(notes)
      const sk = skip()
      const next = notes.filter((n) => !sk.has(n.slug)).slice(0, 8)
      setItems(next)
      setActive(next.length ? 0 : -1)
      setOpen(true)
    } catch {
      /* ignore */
    }
  }
  const timer = useRef<number>(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const pick = (n: Note, exclude = false) => {
    onPick(n, { exclude })
    setQ('')
    setOpen(false)
    input.current?.focus()
  }
  useEffect(() => {
    if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={input}
        data-search=""
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          window.clearTimeout(timer.current)
          const v = e.target.value
          timer.current = window.setTimeout(() => fetchNow(v), 110)
        }}
        onFocus={() => !open && fetchNow(q)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) fetchNow(q)
            else setActive((a) => (a + 1) % Math.max(items.length, 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a - 1 + items.length) % Math.max(items.length, 1))
          } else if (e.key === 'Enter') {
            if (open && items[active]) {
              e.preventDefault()
              pick(items[active], allowExclude && e.shiftKey)
            }
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
        className={cn(
          'w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          small ? 'h-9' : 'h-11 text-[15px]',
        )}
      />
      {open && (
        <ul id={id} ref={list} role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1.5 max-h-80 overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
          {!items.length && <li className="px-3 py-2 text-sm text-muted-foreground">No matching notes</li>}
          {items.map((n, i) => (
            <li
              key={n.slug}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('[data-excl]')) return
                e.preventDefault()
                pick(n, false)
              }}
              onMouseMove={() => active !== i && setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm', i === active && 'bg-accent')}
            >
              <NoteImg n={n} className="size-7 rounded-full" />
              <span className="min-w-0 flex-1 truncate font-medium">{n.name}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{n.family}</span>
              <span className="font-mono text-xs text-muted-foreground">{compact(n.count)}</span>
              {allowExclude && (
                <button
                  type="button"
                  data-excl=""
                  tabIndex={-1}
                  title="Exclude this note"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(n, true)
                  }}
                  className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Minus className="size-3.5" />
                </button>
              )}
            </li>
          ))}
          {allowExclude && items.length > 0 && <li className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">Shift+Enter or − excludes a note</li>}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- pyramid diagram
function NoteCard({ n, onNote }: { n: Note; onNote?: (e: React.MouseEvent) => void }) {
  return (
    <a
      href={`#/note/${encodeURIComponent(n.slug)}`}
      title={`${n.name} — ${n.count} perfumes`}
      onClick={onNote}
      className="flex w-[74px] flex-col items-center gap-1 text-center text-xs leading-tight hover:text-foreground"
    >
      <NoteImg n={n} className="size-12 rounded-full ring-1 ring-border" />
      <span className="line-clamp-2">{n.name}</span>
    </a>
  )
}

/** A read-only three-tier pyramid. */
export function PyramidDiagram({ pyr, onNote }: { pyr: Pyramid; onNote?: (e: React.MouseEvent) => void }) {
  const hasLayers = (['top', 'middle', 'base'] as const).some((k) => (pyr[k] || []).length)
  const tier = (key: string, label: string, notes: Note[], width: string) => (
    <section key={key} aria-label={`${label} notes`} className={cn('rounded-xl border bg-card px-4 pt-2.5 pb-3', width)}>
      <header className="mb-2 flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: LAYER_COLOR[key] }} />
        <h4 className="text-[13px] font-semibold">{label}</h4>
        <small className="font-mono text-xs text-muted-foreground">{notes.length}</small>
      </header>
      <div className="flex flex-wrap gap-x-1 gap-y-3 text-muted-foreground">
        {notes.map((n) => (
          <NoteCard key={n.slug} n={n} onNote={onNote} />
        ))}
      </div>
    </section>
  )
  const out = []
  if (hasLayers) {
    out.push(tier('top', 'Top', pyr.top || [], 'w-full sm:w-[70%]'), tier('middle', 'Heart', pyr.middle || [], 'w-full sm:w-[85%]'), tier('base', 'Base', pyr.base || [], 'w-full'))
  }
  if ((pyr.general || []).length) out.push(tier('general', hasLayers ? 'Also listed' : 'Notes', pyr.general || [], 'w-full'))
  if (!out.length) return <p className="text-sm text-muted-foreground">No notes listed for this fragrance.</p>
  return <div className="flex flex-col items-center gap-2">{out}</div>
}
