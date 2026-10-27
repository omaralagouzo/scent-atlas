// Someone's profile: photo, name and counts for every member; their podium, ranking, display wall, wishlist, tried
// and favourites for friends and the owner. On my own profile it also holds what used to be "My Atlas": my taste
// profile, saved searches and history (only I can see those).
import { useEffect, useState } from 'react'
import { History, Lock, Pencil, Save, Sparkles } from 'lucide-react'
import type { ViewProps } from '@/App'
import { api, ApiError } from '@/lib/api'
import { sync } from '@/lib/router'
import { refreshFriends, type Relation } from '@/lib/social'
import { authDialog, cacheNotes, useSession } from '@/lib/store'
import { plural } from '@/lib/format'
import type { Note, Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserAvatar } from '@/components/avatar'
import { FriendButton } from '@/components/friend-button'
import { NoteChip } from '@/components/notes'
import { EmptyState, Page } from '@/components/page'
import { PerfumeCard, PerfumeGrid } from '@/components/perfume'
import { openProfileEditor } from '@/components/profile-editor'
import { Segmented, type SegOption } from '@/components/segmented'
import { Podium, RankRow, type Item } from '@/components/collection/podium'
import { Shelf, ShelfProgress } from '@/components/shelf/shelf'
import { HistoryList } from '@/components/atlas/history-list'
import { SavedSearches } from '@/components/atlas/saved-searches'
import { TasteProfile } from '@/components/atlas/taste-profile'
import { useAtlas } from '@/components/atlas/use-atlas'

interface Profile {
  username: string
  name?: string
  first_name?: string
  last_name?: string
  avatar?: string | null
  created_at: number
  relation: Relation
  visible: boolean
  counts: { owned: number; friends: number; reviews?: number; tried?: number; wishlist?: number; favorites?: number }
  collection?: { items: Item[]; order: number[]; profile: any }
  tried?: Perfume[]
  wishlist?: Perfume[]
  favorites?: { perfumes: Perfume[]; notes: Note[] }
}

type View = 'top3' | 'top5' | 'top10' | 'all' | 'wall'
const VIEWS: SegOption<View>[] = [
  { value: 'top3', label: 'Top 3' },
  { value: 'top5', label: 'Top 5' },
  { value: 'top10', label: 'Top 10' },
  { value: 'all', label: 'Full ranking' },
  { value: 'wall', label: 'Display wall' },
]
const VIEW_N: Partial<Record<View, number>> = { top3: 3, top5: 5, top10: 10 }
const isView = (v: string | null): v is View => VIEWS.some((o) => o.value === v)

type Tab = 'wishlist' | 'tried' | 'favorites' | 'taste' | 'saved' | 'history'
const PRIVATE: Tab[] = ['taste', 'saved', 'history']
const TABS: Tab[] = ['wishlist', 'tried', 'favorites', ...PRIVATE]
const isTab = (v: string | null): v is Tab => TABS.includes(v as Tab)

function Count({ n, label }: { n?: number; label: string }) {
  if (n == null) return null
  return (
    <span className="flex flex-col leading-tight">
      <b className="font-mono text-xl font-semibold">{n.toLocaleString()}</b>
      <small className="text-xs text-muted-foreground">{label}</small>
    </span>
  )
}

const Num = ({ n }: { n?: number }) => (n == null ? null : <span className="font-mono text-xs text-muted-foreground">{n}</span>)

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}

function OnlyYou() {
  return (
    <p className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock className="size-3.5" />
      Only you can see this.
    </p>
  )
}

function RankList({ items, start = 1 }: { items: Item[]; start?: number | null }) {
  return (
    <ol className="overflow-hidden rounded-xl border bg-card">
      {items.map((it, k) => (
        <RankRow key={it.id} it={it} place={start == null ? null : start + k} />
      ))}
    </ol>
  )
}

