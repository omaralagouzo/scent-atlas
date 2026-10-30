// The /api/admin contract, typed, plus small helpers shared by the admin screens.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type Params } from '@/lib/api'

export interface Me {
  authenticated: boolean
  two_factor: boolean
}

export interface Totals {
  visitors_today: number
  visitors_7d: number
  visitors_30d: number
  views_today: number
  views_7d: number
  views_30d: number
  active_now: number
  signed_in_30d: number
  accounts_total: number
  accounts_new_7d: number
  accounts_new_30d: number
}

export interface Day {
  day: string
  visitors: number
  views: number
  signups: number
}

export interface Analytics {
  now: number
  days: number
  tz: string
  totals: Totals
  daily: Day[]
  sections: { key: string; label: string; views: number; visitors: number }[]
  top_perfumes: { id: number; name: string; brand: string; image: string; views: number; visitors: number }[]
  top_notes: { slug: string; name: string; views: number; visitors: number }[]
  top_pages: { path: string; label: string; views: number; visitors: number }[]
  referrers: { host: string | null; visitors: number }[]
  devices: { name: string; visitors: number }[]
  browsers: { name: string; visitors: number }[]
  locations: { tz: string; place: string; visitors: number }[]
}

export interface MiniUser {
  id: number
  username: string
  name: string
  avatar: string | null
}

export interface Hit {
  id: number
  ts: number
  path: string
  label: string
  visitor: string
  device: string
  browser: string
  place: string | null
  user: MiniUser | null
}

export interface ActivityPage {
  items: Hit[]
  next_before: number | null
}

export interface Account extends MiniUser {
  email: string
  first_name?: string
  last_name?: string
  created_at: number
  last_login_at: number | null
  last_seen_at: number | null
  views_30d: number
  owned: number
  friends: number
  reviews: number
  sessions: number
}

const BASE = '/api/admin'

// A 401 anywhere means the admin cookie expired: the app listens and drops back to the sign-in screen.
const signedOut = new Set<() => void>()
export const onSignedOut = (fn: () => void) => {
  signedOut.add(fn)
  return () => void signedOut.delete(fn)
}
async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) signedOut.forEach((fn) => fn())
    throw e
  }
}

export const admin = {
  me: () => api.get<Me>(`${BASE}/me`),
  login: (password: string, code?: string) => api.post<{ ok: true }>(`${BASE}/login`, code ? { password, code } : { password }),
  logout: () => api.post<{ ok: true }>(`${BASE}/logout`),
  get: <T>(path: string, params?: Params, signal?: AbortSignal) => guard(api.get<T>(BASE + path, params, signal)),
  post: <T>(path: string, body?: unknown) => guard(api.post<T>(BASE + path, body)),
  patch: <T>(path: string, body?: unknown) => guard(api.patch<T>(BASE + path, body)),
  del: <T>(path: string) => guard(api.del<T>(BASE + path)),
}

export const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Load a GET endpoint; keeps the previous data while a new request is in flight (so screens never flash). */
export function useLoad<T>(path: string | null, params?: Params) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const pjson = JSON.stringify(params || {})
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    const ctl = new AbortController()
    setLoading(true)
    admin
      .get<T>(path, JSON.parse(pjson) as Params, ctl.signal)
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(e)
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false)
      })
    return () => ctl.abort()
  }, [path, pjson, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** `v`, once it has stopped changing for `ms`. */
export function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v)
  useEffect(() => {
    const id = window.setTimeout(() => setD(v), ms)
    return () => window.clearTimeout(id)
  }, [v, ms])
  return d
}

/** Run `fn` every `ms` while the tab is visible (and once right away when it becomes visible again). */
export function useVisibleInterval(fn: () => void, ms: number) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    let id: number | undefined
    const start = () => {
      stop()
      if (document.visibilityState === 'visible') id = window.setInterval(() => ref.current(), ms)
    }
    const stop = () => {
      if (id !== undefined) window.clearInterval(id)
      id = undefined
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') ref.current()
      start()
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ms])
}

// ---- formatting ------------------------------------------------------------------------------------------------

export const num = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString())

