// Client-side stores for the signed-in user: session, favourites (hearts), personal status (owned / tried /
// wishlist + rating) and fire-and-forget history. Components subscribe through the hooks at the bottom.
import { useSyncExternalStore } from 'react'
import { api } from './api'
import type { MyStatus, Note, Status, User } from './types'

type Fn = () => void
function createStore() {
  const ls = new Set<Fn>()
  let version = 0
  return {
    subscribe(fn: Fn) {
      ls.add(fn)
      return () => {
        ls.delete(fn)
      }
    },
    emit() {
      version++
      ls.forEach((fn) => fn())
    },
    version: () => version,
  }
}

const store = createStore()

// ---- auth dialog requests (rendered by <AuthDialog/>)
export interface AuthRequest {
  mode: 'login' | 'signup'
  reason?: string
  resolve: (ok: boolean) => void
}
let authRequest: AuthRequest | null = null
export const authDialog = {
  get: () => authRequest,
  open({ mode = 'login', reason = '' }: { mode?: 'login' | 'signup'; reason?: string } = {}) {
    if (authRequest) authRequest.resolve(false)
    return new Promise<boolean>((resolve) => {
      authRequest = { mode, reason, resolve }
      store.emit()
    })
  },
  close(ok: boolean) {
    const r = authRequest
    authRequest = null
    store.emit()
    r?.resolve(ok && !!session.user)
  },
}

/** Resolves true when the visitor ends up signed in, false if they dismiss the dialog. */
export function requireAuth(reason?: string) {
  if (session.user) return Promise.resolve(true)
  return authDialog.open({ mode: 'login', reason })
}

// ---- session
export const session = {
  user: null as User | null,
  loaded: false,
  async load() {
    try {
      this.apply(await api.get('/api/me'))
    } catch {
      this.apply({ user: null, favorites: { perfumes: [], notes: [] }, statuses: {} })
    }
  },
  apply(r: any) {
    this.user = r.user || null
    this.loaded = true
    favs.perfumes = new Set((r.favorites?.perfumes || []).map(String))
    favs.notes = new Set(r.favorites?.notes || [])
    mine.map = new Map(Object.entries(r.statuses || {}))
    store.emit()
  },
  refresh() {
    return this.load()
  },
}

// ---- favourites
export const favs = {
  perfumes: new Set<string>(),
  notes: new Set<string>(),
  has(type: 'perfume' | 'note', id: string | number) {
    return (type === 'perfume' ? this.perfumes : this.notes).has(String(id))
  },
  async toggle(type: 'perfume' | 'note', id: string | number) {
    if (!session.user && !(await requireAuth('Sign in to save favorites.'))) return null
    const set = type === 'perfume' ? this.perfumes : this.notes
    const key = String(id)
    const liked = !set.has(key)
    liked ? set.add(key) : set.delete(key)
    store.emit()
    try {
      await api.post('/api/favorites', { type, id: type === 'perfume' ? Number(id) : key, liked })
    } catch (e: any) {
      liked ? set.delete(key) : set.add(key)
      store.emit()
      if (e.status === 401) session.refresh()
    }
    return liked
  },
}

// ---- personal status
export const STATUS_LABEL: Record<Status, string> = { owned: 'Owned', tried: 'Tried', wishlist: 'Wishlist' }
export const mine = {
  map: new Map<string, MyStatus>(),
  get(pid: number | string) {
    return this.map.get(String(pid)) || null
  },
  status(pid: number | string) {
    return this.get(pid)?.status || null
  },
  async save(pid: number | string, fields: Partial<{ status: Status | null; rating: number | null; note: string | null }>) {
    if (!session.user && !(await requireAuth('Sign in to track perfumes you own, tried or want.'))) return null
    const r = await api.put(`/api/me/perfumes/${pid}`, fields)
    if (r.status || r.rating || r.note) this.map.set(String(pid), { status: r.status, rating: r.rating, has_note: !!r.note })
    else this.map.delete(String(pid))
    store.emit()
    return r as { status: Status | null; rating: number | null; note: string | null }
  },
  /** after an endpoint changed statuses server-side (e.g. adding to the collection) */
  set(pid: number | string, s: MyStatus | null) {
    if (s) this.map.set(String(pid), s)
    else this.map.delete(String(pid))
    store.emit()
  },
}

export const history = {
  record(body: Record<string, unknown>) {
    if (!session.user) return
    api.post('/api/me/history', body).catch(() => {})
  },
}

// ---- note cache (slug -> note) so chips can be rebuilt from URLs
const noteCache = new Map<string, Note>()
export function cacheNotes(list?: Note[] | null) {
  for (const n of list || []) if (n && n.slug) noteCache.set(n.slug, { ...noteCache.get(n.slug), ...n })
}
export async function resolveSlugs(slugs: string[]): Promise<Note[]> {
  const missing = slugs.filter((s) => !noteCache.has(s))
  if (missing.length) {
    try {
      const r = await api.post('/api/notes/resolve', { names: missing.map((s) => s.replace(/-/g, ' ')) })
      r.matches.forEach((m: any, i: number) => {
        if (m.slug) noteCache.set(missing[i], { slug: m.slug, name: m.name, image: m.image || `/img/note/${m.slug}` })
      })
    } catch {
      /* offline: fall through */
    }
  }
  return slugs.map((s) => noteCache.get(s)).filter(Boolean) as Note[]
}

// ---- hooks
const useStore = () => useSyncExternalStore(store.subscribe, store.version)

export function useSession() {
  useStore()
  return { user: session.user, loaded: session.loaded }
}
export function useFav(type: 'perfume' | 'note', id: string | number) {
  useStore()
  return favs.has(type, id)
}
export function useMine(pid: number | string) {
  useStore()
  return mine.get(pid)
}
export function useAuthRequest() {
  useStore()
  return authDialog.get()
}
