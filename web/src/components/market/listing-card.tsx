// Marketplace building blocks: the listing card, the "ml left of total" gauge (a small bottle that fills up), the
// status badge and a few small shared pieces.
import { useId } from 'react'
import { MapPin } from 'lucide-react'
import { formatKm, formatPrice, listingHref, type Listing, type ListingStatus } from '@/lib/market'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/avatar'
import { BottleImg, SmartImg } from '@/components/media'

/** A bottle silhouette filled to `left / total` (a gauge, not decoration). */
export function BottleFill({ left, total, className }: { left: number; total: number; className?: string }) {
  const f = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0
  // body spans y 9..39 (30 units); the liquid rises from the bottom
  const h = 30 * f
  const clip = `sa-bottle-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 24 40" className={cn('shrink-0', className)} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x="3" y="9" width="18" height="30" rx="4" />
        </clipPath>
      </defs>
      <rect x="8.5" y="1" width="7" height="5" rx="1.2" className="fill-muted-foreground/45" />
      <rect x="10" y="5.5" width="4" height="4" className="fill-muted-foreground/30" />
      <rect x="3" y="9" width="18" height="30" rx="4" className="fill-muted" />
      <rect x="3" y={39 - h} width="18" height={h} clipPath={`url(#${clip})`} className="fill-foreground/45" />
      <rect x="3.5" y="9.5" width="17" height="29" rx="3.6" className="fill-none stroke-foreground/25" strokeWidth="1" />
    </svg>
  )
}

/** "30 / 100 ml" next to a small filling bottle. */
export function MlGauge({ left, total, className, size = 'sm' }: { left: number; total: number; className?: string; size?: 'sm' | 'lg' }) {
  const pct = total ? Math.round((left / total) * 100) : 0
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={`About ${left} ml left of ${total} ml (${pct}%)`}
      aria-label={`About ${left} ml left of a ${total} ml bottle`}
    >
      <BottleFill left={left} total={total} className={size === 'lg' ? 'h-9 w-[22px]' : 'h-5 w-3'} />
      <span className={cn('font-mono', size === 'lg' ? 'text-base' : 'text-xs')}>
        <b className="font-semibold">{left}</b>
        <span className="text-muted-foreground"> / {total} ml</span>
      </span>
    </span>
  )
}

export const STATUS_TEXT: Record<ListingStatus, string> = {
  pending: 'Waiting for review',
  rejected: 'Not approved',
  active: 'For sale',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
  removed: 'Removed by the moderators',
}

export function StatusBadge({ status, className }: { status: ListingStatus; className?: string }) {
  const tone =
    status === 'active'
      ? 'border-success/40 bg-success/10 text-foreground'
      : status === 'pending'
        ? 'border-warning/45 bg-warning/10 text-foreground'
        : status === 'rejected' || status === 'removed'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : status === 'sold'
            ? 'border-foreground bg-foreground text-background'
            : 'border-border bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap', tone, className)}>
      {status === 'active' && <i className="size-1.5 rounded-full bg-success" />}
      {status === 'pending' && <i className="size-1.5 rounded-full bg-warning" />}
      {STATUS_TEXT[status]}
    </span>
  )
}

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium text-muted-foreground', className)}>{children}</span>
}

/** Price in mono, with the price per ml beside it. */
export function PriceLine({ l, size = 'sm', className }: { l: Pick<Listing, 'price' | 'currency' | 'price_per_ml'>; size?: 'sm' | 'lg'; className?: string }) {
  return (
    <span className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <b className={cn('font-mono font-semibold tracking-[-0.02em]', size === 'lg' ? 'text-[30px] leading-none' : 'text-[17px] leading-tight')}>{formatPrice(l.price, l.currency)}</b>
      <span className={cn('font-mono text-muted-foreground', size === 'lg' ? 'text-sm' : 'text-[11px]')}>{formatPrice(l.price_per_ml, l.currency)}/ml</span>
    </span>
  )
}

