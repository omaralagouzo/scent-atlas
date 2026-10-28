// One listing: the photos (or the catalogue bottle), the facts (what, how much is left, price, box / tester, area and
// distance), the seller with "Message seller". On your own listing: its status, the exact pickup point, how many
// conversations it has, and Edit / Mark as sold / Withdraw / Put back up.
import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Loader2, Lock, MapPin, MessageCircle, MessagesSquare, Pencil, RotateCcw, SearchX, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api, ApiError, errorText } from '@/lib/api'
import { go, perfumeHref } from '@/lib/router'
import { formatKm, myPosition, type Listing } from '@/lib/market'
import { profileHref } from '@/lib/social'
import { timeAgo } from '@/lib/format'
import { authDialog, useSession } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AccordBars } from '@/components/accords'
import { UserAvatar } from '@/components/avatar'
import { BottleImg, SmartImg } from '@/components/media'
import { EmptyState, Page } from '@/components/page'
import { MlGauge, placeText, PriceLine, StatusBadge, Tag } from '@/components/market/listing-card'
import { locationGranted } from '@/components/market/prefs'

const ago = (ts: number) => {
  const t = timeAgo(ts)
  return /^\d+[mhd]$/.test(t) ? `${t} ago` : t
}

type Slide = { kind: 'photo'; src: string } | { kind: 'bottle' }

export default function ListingView({ args }: ViewProps) {
  const id = args.id
  const { user, loaded } = useSession()
  const [l, setL] = useState<Listing | null>(null)
  const [failed, setFailed] = useState<'missing' | 'error' | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!loaded || !user) return
    let live = true
    setFailed(null)
    if (!/^\d+$/.test(id)) return setFailed('missing')
    api.get<Listing>(`/api/market/listings/${id}`).then(
      (r) => {
        if (!live) return
        setL(r)
        // distance, only when the visitor already allowed location (never a surprise prompt)
        if (!r.mine)
          locationGranted().then(async (ok) => {
            const pos = ok ? await myPosition() : null
            if (!pos || !live) return
            api.get<Listing>(`/api/market/listings/${id}`, pos).then((x) => live && setL((cur) => (cur ? { ...cur, distance_km: x.distance_km } : x)), () => {})
          })
      },
      (e) => live && setFailed(e instanceof ApiError && (e.status === 404 || e.status === 422) ? 'missing' : 'error'),
    )
    return () => {
      live = false
    }
  }, [id, attempt, loaded, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!l) return
    const before = document.title
    document.title = `${l.title} for sale · Scent Atlas`
    return () => {
      document.title = before
    }
  }, [l?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loaded && !user)
    return (
      <Page>
        <EmptyState icon={<Lock className="size-5" />} title="Sign in to see this listing" action={<Button onClick={() => authDialog.open({ mode: 'login' })}>Sign in</Button>}>
          The marketplace is for members only.
        </EmptyState>
      </Page>
    )
  if (failed === 'missing')
    return (
      <Page>
        <EmptyState icon={<SearchX className="size-5" />} title="This listing is gone" action={<Button variant="outline" onClick={() => go('/market')}>Back to the marketplace</Button>}>
          The seller may have withdrawn it, or the link is mistyped.
        </EmptyState>
      </Page>
    )
  if (failed)
    return (
      <Page>
        <EmptyState title="Could not load this listing" action={<Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
          Check your connection and try again.
        </EmptyState>
      </Page>
    )
  if (!l)
    return (
      <Page>
        <div aria-busy="true" aria-label="Loading listing" className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
          <Skeleton className="aspect-square w-full rounded-2xl" />
          <div className="flex flex-col gap-4 lg:pt-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        </div>
      </Page>
    )
  return <Detail key={l.id} l={l} setL={setL} />
}

