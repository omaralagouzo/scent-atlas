// Global search (⌘K / Ctrl+K, or "/" on pages without their own search box): perfumes, notes and pages.
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { go, openPerfume } from '@/lib/router'
import { compact } from '@/lib/format'
import type { Note, Perfume } from '@/lib/types'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { BottleThumb, NoteImg } from '@/components/media'
import { NAV } from './nav'

let openFn: (o: boolean) => void = () => {}
export const openSearch = () => openFn(true)

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [perfumes, setPerfumes] = useState<Perfume[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const seq = useRef(0)
  openFn = setOpen

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setPerfumes([])
      setNotes([])
      return
    }
    const my = ++seq.current
    const t = setTimeout(async () => {
      try {
        const [p, n] = await Promise.all([api.get('/api/perfumes', { q: query, limit: 6 }), api.get('/api/notes', { q: query, limit: 5 })])
        if (my !== seq.current) return
        setPerfumes(p.results)
        setNotes(n.notes)
      } catch {
        /* ignore */
      }
    }, 120)
    return () => clearTimeout(t)
  }, [q])

  const run = (fn: () => void) => {
    setOpen(false)
    setQ('')
    fn()
  }
  const pages = NAV.filter((n) => !q || n.label.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search Scent Atlas" description="Search perfumes, notes and pages" className="top-[20%] translate-y-0 sm:max-w-xl" showCloseButton={false}>
      <CommandInput placeholder="Search perfumes, notes, pages…" value={q} onValueChange={setQ} />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>{q.trim().length < 2 ? 'Type at least two letters.' : 'No results.'}</CommandEmpty>
        {perfumes.length > 0 && (
          <CommandGroup heading="Perfumes">
            {perfumes.map((p) => (
              <CommandItem key={`p${p.id}`} value={`p${p.id}`} onSelect={() => run(() => openPerfume(p.id))} className="gap-3">
                <BottleThumb p={p} size={36} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold tracking-[-0.015em] text-[15px] leading-tight">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.brand}
                    {p.year ? ` · ${p.year}` : ''}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {notes.length > 0 && (
          <CommandGroup heading="Notes">
            {notes.map((n) => (
              <CommandItem key={`n${n.slug}`} value={`n${n.slug}`} onSelect={() => run(() => go(`/note/${encodeURIComponent(n.slug)}`))} className="gap-3">
                <NoteImg n={n} className="size-8 rounded-full" />
                <span className="flex-1 truncate">{n.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{compact(n.count)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {pages.length > 0 && (
          <CommandGroup heading="Go to">
            {pages.map((n) => (
              <CommandItem key={n.href} value={`go${n.href}`} onSelect={() => run(() => go(n.href))}>
                <n.icon className="text-muted-foreground" />
                {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
