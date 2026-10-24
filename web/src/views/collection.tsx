// My Collection: the perfumes you own as an endless personal leaderboard (podium, top 5, top 10, the rest),
// head-to-head ranking, drag-to-reorder, the scent profile computed from it, and layering ideas from the shelf.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, GripVertical, Layers, Plus, Search, Star, Swords } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api, errorText } from '@/lib/api'
import { go, sync, openPerfume } from '@/lib/router'
import { authDialog, mine, useSession } from '@/lib/store'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Note, Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { BottleImg } from '@/components/media'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NoteImg } from '@/components/media'
import { EmptyState, Page } from '@/components/page'
import { PerfumePicker } from '@/components/picker'
import { Segmented } from '@/components/segmented'
import { LayeringIdeas } from '@/components/layer'
import { DuelDialog, type DuelRequest } from '@/components/collection/duel'
import { MoreMenu, Podium, RankRow, type Item, type ItemActions } from '@/components/collection/podium'

type Tab = 'board' | 'profile' | 'layering'
type Show = '3' | '5' | '10' | 'all'
const TABS: { value: Tab; label: string }[] = [
  { value: 'board', label: 'Leaderboard' },
  { value: 'profile', label: 'Scent profile' },
  { value: 'layering', label: 'Layering ideas' },
]
const SHOW: { value: Show; label: string }[] = [
  { value: '3', label: 'Top 3' },
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: 'all', label: 'All' },
]
const TIERS: [number, number, string][] = [
  [3, 5, 'Rounding out the top 5'],
  [5, 10, 'Top 10'],
  [10, Infinity, 'The rest of the shelf'],
]

type ProfileNote = Note & { perfumes: number; share: number }
interface Profile {
  count: number
  ranked: number
  archetype: { title: string; blurb: string; families: string[] }
  favorite_accord: { name: string; share: number; color: string; perfumes: number } | null
  favorite_notes: ProfileNote[]
  accords: { name: string; share: number; color: string; perfumes: number }[]
  families: { key: string; label: string; color: string; share: number }[]
  notes: ProfileNote[]
  common_notes: ProfileNote[]
  houses: { tag: string; label: string; count: number; share: number }[]
  brands: { name: string; count: number }[]
  perfumers: { name: string; count: number }[]
  era: { median_year: number; oldest: number; newest: number } | null
  community_rating: number | null
  gaps: { key: string; label: string; hint: string }[]
}
interface Data {
  items: Item[]
  order: number[]
  profile: Profile
}

