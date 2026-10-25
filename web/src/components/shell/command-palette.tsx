// Global search (⌘K / Ctrl+K, or "/" on pages without their own search box): perfumes, notes and pages.
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useSession } from '@/lib/store'
import { brandHref } from '@/components/brandtags'
import { UserAvatar } from './account-menu'
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
  const [brands, setBrands] = useState<{ name: string; count: number }[]>([])
  const [people, setPeople] = useState<{ username: string }[]>([])
  const { user } = useSession()
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
      setBrands([])
      setPeople([])
      return
    }
    const my = ++seq.current
    const t = setTimeout(async () => {
      try {
        const [p, n, b, u] = await Promise.all([
          api.get('/api/perfumes', { q: query, limit: 6 }),
          api.get('/api/notes', { q: query, limit: 5 }),
          api.get('/api/brands', { q: query, limit: 4 }),
          user ? api.get('/api/users/search', { q: query }).catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
        ])
        if (my !== seq.current) return
        setPerfumes(p.results)
        setNotes(n.notes)
        setBrands(b.brands)
        setPeople(u.users.slice(0, 4))
      } catch {
        /* ignore */
      }
    }, 120)
    return () => clearTimeout(t)
  }, [q, user])

  const run = (fn: () => void) => {
    setOpen(false)
    setQ('')
    fn()
  }
  const pages = NAV.filter((n) => !q || n.label.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search Scent Atlas" description="Search perfumes, brands, notes, people and pages" shouldFilter={false} className="top-[20%] translate-y-0 sm:max-w-xl" showCloseButton={false}>
      <CommandInput placeholder="Search perfumes, brands, notes, people…" value={q} onValueChange={setQ} />
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
        {brands.length > 0 && (
          <CommandGroup heading="Brands">
            {brands.map((b) => (
              <CommandItem key={`b${b.name}`} value={`b${b.name}`} onSelect={() => run(() => (location.hash = brandHref(b.name)))} className="gap-3">
                <span className="grid size-8 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">{b.name.slice(0, 1)}</span>
                <span className="flex-1 truncate">{b.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{compact(b.count)}</span>
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
        {people.length > 0 && (
          <CommandGroup heading="People">
            {people.map((u) => (
              <CommandItem key={`u${u.username}`} value={`u${u.username}`} onSelect={() => run(() => go(`/u/${encodeURIComponent(u.username)}`))} className="gap-3">
                <UserAvatar name={u.username} size={28} />
                <span className="flex-1 truncate">@{u.username}</span>
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
