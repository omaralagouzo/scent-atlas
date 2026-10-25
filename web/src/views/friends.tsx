// Friends: find people, answer requests, and jump to a friend's shelf.
import { useEffect, useState } from 'react'
import { Search, Users } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { profileHref, useFriends, type Person, type Relation } from '@/lib/social'
import { authDialog, useSession } from '@/lib/store'
import { timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FriendButton } from '@/components/friend-button'
import { EmptyState, Page, PageHeader, SectionTitle } from '@/components/page'
import { UserAvatar } from '@/components/shell/account-menu'

function PersonRow({ p, relation, onChange, meta }: { p: Person; relation: Relation; onChange: (r: Relation) => void; meta?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <a href={profileHref(p.username)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <UserAvatar name={p.username} size={40} />
        <span className="flex min-w-0 flex-col leading-tight">
          <b className="truncate font-semibold">@{p.username}</b>
          {meta && <small className="text-xs text-muted-foreground">{meta}</small>}
        </span>
      </a>
      <FriendButton username={p.username} relation={relation} onChange={onChange} />
    </li>
  )
}

export default function FriendsView({ params }: ViewProps) {
  const { user, loaded } = useSession()
  const lists = useFriends()
  const [q, setQ] = useState(params.get('q') || '')
  const [found, setFound] = useState<Person[] | null>(null)

  useEffect(() => {
    const query = q.trim()
    if (!user || !query) {
      setFound(null)
      return
    }
    const t = setTimeout(async () => {
      try {
        setFound((await api.get('/api/users/search', { q: query })).users)
      } catch {
        setFound([])
      }
    }, 180)
    return () => clearTimeout(t)
  }, [q, user])

  const relate = (username: string, r: Relation) => setFound((xs) => (xs ? xs.map((x) => (x.username === username ? { ...x, relation: r } : x)) : xs))

  if (loaded && !user)
    return (
      <Page>
        <PageHeader title="Friends" description="See your friends' shelves and what they wear." />
        <EmptyState
          icon={<Users className="size-5" />}
          title="Add friends, see their shelves"
          action={
            <div className="flex gap-2">
              <Button onClick={() => authDialog.open({ mode: 'signup' })}>Create a free account</Button>
              <Button variant="outline" onClick={() => authDialog.open({ mode: 'login' })}>
                Sign in
              </Button>
            </div>
          }
        >
          Friends can see each other's collection, shelf, favourites and wishlist. Private notes always stay private.
        </EmptyState>
      </Page>
    )

  return (
    <Page>
      <PageHeader title="Friends" description="See your friends' shelves and what they wear." />
      <div className="relative mb-8 max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <input
          data-search=""
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find people by username…"
          aria-label="Find people by username"
          autoComplete="off"
          className="h-12 w-full rounded-lg border border-input bg-card pr-3 pl-10 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      {found && (
        <section className="mb-10">
          <SectionTitle>People</SectionTitle>
          {found.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {found.map((p) => (
                <PersonRow key={p.username} p={p} relation={p.relation || 'none'} onChange={(r) => relate(p.username, r)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No one by that name yet.</p>
          )}
        </section>
      )}

      {!lists ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {lists.incoming.length > 0 && (
            <section>
              <SectionTitle>
                Requests <span className="ml-1 font-mono text-sm text-muted-foreground">{lists.incoming.length}</span>
              </SectionTitle>
              <ul className="grid gap-2 sm:grid-cols-2">
                {lists.incoming.map((p) => (
                  <PersonRow key={p.username} p={p} relation="incoming" onChange={() => {}} meta={p.since ? `asked ${timeAgo(p.since) === 'just now' ? 'just now' : `${timeAgo(p.since)} ago`}` : undefined} />
                ))}
              </ul>
            </section>
          )}
          <section>
            <SectionTitle>
              Your friends <span className="ml-1 font-mono text-sm text-muted-foreground">{lists.friends.length}</span>
            </SectionTitle>
            {lists.friends.length ? (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {lists.friends.map((p) => (
                  <PersonRow key={p.username} p={p} relation="friends" onChange={() => {}} meta={p.since ? `friends since ${new Date(p.since * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : undefined} />
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Users className="size-5" />} title="No friends yet" className="py-10">
                Search for someone's username above and send a request. Once they accept, you can see each other's shelves.
              </EmptyState>
            )}
          </section>
          {lists.outgoing.length > 0 && (
            <section>
              <SectionTitle>Sent requests</SectionTitle>
              <ul className="grid gap-2 sm:grid-cols-2">
                {lists.outgoing.map((p) => (
                  <PersonRow key={p.username} p={p} relation="outgoing" onChange={() => {}} meta="waiting for a reply" />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Page>
  )
}
