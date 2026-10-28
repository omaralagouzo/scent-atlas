// Marketplace shapes and helpers (see app/market_api.py for the API).
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Accord, TopBottle } from './types'

export interface MarketPerson {
  username: string
  name: string
  first_name?: string
  last_name?: string
  avatar: string | null
  top?: TopBottle | null
}

export type ListingStatus = 'pending' | 'active' | 'rejected' | 'sold' | 'withdrawn'

export interface Listing {
  id: number
  status: ListingStatus
  title: string
  brand: string
  perfume: { id: number; name: string; brand: string; year?: number | null; gender?: string; image: string; accords: Accord[]; rating?: number | null } | null
  custom: boolean
  image: string | null
  photos: string[]
  ml_total: number
  ml_left: number
  price: number
  currency: string
  price_per_ml: number
  box: boolean
  tester: boolean
  description: string | null
  area: string | null
  city: string | null
  country: string | null
  /** position rounded to ~1 km (the exact pickup point is only sent to the seller, as `pickup`) */
  approx: { lat: number; lng: number }
  distance_km?: number
  seller: MarketPerson | null
  mine: boolean
  created_at: number
  updated_at: number
  pickup?: Place
  review_note?: string | null
  /** listing detail only */
  conversation_id?: number | null
  conversations?: number
}

export interface Wanted {
  id: number
  status: 'active' | 'closed'
  created_at: number
  perfume: { id: number; name: string; brand: string; image: string; accords: Accord[] } | null
  max_price: number | null
  currency: string | null
  min_ml: number | null
  radius_km: number | null
  area: string | null
  note: string | null
  matches: number
}

export interface ConversationSummary {
  id: number
  role: 'buyer' | 'seller'
  listing: { id: number; title: string; brand: string; image: string | null; status: ListingStatus } | null
  other: MarketPerson | null
  last_at: number
  unread: number
  last: { body: string; mine: boolean; created_at: number } | null
}

export interface Message {
  id: number
  body: string
  mine: boolean
  created_at: number
}

/** A chosen location: what the address search returned, plus the pinned position. */
export interface Place {
  formatted: string | null
  lat: number
  lng: number
  building?: string | null
  street?: string | null
  area?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  postal_code?: string | null
  place_id?: string | null
}

export interface Address extends Place {
  recipient: string | null
  phone: string
  unit: string | null
  floor: string | null
  instructions: string | null
  updated_at?: number
}

export interface MarketConfig {
  currencies: string[]
  sizes: number[]
  max_photos: number
  google_maps_key: string | null
  address_search: 'google' | 'osm'
}

let config: Promise<MarketConfig> | null = null
export function marketConfig() {
  config ??= api.get<MarketConfig>('/api/market/config').catch((e) => {
    config = null
    throw e
  })
  return config
}

export function useMarketConfig() {
  const [c, setC] = useState<MarketConfig | null>(null)
  useEffect(() => {
    marketConfig().then(setC, () => {})
  }, [])
  return c
}

export const listingHref = (id: number) => `#/market/${id}`
export const threadHref = (id: number) => `#/messages/${id}`

export function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: price % 1 ? 2 : 0 }).format(price)
  } catch {
    return `${price} ${currency}`
  }
}

export function formatKm(km?: number) {
  if (km == null) return null
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`
}

/** The browser's position, for "near me" (resolves null when refused or unavailable). */
export function myPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  })
}