function Gallery({ l }: { l: Listing }) {
  const slides: Slide[] = [...l.photos.map((src) => ({ kind: 'photo' as const, src })), ...(l.perfume ? [{ kind: 'bottle' as const }] : [])]
  const [i, setI] = useState(0)
  const cur = slides[Math.min(i, slides.length - 1)]
  const sold = l.status === 'sold'
  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-20">
      <div className={cn('relative aspect-square w-full overflow-hidden rounded-2xl bg-mat', sold && 'grayscale-[0.7]')}>
        {cur?.kind === 'photo' ? (
          <SmartImg key={cur.src} src={cur.src} alt={`${l.title}: photo ${i + 1} of ${l.photos.length}`} className="absolute inset-0 size-full object-contain" />
        ) : l.perfume ? (
          <BottleImg p={l.perfume} className="absolute inset-0 m-auto h-[88%] w-[88%] mix-blend-multiply" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">No photo</div>
        )}
        {sold && <span className="absolute top-3 left-3 rounded-full bg-foreground px-3 py-1 text-sm font-semibold text-background">Sold</span>}
      </div>
      {slides.length > 1 && (
        <div role="group" aria-label="Photos" className="flex gap-2 overflow-x-auto scrollbar-none">
          {slides.map((s, k) => (
            <button
              key={k}
              type="button"
              aria-label={s.kind === 'photo' ? `Photo ${k + 1}` : 'Catalogue bottle'}
              aria-pressed={k === i}
              onClick={() => setI(k)}
              className={cn('relative size-16 shrink-0 overflow-hidden rounded-lg border-2 bg-mat transition-colors sm:size-20', k === i ? 'border-foreground' : 'border-transparent hover:border-border')}
            >
              {s.kind === 'photo' ? <SmartImg src={s.src} className="absolute inset-0 size-full object-cover" /> : l.perfume && <BottleImg p={l.perfume} alt="" className="absolute inset-0 m-auto h-[88%] w-[88%] mix-blend-multiply" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Detail({ l, setL }: { l: Listing; setL: React.Dispatch<React.SetStateAction<Listing | null>> }) {
  const sold = l.status === 'sold'
  const where = placeText(l)
  const km = formatKm(l.distance_km)
  const gender = l.perfume?.gender ? l.perfume.gender[0].toUpperCase() + l.perfume.gender.slice(1) : null
  return (
    <Page>
      <a href="#/market" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Marketplace
      </a>
      <article className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-10">
        <Gallery l={l} />

        <div className="flex min-w-0 flex-col gap-6 lg:pt-2">
          <div className={cn('flex flex-col gap-2', sold && 'opacity-70')}>
            <div className="flex flex-wrap items-center gap-2 text-[15px]">
              <span className="font-medium">{l.brand || 'Unknown brand'}</span>
              {l.status !== 'active' && <StatusBadge status={l.status} />}
              {l.custom && <Tag>Not in the catalogue</Tag>}
            </div>
            <h1 className="text-[32px] leading-[1.04] font-semibold tracking-[-0.03em] text-balance sm:text-[40px]">
              {l.perfume ? (
                <a href={perfumeHref(l.perfume.id)} className="underline-offset-4 hover:underline">
                  {l.title}
                </a>
              ) : (
                l.title
              )}
            </h1>
            {l.perfume && (
              <p className="text-[15px] text-muted-foreground">
                {[l.perfume.year ? <span key="y" className="font-mono">{l.perfume.year}</span> : null, gender].filter(Boolean).map((m, k) => (
                  <span key={k}>
                    {k > 0 && ' · '}
                    {m}
                  </span>
                ))}
                {l.perfume.year || gender ? ' · ' : ''}
                <a href={perfumeHref(l.perfume.id)} className="font-medium text-foreground underline-offset-4 hover:underline">
                  About this fragrance
                </a>
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
              <span className="text-xs text-muted-foreground">Price</span>
              <PriceLine l={l} size="lg" />
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
              <span className="text-xs text-muted-foreground">Left in the bottle (approx.)</span>
              <MlGauge left={l.ml_left} total={l.ml_total} size="lg" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {(where || l.country || km) && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4 text-muted-foreground" />
                {where || l.country}
                {km && <span className={cn('font-mono text-xs', (where || l.country) && 'text-muted-foreground')}>{where || l.country ? `· ${km}` : km}</span>}
              </span>
            )}
            <span className="flex gap-1.5">
              <Tag className={cn(l.box && 'border-foreground/30 text-foreground')}>{l.box ? 'With box' : 'No box'}</Tag>
              {l.tester && <Tag className="border-foreground/30 text-foreground">Tester</Tag>}
            </span>
            <span className="text-xs text-muted-foreground">Listed {ago(l.created_at)}</span>
          </div>

          {l.description && <p className="text-[15px] leading-relaxed whitespace-pre-line">{l.description}</p>}

          {l.mine ? <OwnerPanel l={l} setL={setL} /> : <SellerPanel l={l} />}

          {l.perfume?.accords?.length ? (
            <section aria-labelledby="accords-h" className="flex flex-col gap-3 border-t pt-5">
              <h2 id="accords-h" className="text-sm font-semibold">
                Main accords
              </h2>
              <AccordBars accords={l.perfume.accords} />
            </section>
          ) : null}
        </div>
      </article>
    </Page>
  )
}

function SellerPanel({ l }: { l: Listing }) {
  const [busy, setBusy] = useState(false)
  const s = l.seller
  const name = s ? s.name || s.username : 'A member'
  async function message() {
    if (l.conversation_id) return go(`/messages/${l.conversation_id}`)
    setBusy(true)
    try {
      const r = await api.post<{ conversation_id: number }>(`/api/market/listings/${l.id}/conversation`)
      go(`/messages/${r.conversation_id}`)
    } catch (e) {
      toast.error(errorText(e))
      setBusy(false)
    }
  }
  return (
    <section aria-label="Seller" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        {s ? (
          <a href={profileHref(s.username)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <UserAvatar name={name} seed={s.username} src={s.avatar} top={s.top} size={52} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-xs text-muted-foreground">Sold by</span>
              <b className="truncate text-[15px] font-semibold tracking-[-0.015em]">{name}</b>
              <span className="truncate text-sm text-muted-foreground">@{s.username}</span>
            </span>
          </a>
        ) : (
          <span className="flex-1 text-sm text-muted-foreground">A Scent Atlas member</span>
        )}
      </div>
      {l.status === 'sold' ? (
        <p className="text-sm text-muted-foreground">This bottle has been sold.</p>
      ) : (
        <>
          <Button size="lg" onClick={message} disabled={busy} className="bg-brand text-brand-foreground hover:bg-brand/90">
            {busy ? <Loader2 className="animate-spin" /> : <MessageCircle />}
            {l.conversation_id ? 'Open your conversation' : 'Message seller'}
          </Button>
          <p className="text-xs text-muted-foreground">No reservations: ask your questions and agree on a pickup in messages. You'll get the exact spot from the seller.</p>
        </>
      )}
    </section>
  )
}

function OwnerPanel({ l, setL }: { l: Listing; setL: React.Dispatch<React.SetStateAction<Listing | null>> }) {
  const [busy, setBusy] = useState<string | null>(null)
  async function setStatus(status: 'sold' | 'withdrawn' | 'active', undo?: string) {
    setBusy(status)
    try {
      const r = await api.patch<Listing>(`/api/market/listings/${l.id}`, { status })
      setL((cur) => (cur ? { ...cur, ...r } : r))
      const msg =
        status === 'sold' ? 'Marked as sold.' : status === 'withdrawn' ? 'Listing withdrawn.' : r.status === 'pending' ? 'Sent for review again.' : 'Back up for sale.'
      toast.success(msg, undo ? { action: { label: 'Undo', onClick: () => setStatus(undo as 'active') } } : undefined)
    } catch (e) {
      toast.error(errorText(e))
    }
    setBusy(null)
  }
  const spin = (k: string) => busy === k && <Loader2 className="animate-spin" />
  const p = l.pickup
  return (
    <section aria-label="Your listing" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Your listing</h2>
        <StatusBadge status={l.status} />
      </div>
      {l.status === 'pending' && <p className="text-sm text-muted-foreground">This fragrance isn't in our catalogue, so the site owner checks it before it goes live. You'll get a notification.</p>}
      {l.status === 'rejected' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm">
          <p className="font-medium text-destructive">Not approved</p>
          {l.review_note && <p className="mt-1">{l.review_note}</p>}
          <p className="mt-1 text-xs text-muted-foreground">Edit the listing to fix it; it goes back into the review queue.</p>
        </div>
      )}
      {l.status === 'removed' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm">
          <p className="font-medium text-destructive">Removed by the moderators</p>
          {l.review_note && <p className="mt-1">{l.review_note}</p>}
          <p className="mt-1 text-xs text-muted-foreground">The site owner took this listing down. Buyers can't see it, and it can't be edited or put back up.</p>
        </div>
      )}
      {l.status === 'withdrawn' && <p className="text-sm text-muted-foreground">Hidden from buyers. Put it back up whenever you like.</p>}
      {p && (
        <div className="flex items-start gap-2.5 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
          <div className="flex min-w-0 flex-col">
            <span>{p.formatted || 'Pinned location'}</span>
            <small className="text-xs text-muted-foreground">Exact pickup point, only you see it. {placeText(l) ? `Buyers only see ${placeText(l)}.` : 'Buyers only see a position rounded to about 1 km.'}</small>
          </div>
        </div>
      )}
      <a href="#/messages" className="inline-flex items-center gap-2 text-sm hover:underline">
        <MessagesSquare className="size-4 text-muted-foreground" />
        <span>
          <b className="font-mono font-medium">{l.conversations ?? 0}</b> {l.conversations === 1 ? 'conversation' : 'conversations'}
        </span>
      </a>
      {l.status !== 'removed' && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" asChild>
            <a href={`#/market/${l.id}/edit`}>
              <Pencil />
              Edit
            </a>
          </Button>
          {l.status === 'active' && (
            <Button onClick={() => setStatus('sold', 'active')} disabled={!!busy}>
              {spin('sold') || <Check />}
              Mark as sold
            </Button>
          )}
          {(l.status === 'active' || l.status === 'pending' || l.status === 'rejected') && (
            <Button variant="ghost" onClick={() => setStatus('withdrawn', l.status === 'active' ? 'active' : undefined)} disabled={!!busy}>
              {spin('withdrawn') || <Undo2 />}
              Withdraw
            </Button>
          )}
          {(l.status === 'sold' || l.status === 'withdrawn') && (
            <Button onClick={() => setStatus('active')} disabled={!!busy}>
              {spin('active') || <RotateCcw />}
              Put back up
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
