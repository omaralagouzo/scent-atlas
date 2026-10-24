// The note library: a wall of note tiles with a family filter and type-ahead.
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { cacheNotes } from '@/lib/store'
import { sync } from '@/lib/router'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Note } from '@/lib/types'
import { useInfinite } from '@/hooks/use-infinite'
import { NoteTile } from '@/components/notes'
import { OneLine } from '@/components/one-line'
import { ListStatus, Page, PageHeader } from '@/components/page'
import { Segmented } from '@/components/segmented'

const PAGE = 72

export default function NotesView({ params }: ViewProps) {
  const [input, setInput] = useState(params.get('q') || '')
  const [q, setQ] = useState(input.trim())
  const [family, setFamily] = useState(params.get('family') || '')
  const [sort, setSort] = useState(params.get('sort') || 'count')
  const [families, setFamilies] = useState<{ name: string; count: number; color: string }[]>([])
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 160)
    return () => clearTimeout(t)
  }, [input])
  useEffect(() => sync('/notes', { q, family, sort: sort === 'count' ? '' : sort }), [q, family, sort])

  const list = useInfinite<Note>(
    async (page, signal) => {
      const r = await api.get('/api/notes', { q, family, sort, limit: PAGE, offset: (page - 1) * PAGE }, signal)
      cacheNotes(r.notes)
      if (page === 1) {
        setFamilies(r.families)
        setTotal(r.total)
      }
      return { items: r.notes, hasMore: page * PAGE < r.total }
    },
    [q, family, sort],
  )
  const all = families.reduce((s, f) => s + f.count, 0)
  const famChip = (value: string, label: string, count: number, color?: string) => (
    <button
      key={value || 'all'}
      type="button"
      aria-pressed={family === value}
      onClick={() => setFamily(value)}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] whitespace-nowrap transition-colors hover:bg-muted',
        family === value && 'border-foreground bg-foreground text-background hover:bg-foreground',
      )}
    >
      {color && <i className="size-2 rounded-full" style={{ background: color }} />}
      {label}
      <small className={cn('font-mono text-[11px] text-muted-foreground', family === value && 'text-background/70')}>{count}</small>
    </button>
  )

  return (
    <Page wide>
      <PageHeader title="Note Library" description="Every ingredient in the atlas, and the perfumes that carry it." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <input
            data-search=""
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list.items[0]) location.hash = `#/note/${encodeURIComponent(list.items[0].slug)}`
            }}
            placeholder="Search notes — bergamot, oud, tuberose…"
            aria-label="Search notes"
            autoComplete="off"
            className="h-12 w-full rounded-lg border border-input bg-card pr-3 pl-10 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <Segmented
          label="Sort notes"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'count', label: 'Most used' },
            { value: 'name', label: 'A – Z' },
          ]}
        />
        <span className="font-mono text-sm text-muted-foreground" aria-live="polite">
          {total != null && plural(total, 'note')}
        </span>
      </div>
      <OneLine label="Filter by family" className="mb-6">
        {families.length > 0 && famChip('', 'All', all)}
        {families.map((f) => famChip(f.name, f.name, f.count, f.color))}
      </OneLine>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
        {list.items.map((n) => (
          <NoteTile key={n.slug} n={n} />
        ))}
      </div>
      <ListStatus {...list} emptyText="No notes match that search." />
    </Page>
  )
}
