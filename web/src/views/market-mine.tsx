// My listings (grouped by status, with quick actions and the owner's review notes) and my wanted requests (with
// their match counts, "See matches" and "Close").
import { useEffect, useState } from 'react'
import { BellRing, Check, ChevronDown, Loader2, Lock, MapPin, Pencil, RotateCcw, Store, Tag as TagIcon, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api, errorText } from '@/lib/api'
import { perfumeHref } from '@/lib/router'
import { formatPrice, listingHref, type Listing, type ListingStatus, type Wanted } from '@/lib/market'
import { authDialog, useSession } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BottleThumb } from '@/components/media'
import { EmptyState, Page, PageHeader, SectionTitle } from '@/components/page'
import { ListingCard, ListingImage, MlGauge, placeText, PriceLine, StatusBadge } from '@/components/market/listing-card'
import { WantedDialog } from '@/components/market/wanted-dialog'

const GROUPS: { status: ListingStatus; title: string; hint?: string }[] = [
  { status: 'rejected', title: 'Needs your attention', hint: 'Not approved listings go back into review once you fix them. Removed listings were taken down by the moderators and stay down.' },
  { status: 'pending', title: 'Waiting for review', hint: 'Custom fragrances are checked before they go live.' },
  { status: 'active', title: 'For sale' },
  { status: 'sold', title: 'Sold' },
  { status: 'withdrawn', title: 'Withdrawn' },
]

