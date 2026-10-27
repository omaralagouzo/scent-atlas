// Friends: answer requests and jump to a friend's shelf. Finding new people lives on Discover people (#/people).
import { UserPlus, Users } from 'lucide-react'
import type { ViewProps } from '@/App'
import { profileHref, useFriends, type Person, type Relation } from '@/lib/social'
import { authDialog, useSession } from '@/lib/store'
import { timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/avatar'
import { FriendButton } from '@/components/friend-button'
import { FriendsTop } from '@/components/friends-top'
import { EmptyState, Page, PageHeader, SectionTitle } from '@/components/page'

function PersonRow({ p, relation, onChange, meta }: { p: Person; relation: Relation; onChange: (r: Relation) => void; meta?: React.ReactNode }) {
  const name = p.name || p.username
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
      <a href={profileHref(p.username)} className="flex min-w-[12rem] flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <UserAvatar name={name} seed={p.username} src={p.avatar} top={p.top} size={44} />
        <span className="flex min-w-0 flex-col leading-tight">
          <b className="truncate font-semibold tracking-[-0.015em]">{name}</b>
          <small className="truncate text-xs text-muted-foreground">
            @{p.username}
            {meta && <> · {meta}</>}
          </small>
        </span>
      </a>
      <span className="ml-auto">
        <FriendButton username={p.username} relation={relation} onChange={onChange} />
      </span>
    </li>
  )
}

const FindPeople = ({ variant = 'outline' }: { variant?: 'outline' | 'default' }) => (
  <Button variant={variant} asChild>
    <a href="#/people">
      <UserPlus />
      Find people
    </a>
  </Button>
)

export default function FriendsView(_: ViewProps) {
  const { user, loaded } = useSession()
  const lists = useFriends()

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
      <PageHeader title="Friends" description="See your friends' shelves and what they wear." actions={<FindPeople />} />

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
          <FriendsTop key={lists.friends.length} />
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
              <EmptyState icon={<Users className="size-5" />} title="No friends yet" className="py-10" action={<FindPeople variant="default" />}>
                Find someone by name or username and send a request. Once they accept, you can see each other's shelves.
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