/** Axis-style compact numbers: 950, 1.2K, 12K. */
export const compactNum = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(n)
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "14:32" today, "Yesterday 14:32", "Oct 3, 14:32" this year, else "Oct 3, 2025". */
export function when(ts: number | null | undefined) {
  if (!ts) return '–'
  const d = new Date(ts * 1000)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, now)) return time
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return `Yesterday ${time}`
  if (d.getFullYear() === now.getFullYear()) return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A calendar date only: "Oct 3" this year, "Oct 3, 2025" before. */
export function dateOnly(ts: number | null | undefined) {
  if (!ts) return '–'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The server sends phone / tablet / desktop / unknown. */
export const deviceName = (d: string | null | undefined) => {
  if (!d || d === 'unknown') return 'Unknown'
  return d[0].toUpperCase() + d.slice(1)
}

export const fullTime = (ts: number) => new Date(ts * 1000).toLocaleString()

export function ago(ts: number | null | undefined) {
  if (!ts) return 'never'
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 45) return `${d} d ago`
  return dateOnly(ts)
}

/** Parse "YYYY-MM-DD" as a local calendar date (not UTC midnight). */
export const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
// ---- new releases (discovery) ------------------------------------------------------------------------------------

export type DiscState = 'incomplete' | 'complete' | 'duplicate' | 'approved' | 'published' | 'rejected'
export type DiscCounts = Record<DiscState, number>
export type ConfKey = 'identity' | 'release_date' | 'notes' | 'perfumers' | 'image' | 'gender' | 'concentration'
export type DiscKind = 'discover' | 'complete' | 'full'
export type DiscModel = 'sonnet' | 'haiku'

export interface DiscNotes {
  top: string[]
  middle: string[]
  base: string[]
  general: string[]
}

export interface DiscSource {
  url: string
  title: string
  kind: 'official' | 'retailer' | 'news' | 'aggregator' | 'social'
  supports: string[]
}

export interface DiscItem {
  id: number
  state: DiscState
  brand: string
  name: string
  concentration: string | null
  gender: 'women' | 'men' | 'unisex' | null
  release_date: string | null
  release_status: 'released' | 'announced' | null
  perfumers: string[]
  notes: Partial<DiscNotes>
  note_count: number
  family: string | null
  description: string | null
  /** admin image URL, usable in <img> */
  image: string | null
  /** the source URL the image came from */
  image_url: string | null
  official_url: string | null
  sources: DiscSource[]
  confidence: Partial<Record<ConfKey, number>>
  overall: number
  missing: string[]
  duplicate_of: { id: number; name?: string; brand?: string; year?: number | null; gender?: string | null; image?: string } | null
  perfume_id: number | null
  review_note: string | null
  comment: string | null
  origin: string | null
  attempts: number
  created_at: number
  updated_at: number
  reviewed_at: number | null
  published_at: number | null
  /** published only: already in the running catalogue (false: live after the next restart) */
  live?: boolean
}

export interface DiscItemsPage {
  items: DiscItem[]
  total: number
  counts: DiscCounts
}

export interface DiscConfig {
  engine_ready: boolean
  running: number | null
  deploy_hook: boolean
  pending_restart: number
  /** how approvals reach the site: a Render deploy, the app restarting itself, or a manual restart; due_at = when */
  live: { mode: 'deploy_hook' | 'self_restart' | 'manual'; due_at: number | null }
  counts: DiscCounts
  segments: { key: string; title: string }[]
  models: { sonnet: string; haiku: string }
  default_budget_usd: number
}

export interface DiscSegmentStat {
  key: string
  status: string
  requests: number
  submitted: number
  new: number
  updated: number
  cost_usd: number
}

export interface DiscRun {
  id: number
  kind: DiscKind | 'import'
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  model: string
  params: { since?: string; segments?: string[]; budget_usd?: number; max_items?: number; model?: string; complete_model?: string }
  stats: {
    cost_usd?: number
    requests?: number
    searches?: number
    input_tokens?: number
    output_tokens?: number
    new?: number
    updated?: number
    skipped?: number
    segments?: Record<string, DiscSegmentStat>
  }
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  /** only on GET /discovery/runs/{id} */
  log?: string[]
}

export interface DiscRunsPage {
  runs: DiscRun[]
  running: number | null
}
