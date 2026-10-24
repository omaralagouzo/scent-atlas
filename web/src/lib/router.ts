// Hash router with the same URL scheme as the original site: #/path?query, where `p` opens the perfume drawer
// on top of any view. A view mounts once per "view key" (path + query without `p`); views write their own state
// back with sync() without re-mounting, and the Back button re-mounts them from the URL.
import { useSyncExternalStore } from 'react'

export interface Loc {
  path: string
  params: URLSearchParams
  /** increments whenever the view must re-mount from the URL */
  mount: number
  /** perfume shown in the drawer, if any */
  drawer: string | null
}

export function parseHash(): { path: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '') || '/notes'
  const i = raw.indexOf('?')
  const path = i < 0 ? raw : raw.slice(0, i)
  return { path, params: new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)) }
}

export function buildHash(path: string, params: URLSearchParams | Record<string, any>) {
  const p = params instanceof URLSearchParams ? params : toParams(params)
  const parts: string[] = []
  for (const [k, v] of p.entries()) {
    if (v === '' || v == null) continue
    parts.push(
      `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/gi, ',').replace(/%40/g, '@').replace(/%3A/gi, ':')}`,
    )
  }
  return `#${path}${parts.length ? '?' + parts.join('&') : ''}`
}

const toParams = (obj: Record<string, any>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(obj || {})) if (v !== '' && v != null && v !== false) p.set(k, String(v))
  return p
}

const viewKey = (path: string, params: URLSearchParams) => {
  const p = new URLSearchParams(params)
  p.delete('p')
  return path + '?' + p.toString()
}

let currentKey: string | null = null
let drawerPushed = false
let snapshot: Loc = read(true)
const listeners = new Set<() => void>()

function read(first = false): Loc {
  const { path, params } = parseHash()
  const key = viewKey(path, params)
  let mount = first ? 0 : snapshot.mount
  if (key !== currentKey) {
    currentKey = key
    mount++
  }
  const drawer = params.get('p')
  if (!drawer) drawerPushed = false
  return { path, params, mount, drawer }
}

function update() {
  const prev = snapshot
  snapshot = read()
  if (prev.path !== snapshot.path) window.scrollTo(0, 0)
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') window.addEventListener('hashchange', update)

export function useLocation(): Loc {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => snapshot,
  )
}

export function go(path: string, params: Record<string, any> = {}) {
  location.hash = buildHash(path, toParams(params))
}

export const href = (path: string, params: Record<string, any> = {}) => buildHash(path, toParams(params))

/** Write view state to the URL without re-mounting. push: add a history entry when the URL really changes. */
export function sync(path: string, paramsObj: Record<string, any>, { push = false } = {}) {
  const p = toParams(paramsObj)
  currentKey = viewKey(path, p)
  const open = parseHash().params.get('p')
  if (open) p.set('p', open)
  const hash = buildHash(path, p)
  const same = (a: string, b: string) => {
    try {
      return decodeURIComponent(a) === decodeURIComponent(b)
    } catch {
      return a === b
    }
  }
  if (push && !same(hash, location.hash)) history.pushState(null, '', hash)
  else history.replaceState(null, '', hash)
  const { params } = parseHash()
  snapshot = { ...snapshot, path, params }
  listeners.forEach((fn) => fn())
}

export function openPerfume(id: number | string) {
  const { path, params } = parseHash()
  params.set('p', String(id))
  drawerPushed = true
  location.hash = buildHash(path, params)
}

export function closeDrawer() {
  const { path, params } = parseHash()
  if (!params.has('p')) return
  if (drawerPushed) {
    drawerPushed = false
    history.back()
  } else {
    params.delete('p')
    history.replaceState(null, '', buildHash(path, params))
    update()
  }
}

/** Match `pattern` (e.g. "/layering/:id/:other") against a path; returns the named args or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const names: string[] = []
  const rx = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, n) => (names.push(n), '([^/]+)')) + '/?$')
  const m = rx.exec(path)
  if (!m) return null
  const args: Record<string, string> = {}
  names.forEach((n, i) => (args[n] = decodeURIComponent(m[i + 1])))
  return args
}