/** The front of the profile: podium, top 5 / 10, the full ranking or the display wall. */
function Front({ p, view, setView }: { p: Profile; view: View; setView: (v: View) => void }) {
  const self = p.relation === 'self'
  const who = self ? 'You' : (p.first_name || p.name || `@${p.username}`)
  const items = p.collection?.items || []
  const ranked = items.filter((it) => it.rank)
  const unranked = items.filter((it) => !it.rank)

  if (view === 'wall')
    return (
      <>
        <ShelfProgress count={items.length} className="mb-4" />
        <Shelf items={items} empty={self ? 'Your shelf is empty.' : `${who}'s shelf is empty.`} />
      </>
    )

  if (!items.length)
    return (
      <EmptyState title={self ? 'Your shelf is empty' : `${who} has no bottles on the shelf yet`} action={self ? <Button asChild><a href="#/collection">Add bottles</a></Button> : undefined}>
        {self ? 'Add the perfumes you own, then rank them to build your podium.' : 'Once they add perfumes they own, their podium and display wall show up here.'}
      </EmptyState>
    )

  if (!ranked.length && view !== 'all')
    return (
      <EmptyState
        title="No ranking yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {self && (
              <Button asChild>
                <a href="#/collection">Rank my bottles</a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setView('wall')}>
              See the display wall
            </Button>
          </div>
        }
      >
        {self ? `You own ${plural(items.length, 'bottle')} but haven't ranked them yet.` : `${who} owns ${plural(items.length, 'bottle')} but hasn't ranked them yet.`}
      </EmptyState>
    )

  const n = VIEW_N[view]
  const shown = n ? ranked.slice(0, n) : ranked
  const short = n && ranked.length < n
  return (
    <div className="flex flex-col gap-4">
      {view === 'top3' ? <Podium top={shown} label={self ? 'Your top 3' : `${who}'s top 3`} className="mb-0" /> : shown.length > 0 && <RankList items={shown} />}
      {short ? (
        <p className="text-sm text-muted-foreground">
          {ranked.length === 1 ? 'Only one bottle is ranked so far.' : `Only ${ranked.length} bottles are ranked so far.`}
          {unranked.length > 0 && (
            <>
              {' '}
              <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setView('all')}>
                See all {plural(items.length, 'bottle')}
              </button>
            </>
          )}
        </p>
      ) : n && ranked.length > n ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setView('all')}>
            Full ranking <span className="font-mono text-xs text-muted-foreground">{ranked.length}</span>
          </Button>
        </div>
      ) : null}
      {view === 'all' && unranked.length > 0 && (
        <section className="mt-2">
          <h3 className="mb-2 text-sm font-semibold">
            Not ranked yet <Num n={unranked.length} />
          </h3>
          <RankList items={unranked} start={null} />
        </section>
      )}
    </div>
  )
}

