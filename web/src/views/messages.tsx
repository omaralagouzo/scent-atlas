// Messages between buyers and sellers: #/messages (inbox) and #/messages/:id (one conversation).
// Two panes from md up (conversations on the left, the thread on the right); one at a time on phones.
// A thread polls for new messages every 8 s while the tab is visible; loading it marks it read.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, MessageCircle, SendHorizontal, ShieldCheck, X } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api, ApiError, errorText } from '@/lib/api'
import { formatPrice, listingHref, threadHref, type ConversationSummary, type Listing, type Message } from '@/lib/market'
import { refreshMessagesUnread, setMessagesUnread, useMessagesUnread } from '@/lib/messages'
import { refreshUnread } from '@/lib/notifications'
import { profileHref } from '@/lib/social'
import { authDialog, useSession } from '@/lib/store'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/avatar'
import { EmptyState, Page, PageHeader } from '@/components/page'
import { ListingThumb } from '@/components/shell/notifications'

const POLL_MS = 8_000
const INBOX_POLL_MS = 30_000
const MAX_CHARS = 2000
const SAFETY_KEY = 'sa-msg-safety-seen'
const SAFETY = "Meet in a public place, check the bottle before paying, never pay in advance to someone you don't know."

interface Thread extends ConversationSummary {
  messages: Message[]
}

// the inbox survives moving between threads (each route change re-mounts the view)
let inboxCache: { uid: number; items: ConversationSummary[] } | null = null

const roleText = (r: ConversationSummary['role']) => (r === 'buyer' ? "You're buying" : "You're selling")
const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
function dayLabel(ts: number) {
  const d = new Date(ts * 1000)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }) })
}
const visible = () => document.visibilityState === 'visible'

