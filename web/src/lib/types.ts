// Shapes returned by the FastAPI backend (only the fields the UI reads).
export interface Accord {
  name: string
  strength: number
  color: string
}

export interface Note {
  slug: string
  name: string
  image?: string
  color?: string
  family?: string
  count?: number
  variants?: boolean
}

export type Layer = 'top' | 'middle' | 'base' | 'general'
export type Pyramid = Partial<Record<Layer, Note[]>>

export interface DupeLink {
  relation: 'dupe' | 'original'
  basis_label: string
  confidence: string
}

export interface Perfume {
  id: number
  name: string
  brand: string
  year?: number | null
  image: string
  rating?: number | null
  rating_count?: number | null
  accords: Accord[]
  brand_tags?: string[]
  brand_tags_inferred?: boolean
  is_dupe?: boolean
  n_dupes?: number
  matched_names?: string[]
  dupe_link?: DupeLink | null
  [k: string]: any
}

/** A member's #1 ranked bottle, shown on their photo (sent only for yourself and your friends). */
export interface TopBottle {
  id: number
  name: string
  brand: string
  image?: string | null
}

export interface User {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  /** display name: first + last name (the username when neither is set) */
  name: string
  /** profile photo URL, or null */
  avatar: string | null
  /** true while the account still has the placeholder name "User Name" */
  needs_name: boolean
  created_at?: number
  top?: TopBottle | null
}

export type Status = 'owned' | 'tried' | 'wishlist'
export interface MyStatus {
  status: Status | null
  rating: number | null
  has_note?: boolean
}
