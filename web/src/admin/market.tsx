// Marketplace: the review queue for custom listings (a fragrance not in the catalogue), plus every other listing by
// status. A listing opens a side sheet with its photos, details and the review actions (approve, optionally linked to
// a catalogue perfume; reject with a reason the seller sees; remove).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronLeft, ChevronRight, ImageOff, Link2, MapPin, RefreshCw, Search, Trash2, Unlink, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, api, errorText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BottleThumb, SmartImg } from '@/components/media'
import { Segmented } from '@/components/segmented'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { admin, ago, fullTime, num, useDebounced, useLoad, useVisibleInterval, when, type AdminListing, type ListingStatus, type ListingsPage } from './data'
import { Muted, PageHead, Who } from './parts'
import { ActionForm, Field } from './person'

// ---- the pending count shown on the nav tab -------------------------------------------------------------------

let pendingCount: number | null = null
const pendingSubs = new Set<() => void>()
const setPending = (n: number) => {
  if (n === pendingCount) return
  pendingCount = n
  pendingSubs.forEach((fn) => fn())
}
const subscribePending = (fn: () => void) => {
  pendingSubs.add(fn)
  return () => void pendingSubs.delete(fn)
}

/** Listings waiting for review: loaded on sign-in, every minute while the tab is visible, and after each action here. */
export function usePendingCount() {
  const n = useSyncExternalStore(subscribePending, () => pendingCount)
  const refresh = useCallback(() => {
    admin
      .get<ListingsPage>('/market/listings', { status: 'pending' })
      .then((r) => setPending(r.counts.pending))
      .catch(() => {})
  }, [])
  useEffect(() => refresh(), [refresh])
  useVisibleInterval(refresh, 60_000)
  return n
}

// ---- formatting -------------------------------------------------------------------------------------------------

type Filter = ListingStatus | 'all'

const FILTERS: { value: Filter; label: string; empty: string }[] = [
  { value: 'pending', label: 'Review queue', empty: 'Nothing to review. New custom listings show up here.' },
  { value: 'active', label: 'Live', empty: 'No live listings.' },
  { value: 'rejected', label: 'Rejected', empty: 'No rejected listings.' },
  { value: 'sold', label: 'Sold', empty: 'No sold listings.' },
  { value: 'withdrawn', label: 'Withdrawn', empty: 'No withdrawn listings.' },
  { value: 'all', label: 'All', empty: 'No listings yet.' },
]

