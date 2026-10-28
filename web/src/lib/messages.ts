// Unread messages for the header: like notifications, the count is polled (every minute while the tab is visible,
// and whenever it regains focus). The messages page calls setMessagesUnread() when it already knows the answer.
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import { session, useSession } from './store'

const POLL_MS = 60_000

let unread = 0
const ls = new Set<() => void>()
const subscribe = (fn: () => void) => {
  ls.add(fn)
  return () => ls.delete(fn)
}

export function setMessagesUnread(n: number) {
  if (n === unread) return
  unread = n
  ls.forEach((fn) => fn())
}

export async function refreshMessagesUnread() {
  if (!session.user) return setMessagesUnread(0)
  try {
    setMessagesUnread((await api.get<{ unread: number }>('/api/messages/unread')).unread)
  } catch {
    /* offline: keep the old count */
  }
}

/** Unread message count; starts the polling loop for the signed-in user (mount once, in the header). */
export function useMessagesUnread() {
  const { user } = useSession()
  useEffect(() => {
    setMessagesUnread(0)
    if (!user) return
    refreshMessagesUnread()
    const tick = () => document.visibilityState === 'visible' && refreshMessagesUnread()
    const t = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [user?.id])
  return useSyncExternalStore(subscribe, () => unread)
}
