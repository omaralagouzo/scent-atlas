// Discover people: the member directory, searchable by name or username, with a friend button on every card.
import { useEffect, useState } from 'react'
import { Search, Users } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { sync } from '@/lib/router'
import { plural } from '@/lib/format'
import { profileHref, refreshFriends, type Person, type Relation } from '@/lib/social'
import { authDialog, useSession } from '@/lib/store'
import { useInfinite } from '@/hooks/use-infinite'
import { UserAvatar } from '@/components/avatar'
import { FriendButton } from '@/components/friend-button'
import { EmptyState, ListStatus, Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE = 30
const TITLE = 'Discover people'
const BLURB = 'Everyone on Scent Atlas. Find friends and family by name or username.'

const joinedText = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null)

export function PersonCard({ p, onRelation }: { p: Person; onRelation: (r: Relation) => void }) {
  const name = p.name || p.username
  const joined = joinedText(p.created_at)
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
      <a href={profileHref(p.username)} className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <UserAvatar name={name} seed={p.username} src={p.avatar} size={56} />
        <span className="flex min-w-0 flex-col leading-tight">
          <b className="truncate text-[15px] font-semibold tracking-[-0.015em]">{name}</b>
          <span className="truncate text-sm text-muted-foreground">@{p.username}</span>
        </span>
      </a>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <small className="text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{(p.owned ?? 0).toLocaleString()}</span> {p.owned === 1 ? 'bottle' : 'bottles'}
          {joined && <> · Joined {joined}</>}
        </small>
        <FriendButton username={p.username} relation={p.relation || 'none'} onChange={onRelation} quiet />
      </div>
    </li>
  )
}

export default function PeopleView({ params }: ViewProps) {
  const { user, loaded } = useSession()
  const [input, setInput] = useState(params.get('q') || '')
  const [q, setQ] = useState(input.trim())
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 220)
    return () => clearTimeout(t)
  }, [input])
  useEffect(() => sync('/people', { q }), [q])

  const list = useInfinite<Person>(
    async (page, signal) => {
      const r = await api.get<{ people: Person[]; total: number; next_offset: number | null }>('/api/people', { q, offset: (page - 1) * PAGE, limit: PAGE }, signal)
      if (page === 1) setTotal(r.total)
      return { items: r.people, hasMore: r.next_offset != null }
    },
    [q, user?.id],
    { enabled: !!user },
  )

  const relate = (username: string, r: Relation) => {
    list.setItems((xs) => xs.map((x) => (x.username === username ? { ...x, relation: r } : x)))
    refreshFriends()
  }

  if (!loaded)
    return (
      <Page>
        <PageHeader title={TITLE} description={BLURB} />
        <Skeleton className="h-12 w-full max-w-xl" />
      </Page>
    )

  if (!user)
    return (
      <Page>
        <PageHeader title={TITLE} description={BLURB} />
        <EmptyState
          icon={<Users className="size-5" />}
          title="Sign in to meet other collectors"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => authDialog.open({ mode: 'signup' })}>Create a free account</Button>
              <Button variant="outline" onClick={() => authDialog.open({ mode: 'login' })}>
                Sign in
              </Button>
            </div>
          }
        >
          The member directory is only visible to people with an account. Add friends to see each other's shelves.
        </EmptyState>
      </Page>
    )

  const searching = !!q
  return (
    <Page>
      <PageHeader title={TITLE} description={BLURB} />
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <input
            data-search=""
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search by name or username…"
            aria-label="Search people by name or username"
            autoComplete="off"
            className="h-12 w-full rounded-lg border border-input bg-card pr-3 pl-10 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {total == null ? ' ' : searching ? `${plural(total, 'match', 'matches')} for “${q}”` : plural(total, 'member')}
        </p>
      </div>

      {list.firstLoad && list.loading ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] rounded-xl" />
          ))}
        </ul>
      ) : (
        list.items.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.items.map((p) => (
              <PersonCard key={p.username} p={p} onRelation={(r) => relate(p.username, r)} />
            ))}
          </ul>
        )
      )}
      <ListStatus {...list} loading={list.loading && !list.firstLoad} emptyText={searching ? 'No one matches that name or username.' : 'No other members yet.'} />
    </Page>
  )
}