const ranked = (d: Data) => {
  const by = new Map(d.items.map((it) => [it.id, it]))
  return d.order.map((id) => by.get(id)).filter(Boolean) as Item[]
}
const unranked = (d: Data) => d.items.filter((it) => !it.rank)
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function CollectionView({ params }: ViewProps) {
  const { user, loaded } = useSession()
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.value === params.get('tab')) ? (params.get('tab') as Tab) : 'board')
  const [show, setShow] = useState<Show>(SHOW.some((s) => s.value === params.get('show')) ? (params.get('show') as Show) : 'all')
  const [editing, setEditing] = useState(false)
  const [data, setDataState] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)
  const [duel, setDuel] = useState<DuelRequest | null>(null)
  const [moving, setMoving] = useState<Item | null>(null)
  const dataRef = useRef<Data | null>(null)
  const dead = useRef(false)
  const gen = useRef(0)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const saveSeq = useRef(0)

  useEffect(() => {
    dead.current = false
    return () => {
      dead.current = true
    }
  }, [])
  useEffect(() => sync('/collection', { tab: tab === 'board' ? '' : tab, show: show === 'all' ? '' : show }), [tab, show])

  const setData = (d: Data) => {
    dataRef.current = d
    setDataState(d)
  }
  // ---------------------------------------------------------------- data
  const apply = useCallback((r: Data) => {
    setData(r)
    // the server marked these as owned: tell the status store (one emit at the end)
    r.items.forEach((it, k) => {
      const s = { status: 'owned' as const, rating: it.my.rating, has_note: !!it.my.note }
      if (k === r.items.length - 1) mine.set(it.id, s)
      else mine.map.set(String(it.id), s)
    })
  }, [])

  const load = useCallback(async () => {
    const my = ++gen.current
    setFailed(false)
    try {
      const r = await api.get<Data>('/api/me/collection')
      if (dead.current || my !== gen.current) return
      apply(r)
    } catch {
      if (!dead.current && my === gen.current) setFailed(true)
    }
  }, [apply])

  useEffect(() => {
    if (!loaded) return
    if (user) load()
    else {
      gen.current++
      dataRef.current = null
      setDataState(null)
    }
  }, [loaded, user?.id, load])

  function saveOrder(ids: number[], msg?: string | null) {
    const d = dataRef.current
    if (!d) return Promise.resolve()
    setData({ ...d, order: ids.slice(), items: d.items.map((it) => ({ ...it, rank: ids.indexOf(it.id) >= 0 ? ids.indexOf(it.id) + 1 : null })) })
    const my = ++saveSeq.current
    saving.current = saving.current.then(async () => {
      try {
        const r = await api.put<Data>('/api/me/collection/order', { ids })
        if (dead.current) return
        if (my === saveSeq.current) apply(r) // a newer local order is already on screen: let its own save settle it
        if (msg) toast(msg)
      } catch {
        toast('Could not save the new order.')
        load()
      }
    })
    return saving.current
  }

  async function add(p: Perfume) {
    const d = dataRef.current
    if (d?.items.some((x) => x.id === p.id)) {
      toast(`${p.name} is already on your shelf.`)
      return
    }
    try {
      const r = await api.post<Data>('/api/me/collection', { perfume_id: p.id })
      apply(r)
      const it = r.items.find((x) => x.id === p.id)
      if (!ranked(r).length) await saveOrder([p.id], `${p.name} is your #1 — for now.`)
      else if (it) toast(`Added ${p.name}.`, { duration: 6000, action: { label: 'Rank it', onClick: () => rankOne(it) } })
    } catch (e) {
      toast(errorText(e, 'Could not add it.'))
    }
  }

  async function removeItem(it: Item) {
    const before = dataRef.current?.order.slice() || []
    try {
      await mine.save(it.id, { status: null })
      await load()
      toast(`Removed ${it.name}.`, {
        duration: 6000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.post('/api/me/collection', { perfume_id: it.id })
              await api.put('/api/me/collection/order', { ids: before })
            } catch {
              toast('Could not undo.')
            }
            load()
          },
        },
      })
    } catch {
      toast('Could not remove it.')
    }
  }

  // ---------------------------------------------------------------- ranking: head-to-head binary insertion
  const askDuel = (it: Item, list: Item[], batch: DuelRequest['batch']) =>
    new Promise<number | null>((resolve) => {
      if (!list.length) return resolve(0)
      let settled = false
      setDuel({
        it,
        list,
        batch,
        resolve: (v) => {
          if (settled) return
          settled = true
          resolve(v)
        },
      })
    })

  async function rankOne(it: Item, batch: DuelRequest['batch'] = null) {
    const d = dataRef.current
    if (!d) return false
    const others = ranked(d).filter((x) => x.id !== it.id)
    const pos = await askDuel(it, others, batch)
    if (!batch) setDuel(null)
    if (pos == null) return false
    const ids = others.map((x) => x.id)
    ids.splice(pos, 0, it.id)
    const p = saveOrder(ids, batch ? null : `${it.name} placed at #${pos + 1}.`)
    if (!batch) await p
    return true
  }
  async function rankAll() {
    const d = dataRef.current
    if (!d) return
    const todo = unranked(d)
    let done = 0
    for (const it of todo) {
      if (dead.current || !(await rankOne(it, { n: done + 1, of: todo.length }))) break
      done++
    }
    setDuel(null)
    if (done) toast(done === todo.length ? `All ${plural(done, 'fragrance')} ranked.` : `${plural(done, 'fragrance')} ranked; the rest can wait.`)
  }

  const actions: ItemActions = {
    moveTo: (it) => setMoving(it),
    rankOne: (it) => void rankOne(it),
    unrank: (it) => void saveOrder((dataRef.current?.order || []).filter((x) => x !== it.id)),
    remove: (it) => void removeItem(it),
  }
  const rankOf = (id: number) => (dataRef.current?.order.indexOf(id) ?? -1) + 1

  // ---------------------------------------------------------------- frame
  const count = data?.items.length || 0
  const signedOut = loaded && !user
  return (
    <Page>
      <header className="mb-6">
        <div className="mb-1.5 font-mono text-xs tracking-[.08em] text-muted-foreground uppercase">Your shelf</div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[32px]">
          My Collection
          {count > 0 && <span className="ml-2 align-middle font-mono text-lg font-normal text-muted-foreground">· {count}</span>}
        </h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-muted-foreground">Everything you own, ranked your way. Add a bottle, settle where it belongs with a few quick “which do you love more?” questions, and see what your shelf says about your taste.</p>
      </header>

      {signedOut ? (
        <EmptyState
          className="py-16"
          icon={<Star className="size-5" />}
          title="Build your personal leaderboard"
          action={
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button onClick={() => authDialog.open({ mode: 'signup' })}>Create a free account</Button>
              <Button variant="outline" onClick={() => authDialog.open({ mode: 'login' })}>
                Sign in
              </Button>
            </div>
          }
        >
          Sign in to add the fragrances you own, rank them from your #1 down, discover your scent profile and get layering ideas from your own shelf.
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
            <PerfumePicker
              className="flex-1"
              placeholder="Add a fragrance you own — search by name or house…"
              label="Add a fragrance to your collection"
              clearOnPick
              skip={() => new Set(dataRef.current ? dataRef.current.items.map((x) => x.id) : [])}
              onPick={add}
            />
            <Segmented label="Collection view" options={TABS} value={tab} onChange={setTab} className="self-start md:self-auto" />
          </div>
          {failed ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Could not load your collection.{' '}
              <Button size="sm" variant="outline" onClick={load}>
                Retry
              </Button>
            </p>
          ) : !data ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((k) => (
                  <div key={k} className="h-72 animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
              <div className="h-40 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : tab === 'board' ? (
            <Board
              data={data}
              show={show}
              setShow={setShow}
              editing={editing}
              setEditing={setEditing}
              actions={actions}
              saveOrder={saveOrder}
              rankOne={(it) => void rankOne(it)}
              rankAll={rankAll}
            />
          ) : tab === 'profile' ? (
            <ProfileTab p={data.profile} onLayering={() => setTab('layering')} />
          ) : (
            <LayeringIdeas items={data.items} />
          )}
        </>
      )}

      <DuelDialog req={duel} rankOf={rankOf} />
      <MoveDialog
        it={moving}
        n={data?.order.length || 0}
        onClose={() => setMoving(null)}
        onMove={(it, pos) => {
          const ids = (dataRef.current?.order || []).filter((x) => x !== it.id)
          ids.splice(pos - 1, 0, it.id)
          saveOrder(ids)
        }}
      />
    </Page>
  )
}

