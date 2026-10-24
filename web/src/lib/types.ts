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

export interface User {
  id: number
  username: string
  email: string
}

export type Status = 'owned' | 'tried' | 'wishlist'
export interface MyStatus {
  status: Status | null
  rating: number | null
  has_note?: boolean
}
