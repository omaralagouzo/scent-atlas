// A member's bottles for sale (the "For sale" tab on a profile).
import { useEffect, useState } from 'react'
import { Store } from 'lucide-react'
import { api } from '@/lib/api'
import type { Listing } from '@/lib/market'
import { Button } from '@/components/ui/button'
import { ListingCard, ListingGrid, ListingSkeletons } from './listing-card'

export function useSellerListings(username: string, enabled = true) {
  const [items, setItems] = useState<Listing[] | null>(null)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let live = true
    setItems(null)
    setFailed(false)
    api.get<{ listings: Listing[]; total: number }>('/api/market/listings', { seller: username, limit: 60 }).then(
      (r) => {
        if (!live) return
        setItems(r.listings)
        setTotal(r.total)
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [username, enabled])
  return { items, total, failed }
}

export function SellerListings({ data, self, who }: { data: ReturnType<typeof useSellerListings>; self: boolean; who: string }) {
  if (data.failed) return <p className="text-sm text-muted-foreground">Could not load the listings. Try again in a moment.</p>
  if (!data.items) return <ListingSkeletons n={4} />
  if (!data.items.length)
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{self ? 'You have nothing for sale right now.' : `${who} has nothing for sale right now.`}</p>
        {self && (
          <Button size="sm" variant="outline" asChild>
            <a href="#/market/new">
              <Store />
              Sell a bottle
            </a>
          </Button>
        )}
      </div>
    )
  return (
    <ListingGrid>
      {data.items.map((l) => (
        <ListingCard key={l.id} l={l} />
      ))}
    </ListingGrid>
  )
}
