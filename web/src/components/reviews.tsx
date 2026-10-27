// "What people are saying": members' review summary, my own review (write / edit / delete), the review list and
// how many members own / want / have tried a perfume (with my friends' faces).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquareText, Pencil, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { requireAuth, useMine, useSession } from '@/lib/store'
import { profileHref } from '@/lib/social'
import { plural, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserAvatar } from './avatar'

// ---------------------------------------------------------------- data
export interface ReviewStats {
  count: number
  written: number
  average: number | null
  /** reviews with 1, 2, 3, 4 and 5 stars */
  distribution: number[]
  longevity: number | null
  sillage: number | null
}
export interface ReviewFields {
  rating: number
  longevity: number | null
  sillage: number | null
  body: string | null
  created_at: number
  updated_at: number
}
export interface Review extends ReviewFields {
  author: { username: string; name: string; first_name?: string; last_name?: string; avatar?: string | null }
  mine: boolean
  friend: boolean
}
type MemberStatus = 'owned' | 'tried' | 'wishlist'
export interface Community {
  stats: ReviewStats
  members: Record<MemberStatus, number>
  reviews: Review[]
  next_offset: number | null
  mine: ReviewFields | null
  friends: { username: string; name: string; avatar?: string | null; status: MemberStatus }[]
}

const PER = 20

/** The community block of one perfume, reloaded when the visitor signs in or out. */
export function useCommunity(pid: number) {
  const { user } = useSession()
  const [data, setData] = useState<Community | null>(null)
  const [failed, setFailed] = useState(false)
  const [more, setMore] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    setFailed(false)
    try {
      const r = await api.get<Community>(`/api/perfumes/${pid}/community`, { offset: 0, limit: PER })
      if (n === seq.current) setData(r)
    } catch {
      if (n === seq.current) setFailed(true)
    }
  }, [pid])

  useEffect(() => {
    load()
  }, [load, user?.id])

  const loadMore = async () => {
    if (!data || data.next_offset == null) return
    const n = seq.current
    setMore(true)
    try {
      const r = await api.get<Community>(`/api/perfumes/${pid}/community`, { offset: data.next_offset, limit: PER })
      if (n === seq.current) setData((d) => d && { ...d, reviews: [...d.reviews, ...r.reviews], next_offset: r.next_offset })
    } catch {
      toast.error('Could not load more reviews.')
    }
    setMore(false)
  }
  return { data, failed, reload: load, loadMore, loadingMore: more }
}
export type CommunityState = ReturnType<typeof useCommunity>

// ---------------------------------------------------------------- scales
export const LONGEVITY = ['Fleeting', 'Weak', 'Moderate', 'Long-lasting', 'Eternal']
export const SILLAGE = ['Intimate', 'Soft', 'Moderate', 'Strong', 'Enormous']
const scaleWord = (words: string[], v: number) => words[Math.min(5, Math.max(1, Math.round(v))) - 1]