export default function ProfileView({ args, params, path }: ViewProps) {
  const username = args.username
  const { user, loaded } = useSession()
  const [p, setP] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setViewState] = useState<View>(() => {
    const v = params.get('view')
    return isView(v) ? v : 'top3'
  })
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get('tab')
    return isTab(t) ? t : 'wishlist'
  })
  const self = p?.relation === 'self'
  const atlas = useAtlas(!!self)

  // my own profile reloads after I change my name or photo
  const mine = user && user.username.toLowerCase() === username.toLowerCase() ? `${user.name}|${user.avatar}` : ''
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
    if (loaded && user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, loaded, user?.id, mine])

  const activeTab: Tab = self || !PRIVATE.includes(tab) ? tab : 'wishlist'
  const ready = !!p
  useEffect(() => {
    if (ready) sync(path, { view: view === 'top3' ? '' : view, tab: activeTab === 'wishlist' ? '' : activeTab })
  }, [ready, path, view, activeTab])
  const setView = (v: View) => setViewState(v)

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
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="mt-8 h-72 w-full rounded-2xl" />
      </Page>
    )

  const name = p.name || p.username
  const who = self ? 'You' : p.first_name || name
  const joined = new Date(p.created_at * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const onRelation = (r: Relation) => {
    setP({ ...p, relation: r })
    refreshFriends()
    if (r === 'friends' || p.visible) load()
  }
  const favCount = (p.favorites?.perfumes.length || 0) + (p.favorites?.notes.length || 0)

  return (
    <Page>
      <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
          <UserAvatar name={name} seed={p.username} src={p.avatar} size={84} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] break-words sm:text-[32px]">{name}</h1>
            <p className="text-[15px] text-muted-foreground">@{p.username}</p>
            <p className="text-xs text-muted-foreground">Joined {joined}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="flex items-center gap-6">
            <Count n={p.counts.owned} label="on the shelf" />
            <Count n={p.counts.friends} label={p.counts.friends === 1 ? 'friend' : 'friends'} />
            {p.visible && <Count n={p.counts.wishlist} label="wishlist" />}
            <Count n={p.counts.reviews} label={p.counts.reviews === 1 ? 'review' : 'reviews'} />
          </div>
          {self ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={openProfileEditor}>
                <Pencil />
                Edit profile
              </Button>
              <Button variant="outline" asChild>
                <a href="#/collection">Edit my collection</a>
              </Button>
            </div>
          ) : (
            <FriendButton username={p.username} relation={p.relation} onChange={onRelation} size="default" />
          )}
        </div>
      </header>

      {!p.visible ? (
        <EmptyState icon={<Lock className="size-5" />} title={p.relation === 'outgoing' ? `Waiting for ${who} to accept` : p.relation === 'incoming' ? `${who} wants to be friends. Accept to see their shelf` : `Add ${who} as a friend to see their shelf`}>
          Friends can see each other's collection, shelf, favourites and wishlist. Private notes always stay private.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-10">
          <section aria-label={self ? 'My collection' : `${name}'s collection`} className="flex flex-col gap-5">
            <Segmented<View> label="Show" value={view} onChange={setView} options={VIEWS} size="sm" className="sm:hidden" />
            <Segmented<View> label="Show" value={view} onChange={setView} options={VIEWS} className="hidden self-start sm:inline-flex" />
            <Front p={p} view={view} setView={setView} />
          </section>

          <Tabs value={activeTab} onValueChange={(v) => setTab(v as Tab)} className="gap-5">
            <div className="-mx-4 overflow-x-auto border-b px-4 scrollbar-none sm:mx-0 sm:px-0">
              <TabsList variant="line" className="h-10 gap-4">
                <TabsTrigger value="wishlist" className="flex-none px-0.5">
                  Wishlist <Num n={p.wishlist?.length} />
                </TabsTrigger>
                <TabsTrigger value="tried" className="flex-none px-0.5">
                  Tried <Num n={p.tried?.length} />
                </TabsTrigger>
                <TabsTrigger value="favorites" className="flex-none px-0.5">
                  Favorites <Num n={favCount} />
                </TabsTrigger>
                {self && (
                  <>
                    <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
                    <TabsTrigger value="taste" className="flex-none px-0.5" title="Only you can see this">
                      <Sparkles />
                      Taste profile
                    </TabsTrigger>
                    <TabsTrigger value="saved" className="flex-none px-0.5" title="Only you can see this">
                      <Save />
                      Saved searches <Num n={atlas.data?.saved.length} />
                    </TabsTrigger>
                    <TabsTrigger value="history" className="flex-none px-0.5" title="Only you can see this">
                      <History />
                      History <Num n={atlas.data?.history.length} />
                    </TabsTrigger>
                  </>
                )}
              </TabsList>
            </div>

            <TabsContent value="wishlist">
              {p.wishlist?.length ? (
                <PerfumeGrid>
                  {p.wishlist.map((x) => (
                    <PerfumeCard key={x.id} p={x} />
                  ))}
                </PerfumeGrid>
              ) : (
                <Muted>Nothing on the wishlist.</Muted>
              )}
            </TabsContent>
            <TabsContent value="tried">
              {p.tried?.length ? (
                <PerfumeGrid>
                  {p.tried.map((x) => (
                    <PerfumeCard key={x.id} p={x} />
                  ))}
                </PerfumeGrid>
              ) : (
                <Muted>Nothing marked as tried.</Muted>
              )}
            </TabsContent>
            <TabsContent value="favorites" className="flex flex-col gap-6">
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
                !p.favorites?.notes.length && <Muted>No favorites yet.</Muted>
              )}
            </TabsContent>

            {self &&
              PRIVATE.map((t) => (
                <TabsContent key={t} value={t}>
                  <OnlyYou />
                  {atlas.failed ? (
                    <Muted>Could not load this. Try again in a moment.</Muted>
                  ) : !atlas.data ? (
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ) : t === 'taste' ? (
                    <section>
                      <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">Notes I gravitate to</h2>
                      <TasteProfile pr={atlas.data.profile} />
                    </section>
                  ) : t === 'saved' ? (
                    <SavedSearches items={atlas.data.saved} onChange={(saved) => atlas.setData((d) => d && { ...d, saved })} />
                  ) : (
                    <HistoryList items={atlas.data.history} onChange={(history) => atlas.setData((d) => d && { ...d, history })} />
                  )}
                </TabsContent>
              ))}
          </Tabs>
        </div>
      )}
    </Page>
  )
}
