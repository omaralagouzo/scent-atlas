// Notifications: the unread count is polled (every minute while the tab is visible, and whenever it regains focus);
// the list itself loads when the bell is opened. Light enough for a few thousand members with no extra services.
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import { refreshFriends } from './social'
import { session, useSession } from './store'
import type { TopBottle } from './types'

export interface Notification {
  id: number
  kind: 'friend_request' | 'friend_accept' | 'name_reminder' | string
  ref: string | null
  created_at: number
  read: boolean
  actor: { username: string; name: string; avatar: string | null; top?: TopBottle | null } | null
}

const POLL_MS = 60_000

let unread = 0
let items: Notification[] | null = null
const ls = new Set<() => void>()
const emit = () => ls.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  ls.add(fn)
  return () => ls.delete(fn)
}

function setUnread(n: number) {
  if (n === unread) return
  // something new arrived (e.g. a friend request): the header's friend badge reads the friend lists
  if (n > unread) refreshFriends()
  unread = n
  emit()
}

export async function refreshUnread() {
  if (!session.user) return setUnread(0)
  try {
    setUnread((await api.get<{ unread: number }>('/api/notifications/unread')).unread)
  } catch {
    /* offline: keep the old count */
  }
}

export async function loadNotifications() {
  if (!session.user) return
  try {
    const r = await api.get<{ items: Notification[]; unread: number }>('/api/notifications')
    items = r.items
    setUnread(r.unread)
    emit()
  } catch {
    /* keep what we have */
  }
}

export async function markAllRead() {
  if (!unread) return
  try {
    setUnread((await api.post<{ unread: number }>('/api/notifications/read', {})).unread)
  } catch {
    /* try again next time */
  }
}

/** Drop a notification from the open list (e.g. a friend request answered right there). */
export function dismiss(id: number) {
  if (!items) return
  items = items.filter((n) => n.id !== id)
  emit()
}

/** Unread count + the last loaded list; starts the polling loop for the signed-in user. */
export function useNotifications() {
  const { user } = useSession()
  useEffect(() => {
    items = null
    unread = 0
    emit()
    if (!user) return
    refreshUnread()
    const tick = () => document.visibilityState === 'visible' && refreshUnread()
    const t = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [user?.id])
  useEffect(() => {
    // setting a real name withdraws the "add your name" reminder on the server
    if (user && !user.needs_name) refreshUnread()
  }, [user?.needs_name])
  const u = useSyncExternalStore(subscribe, () => unread)
  const list = useSyncExternalStore(subscribe, () => items)
  return { unread: u, items: list }
}