export default function MessagesView({ args }: ViewProps) {
  const { user, loaded } = useSession()
  const id = args.id && /^\d+$/.test(args.id) ? Number(args.id) : null
  const [items, setItems] = useState<ConversationSummary[] | null>(inboxCache && user && inboxCache.uid === user.id ? inboxCache.items : null)
  const [failed, setFailed] = useState(false)
  const headerUnread = useMessagesUnread()

  const loadInbox = useCallback(async () => {
    if (!user) return
    try {
      const r = await api.get<{ conversations: ConversationSummary[]; unread: number }>('/api/messages')
      inboxCache = { uid: user.id, items: r.conversations }
      setItems(r.conversations)
      setMessagesUnread(r.unread)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    loadInbox()
    const tick = () => visible() && loadInbox()
    const t = window.setInterval(tick, INBOX_POLL_MS)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', tick)
    }
  }, [loadInbox]) // eslint-disable-line react-hooks/exhaustive-deps
  // the header noticed new messages somewhere: refresh the list
  const seenUnread = useRef(headerUnread)
  useEffect(() => {
    if (headerUnread > seenUnread.current) loadInbox()
    seenUnread.current = headerUnread
  }, [headerUnread]) // eslint-disable-line react-hooks/exhaustive-deps

  // a thread was opened (read) or got a message: patch its row right away, then refresh from the server
  const onThread = useCallback(
    (t: Thread) => {
      setItems((list) => {
        if (!list) return list
        const last = t.messages[t.messages.length - 1]
        const next = list.map((c) =>
          c.id === t.id ? { ...c, unread: 0, ...(last && { last: { body: last.body.slice(0, 140), mine: last.mine, created_at: last.created_at }, last_at: Math.max(c.last_at, last.created_at) }) } : c,
        )
        next.sort((a, b) => b.last_at - a.last_at)
        if (user) inboxCache = { uid: user.id, items: next }
        return next
      })
    },
    [user?.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!loaded)
    return (
      <Page>
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-6 h-[420px] w-full rounded-xl" />
      </Page>
    )
  if (!user)
    return (
      <Page>
        <PageHeader title="Messages" description="Talk to buyers and sellers about a bottle." />
        <EmptyState
          icon={<MessageCircle className="size-5" />}
          title="Sign in to see your messages"
          action={<Button onClick={() => authDialog.open({ mode: 'login', reason: 'Sign in to message buyers and sellers.' })}>Sign in</Button>}
        >
          Ask a seller about a bottle, agree on a price and where to meet. Your conversations stay between the two of you.
        </EmptyState>
      </Page>
    )

  const inboxPane = (
    <Inbox items={items} failed={failed} retry={loadInbox} current={id} />
  )

  return (
    <Page className="pb-6 sm:pb-8">
      <PageHeader title="Messages" description="Talk to buyers and sellers about a bottle." className={cn('mb-4 sm:mb-6', id && 'max-md:hidden')} />
      {items && items.length === 0 && !id ? (
        <EmptyState
          icon={<MessageCircle className="size-5" />}
          title="No messages yet"
          action={
            <Button variant="outline" asChild>
              <a href="#/market">Browse bottles for sale</a>
            </Button>
          }
        >
          When you message a seller about a bottle, or a buyer messages you, the conversation shows up here.
        </EmptyState>
      ) : (
        <div className="grid overflow-hidden rounded-xl border bg-card md:h-[calc(100dvh-17.5rem)] md:min-h-[480px] md:grid-cols-[minmax(280px,340px)_1fr] lg:h-[calc(100dvh-15rem)]">
          <aside aria-label="Conversations" className={cn('flex min-h-0 flex-col md:border-r', id && 'max-md:hidden')}>
            {inboxPane}
          </aside>
          <section aria-label="Conversation" className={cn('flex min-h-0 min-w-0 flex-col', !id && 'max-md:hidden', id && 'max-md:h-[calc(100dvh-9.5rem)] max-md:min-h-[420px]')}>
            {id ? (
              <ThreadPane key={id} id={id} onThread={onThread} />
            ) : (
              <div className="m-auto flex max-w-xs flex-col items-center gap-3 px-6 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                  <MessageCircle className="size-5" />
                </span>
                <p className="text-sm font-medium">Choose a conversation</p>
                <p className="text-sm text-muted-foreground">Pick someone on the left to read and reply.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------------------- inbox
function Inbox({ items, failed, retry, current }: { items: ConversationSummary[] | null; failed: boolean; retry: () => void; current: number | null }) {
  if (!items)
    return failed ? (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-muted-foreground">
        Could not load your messages.
        <Button size="sm" variant="outline" onClick={retry}>
          Retry
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-1 p-2" aria-busy="true">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="flex items-center gap-3 p-2">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    )
  return (
    <ul className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain">
      {items.map((c) => (
        <InboxRow key={c.id} c={c} on={c.id === current} />
      ))}
    </ul>
  )
}

function InboxRow({ c, on }: { c: ConversationSummary; on: boolean }) {
  const name = c.other?.name || 'Former member'
  const unread = c.unread > 0 && !on
  return (
    <li className={cn('relative flex gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50', on && 'bg-muted hover:bg-muted', unread && 'bg-brand-soft/25')}>
      {c.other ? (
        <UserAvatar name={name} seed={c.other.username} src={c.other.avatar} top={c.other.top} size={44} />
      ) : (
        <span className="size-11 shrink-0 rounded-full bg-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          {/* the whole row opens the thread; the listing link below sits above this one */}
          <a href={threadHref(c.id)} aria-current={on ? 'page' : undefined} className={cn('min-w-0 flex-1 truncate text-sm after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset', unread ? 'font-semibold' : 'font-medium')}>
            {name}
          </a>
          <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums" dateTime={new Date(c.last_at * 1000).toISOString()}>
            {timeAgo(c.last_at)}
          </time>
        </div>
        {c.listing && (
          <a href={listingHref(c.listing.id)} className="relative flex min-w-0 items-center gap-2 self-start text-xs text-muted-foreground hover:text-foreground" title={`${c.listing.title} by ${c.listing.brand}`}>
            <ListingThumb image={c.listing.image} size={20} className="rounded" />
            <span className="truncate">{c.listing.title}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{roleText(c.role)}</span>
          </a>
        )}
        <div className="flex items-center gap-2">
          <p className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'text-foreground' : 'text-muted-foreground')}>
            {c.last ? (
              <>
                {c.last.mine && <span className="text-muted-foreground">You: </span>}
                {c.last.body}
              </>
            ) : (
              <span className="italic">No messages yet</span>
            )}
          </p>
          {unread && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 font-mono text-[11px] leading-none font-semibold text-brand-foreground" aria-label={`${c.unread} unread`}>
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------------------- thread
function ThreadPane({ id, onThread }: { id: number; onThread: (t: Thread) => void }) {
  const [t, setT] = useState<Thread | null>(null)
  const [error, setError] = useState<'missing' | 'failed' | null>(null)
  const [price, setPrice] = useState<string | null>(null)
  const last = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // keep the view at the newest message unless the reader scrolled up
  const onThreadRef = useRef(onThread)
  onThreadRef.current = onThread

  const tRef = useRef<Thread | null>(null)
  tRef.current = t
  const merge = useCallback((incoming: Message[]) => {
    const cur = tRef.current
    if (!cur || !incoming.length) return
    const have = new Set(cur.messages.map((m) => m.id))
    const add = incoming.filter((m) => !have.has(m.id))
    if (!add.length) return
    const next = { ...cur, messages: [...cur.messages, ...add].sort((a, b) => a.id - b.id) }
    last.current = next.messages[next.messages.length - 1].id
    tRef.current = next
    setT(next)
    onThreadRef.current(next)
  }, [])

  // first load (also marks it read)
  useEffect(() => {
    let live = true
    api
      .get<Thread>(`/api/messages/${id}`)
      .then((r) => {
        if (!live) return
        last.current = r.messages.length ? r.messages[r.messages.length - 1].id : 0
        setT(r)
        onThreadRef.current(r)
        refreshMessagesUnread()
        refreshUnread() // its "sent you a message" notifications are read now too
        if (r.listing)
          api.get<Listing>(`/api/market/listings/${r.listing.id}`).then(
            (l) => live && setPrice(formatPrice(l.price, l.currency)),
            () => {},
          )
      })
      .catch((e) => live && setError(e instanceof ApiError && (e.status === 404 || e.status === 422) ? 'missing' : 'failed'))
    return () => {
      live = false
    }
  }, [id])

  // new messages: every 8 s while the tab is visible, and at once when it comes back
  useEffect(() => {
    if (!t) return
    let busy = false
    const tick = async () => {
      if (busy || !visible()) return
      busy = true
      try {
        const r = await api.get<Thread>(`/api/messages/${id}`, { after: last.current })
        if (r.messages.length) {
          merge(r.messages)
          if (r.messages.some((m) => !m.mine)) refreshMessagesUnread()
        }
        setT((cur) => (cur && cur.listing?.status !== r.listing?.status ? { ...cur, listing: r.listing } : cur))
      } catch {
        /* try again on the next tick */
      }
      busy = false
    }
    const timer = window.setInterval(tick, POLL_MS)
    const onVis = () => visible() && tick()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [id, !!t]) // eslint-disable-line react-hooks/exhaustive-deps

  // scroll to the newest message (on load, and when one arrives while we're at the bottom)
  const count = t?.messages.length || 0
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [count, !!t])

  const sent = (m: Message) => {
    stick.current = true
    merge([m])
  }

  if (error)
    return (
      <div className="flex flex-1 flex-col">
        <BackBar />
        <div className="m-auto flex max-w-xs flex-col items-center gap-3 px-6 text-center">
          <p className="text-sm font-medium">{error === 'missing' ? "This conversation isn't available" : 'Could not load this conversation'}</p>
          <p className="text-sm text-muted-foreground">{error === 'missing' ? 'It may have been removed, or it belongs to someone else.' : 'Check your connection and try again.'}</p>
          {error === 'failed' && (
            <Button size="sm" variant="outline" onClick={() => location.reload()}>
              Retry
            </Button>
          )}
        </div>
      </div>
    )
  if (!t)
    return (
      <div className="flex flex-1 flex-col" aria-busy="true">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-9 w-2/5 self-start rounded-2xl" />
          <Skeleton className="h-9 w-1/2 self-end rounded-2xl" />
        </div>
      </div>
    )

  const name = t.other?.name || 'Former member'
  const closed = !!t.listing && (t.listing.status === 'sold' || t.listing.status === 'withdrawn')
  return (
    <>
      {/* who + what */}
      <div className="flex flex-col gap-3 border-b px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="icon" className="-ml-1 md:hidden" asChild>
            <a href="#/messages" aria-label="Back to all messages">
              <ArrowLeft />
            </a>
          </Button>
          {t.other ? (
            <a href={profileHref(t.other.username)} className="flex min-w-0 items-center gap-2.5 rounded-md hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              <UserAvatar name={name} seed={t.other.username} src={t.other.avatar} top={t.other.top} size={36} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-semibold">{name}</span>
                <small className="truncate text-xs text-muted-foreground">@{t.other.username}</small>
              </span>
            </a>
          ) : (
            <span className="text-sm font-semibold">{name}</span>
          )}
          <span className="ml-auto shrink-0 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">{roleText(t.role)}</span>
        </div>
        {t.listing && (
          <a href={listingHref(t.listing.id)} className="flex items-center gap-3 rounded-lg border bg-background/60 p-2 pr-3 transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <ListingThumb image={t.listing.image} size={48} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn('truncate text-sm font-semibold tracking-[-0.01em]', closed && 'text-muted-foreground')}>{t.listing.title}</span>
              <small className="truncate text-xs text-muted-foreground">{t.listing.brand}</small>
              {closed && <small className="mt-0.5 text-xs font-medium text-warning">This bottle is no longer for sale</small>}
            </span>
            {price && <span className={cn('shrink-0 font-mono text-sm font-semibold', closed && 'text-muted-foreground line-through')}>{price}</span>}
          </a>
        )}
      </div>

      {/* the conversation */}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
        aria-live="polite"
        aria-relevant="additions"
      >
        <SafetyNote force={t.messages.length === 0} />
        <Bubbles messages={t.messages} other={name} />
      </div>

      <Composer id={id} onSent={sent} closed={closed} other={t.other?.first_name || name} />
    </>
  )
}

function BackBar() {
  return (
    <div className="border-b px-3 py-2 md:hidden">
      <Button variant="ghost" size="sm" asChild>
        <a href="#/messages">
          <ArrowLeft />
          All messages
        </a>
      </Button>
    </div>
  )
}

/** Shown the first time someone opens a conversation (and in any conversation with no messages yet). */
function SafetyNote({ force }: { force: boolean }) {
  const [show, setShow] = useState(() => {
    try {
      if (localStorage.getItem(SAFETY_KEY)) return force
      localStorage.setItem(SAFETY_KEY, '1')
    } catch {
      /* storage blocked: show it */
    }
    return true
  })
  if (!show) return null
  return (
    <div className="mx-auto mb-4 flex w-full max-w-md items-start gap-2.5 rounded-lg border bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
      <p className="flex-1">
        <b className="font-medium text-foreground">Stay safe.</b> {SAFETY}
      </p>
      <button type="button" onClick={() => setShow(false)} aria-label="Dismiss" className="-mt-0.5 -mr-1 rounded p-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function Bubbles({ messages, other }: { messages: Message[]; other: string }) {
  if (!messages.length)
    return <p className="m-auto max-w-xs py-6 text-center text-sm text-muted-foreground">Say hello to {other}. Ask about the bottle, the price, or where to meet.</p>
  return (
    <ol className="mt-auto flex flex-col">
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const next = messages[i + 1]
        const newDay = !prev || new Date(prev.created_at * 1000).toDateString() !== new Date(m.created_at * 1000).toDateString()
        // consecutive messages from the same person within 5 minutes form a group; the time sits under the last one
        const joinPrev = !newDay && prev && prev.mine === m.mine && m.created_at - prev.created_at < 300
        const endsGroup = !next || next.mine !== m.mine || next.created_at - m.created_at >= 300 || new Date(next.created_at * 1000).toDateString() !== new Date(m.created_at * 1000).toDateString()
        return (
          <li key={m.id} className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start', joinPrev ? 'mt-0.5' : 'mt-3', i === 0 && 'mt-0')}>
            {newDay && (
              <span className="mb-3 self-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{dayLabel(m.created_at)}</span>
            )}
            <div
              className={cn(
                'max-w-[min(80%,34rem)] rounded-2xl px-3.5 py-2 text-[14px] leading-snug break-words whitespace-pre-wrap',
                m.mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                m.mine ? joinPrev && 'rounded-tr-md' : joinPrev && 'rounded-tl-md',
                m.mine ? !endsGroup && 'rounded-br-md' : !endsGroup && 'rounded-bl-md',
              )}
            >
              {m.body}
            </div>
            {endsGroup && (
              <time className="mt-1 px-1 text-[11px] text-muted-foreground tabular-nums" dateTime={new Date(m.created_at * 1000).toISOString()} title={new Date(m.created_at * 1000).toLocaleString()}>
                {clock(m.created_at)}
              </time>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Composer({ id, onSent, closed, other }: { id: number; onSent: (m: Message) => void; closed: boolean; other: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const len = text.trim().length
  const over = len > MAX_CHARS

  useEffect(() => {
    // focus the composer on desktop (on phones the keyboard would cover the thread)
    if (window.matchMedia('(min-width: 768px)').matches) box.current?.focus({ preventScroll: true })
  }, [id])

  const send = async () => {
    const body = text.trim()
    if (!body || busy || over) return
    setBusy(true)
    setError(null)
    try {
      const m = await api.post<Message>(`/api/messages/${id}`, { body })
      setText('')
      onSent(m)
    } catch (e) {
      setError(errorText(e, 'Could not send your message. Try again.'))
    }
    setBusy(false)
    box.current?.focus({ preventScroll: true })
  }

  return (
    <form
      className="border-t p-3 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <div className="flex items-end gap-2">
        <label htmlFor={`compose-${id}`} className="sr-only">
          Message {other}
        </label>
        <textarea
          id={`compose-${id}`}
          ref={box}
          value={text}
          onChange={(e) => (setText(e.target.value), error && setError(null))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          rows={1}
          maxLength={MAX_CHARS + 200}
          placeholder={closed ? `Message ${other} (no longer for sale)` : `Message ${other}…`}
          aria-invalid={over || !!error || undefined}
          aria-describedby={`compose-${id}-help`}
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive sm:text-sm"
        />
        <Button type="submit" size="icon" className="size-10 shrink-0 rounded-xl" disabled={!len || busy || over} aria-label="Send">
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </div>
      <div id={`compose-${id}-help`} className="mt-1.5 flex min-h-4 items-center gap-3 px-1 text-[11px] text-muted-foreground">
        {error ? (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        ) : (
          <span className="max-sm:hidden">Enter to send, Shift + Enter for a new line</span>
        )}
        {len > MAX_CHARS - 200 && (
          <span className={cn('ml-auto font-mono tabular-nums', over && 'text-destructive')}>
            {len.toLocaleString()}/{MAX_CHARS.toLocaleString()}
          </span>
        )}
      </div>
    </form>
  )
}