// ---------------------------------------------------------------- move to position
function MoveDialog({ it, n, onClose, onMove }: { it: Item | null; n: number; onClose: () => void; onMove: (it: Item, pos: number) => void }) {
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (it) setValue(String(it.rank || n))
  }, [it, n])
  return (
    <Dialog open={!!it} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" onOpenAutoFocus={(e) => (e.preventDefault(), setTimeout(() => input.current?.select(), 0))}>
        <DialogHeader>
          <DialogTitle>Move to position</DialogTitle>
          <DialogDescription>
            Where should <span className="font-serif text-[15px] text-foreground">{it?.name}</span> sit? <span className="font-mono">1</span> is your favourite.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!it) return
            onMove(it, Math.max(1, Math.min(n, parseInt(value, 10) || 1)))
            onClose()
          }}
        >
          <Input ref={input} type="number" min={1} max={n} value={value} onChange={(e) => setValue(e.target.value)} aria-label="New position" className="h-11 font-mono text-lg" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Move</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- leaderboard
function TierTitle({ label, range, action }: { label: string; range?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <h3 className="text-sm font-semibold whitespace-nowrap">{label}</h3>
      {range && <small className="text-xs whitespace-nowrap text-muted-foreground">{range}</small>}
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      {action}
    </div>
  )
}

