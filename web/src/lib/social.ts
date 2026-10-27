// Friends: relation states, requests and the incoming-request count shown in the header.
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import { session, useSession } from './store'

export type Relation = 'self' | 'friends' | 'outgoing' | 'incoming' | 'none'
export interface Person {
  id?: number
  username: string
  /** display name (first + last) */
  name?: string
  first_name?: string
  last_name?: string
  /** profile photo URL, or null */
  avatar?: string | null
  since?: number
  created_at?: number
  relation?: Relation
  /** bottles on their shelf (directory listings) */
  owned?: number
}
export interface FriendLists {
  friends: Person[]
  incoming: Person[]
  outgoing: Person[]
}

let lists: FriendLists | null = null
const ls = new Set<() => void>()
const emit = () => ls.forEach((fn) => fn())

export async function refreshFriends() {
  if (!session.user) {
    lists = null
    emit()
    return null
  }
  try {
    lists = await api.get<FriendLists>('/api/friends')
  } catch {
    /* keep the old lists */
  }
  emit()
  return lists
}

/** The signed-in user's friend lists (loaded once per session, refreshed after every change). */
export function useFriends() {
  const { user } = useSession()
  useEffect(() => {
    refreshFriends()
  }, [user?.id])
  return useSyncExternalStore(
    (fn) => {
      ls.add(fn)
      return () => ls.delete(fn)
    },
    () => lists,
  )
}

export async function addFriend(username: string): Promise<Relation> {
  const r = await api.post<{ relation: Relation }>(`/api/friends/${encodeURIComponent(username)}`, {})
  refreshFriends()
  return r.relation
}

export async function removeFriend(username: string): Promise<Relation> {
  const r = await api.del<{ relation: Relation }>(`/api/friends/${encodeURIComponent(username)}`)
  refreshFriends()
  return r.relation
}

export const profileHref = (username: string) => `#/u/${encodeURIComponent(username)}`
