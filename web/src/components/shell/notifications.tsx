// The bell in the header: unread count, and a list of recent notifications (friend requests can be answered here).
import { useState } from 'react'
import { Bell, Check, MapPin, Package, ShieldAlert, UserRoundPen } from 'lucide-react'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { dismiss, loadNotifications, markAllRead, useNotifications, type Notification } from '@/lib/notifications'
import { listingHref, threadHref } from '@/lib/market'
import { addFriend, profileHref, removeFriend, useFriends } from '@/lib/social'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/avatar'
import { openProfileEditor } from '@/components/profile-editor'
import { openAddressDialog } from '@/components/address-dialog'

/** A listing's picture on a small tile: catalogue bottles are multiplied onto the mat, members' photos fill it. */
export function ListingThumb({ image, size = 40, className }: { image: string | null | undefined; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  const photo = !!image && image.includes('/market/photos/')
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg', image && !broken ? 'bg-mat' : 'bg-muted', className)} style={{ width: size, height: size }}>
      {image && !broken ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className={photo ? 'size-full object-cover' : 'size-[90%] object-contain mix-blend-multiply'}
        />
      ) : (
        <Package className="size-[45%] text-muted-foreground" />
      )}
    </span>
  )
}

export function NotificationBell() {
  const { unread, items } = useNotifications()
  const [open, setOpen] = useState(false)
  const onOpen = async (o: boolean) => {
    setOpen(o)
    if (o) {
      await loadNotifications()
      markAllRead() // the dots stay on the items shown now; the badge clears
    }
  }
  return (
    <Popover open={open} onOpenChange={onOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications">
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 font-mono text-[10px] leading-none font-semibold text-brand-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] gap-0 p-0">
        <div className="flex items-center border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
        </div>
        <div className="max-h-[min(70vh,480px)] overflow-y-auto overscroll-contain">
          {!items ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.length ? (
            <ul className="divide-y">
              {collapse(items).map((n) => (
                <Item key={n.id} n={n} close={() => setOpen(false)} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Bell className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">You're all caught up</p>
              <p className="text-xs text-muted-foreground">Friend requests, messages and marketplace news show up here.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** One row per conversation: several "sent you a message" notifications for the same thread show as the newest. */
function collapse(items: Notification[]) {
  const seen = new Set<string>()
  return items.filter((n) => {
    if (n.kind !== 'message' || !n.ref) return true
    if (seen.has(n.ref)) return false
    seen.add(n.ref)
    return true
  })
}

function Icon({ icon: I }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
      <I className="size-4" />
    </span>
  )
}

const ago = (ts: number) => {
  const t = timeAgo(ts)
  return /^\d+[mhd]$/.test(t) ? `${t} ago` : t
}

function Item({ n, close }: { n: Notification; close: () => void }) {
  const lists = useFriends()
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<'accepted' | 'declined' | null>(null)
  const who = n.actor ? <b className="font-semibold">{n.actor.name}</b> : null
  let text: React.ReactNode
  let href: string | null = n.actor ? profileHref(n.actor.username) : null
  let onClick: (() => void) | null = null
  // leading picture: the actor's photo, else the listing, else an icon; `trailing`: the listing beside the text
  let lead: React.ReactNode = null
  let trailing: React.ReactNode = null
  const title = n.listing ? <b className="font-semibold">{n.listing.title}</b> : null
  const ref = n.ref && /^\d+$/.test(n.ref) ? Number(n.ref) : null
  switch (n.kind) {
    case 'friend_request':
      text = answer === 'accepted' ? <>You and {who} are now friends</> : answer === 'declined' ? <>You declined {who}'s request</> : <>{who} sent you a friend request</>
      break
    case 'friend_accept':
      text = <>{who} accepted your friend request</>
      break
    case 'name_reminder':
      text = <>Add your name so friends and family can find you</>
      href = null
      onClick = openProfileEditor
      break
    case 'address_reminder':
      text = <>Add your delivery address</>
      href = null
      onClick = openAddressDialog
      lead = <Icon icon={MapPin} />
      break
    case 'message':
      text = title ? <>{who ?? 'Someone'} sent you a message about {title}</> : <>{who ?? 'Someone'} sent you a message</>
      href = ref ? threadHref(ref) : '#/messages'
      break
    case 'wanted_match':
      text = <>{who ?? 'Someone'} listed {title ?? 'a bottle'}, which matches what you're looking for</>
      href = ref ? listingHref(ref) : '#/market'
      trailing = n.listing && <ListingThumb image={n.listing.image} size={44} />
      break
    case 'listing_approved':
      text = <>Your listing {title} was approved and is live</>
      href = ref ? listingHref(ref) : null
      break
    case 'listing_rejected':
      text = <>Your listing {title} needs changes</>
      href = ref ? listingHref(ref) : null
      break
    case 'listing_removed':
      text = title ? <>Your listing {title} was removed by the moderators</> : <>Your listing was removed by the moderators</>
      href = null
      lead = n.listing ? null : <Icon icon={ShieldAlert} />
      break
    default:
      text = <>{who} sent you a notification</>
  }
  const respond = async (accept: boolean) => {
    if (!n.actor) return
    setBusy(true)
    try {
      if (accept) await addFriend(n.actor.username)
      else await removeFriend(n.actor.username)
      setAnswer(accept ? 'accepted' : 'declined')
      if (!accept) setTimeout(() => dismiss(n.id), 1200)
    } catch (e) {
      toast(errorText(e, 'Could not answer the request.'))
    }
    setBusy(false)
  }
  const body = (
    <>
      {lead ??
        (n.actor ? (
          <UserAvatar name={n.actor.name} seed={n.actor.username} src={n.actor.avatar} top={n.actor.top} size={36} />
        ) : n.listing ? (
          <ListingThumb image={n.listing.image} size={36} />
        ) : (
          <Icon icon={UserRoundPen} />
        ))}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="text-sm leading-snug">{text}</span>
        <small className="text-xs text-muted-foreground">{ago(n.created_at)}</small>
      </span>
      {trailing}
      {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="unread" />}
    </>
  )
  const rowCls = 'flex w-full items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none'
  return (
    <li className={cn(!n.read && 'bg-brand-soft/30')}>
      {href ? (
        <a href={href} onClick={close} className={rowCls}>
          {body}
        </a>
      ) : (
        <button type="button" onClick={() => (close(), onClick?.())} className={rowCls}>
          {body}
        </button>
      )}
      {n.kind === 'friend_request' && !answer && lists?.incoming.some((p) => p.username === n.actor?.username) && (
        <div className="flex gap-2 px-4 pb-3 pl-[64px]">
          <Button size="sm" disabled={busy} onClick={() => respond(true)}>
            <Check />
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => respond(false)}>
            Decline
          </Button>
        </div>
      )}
    </li>
  )
}
