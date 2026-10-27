// The signed-in user's private "My Atlas" data (taste profile, saved searches, history), shown on their own profile.
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { cacheNotes } from '@/lib/store'
import type { Note, Perfume, Status } from '@/lib/types'
import type { HistoryItem } from './history-list'
import type { SavedSearch } from './saved-searches'
import type { TasteProfileData } from './taste-profile'

export type MyPerfume = Perfume & { my?: { status: Status | null; rating: number | null; note: string | null } }
export interface AtlasData {
  user: { username: string; created_at?: number }
  favorites: { perfumes: Perfume[]; notes: Note[] }
  collection: Record<Status, MyPerfume[]>
  rated_only: MyPerfume[]
  saved: SavedSearch[]
  history: HistoryItem[]
  profile: TasteProfileData
}

/** Loads GET /api/me/atlas while `enabled` (e.g. only on my own profile). */
export function useAtlas(enabled: boolean) {
  const [data, setData] = useState<AtlasData | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setData(null)
    setFailed(false)
    if (!enabled) return
    let dead = false
    api.get<AtlasData>('/api/me/atlas').then(
      (r) => {
        if (dead) return
        cacheNotes([...r.favorites.notes, ...r.profile.notes])
        setData(r)
      },
      () => !dead && setFailed(true),
    )
    return () => {
      dead = true
    }
  }, [enabled])
  return { data, failed, setData }
}
