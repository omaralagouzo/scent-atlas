// Perfume search box with a suggestion list.
import { useEffect, useRef, useState } from 'react'
import { Search, Star } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { BottleThumb } from './media'

export interface PerfumePickerProps {
  onPick: (p: Perfume) => void
  placeholder?: string
  label?: string
  /** keep the box ready for the next pick */
  clearOnPick?: boolean
  skip?: () => Set<number>
  autoFocus?: boolean
  size?: 'default' | 'lg'
  className?: string
}

export function PerfumePicker({
  onPick,
  placeholder = 'Search a perfume or brand — Aventus, Shalimar, Tom Ford…',
  label = 'Search for a perfume',
  clearOnPick = false,
  skip = () => new Set(),
  autoFocus = false,
  size = 'lg',
  className,
}: PerfumePickerProps) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Perfume[]>([])
  const [active, setActive] = useState(-1)
  const seq = useRef(0)
  const timer = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) setTimeout(() => input.current?.focus(), 0)
    return () => window.clearTimeout(timer.current)
  }, [autoFocus])

  const fetchNow = async (value: string) => {
    const query = value.trim()
    if (query.length < 2) {
      setOpen(false)
      return
    }
    const my = ++seq.current
    try {
      const r = await api.get('/api/perfumes', { q: query, limit: 10 })
      if (my !== seq.current) return
      const sk = skip()
      const next = r.results.filter((p: Perfume) => !sk.has(p.id)).slice(0, 8)
      setItems(next)
      setActive(next.length ? 0 : -1)
      setOpen(true)
    } catch {
      /* ignore */
    }
  }
  const choose = (p: Perfume) => {
    if (clearOnPick) {
      setQ('')
      setOpen(false)
      input.current?.focus()
    } else setOpen(false)
    onPick(p)
  }
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
      <input
        ref={input}
        data-search=""
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          window.clearTimeout(timer.current)
          const v = e.target.value
          timer.current = window.setTimeout(() => fetchNow(v), 140)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) fetchNow(q)
            else setActive((a) => (a + 1) % Math.max(items.length, 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a - 1 + items.length) % Math.max(items.length, 1))
          } else if (e.key === 'Enter' && open && items[active]) {
            e.preventDefault()
            choose(items[active])
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
        className={cn(
          'w-full rounded-lg border border-input bg-card pr-3 pl-10 shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          size === 'lg' ? 'h-12 text-base' : 'h-10 text-sm',
        )}
      />
      {open && (
        <ul role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1.5 max-h-96 overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
          {!items.length && <li className="px-3 py-2 text-sm text-muted-foreground">No perfume found</li>}
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(p)
              }}
              onMouseMove={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5', i === active && 'bg-accent')}
            >
              <BottleThumb p={p} size={40} />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate font-serif text-[17px] font-normal leading-tight">{p.name}</b>
                <small className="truncate text-xs text-muted-foreground">
                  {p.brand}
                  {p.year ? ' · ' + p.year : ''}
                </small>
              </span>
              {p.rating ? (
                <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  <Star className="size-3 fill-gold text-gold" />
                  {p.rating.toFixed(2)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