export const placeText = (l: Pick<Listing, 'area' | 'city'>) => [l.area, l.city && l.city !== l.area ? l.city : null].filter(Boolean).join(', ')

/** The listing's lead image: the seller's photo, else the catalogue bottle on the mat. */
export function ListingImage({ l, className, imgClassName }: { l: Pick<Listing, 'photos' | 'perfume' | 'image' | 'title'>; className?: string; imgClassName?: string }) {
  const photo = l.photos[0]
  return (
    <div className={cn('relative overflow-hidden bg-mat', className)}>
      {photo ? (
        <SmartImg src={photo} alt={`${l.title}: seller's photo`} className={cn('absolute inset-0 size-full object-cover', imgClassName)} />
      ) : l.perfume ? (
        <BottleImg p={l.perfume} alt={`${l.title} bottle`} className={cn('absolute inset-0 m-auto h-[88%] w-[88%] mix-blend-multiply', imgClassName)} />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <BottleFill left={1} total={1} className="h-1/3 w-auto opacity-40" />
        </div>
      )}
    </div>
  )
}

export function ListingCard({ l, className }: { l: Listing; className?: string }) {
  const sold = l.status === 'sold'
  const where = placeText(l)
  const km = formatKm(l.distance_km)
  const first = l.seller ? l.seller.first_name || l.seller.name || l.seller.username : null
  return (
    <a
      href={listingHref(l.id)}
      aria-label={`${l.title} by ${l.brand}, ${l.ml_left} of ${l.ml_total} ml, ${formatPrice(l.price, l.currency)}${sold ? ', sold' : ''}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border bg-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        sold && 'opacity-60 grayscale-[0.6]',
        className,
      )}
    >
      <div className="relative">
        <ListingImage l={l} className="aspect-square" imgClassName="transition-transform duration-300 group-hover:scale-[1.03]" />
        {(sold || l.status !== 'active') && <StatusBadge status={l.status} className="absolute top-2 left-2" />}
        {l.photos.length > 1 && <span className="absolute right-2 bottom-2 rounded-full bg-card/85 px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">1/{l.photos.length}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pt-2 pb-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-[15px] leading-[1.15] font-semibold tracking-[-0.015em]">{l.title}</h3>
          <p className="truncate text-[13px] text-muted-foreground">{l.brand || 'Unknown brand'}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <MlGauge left={l.ml_left} total={l.ml_total} />
          {(l.box || l.tester) && (
            <span className="flex gap-1">
              {l.box && <Tag>Box</Tag>}
              {l.tester && <Tag>Tester</Tag>}
            </span>
          )}
        </div>
        <PriceLine l={l} />
        <div className="mt-auto flex min-w-0 items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
          {l.seller && <UserAvatar name={l.seller.name || l.seller.username} seed={l.seller.username} src={l.seller.avatar} size={20} />}
          <span className="min-w-0 flex-1 truncate">
            {first && <span className="font-medium text-foreground">{l.mine ? 'You' : first}</span>}
            {where && (
              <>
                {first && ' · '}
                {where}
              </>
            )}
          </span>
          {km ? (
            <span className="shrink-0 font-mono text-[11px]">{km.replace(' away', '')}</span>
          ) : (
            !first && !where && <MapPin className="size-3" />
          )}
        </div>
      </div>
    </a>
  )
}

export function ListingGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4', className)}>{children}</div>
}

export function ListingSkeletons({ n = 8 }: { n?: number }) {
  return (
    <ListingGrid>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex flex-col overflow-hidden rounded-xl border bg-card">
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="flex flex-col gap-2 p-3">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </ListingGrid>
  )
}

/** The id of a listing photo from its URL (/api/market/photos/<id>.webp). */
export const photoId = (url: string) => Number(/\/photos\/(\d+)\./.exec(url)?.[1] || 0)