/** Five stars filled to `value` (fractions allowed). */
export function Stars({ value, size = 16, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0', className)} role="img" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const f = Math.max(0, Math.min(1, value - i))
        return (
          <span key={i} className="relative" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-sand-300 dark:text-sand-300/40" style={{ width: size, height: size }} />
            {f > 0 && (
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${f * 100}%` }}>
                <Star className="fill-gold text-gold" style={{ width: size, height: size }} />
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

/** A labelled 1-5 meter (average longevity / sillage). */
function Meter({ label, value, words }: { label: string; value: number | null; words: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-medium">{label}</span>
        {value != null ? (
          <span className="text-muted-foreground">
            {scaleWord(words, value)} <span className="font-mono text-xs">{value.toFixed(1)}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">no votes yet</span>
        )}
      </div>
      <div className="flex gap-1" role="meter" aria-label={label} aria-valuemin={1} aria-valuemax={5} aria-valuenow={value ?? undefined} aria-valuetext={value != null ? `${scaleWord(words, value)}, ${value.toFixed(1)} of 5` : 'No votes yet'}>
        {[0, 1, 2, 3, 4].map((i) => {
          const f = value == null ? 0 : Math.max(0, Math.min(1, value - i))
          return (
            <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${f * 100}%` }} />
            </span>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{words[0]}</span>
        <span>{words[4]}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- summary
function Summary({ s }: { s: ReviewStats }) {
  const max = Math.max(1, ...s.distribution)
  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <span className="font-mono text-[40px] leading-none font-semibold tracking-[-0.03em]">{s.average != null ? s.average.toFixed(1) : '—'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <Stars value={s.average || 0} size={18} />
          <span className="text-[13px] text-muted-foreground">{s.count ? `from ${plural(s.count, 'member review')}` : 'No member reviews yet'}</span>
        </div>
      </div>
      <ol className="flex flex-col gap-1.5" aria-label="How members rated it">
        {[5, 4, 3, 2, 1].map((k) => {
          const n = s.distribution[k - 1] || 0
          return (
            <li key={k} className="grid grid-cols-[1.75rem_1fr_2rem] items-center gap-2 text-xs" aria-label={`${k} stars: ${n}`}>
              <span className="flex items-center gap-0.5 font-mono text-muted-foreground">
                {k}
                <Star className="size-3 fill-current" />
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-gold transition-[width] duration-200" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-muted-foreground">{n}</span>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-col gap-4 border-t pt-4">
        <Meter label="Longevity" value={s.longevity} words={LONGEVITY} />
        <Meter label="Sillage" value={s.sillage} words={SILLAGE} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- members strip
const STATUS_WORDS: Record<MemberStatus, { count: string; friends: string }> = {
  owned: { count: 'own it', friends: 'Friends who own it' },
  wishlist: { count: 'want it', friends: 'Friends who want it' },
  tried: { count: 'have tried it', friends: 'Friends who tried it' },
}
const MEMBER_ORDER: MemberStatus[] = ['owned', 'wishlist', 'tried']

function Members({ c }: { c: Community }) {
  const total = MEMBER_ORDER.reduce((s, k) => s + (c.members[k] || 0), 0)
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">On members' shelves</h3>
      {total ? (
        <dl className="grid grid-cols-3 gap-2">
          {MEMBER_ORDER.map((k) => (
            <div key={k} className="flex flex-col">
              <dt className="order-2 text-xs text-muted-foreground">{STATUS_WORDS[k].count}</dt>
              <dd className="font-mono text-xl font-semibold">{(c.members[k] || 0).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-muted-foreground">No member has this on their shelf yet.</p>
      )}
      {MEMBER_ORDER.map((k) => {
        const ppl = c.friends.filter((f) => f.status === k)
        if (!ppl.length) return null
        return (
          <div key={k} className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{STATUS_WORDS[k].friends}</span>
            <div className="flex flex-wrap items-center gap-1">
              {ppl.slice(0, 12).map((f) => (
                <Tooltip key={f.username}>
                  <TooltipTrigger asChild>
                    <a href={profileHref(f.username)} aria-label={f.name} className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
                      <UserAvatar name={f.name} seed={f.username} src={f.avatar} size={30} className="ring-2 ring-card" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>{f.name}</TooltipContent>
                </Tooltip>
              ))}
              {ppl.length > 12 && <span className="pl-1 font-mono text-xs text-muted-foreground">+{ppl.length - 12}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- composer
function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div role="radiogroup" aria-label="Your rating (required)" className="flex items-center" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          className="grid size-9 place-items-center rounded-md transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Star className={cn('size-6 transition-transform duration-150', shown >= n ? 'fill-gold text-gold' : 'text-sand-300 dark:text-sand-300/50', hover === n && 'scale-110')} />
        </button>
      ))}
      <span className="ml-2 font-mono text-sm text-muted-foreground">{shown ? `${shown}/5` : ''}</span>
    </div>
  )
}

function ScaleInput({ label, words, value, onChange }: { label: string; words: string[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      <div className="grid grid-cols-5 gap-1 rounded-lg bg-muted p-[3px]">
        {words.map((w, i) => {
          const v = i + 1
          const on = value === v
          return (
            <button
              key={w}
              type="button"
              aria-pressed={on}
              title={on ? 'Click again to clear' : `${w} (${v}/5)`}
              onClick={() => onChange(on ? null : v)}
              className={cn(
                'flex min-w-0 flex-col items-center gap-0.5 rounded-md px-0.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                on && 'bg-card text-foreground shadow-sm',
              )}
            >
              <span className="font-mono text-[11px] leading-none">{v}</span>
              <span className="w-full truncate text-center text-[11px] leading-tight sm:text-xs">{w}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

const MAX = 2000

function Composer({ pid, name, initial, onSaved, onCancel }: { pid: number; name: string; initial: ReviewFields | null; onSaved: (r: ReviewFields | null, s: ReviewStats) => void; onCancel?: () => void }) {
  const { user } = useSession()
  const privateRating = useMine(pid)?.rating || 0
  const [rating, setRating] = useState(initial?.rating || privateRating)
  const [longevity, setLongevity] = useState<number | null>(initial?.longevity ?? null)
  const [sillage, setSillage] = useState<number | null>(initial?.sillage ?? null)
  const [body, setBody] = useState(initial?.body || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rating) {
      setErr('Pick a star rating first.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const r = await api.put<{ review: ReviewFields; stats: ReviewStats }>(`/api/me/reviews/${pid}`, { rating, longevity, sillage, body: body.trim() || null })
      toast.success(initial ? 'Review updated' : 'Review posted')
      onSaved(r.review, r.stats)
    } catch (e2) {
      setErr(errorText(e2, 'Could not save your review.'))
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5" aria-label={initial ? 'Edit your review' : 'Write a review'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{initial ? 'Edit your review' : `What do you think of ${name}?`}</h3>
      </div>
      <StarInput value={rating} onChange={(n) => (setRating(n), setErr(''))} />
      <div className="grid gap-4 sm:grid-cols-2">
        <ScaleInput label="Longevity" words={LONGEVITY} value={longevity} onChange={setLongevity} />
        <ScaleInput label="Sillage" words={SILLAGE} value={sillage} onChange={setSillage} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Textarea
          rows={4}
          maxLength={MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="How does it open, how does it dry down, when do you wear it? (optional)"
          aria-label="Review text"
          className="min-h-24 bg-background"
        />
        <div className="flex justify-end">
          <span className={cn('font-mono text-[11px] text-muted-foreground', body.length > MAX - 100 && 'text-warning')}>
            {body.length.toLocaleString()}/{MAX.toLocaleString()}
          </span>
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
        <UserAvatar name={user?.name || '?'} seed={user?.username} src={user?.avatar} size={20} />
        <span>
          Reviews are public: yours shows your name, <b className="font-medium text-foreground">{user?.name}</b> (@{user?.username}), and your profile photo.
        </span>
      </p>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {initial ? 'Save changes' : 'Post review'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- one review
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-5 items-center rounded-full border px-2 text-[11px] whitespace-nowrap text-muted-foreground">{children}</span>
}

function ReviewMeta({ r }: { r: ReviewFields }) {
  if (!r.longevity && !r.sillage) return null
  return (
    <div className="flex flex-wrap gap-1">
      {r.longevity ? <Chip>Longevity: {LONGEVITY[r.longevity - 1]}</Chip> : null}
      {r.sillage ? <Chip>Sillage: {SILLAGE[r.sillage - 1]}</Chip> : null}
    </div>
  )
}

const ago = (ts: number) => {
  const t = timeAgo(ts)
  return /^\d+[mhd]$/.test(t) ? `${t} ago` : t
}
const when = (r: ReviewFields) => (
  <time dateTime={new Date(r.updated_at * 1000).toISOString()} title={new Date(r.updated_at * 1000).toLocaleString()} className="text-xs text-muted-foreground">
    {ago(r.updated_at)}
    {r.updated_at - r.created_at > 60 ? ' · edited' : ''}
  </time>
)

function ReviewItem({ r }: { r: Review }) {
  const a = r.author
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <a href={profileHref(a.username)} aria-hidden="true" tabIndex={-1} className="shrink-0">
        <UserAvatar name={a.name} seed={a.username} src={a.avatar} size={36} />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <a href={profileHref(a.username)} className="text-sm font-semibold hover:underline hover:underline-offset-2">
            {a.name}
          </a>
          <a href={profileHref(a.username)} className="text-xs text-muted-foreground hover:text-foreground">
            @{a.username}
          </a>
          {r.friend && <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] font-medium text-foreground">Friend</span>}
          <span className="ml-auto">{when(r)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Stars value={r.rating} size={14} />
          <ReviewMeta r={r} />
        </div>
        {r.body && <p className="text-[14px] leading-relaxed break-words whitespace-pre-line">{r.body}</p>}
      </div>
    </li>
  )
}

function MyReview({ r, onEdit, onDelete }: { r: ReviewFields; onEdit: () => void; onDelete: () => Promise<void> }) {
  const { user } = useSession()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <section aria-label="Your review" className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <UserAvatar name={user?.name || '?'} seed={user?.username} src={user?.avatar} size={28} />
        <h3 className="text-sm font-semibold">Your review</h3>
        <span className="text-xs text-muted-foreground">public</span>
        <span className="ml-auto">{when(r)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={r.rating} size={16} />
        <ReviewMeta r={r} />
      </div>
      {r.body ? <p className="text-[14px] leading-relaxed break-words whitespace-pre-line">{r.body}</p> : <p className="text-[13px] text-muted-foreground">No written review, just your stars.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil />
          Edit
        </Button>
        {confirm ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onDelete()
                setBusy(false)
                setConfirm(false)
              }}
            >
              {busy && <Loader2 className="animate-spin" />}
              Delete review
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
              Keep it
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            <Trash2 />
            Delete
          </Button>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- the section
export function ReviewsSection({ pid, name, community }: { pid: number; name: string; community: CommunityState }) {
  const { user } = useSession()
  const { data: c, failed, reload, loadMore, loadingMore } = community
  const [editing, setEditing] = useState(false)

  useEffect(() => setEditing(false), [user?.id])

  if (failed && !c)
    return (
      <p className="text-sm text-muted-foreground">
        Could not load reviews.{' '}
        <Button size="sm" variant="outline" onClick={reload}>
          Retry
        </Button>
      </p>
    )
  if (!c)
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </div>
    )

  const saved = async () => {
    setEditing(false)
    await reload()
  }
  const remove = async () => {
    try {
      await api.del(`/api/me/reviews/${pid}`)
      toast.success('Review deleted')
      await reload()
    } catch (e) {
      toast.error(errorText(e, 'Could not delete your review.'))
    }
  }
  const others = c.reviews.filter((r) => !r.mine)

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Summary s={c.stats} />
        <Members c={c} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {!user ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4">
            <MessageSquareText className="size-5 shrink-0 text-muted-foreground" />
            <p className="min-w-48 flex-1 text-sm text-muted-foreground">Worn {name}? Sign in to rate it and tell other members what you think.</p>
            <Button size="sm" variant="outline" onClick={() => requireAuth('Sign in to write a review.')}>
              Sign in to review
            </Button>
          </div>
        ) : c.mine && !editing ? (
          <MyReview r={c.mine} onEdit={() => setEditing(true)} onDelete={remove} />
        ) : (
          <Composer key={c.mine ? `e${c.mine.updated_at}` : 'new'} pid={pid} name={name} initial={c.mine} onSaved={saved} onCancel={c.mine ? () => setEditing(false) : undefined} />
        )}

        {others.length ? (
          <div className="rounded-xl border bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Member reviews</h3>
              <span className="font-mono text-xs text-muted-foreground">{c.stats.count - (c.mine ? 1 : 0)}</span>
            </div>
            <ul className="flex flex-col divide-y">
              {others.map((r) => (
                <ReviewItem key={r.author.username} r={r} />
              ))}
            </ul>
            {c.next_offset != null && (
              <Button variant="outline" size="sm" className="mt-4 w-full sm:w-auto" disabled={loadingMore} onClick={loadMore}>
                {loadingMore && <Loader2 className="animate-spin" />}
                Load more reviews
              </Button>
            )}
          </div>
        ) : (
          <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
            {c.mine ? `No one else has reviewed ${name} yet.` : `No reviews of ${name} yet. Be the first to say what you think.`}
          </p>
        )}
      </div>
    </div>
  )
}
