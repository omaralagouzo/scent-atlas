// Someone's profile: their shelf, leaderboard, wishlist and favourites (friends and the owner only).
import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api, ApiError } from '@/lib/api'
import { refreshFriends, type Relation } from '@/lib/social'
import { authDialog, useSession } from '@/lib/store'
import { cacheNotes } from '@/lib/store'
import type { Note, Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FriendButton } from '@/components/friend-button'
import { NoteChip } from '@/components/notes'
import { EmptyState, Page } from '@/components/page'
import { PerfumeCard, PerfumeGrid } from '@/components/perfume'
import { RankRow, type Item } from '@/components/collection/podium'
import { Shelf, ShelfProgress } from '@/components/shelf/shelf'
import { UserAvatar } from '@/components/shell/account-menu'

interface Profile {
  username: string
  created_at: number
  relation: Relation
  visible: boolean
  counts: { owned: number; friends: number; tried?: number; wishlist?: number; favorites?: number }
  collection?: { items: Item[]; order: number[]; profile: any }
  tried?: Perfume[]
  wishlist?: Perfume[]
  favorites?: { perfumes: Perfume[]; notes: Note[] }
}

function Count({ n, label }: { n?: number; label: string }) {
  if (n == null) return null
  return (
    <span className="flex flex-col leading-tight">
      <b className="font-mono text-xl font-semibold">{n.toLocaleString()}</b>
      <small className="text-xs text-muted-foreground">{label}</small>
    </span>
  )
}

export default function ProfileView({ args }: ViewProps) {
  const username = args.username
  const { user, loaded } = useSession()
  const [p, setP] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    api.get<Profile>(`/api/users/${encodeURIComponent(username)}`).then(
      (r) => {
        setP(r)
        setError(null)
        cacheNotes(r.favorites?.notes)
      },
      (e) => setError(e instanceof ApiError && e.status === 404 ? 'No one goes by that name.' : e instanceof ApiError && e.status === 401 ? 'signin' : 'Could not load this profile.'),
    )
  useEffect(() => {
    if (loaded) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, loaded, user?.id])

  if (error === 'signin' || (loaded && !user))
    return (
      <Page>
        <EmptyState icon={<Lock className="size-5" />} title={`Sign in to see @${username}`} action={<Button onClick={() => authDialog.open({ mode: 'login' })}>Sign in</Button>}>
          Profiles are only visible to people with an account.
        </EmptyState>
      </Page>
    )
  if (error)
    return (
      <Page>
        <EmptyState title={error} />
      </Page>
    )
  if (!p)
    return (
      <Page>
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="mt-8 h-72 w-full rounded-2xl" />
      </Page>
    )

  const items = p.collection?.items || []
  const ranked = items.filter((it) => it.rank)
  const joined = new Date(p.created_at * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const onRelation = (r: Relation) => {
    setP({ ...p, relation: r })
    refreshFriends()
    if (r === 'friends' || p.visible) load()
  }

  return (
    <Page wide>
      <header className="mb-8 flex flex-wrap items-center gap-5">
        <UserAvatar name={p.username} size={76} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[32px]">@{p.username}</h1>
          <p className="text-sm text-muted-foreground">Joined {joined}</p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Count n={p.counts.owned} label="on the shelf" />
          <Count n={p.counts.friends} label={p.counts.friends === 1 ? 'friend' : 'friends'} />
          {p.visible && <Count n={p.counts.wishlist} label="wishlist" />}
          {p.relation === 'self' ? (
            <Button variant="outline" asChild>
              <a href="#/collection">Edit my collection</a>
            </Button>
          ) : (
            <FriendButton username={p.username} relation={p.relation} onChange={onRelation} size="default" />
          )}
        </div>
      </header>

      {!p.visible ? (
        <EmptyState icon={<Lock className="size-5" />} title={p.relation === 'outgoing' ? `Waiting for @${p.username} to accept` : `Add @${p.username} as a friend to see their shelf`}>
          Friends can see each other's collection, shelf, favourites and wishlist. Private notes always stay private.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-10">
          <section aria-label={`@${p.username}'s shelf`}>
            <ShelfProgress count={items.length} className="mb-4" />
            <Shelf items={items} empty={p.relation === 'self' ? 'Your shelf is empty.' : `@${p.username}'s shelf is empty.`} />
          </section>
          <Tabs defaultValue="ranked">
            <TabsList>
              <TabsTrigger value="ranked">Leaderboard</TabsTrigger>
              <TabsTrigger value="wishlist">Wishlist</TabsTrigger>
              <TabsTrigger value="tried">Tried</TabsTrigger>
              <TabsTrigger value="favorites">Favorites</TabsTrigger>
            </TabsList>
            <TabsContent value="ranked" className="pt-4">
              {ranked.length ? (
                <ol className="overflow-hidden rounded-xl border bg-card">
                  {ranked.map((it, k) => (
                    <RankRow key={it.id} it={it} place={k + 1} />
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No ranking yet.</p>
              )}
            </TabsContent>
            <TabsContent value="wishlist" className="pt-4">
              {p.wishlist?.length ? (
                <PerfumeGrid>
                  {p.wishlist.map((x) => (
                    <PerfumeCard key={x.id} p={x} />
                  ))}
                </PerfumeGrid>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing on the wishlist.</p>
              )}
            </TabsContent>
            <TabsContent value="tried" className="pt-4">
              {p.tried?.length ? (
                <PerfumeGrid>
                  {p.tried.map((x) => (
                    <PerfumeCard key={x.id} p={x} />
                  ))}
                </PerfumeGrid>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing marked as tried.</p>
              )}
            </TabsContent>
            <TabsContent value="favorites" className="flex flex-col gap-6 pt-4">
              {p.favorites?.notes.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {p.favorites.notes.map((n) => (
                    <a key={n.slug} href={`#/note/${encodeURIComponent(n.slug)}`}>
                      <NoteChip n={n} draggable={false} />
                    </a>
                  ))}
                </div>
              ) : null}
              {p.favorites?.perfumes.length ? (
                <PerfumeGrid>
                  {p.favorites.perfumes.map((x) => (
                    <PerfumeCard key={x.id} p={x} />
                  ))}
                </PerfumeGrid>
              ) : (
                !p.favorites?.notes.length && <p className="text-sm text-muted-foreground">No favorites yet.</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Page>
  )
}