const STATUS: Record<ListingStatus, { label: string; className: string }> = {
  pending: { label: 'Waiting for review', className: 'bg-warning/12 text-foreground' },
  active: { label: 'Live', className: 'bg-success/10 text-success' },
  rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive' },
  sold: { label: 'Sold', className: 'bg-muted text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
}

const QUICK_REASONS = [
  'Please add a clear photo of the bottle and label.',
  'This looks like a duplicate of a catalogue perfume: please list it from the list.',
  'Please give the full perfume name and its brand.',
  'The price or the amount left looks wrong. Please check them.',
]

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

const nameOf = (l: AdminListing) => (l.custom ? l.custom_name || l.title : l.title) || 'Untitled'
const brandOf = (l: AdminListing) => (l.custom ? l.custom_brand || l.brand : l.brand) || ''
const placeOf = (l: AdminListing) => [l.area, l.city, l.country].filter(Boolean).join(', ')
const cleanReason = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')

// ---- small pieces -----------------------------------------------------------------------------------------------

function StatusPill({ status }: { status: ListingStatus }) {
  const s = STATUS[status]
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium', s.className)}>{s.label}</span>
}

function Tags({ l, withStatus }: { l: AdminListing; withStatus: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {withStatus && <StatusPill status={l.status} />}
      {l.custom ? <Badge variant="outline">Custom</Badge> : <Badge variant="secondary">Catalogue</Badge>}
      <Badge variant="outline" className="text-muted-foreground">
        {l.box ? 'With box' : 'No box'}
      </Badge>
      {l.tester && (
        <Badge variant="outline" className="text-muted-foreground">
          Tester
        </Badge>
      )}
    </div>
  )
}

/** How full the bottle is: a thin bar plus "80 of 100 ml". */
function MlLeft({ l }: { l: AdminListing }) {
  const pct = l.ml_total > 0 ? Math.max(0, Math.min(100, (l.ml_left / l.ml_total) * 100)) : 0
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(pct)}% left`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono tabular-nums">
        {num(l.ml_left)} <span className="text-muted-foreground">of {num(l.ml_total)} ml</span>
      </span>
    </span>
  )
}

function Facts({ l }: { l: AdminListing }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="text-[11px] text-muted-foreground">Price</dt>
        <dd className="flex items-baseline gap-1.5">
          <span className="font-mono font-semibold tabular-nums">{money(l.price, l.currency)}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{money(l.price / Math.max(1, l.ml_left), l.currency)}/ml</span>
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-[11px] text-muted-foreground">Left in the bottle</dt>
        <dd>
          <MlLeft l={l} />
        </dd>
      </div>
    </dl>
  )
}

function Place({ l }: { l: AdminListing }) {
  const p = placeOf(l)
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <MapPin className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{p || 'No pickup area'}</span>
    </p>
  )
}

function RejectNote({ l }: { l: AdminListing }) {
  if (l.status !== 'rejected' || !l.review_note) return null
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
      <span className="font-medium text-destructive">Rejected: </span>
      {l.review_note}
    </p>
  )
}

function Seller({ l }: { l: AdminListing }) {
  if (!l.seller) return <p className="text-sm text-muted-foreground">Seller account deleted</p>
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Who user={l.seller} size={32} className="text-sm" />
      <a href={`mailto:${l.seller.email}`} className="truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" title={l.seller.email}>
        {l.seller.email}
      </a>
    </div>
  )
}

function Times({ l }: { l: AdminListing }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-muted-foreground">Listed</dt>
      <dd className="font-mono tabular-nums" title={fullTime(l.created_at)}>
        {when(l.created_at)}
      </dd>
      {l.updated_at !== l.created_at && (
        <>
          <dt className="text-muted-foreground">Updated</dt>
          <dd className="font-mono tabular-nums" title={fullTime(l.updated_at)}>
            {when(l.updated_at)}
          </dd>
        </>
      )}
      {l.status === 'pending' && (
        <>
          <dt className="text-muted-foreground">In the queue</dt>
          <dd title={fullTime(l.updated_at)}>{ago(l.updated_at) === 'just now' ? 'just now' : `for ${ago(l.updated_at).replace(/ ago$/, '')}`}</dd>
        </>
      )}
    </dl>
  )
}

/** The lead image: the first photo, else the catalogue bottle, else an empty tile. */
function Cover({ l, onPhoto, className }: { l: AdminListing; onPhoto: (i: number) => void; className?: string }) {
  if (l.photos.length)
    return (
      <button
        type="button"
        onClick={() => onPhoto(0)}
        aria-label={`Open photo 1 of ${l.photos.length}`}
        className={cn('block aspect-square w-full overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}
      >
        <img src={l.photos[0]} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-200 hover:scale-[1.03]" />
      </button>
    )
  if (l.image)
    return (
      <span className={cn('grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-mat', className)}>
        <SmartImg src={l.image} fallback={l.perfume_id ? `/img/perfume/${l.perfume_id}` : undefined} alt={`${nameOf(l)} bottle`} className="h-[90%] w-[90%] object-contain mix-blend-multiply" />
      </span>
    )
  return (
    <span className={cn('flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground', className)}>
      <ImageOff className="size-5 opacity-70" />
      <span className="text-[11px]">No photo</span>
    </span>
  )
}

function Thumbs({ l, onPhoto, className }: { l: AdminListing; onPhoto: (i: number) => void; className?: string }) {
  if (l.photos.length < 2) return null
  return (
    <div className={cn('grid grid-cols-3 gap-1 sm:grid-cols-4', className)}>
      {l.photos.map((src, i) => (
        <button
          key={src}
          type="button"
          onClick={() => onPhoto(i)}
          aria-label={`Open photo ${i + 1} of ${l.photos.length}`}
          className="aspect-square overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-opacity hover:opacity-80" />
        </button>
      ))}
    </div>
  )
}

// ---- the screen -------------------------------------------------------------------------------------------------

type Act = 'approve' | 'reject' | 'remove' | null
type Photo = { l: AdminListing; i: number }

export function Market() {
  const [filter, setFilter] = useState<Filter>('pending')
  const { data, error, loading, reload } = useLoad<ListingsPage>('/market/listings', { status: filter })
  const [open, setOpen] = useState<{ id: number; act: Act } | null>(null)
  const [photo, setPhoto] = useState<Photo | null>(null)

  useEffect(() => {
    if (data) setPending(data.counts.pending)
  }, [data])

  const counts = data?.counts
  const countOf = (f: Filter) => (counts ? (f === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[f]) : null)
  // keeps the previous filter's rows while the next loads (dimmed), like People
  const listings = data?.listings
  const openListing = (open && listings?.find((l) => l.id === open.id)) || null
  const empty = FILTERS.find((f) => f.value === filter)!.empty

  const done = () => {
    setOpen(null)
    reload()
  }

  return (
    <>
      <PageHead title="Marketplace" lede="Custom listings wait here for your review. Listings of catalogue perfumes go live at once.">
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading} className="text-muted-foreground">
          <RefreshCw className={cn(loading && data && 'animate-spin')} />
          Refresh
        </Button>
      </PageHead>

      <Segmented<Filter>
        label="Listing status"
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => {
          const n = countOf(f.value)
          return {
            value: f.value,
            label: (
              <>
                {f.label}
                {n !== null && (
                  <span
                    className={cn(
                      'min-w-5 rounded-full px-1.5 py-px text-center font-mono text-[11px] leading-4 tabular-nums',
                      f.value === 'pending' && n > 0 ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.07] text-muted-foreground',
                    )}
                  >
                    {num(n)}
                  </span>
                )}
              </>
            ),
          }
        })}
      />

      {!data && !error && (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      )}
      {!!error && !data && (
        <div className="rounded-xl border bg-card">
          <Muted>{errorText(error, "Couldn't load listings.")}</Muted>
        </div>
      )}
      {listings?.length === 0 && (
        <div className="rounded-xl border bg-card">
          <Muted>{empty}</Muted>
        </div>
      )}
      {!!listings?.length && (
        <ol className={cn('flex flex-col gap-3 transition-opacity', loading && 'opacity-60')} aria-label="Listings">
          {listings.map((l) => (
            <li key={l.id}>
              <ListingCard l={l} withStatus={filter === 'all'} onOpen={(act) => setOpen({ id: l.id, act })} onPhoto={(i) => setPhoto({ l, i })} />
            </li>
          ))}
        </ol>
      )}

      <ListingSheet listing={openListing} act={open?.act ?? null} onClose={() => setOpen(null)} onDone={done} onPhoto={(l, i) => setPhoto({ l, i })} />
      <Lightbox photo={photo} onChange={setPhoto} />
    </>
  )
}

function ListingCard({ l, withStatus, onOpen, onPhoto }: { l: AdminListing; withStatus: boolean; onOpen: (act: Act) => void; onPhoto: (i: number) => void }) {
  const name = nameOf(l)
  const brand = brandOf(l)
  return (
    <article className="listing-card rounded-xl border bg-card p-4 sm:p-5" aria-label={`${name}${brand ? ` by ${brand}` : ''}`}>
      <div className="flex flex-col gap-1 [grid-area:img]">
        <Cover l={l} onPhoto={onPhoto} />
        <Thumbs l={l} onPhoto={onPhoto} />
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 [grid-area:head]">
        <Tags l={l} withStatus={withStatus} />
        <h2 className="text-[17px] leading-snug font-semibold tracking-[-0.01em]">
          <button type="button" onClick={() => onOpen(null)} className="rounded-sm text-left break-words outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {name}
          </button>
        </h2>
        {brand && <p className="-mt-1 text-sm text-muted-foreground">{brand}</p>}
      </div>

      <div className="flex min-w-0 flex-col gap-3 [grid-area:body]">
        <Facts l={l} />
        {l.description ? <p className="line-clamp-4 text-sm break-words whitespace-pre-line">{l.description}</p> : <p className="text-sm text-muted-foreground italic">No description.</p>}
        <Place l={l} />
        <RejectNote l={l} />
      </div>

      <aside className="flex min-w-0 flex-col gap-3 border-t pt-3 [grid-area:side] lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5" aria-label="Seller and review">
        <Seller l={l} />
        <Times l={l} />
        <div className="flex flex-wrap gap-2">
          {l.status === 'pending' && (
            <>
              <Button size="sm" onClick={() => onOpen('approve')}>
                <Check />
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpen('reject')}>
                <X />
                Reject
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => onOpen('remove')}>
            <Trash2 />
            Remove
          </Button>
        </div>
      </aside>
    </article>
  )
}

// ---- the sheet ----------------------------------------------------------------------------------------------------

function ListingSheet({ listing, act, onClose, onDone, onPhoto }: { listing: AdminListing | null; act: Act; onClose: () => void; onDone: () => void; onPhoto: (l: AdminListing, i: number) => void }) {
  // keep the last listing around while the sheet animates closed
  const [shown, setShown] = useState<AdminListing | null>(listing)
  if (listing && listing !== shown) setShown(listing)
  const l = listing || shown
  return (
    <Sheet open={!!listing} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[520px]">{l && <SheetBody key={`${l.id}-${act}`} l={l} initial={act} onDone={onDone} onPhoto={(i) => onPhoto(l, i)} />}</SheetContent>
    </Sheet>
  )
}

function SheetBody({ l, initial, onDone, onPhoto }: { l: AdminListing; initial: Act; onDone: () => void; onPhoto: (i: number) => void }) {
  const [action, setAction] = useState<Act>(initial === 'approve' || initial === 'reject' ? (l.status === 'pending' ? initial : null) : initial)
  const toggle = (a: Act) => setAction((cur) => (cur === a ? null : a))
  // opened from a card's Approve / Reject / Remove: bring that form into view
  const actions = useRef<HTMLElement>(null)
  useEffect(() => {
    if (initial) window.setTimeout(() => actions.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150)
  }, [initial])
  const name = nameOf(l)
  const brand = brandOf(l)
  return (
    <>
      <SheetHeader className="gap-2 border-b p-5 pr-12">
        <Tags l={l} withStatus />
        <SheetTitle className="text-lg leading-snug tracking-[-0.02em] break-words">{name}</SheetTitle>
        <SheetDescription>
          {brand || 'No brand'} <span className="font-mono text-xs">· #{l.id}</span>
        </SheetDescription>
      </SheetHeader>

      <section className="flex flex-col gap-3 border-b p-5" aria-label="Photos">
        {l.photos.length ? (
          <div className="grid grid-cols-3 gap-2">
            {l.photos.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => onPhoto(i)}
                aria-label={`Open photo ${i + 1} of ${l.photos.length}`}
                className="aspect-square overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <img src={src} alt="" decoding="async" className="size-full object-cover transition-opacity hover:opacity-85" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Cover l={l} onPhoto={onPhoto} className="w-24 shrink-0" />
            <p className="text-sm text-muted-foreground">{l.image ? 'No photos: this is the catalogue bottle.' : 'The seller has not added a photo.'}</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-b p-5" aria-label="Details">
        <Facts l={l} />
        {l.description ? <p className="text-sm break-words whitespace-pre-line">{l.description}</p> : <p className="text-sm text-muted-foreground italic">No description.</p>}
        <Place l={l} />
        <RejectNote l={l} />
      </section>

      <section className="flex flex-col gap-3 border-b p-5" aria-label="Seller">
        <Seller l={l} />
        <Times l={l} />
      </section>

      <section ref={actions} className="scroll-mt-2 p-5" aria-label="Review actions">
        <h3 className="mb-3 text-sm font-semibold">{l.status === 'pending' ? 'Review' : 'Listing'}</h3>
        <div className="flex flex-wrap gap-2">
          {l.status === 'pending' && (
            <>
              <Button size="sm" variant={action === 'approve' ? 'secondary' : 'outline'} aria-expanded={action === 'approve'} onClick={() => toggle('approve')}>
                <Check />
                Approve
              </Button>
              <Button size="sm" variant={action === 'reject' ? 'secondary' : 'outline'} aria-expanded={action === 'reject'} onClick={() => toggle('reject')}>
                <X />
                Reject
              </Button>
            </>
          )}
          <Button size="sm" variant={action === 'remove' ? 'secondary' : 'outline'} aria-expanded={action === 'remove'} onClick={() => toggle('remove')} className="text-destructive hover:text-destructive">
            <Trash2 />
            Remove
          </Button>
        </div>
        {action === 'approve' && <Approve l={l} done={onDone} />}
        {action === 'reject' && <Reject l={l} done={onDone} />}
        {action === 'remove' && <Remove l={l} done={onDone} />}
      </section>
    </>
  )
}

/** A 409 / 404 means someone (the seller, or another admin tab) changed the listing first: say so and refresh. */
async function guarded(run: () => Promise<void>, done: () => void) {
  try {
    await run()
  } catch (e) {
    if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
      toast.error(e.status === 404 ? 'That listing is gone.' : 'This listing is no longer waiting for review.')
      done()
      return
    }
    throw e
  }
}

interface CatalogueHit {
  id: number
  name: string
  brand: string
  image: string
  year?: number | null
}

function Approve({ l, done }: { l: AdminListing; done: () => void }) {
  const [picked, setPicked] = useState<CatalogueHit | null>(null)
  const name = nameOf(l)
  return (
    <ActionForm
      title={l.custom ? 'It goes live at once and the seller is told. Link it to a catalogue perfume if it is one; otherwise it stays custom.' : 'It goes live at once and the seller is told.'}
      label={picked ? 'Approve and link' : l.custom ? 'Approve as custom' : 'Approve'}
      run={() =>
        guarded(async () => {
          await admin.post(`/market/listings/${l.id}/approve`, picked ? { perfume_id: picked.id } : {})
          toast.success(picked ? `Approved, linked to ${picked.name} by ${picked.brand}.` : `Approved “${name}”. It's live now.`)
          done()
        }, done)
      }
    >
      {l.custom && <LinkSearch initial={l.custom_name || ''} picked={picked} onPick={setPicked} />}
    </ActionForm>
  )
}

