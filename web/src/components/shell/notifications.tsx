// The bell in the header: unread count, and a list of recent notifications (friend requests can be answered here).
import { useState } from 'react'
import { Bell, Check, UserRoundPen } from 'lucide-react'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { dismiss, loadNotifications, markAllRead, useNotifications, type Notification } from '@/lib/notifications'
import { addFriend, profileHref, removeFriend, useFriends } from '@/lib/social'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/avatar'
import { openProfileEditor } from '@/components/profile-editor'

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
              {items.map((n) => (
                <Item key={n.id} n={n} close={() => setOpen(false)} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Bell className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">You're all caught up</p>
              <p className="text-xs text-muted-foreground">Friend requests and replies show up here.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
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
      {n.actor ? (
        <UserAvatar name={n.actor.name} seed={n.actor.username} src={n.actor.avatar} top={n.actor.top} size={36} />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <UserRoundPen className="size-4" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="text-sm leading-snug">{text}</span>
        <small className="text-xs text-muted-foreground">{ago(n.created_at)}</small>
      </span>
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
