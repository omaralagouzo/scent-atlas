// "On the marketplace" on a perfume's page: how many are for sale and from what price, sell yours, post a request.
// The summary needs no account; the marketplace itself does.
import { useEffect, useState } from 'react'
import { ArrowRight, BellRing, Store, Tag as TagIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { href } from '@/lib/router'
import { formatPrice } from '@/lib/market'
import { requireAuth } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { WantedDialog, type WantedPerfume } from './wanted-dialog'

interface Summary {
  active: number
  from: { currency: string; price: number }[]
  wanted: number
}

export function MarketStrip({ p }: { p: WantedPerfume }) {
  const [s, setS] = useState<Summary | null>(null)
  const [wantOpen, setWantOpen] = useState(false)
  useEffect(() => {
    let live = true
    api.get<Summary>('/api/market/summary', { perfume_id: p.id }).then((r) => live && setS(r), () => {})
    return () => {
      live = false
    }
  }, [p.id])
  if (!s) return null
  const low = s.from[0]
  const lookFor = async () => {
    if (await requireAuth('Sign in to post a request on the marketplace.')) setWantOpen(true)
  }
  return (
    <section aria-label="On the marketplace" className="flex flex-col gap-3 rounded-xl border bg-card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Store className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">On the marketplace</h2>
        {s.wanted > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            <b className="font-mono font-medium text-foreground">{s.wanted}</b> {s.wanted === 1 ? 'person wants' : 'people want'} this
          </span>
        )}
      </div>
      {s.active > 0 ? (
        <a href={href('/market', { perfume: p.id })} className="group flex items-baseline gap-1.5 text-[15px] hover:text-foreground">
          <span>
            <b className="font-mono font-semibold">{s.active}</b> for sale
            {low && (
              <>
                {' '}
                from <b className="font-mono font-semibold">{formatPrice(low.price, low.currency)}</b>
                {s.from.length > 1 && <span className="text-xs text-muted-foreground"> (+{s.from.length - 1} more currencies)</span>}
              </>
            )}
          </span>
          <ArrowRight className="size-3.5 self-center text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">No bottles for sale right now.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <a href={href('/market/new', { perfume: p.id })}>
            <TagIcon />
            Sell yours
          </a>
        </Button>
        <Button size="sm" variant="ghost" onClick={lookFor}>
          <BellRing />
          Looking for one?
        </Button>
      </div>
      <WantedDialog open={wantOpen} onOpenChange={setWantOpen} perfume={p} onPosted={() => setS((x) => x && { ...x, wanted: x.wanted + 1 })} />
    </section>
  )
}