function LinkSearch({ initial, picked, onPick }: { initial: string; picked: CatalogueHit | null; onPick: (p: CatalogueHit | null) => void }) {
  const [q, setQ] = useState(initial)
  const dq = useDebounced(q.trim(), 250)
  const [hits, setHits] = useState<CatalogueHit[] | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (dq.length < 2) {
      setHits(null)
      return
    }
    const ctl = new AbortController()
    api
      .get<{ results: CatalogueHit[] }>('/api/perfumes', { q: dq, limit: 8 }, ctl.signal)
      .then((r) => {
        setHits(r.results)
        setErr(false)
      })
      .catch(() => {
        if (!ctl.signal.aborted) setErr(true)
      })
    return () => ctl.abort()
  }, [dq])

  return (
    <Field id="link-search" label="Link to a catalogue perfume (optional)">
      {picked && (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-2">
          <BottleThumb p={picked} size={44} />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="size-3.5" /> Linked to
            </span>
            <span className="truncate text-sm font-medium">{picked.name}</span>
            <span className="truncate text-xs text-muted-foreground">{picked.brand}</span>
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)}>
            <Unlink />
            Unlink
          </Button>
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id="link-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalogue by name or brand" autoComplete="off" className="bg-background pl-9" />
      </div>
      {err && <p className="text-xs text-destructive">The search didn't work. Try again.</p>}
      {hits?.length === 0 && <p className="text-xs text-muted-foreground">No catalogue perfume matches “{dq}”.</p>}
      {!!hits?.length && (
        <ul className="flex max-h-[296px] flex-col gap-0.5 overflow-y-auto rounded-lg border bg-card p-1" aria-label="Catalogue matches">
          {hits.map((p) => {
            const on = picked?.id === p.id
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onPick(on ? null : p)}
                  className={cn('flex w-full items-center gap-3 rounded-md p-1.5 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50', on && 'bg-muted')}
                >
                  <BottleThumb p={p} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {p.brand}
                      {p.year ? <span className="font-mono"> · {p.year}</span> : null}
                    </span>
                  </span>
                  {on && <Check className="size-4 shrink-0" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Field>
  )
}

function Reject({ l, done }: { l: AdminListing; done: () => void }) {
  const [reason, setReason] = useState('')
  const clean = cleanReason(reason)
  return (
    <ActionForm
      title="Tell the seller what to fix. They see this reason with the listing."
      label="Reject listing"
      submit={clean.length >= 3}
      run={() =>
        guarded(async () => {
          if (clean.length < 3) throw new Error('Write a reason of at least 3 characters.')
          await admin.post(`/market/listings/${l.id}/reject`, { reason: clean })
          toast.success(`Rejected “${nameOf(l)}”. The seller has been told why.`)
          done()
        }, done)
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Quick reasons</span>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={clean === r}
              onClick={() => setReason(r)}
              className={cn(
                'rounded-xl border bg-background px-2.5 py-1 text-left text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                clean === r && 'border-foreground/40 bg-muted',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <Field id="reject-reason" label="Reason">
        <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} placeholder="What should the seller change?" className="bg-background" />
        <span className={cn('self-end font-mono text-[11px] tabular-nums', clean.length > 280 ? 'text-warning' : 'text-muted-foreground')}>{clean.length} / 300</span>
      </Field>
    </ActionForm>
  )
}

function Remove({ l, done }: { l: AdminListing; done: () => void }) {
  const name = nameOf(l)
  const brand = brandOf(l)
  return (
    <ActionForm
      danger
      label="Remove listing"
      title={
        <>
          Remove{' '}
          <strong className="font-semibold">
            “{name}”{brand ? ` by ${brand}` : ''}
          </strong>
          {l.seller ? ` from @${l.seller.username}` : ''}? It's deleted with its photos and the seller is told. This cannot be undone.
        </>
      }
      run={() =>
        guarded(async () => {
          await admin.del(`/market/listings/${l.id}`)
          toast.success(`Removed “${name}”.`)
          done()
        }, done)
      }
    />
  )
}

// ---- photos, larger -----------------------------------------------------------------------------------------------

function Lightbox({ photo, onChange }: { photo: Photo | null; onChange: (p: Photo | null) => void }) {
  // keep the last photo while the dialog animates closed
  const [shown, setShown] = useState<Photo | null>(photo)
  if (photo && photo !== shown) setShown(photo)
  const p = photo || shown
  const n = p?.l.photos.length || 0
  const go = (d: number) => p && n > 1 && onChange({ l: p.l, i: (p.i + d + n) % n })
  return (
    <Dialog open={!!photo} onOpenChange={(o) => !o && onChange(null)}>
      <DialogContent
        className="max-w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-3xl sm:p-4"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') go(-1)
          if (e.key === 'ArrowRight') go(1)
        }}
      >
        {p && (
          <>
            <DialogTitle className="pr-8 text-base leading-snug">{nameOf(p.l)}</DialogTitle>
            <DialogDescription className="-mt-2 text-xs">
              Photo <span className="font-mono">{p.i + 1}</span> of <span className="font-mono">{n}</span>
              {p.l.seller ? ` · by @${p.l.seller.username}` : ''}
            </DialogDescription>
            <div className="relative grid min-h-48 place-items-center overflow-hidden rounded-lg bg-muted">
              <img key={p.l.photos[p.i]} src={p.l.photos[p.i]} alt={`${nameOf(p.l)}, photo ${p.i + 1}`} className="max-h-[70svh] w-auto max-w-full object-contain" />
              {n > 1 && (
                <>
                  <Button type="button" variant="outline" size="icon" className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur" onClick={() => go(-1)} aria-label="Previous photo">
                    <ChevronLeft />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur" onClick={() => go(1)} aria-label="Next photo">
                    <ChevronRight />
                  </Button>
                </>
              )}
            </div>
            {n > 1 && (
              <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
                {p.l.photos.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => onChange({ l: p.l, i })}
                    aria-label={`Photo ${i + 1}`}
                    aria-current={i === p.i ? 'true' : undefined}
                    className={cn('size-14 shrink-0 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', i === p.i ? 'border-foreground' : 'border-transparent opacity-70 hover:opacity-100')}
                  >
                    <img src={src} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