export default function MarketMine(_: ViewProps) {
  const { user, loaded } = useSession()
  const [data, setData] = useState<{ listings: Listing[]; wanted: Wanted[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [wantOpen, setWantOpen] = useState(false)

  const load = () =>
    api.get<{ listings: Listing[]; wanted: Wanted[] }>('/api/market/mine').then(
      (r) => {
        setData(r)
        setFailed(false)
      },
      () => setFailed(true),
    )
  useEffect(() => {
    if (loaded && user) load()
  }, [loaded, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (l: Listing) => setData((d) => d && { ...d, listings: d.listings.map((x) => (x.id === l.id ? { ...x, ...l } : x)) })

  const header = (
    <PageHeader
      title="My listings"
      description="Everything you're selling and the bottles you're looking for."
      actions={
        <>
          <Button variant="outline" asChild>
            <a href="#/market">Marketplace</a>
          </Button>
          <Button asChild className="bg-brand text-brand-foreground hover:bg-brand/90">
            <a href="#/market/new">
              <TagIcon />
              Sell a bottle
            </a>
          </Button>
        </>
      }
    />
  )

  if (loaded && !user)
    return (
      <Page>
        {header}
        <EmptyState icon={<Lock className="size-5" />} title="Sign in to see your listings" action={<Button onClick={() => authDialog.open({ mode: 'login' })}>Sign in</Button>} />
      </Page>
    )
  if (failed)
    return (
      <Page>
        {header}
        <EmptyState title="Could not load your listings" action={<Button variant="outline" onClick={load}>Try again</Button>} />
      </Page>
    )
  if (!data)
    return (
      <Page>
        {header}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </Page>
    )

  return (
    <Page>
      {header}
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-10">
          {data.listings.length === 0 ? (
            <EmptyState
              icon={<Store className="size-5" />}
              title="You haven't put anything up yet"
              action={
                <Button asChild>
                  <a href="#/market/new">Sell a bottle</a>
                </Button>
              }
            >
              Sell the bottles you no longer wear. Say how much is left, set a price, and buyers message you.
            </EmptyState>
          ) : (
            GROUPS.map((g) => {
              const items = data.listings.filter((l) => l.status === g.status || (g.status === 'rejected' && l.status === 'removed'))
              if (!items.length) return null
              return (
                <section key={g.status} aria-label={g.title}>
                  <SectionTitle>
                    {g.title} <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">{items.length}</span>
                  </SectionTitle>
                  {g.hint && <p className="-mt-2 mb-3 text-[13px] text-muted-foreground">{g.hint}</p>}
                  <ul className="flex flex-col gap-3">
                    {items.map((l) => (
                      <MyListingRow key={l.id} l={l} onChange={replace} />
                    ))}
                  </ul>
                </section>
              )
            })
          )}
        </div>

        <section aria-label="My wanted requests">
          <SectionTitle
            action={
              <Button size="sm" variant="outline" onClick={() => setWantOpen(true)}>
                <BellRing />
                New request
              </Button>
            }
          >
            Looking for <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">{data.wanted.length}</span>
          </SectionTitle>
          {data.wanted.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Post a request for a fragrance you want and we'll notify you when a matching bottle goes up.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.wanted.map((w) => (
                <WantedRow key={w.id} w={w} onClosed={() => setData((d) => d && { ...d, wanted: d.wanted.filter((x) => x.id !== w.id) })} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <WantedDialog open={wantOpen} onOpenChange={setWantOpen} onPosted={() => load()} />
    </Page>
  )
}

function MyListingRow({ l, onChange }: { l: Listing; onChange: (l: Listing) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  async function setStatus(status: 'sold' | 'withdrawn' | 'active') {
    setBusy(status)
    try {
      const r = await api.patch<Listing>(`/api/market/listings/${l.id}`, { status })
      onChange(r)
      toast.success(status === 'sold' ? 'Marked as sold.' : status === 'withdrawn' ? 'Listing withdrawn.' : r.status === 'pending' ? 'Sent for review again.' : 'Back up for sale.')
    } catch (e) {
      toast.error(errorText(e))
    }
    setBusy(null)
  }
  const spin = (k: string, icon: React.ReactNode) => (busy === k ? <Loader2 className="animate-spin" /> : icon)
  const where = placeText(l)
  return (
    <li className={cn('flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:gap-4', l.status === 'sold' && 'opacity-75')}>
      <a href={listingHref(l.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <ListingImage l={l} className={cn('size-20 shrink-0 rounded-lg', l.status === 'sold' && 'grayscale-[0.7]')} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="truncate text-[15px] font-semibold tracking-[-0.015em]">{l.title}</b>
            <StatusBadge status={l.status} />
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {l.brand}
            {where && (
              <>
                {' · '}
                <MapPin className="inline size-3 align-[-1px]" /> {where}
              </>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <PriceLine l={l} />
            <MlGauge left={l.ml_left} total={l.ml_total} />
          </span>
          {l.status === 'removed' && <span className="mt-1 text-[13px] text-muted-foreground">The site owner took this listing down. It can't be edited or put back up.</span>}
          {(l.status === 'rejected' || l.status === 'removed') && l.review_note && (
            <span className="mt-1 rounded-md bg-destructive/8 px-2 py-1 text-[13px] text-destructive">
              <b className="font-medium">Owner's note:</b> {l.review_note}
            </span>
          )}
        </span>
      </a>
      {l.status !== 'removed' && (
        <div className="flex flex-wrap gap-1.5 sm:flex-col sm:items-stretch lg:flex-row lg:items-center">
          <Button size="sm" variant="outline" asChild>
            <a href={`#/market/${l.id}/edit`}>
              <Pencil />
              {l.status === 'rejected' ? 'Fix' : 'Edit'}
            </a>
          </Button>
          {l.status === 'active' && (
            <Button size="sm" variant="outline" onClick={() => setStatus('sold')} disabled={!!busy}>
              {spin('sold', <Check />)}
              Mark sold
            </Button>
          )}
          {(l.status === 'active' || l.status === 'pending' || l.status === 'rejected') && (
            <Button size="sm" variant="ghost" onClick={() => setStatus('withdrawn')} disabled={!!busy}>
              {spin('withdrawn', <Undo2 />)}
              Withdraw
            </Button>
          )}
          {(l.status === 'sold' || l.status === 'withdrawn') && (
            <Button size="sm" variant="outline" onClick={() => setStatus('active')} disabled={!!busy}>
              {spin('active', <RotateCcw />)}
              Relist
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function WantedRow({ w, onClosed }: { w: Wanted; onClosed: () => void }) {
  const [open, setOpen] = useState(false)
  const [matches, setMatches] = useState<Listing[] | null>(null)
  const [closing, setClosing] = useState(false)
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && !matches)
      api.get<{ listings: Listing[] }>(`/api/market/wanted/${w.id}/matches`).then(
        (r) => setMatches(r.listings),
        () => (setMatches([]), toast.error('Could not load the matches.')),
      )
  }
  const close = async () => {
    setClosing(true)
    try {
      await api.del(`/api/market/wanted/${w.id}`)
      toast.success('Request closed.')
      onClosed()
    } catch (e) {
      toast.error(errorText(e))
      setClosing(false)
    }
  }
  const criteria = [
    w.max_price != null && w.currency ? `up to ${formatPrice(w.max_price, w.currency)}` : null,
    w.min_ml ? `${w.min_ml}+ ml left` : null,
    w.area ? (w.radius_km ? `within ${w.radius_km} km of ${w.area}` : `around ${w.area}`) : null,
  ].filter(Boolean)
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {w.perfume && <BottleThumb p={w.perfume} size={56} />}
          <div className="flex min-w-0 flex-col gap-0.5">
            {w.perfume ? (
              <a href={perfumeHref(w.perfume.id)} className="truncate text-[15px] font-semibold tracking-[-0.015em] hover:underline">
                {w.perfume.name}
              </a>
            ) : (
              <b className="text-[15px] font-semibold">A fragrance</b>
            )}
            <span className="truncate text-[13px] text-muted-foreground">
              {w.perfume?.brand}
              {criteria.length > 0 && ` · ${criteria.join(' · ')}`}
            </span>
            {w.note && <span className="line-clamp-1 text-xs text-muted-foreground italic">“{w.note}”</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('mr-1 text-sm', w.matches ? 'font-medium' : 'text-muted-foreground')}>
            <b className="font-mono">{w.matches}</b> {w.matches === 1 ? 'match' : 'matches'}
          </span>
          <Button size="sm" variant={open ? 'secondary' : 'outline'} onClick={toggle} disabled={!w.matches && !open} aria-expanded={open}>
            See matches
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
          <Button size="sm" variant="ghost" onClick={close} disabled={closing}>
            {closing ? <Loader2 className="animate-spin" /> : <X />}
            Close
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t pt-3">
          {!matches ? (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : matches.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {matches.map((l) => (
                <ListingCard key={l.id} l={l} />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">Nothing matches right now.</p>
          )}
        </div>
      )}
    </li>
  )
}