function Board({ data, show, setShow, editing, setEditing, actions, saveOrder, rankOne, rankAll }: {
  data: Data
  show: Show
  setShow: (s: Show) => void
  editing: boolean
  setEditing: (b: boolean) => void
  actions: ItemActions
  saveOrder: (ids: number[]) => void
  rankOne: (it: Item) => void
  rankAll: () => void
}) {
  const r = ranked(data)
  const u = unranked(data)
  if (!data.items.length)
    return (
      <EmptyState icon={<Plus className="size-5" />} title="Your shelf is empty" className="py-16">
        Search above to add the fragrances you own. Anything you mark as “Owned” elsewhere on the site shows up here too.
      </EmptyState>
    )
  const lim = show === 'all' ? Infinity : Number(show)
  const top = r.slice(0, Math.min(3, lim))
  return (
    <div className="flex flex-col gap-8">
      {r.length > 0 && (
        <div>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            {editing ? (
              <p className="text-sm text-muted-foreground">Drag the handles, or use the arrows. Changes save as you go.</p>
            ) : (
              <Segmented label="How much of the leaderboard to show" size="sm" options={SHOW} value={show} onChange={setShow} />
            )}
            <span className="flex-1" />
            <Button size="sm" variant={editing ? 'default' : 'outline'} aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? <Check /> : <ArrowUpDown />}
              {editing ? 'Done' : 'Reorder'}
            </Button>
          </div>
          {editing ? (
            <SortableList items={r} saveOrder={saveOrder} />
          ) : (
            <>
              <Podium top={top} actions={actions} />
              {TIERS.map(([a, b, label]) => {
                if (lim <= a || r.length <= a) return null
                const part = r.slice(a, Math.min(b, lim))
                return (
                  <section key={label} className="mb-6">
                    <TierTitle label={label} range={<span className="font-mono">{`#${a + 1}${part.length > 1 ? `–${a + part.length}` : ''}`}</span>} />
                    <ol start={a + 1} className="overflow-hidden rounded-xl border bg-card">
                      {part.map((it, k) => (
                        <RankRow key={it.id} it={it} place={a + k + 1} trailing={<MoreMenu it={it} actions={actions} />} />
                      ))}
                    </ol>
                  </section>
                )
              })}
              {lim < r.length && (
                <div className="flex justify-center">
                  <Button variant="ghost" onClick={() => setShow('all')}>
                    Show all <span className="font-mono">{r.length}</span> ranked
                    <ChevronDown />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {u.length > 0 && (
        <section>
          <TierTitle
            label={r.length ? 'Not ranked yet' : 'Start your leaderboard'}
            range={
              <>
                <span className="font-mono">{u.length}</span> {u.length === 1 ? 'fragrance' : 'fragrances'}
              </>
            }
            action={
              <Button size="sm" onClick={rankAll} className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Swords />
                {u.length > 1 ? 'Rank them all' : 'Rank it'}
              </Button>
            }
          />
          <p className="mb-3 text-sm text-muted-foreground">{r.length ? 'Answer a few “which do you love more?” questions and each one drops into its place.' : 'Pick your favourite first, then each next bottle is placed with a couple of quick questions.'}</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {u.map((it) => (
              <li key={it.id} className="group relative flex flex-col overflow-hidden rounded-xl border bg-card">
                <button type="button" onClick={() => openPerfume(it.id)} className="relative aspect-[4/5] bg-white dark:bg-sand-100" aria-label={`${it.name} details`}>
                  <BottleImg p={it} alt="" className="absolute inset-0 m-auto h-[96%] w-[96%] mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.03]" />
                </button>
                <MoreMenu it={it} actions={actions} className="absolute top-2 right-2 bg-card/85 backdrop-blur-sm" />
                <div className="flex flex-1 flex-col gap-0.5 px-3 pt-1 pb-3">
                  <b className="line-clamp-2 font-serif text-[19px] leading-[1.1] font-normal">{it.name}</b>
                  <span className="truncate text-[13px] text-muted-foreground">{it.brand}</span>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => rankOne(it)}>
                    Rank it
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Edit mode: pointer-driven reordering (mouse, pen and touch), arrow buttons and arrow keys on the handle.
 *  Rows glide to their new slots with a spring (FLIP), unless reduced motion is on. */
function SortableList({ items, saveOrder }: { items: Item[]; saveOrder: (ids: number[]) => void }) {
  const [dragOrder, setDragOrder] = useState<number[] | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const rows = useRef(new Map<number, HTMLLIElement>())
  const tops = useRef(new Map<number, number>())
  const focusAfter = useRef<{ id: number; which: 'handle' | 'up' | 'down' } | null>(null)
  const byId = new Map(items.map((it) => [it.id, it]))
  const order = dragOrder || items.map((it) => it.id)
  const ids = items.map((x) => x.id)
  const orderKey = order.join(',')

  // FLIP: measure where each row was, and animate from there to where it is now
  useLayoutEffect(() => {
    const reduce = reduceMotion()
    rows.current.forEach((el, id) => {
      const top = el.getBoundingClientRect().top + window.scrollY
      const prev = tops.current.get(id)
      tops.current.set(id, top)
      if (reduce || prev == null || id === dragId || Math.abs(prev - top) < 1) return
      el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }], { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' })
    })
    const f = focusAfter.current
    if (f) {
      focusAfter.current = null
      rows.current.get(f.id)?.querySelector<HTMLElement>(`[data-k="${f.which}"]`)?.focus()
    }
  }, [orderKey, dragId])

  function nudge(id: number, d: number, which: 'handle' | 'up' | 'down') {
    const next = ids.slice()
    const k = next.indexOf(id)
    const j = k + d
    if (k < 0 || j < 0 || j >= next.length) return
    ;[next[k], next[j]] = [next[j], next[k]]
    focusAfter.current = { id, which }
    saveOrder(next)
  }

  const onPointerDown = (e: React.PointerEvent, id: number) => {
    if (e.button > 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragId(id)
    setDragOrder(ids.slice())
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragId == null || !dragOrder) return
    const y = e.clientY
    const sibs = dragOrder.filter((x) => x !== dragId)
    const before = sibs.findIndex((x) => {
      const r = rows.current.get(x)?.getBoundingClientRect()
      return r ? y < r.top + r.height / 2 : false
    })
    const next = sibs.slice()
    next.splice(before < 0 ? next.length : before, 0, dragId)
    if (next.join() !== dragOrder.join()) setDragOrder(next)
    if (y < 70) window.scrollBy(0, -14)
    else if (y > window.innerHeight - 70) window.scrollBy(0, 14)
  }
  const end = () => {
    if (dragId == null) return
    const next = dragOrder
    setDragId(null)
    setDragOrder(null)
    if (next && next.join() !== ids.join()) saveOrder(next)
  }

  const iconBtn = 'grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <ol className={cn('rounded-xl border bg-card', dragId != null && 'select-none')}>
      {order.map((id, k) => {
        const it = byId.get(id)
        if (!it) return null
        const lifted = id === dragId
        return (
          <RankRow
            key={id}
            ref={(el: HTMLLIElement | null) => {
              if (el) rows.current.set(id, el)
              else rows.current.delete(id)
            }}
            it={it}
            place={k + 1}
            className={cn('relative bg-card transition-[box-shadow,scale] duration-200 first:rounded-t-xl last:rounded-b-xl', lifted && 'z-10 scale-[1.015] rounded-lg shadow-lg ring-1 ring-foreground/15')}
            lead={
              <button
                type="button"
                data-k="handle"
                aria-label={`Reorder ${it.name}: drag, or use the arrow keys`}
                title="Drag to reorder"
                className={cn(iconBtn, 'cursor-grab touch-none active:cursor-grabbing')}
                onPointerDown={(e) => onPointerDown(e, id)}
                onPointerMove={onPointerMove}
                onPointerUp={end}
                onPointerCancel={end}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                  e.preventDefault()
                  nudge(id, e.key === 'ArrowUp' ? -1 : 1, 'handle')
                }}
              >
                <GripVertical className="size-[18px]" />
              </button>
            }
            trailing={
              <span className="flex items-center">
                <button type="button" data-k="up" className={iconBtn} disabled={k === 0} aria-label={`Move ${it.name} up`} onClick={() => nudge(id, -1, 'up')}>
                  <ArrowUp className="size-4" />
                </button>
                <button type="button" data-k="down" className={iconBtn} disabled={k === order.length - 1} aria-label={`Move ${it.name} down`} onClick={() => nudge(id, 1, 'down')}>
                  <ArrowDown className="size-4" />
                </button>
              </span>
            }
          />
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------- scent profile
const pct = (x: number) => `${Math.round(x * 100)}%`
function gapLink(key: string) {
  const acc = ({ fresh: 'citrus~fresh~aquatic~aromatic', woody: 'woody', warm: 'amber~vanilla~warm spicy', floral: 'floral~rose~white floral' } as Record<string, string>)[key]
  return `#/combine?accords=${encodeURIComponent(acc || key)}&acc_any=1&acc_main=1`
}

function Tile({ label, value, sub, mono = false }: { label: string; value: React.ReactNode; sub?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4">
      <small className="text-xs text-muted-foreground">{label}</small>
      <b className={cn('text-lg leading-tight font-semibold tracking-[-0.01em]', mono && 'font-mono font-medium')}>{value}</b>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

function NoteBarList({ notes, count }: { notes: ProfileNote[]; count: number }) {
  return (
    <ol className="flex flex-col">
      {notes.map((n) => (
        <li key={n.slug}>
          <a href={`#/note/${encodeURIComponent(n.slug)}`} className="grid grid-cols-[28px_minmax(0,8rem)_1fr_auto] items-center gap-3 rounded-lg px-1 py-1 text-[13px] hover:bg-muted">
            <NoteImg n={n} className="size-7 rounded-full" />
            <span className="truncate">{n.name}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <i className="block h-full rounded-full" style={{ width: `${Math.max(6, Math.round(n.share * 100))}%`, background: n.color || 'var(--muted-foreground)' }} />
            </span>
            <small className="font-mono text-[11px] text-muted-foreground" title={`In ${n.perfumes} of ${count}`}>
              {n.perfumes}/{count}
            </small>
          </a>
        </li>
      ))}
    </ol>
  )
}

function ProfileTab({ p, onLayering }: { p: Profile; onLayering: () => void }) {
  if (!p.count) return <p className="py-10 text-center text-sm text-muted-foreground">Add a few fragrances to see your scent profile.</p>
  const fams = p.families.filter((f) => f.share >= 0.01)
  const top = p.accords[0]?.share || 1
  const card = 'rounded-xl border bg-card p-5'
  const h3 = 'mb-3 text-base font-semibold tracking-[-0.02em]'
  return (
    <div className="flex flex-col gap-6">
      {/* the one mesh-soft moment on the site: the personal summary */}
      <section className="mesh-soft overflow-hidden rounded-2xl px-5 py-7 text-sand-900 sm:px-8 sm:py-9 dark:text-foreground">
        <p className="font-mono text-xs tracking-[.08em] uppercase opacity-70">Your scent profile</p>
        <h2 className="mt-2 font-serif text-[40px] leading-[1.02] font-normal tracking-[-0.01em] sm:text-[56px]">{p.archetype.title}</h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed opacity-85">{p.archetype.blurb}</p>
        <div
          role="img"
          aria-label={'Scent families: ' + fams.map((f) => `${f.label} ${pct(f.share)}`).join(', ')}
          className="mt-6 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-white/50 dark:bg-black/20"
        >
          {fams.map((f) => (
            <span key={f.key} style={{ flexGrow: f.share, background: f.color }} title={`${f.label} ${pct(f.share)}`} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
          {fams.slice(0, 6).map((f) => (
            <li key={f.key} className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full" style={{ background: f.color }} />
              {f.label}
              <small className="font-mono text-[11px] opacity-70">{pct(f.share)}</small>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs opacity-70">
          Based on <span className="font-mono">{p.count}</span> {p.count === 1 ? 'fragrance' : 'fragrances'}
          {p.ranked ? '; your top-ranked ones count more' : ''}. Rank more of them to sharpen it.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h3 className={h3}>Favourite accords</h3>
          {p.favorite_accord && (
            <p className="mb-4 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              Number one:
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground capitalize">
                <i className="size-2.5 rounded-full" style={{ background: p.favorite_accord.color }} />
                {p.favorite_accord.name}
              </span>
              {p.favorite_accord.perfumes ? <span>· a main accord in {plural(p.favorite_accord.perfumes, 'of your fragrances', 'of your fragrances')}</span> : null}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {p.accords.slice(0, 8).map((a) => (
              <div key={a.name} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-[13px]">
                <span className="flex items-center gap-2 truncate capitalize">
                  <i className="size-2 shrink-0 rounded-full" style={{ background: a.color }} />
                  {a.name}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <i className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.round((a.share / top) * 100))}%`, background: a.color }} />
                </span>
                <span className="text-right font-mono text-[11px] text-muted-foreground">{pct(a.share)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className={card}>
          <h3 className={h3}>Signature notes</h3>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {p.favorite_notes.map((n) => (
              <a key={n.slug} href={`#/note/${encodeURIComponent(n.slug)}`} className="group flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-shadow hover:shadow-md" style={{ borderTopColor: n.color, borderTopWidth: 2 }}>
                <NoteImg n={n} className="size-14 rounded-full transition-transform duration-200 group-hover:scale-105" />
                <b className="line-clamp-1 text-[13px] font-semibold">{n.name}</b>
                <small className="text-[11px] text-muted-foreground">
                  in <span className="font-mono">{n.perfumes}</span> of <span className="font-mono">{p.count}</span>
                </small>
              </a>
            ))}
          </div>
          <NoteBarList notes={p.notes.slice(3, 12)} count={p.count} />
        </section>
      </div>

      {(p.common_notes?.length ?? 0) > 0 && (
        <section className={card}>
          <h3 className={h3}>In most of your bottles</h3>
          <div className="flex flex-wrap gap-1.5">
            {p.common_notes.map((n) => (
              <a key={n.slug} href={`#/note/${encodeURIComponent(n.slug)}`} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pr-2.5 pl-0.5 text-[13px] hover:bg-muted">
                <NoteImg n={n} className="size-6 rounded-full" />
                {n.name}
                <small className="font-mono text-[11px] text-muted-foreground">{pct(n.share)}</small>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {p.houses.length > 0 && (
          <Tile
            label="Houses"
            value={p.houses.slice(0, 2).map((x) => `${x.label} ${pct(x.share)}`).join(' · ')}
            sub={p.houses.slice(2).map((x) => `${x.label} ${pct(x.share)}`).join(' · ') || null}
          />
        )}
        {p.brands.length > 0 && <Tile label="Most collected house" value={p.brands[0].name} sub={p.brands[0].count > 1 ? plural(p.brands[0].count, 'bottle') : null} />}
        {p.perfumers.length > 0 && <Tile label="Favourite perfumer" value={p.perfumers[0].name} sub={plural(p.perfumers[0].count, 'creation')} />}
        {p.era && (
          <Tile
            label="Era"
            mono
            value={p.era.median_year}
            sub={
              <>
                median release · <span className="font-mono">{p.era.oldest}–{p.era.newest}</span>
              </>
            }
          />
        )}
        {p.community_rating ? (
          <Tile
            label="Community rating"
            mono
            value={
              <span className="inline-flex items-center gap-1">
                <Star className="size-4 fill-gold text-gold" />
                {p.community_rating.toFixed(2)}
              </span>
            }
            sub="average of your shelf"
          />
        ) : null}
      </section>

      {p.gaps.length > 0 && (
        <section className={card}>
          <h3 className={h3}>Room to grow</h3>
          <ul className="flex flex-col divide-y">
            {p.gaps.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <b className="w-28 text-sm font-semibold">{g.label}</b>
                <span className="min-w-48 flex-1 text-sm text-muted-foreground">{g.hint}</span>
                <Button size="sm" variant="outline" asChild>
                  <a href={gapLink(g.key)}>Explore</a>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.notes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => go('/combine', { include: p.favorite_notes.map((n) => n.slug).join(','), mode: 'all' })}>
            <Search />
            Perfumes with my signature notes
          </Button>
          <Button variant="outline" onClick={onLayering}>
            <Layers />
            Layering ideas from my shelf
          </Button>
        </div>
      )}
    </div>
  )
}
