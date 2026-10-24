// My Atlas: the signed-in user's profile page: taste profile, collection, favorites, saved searches and history.
import { useEffect, useState } from 'react'
import { Bookmark, Heart, History, Save, Star, Trophy, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { authDialog, cacheNotes, useSession } from '@/lib/store'
import { go } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { Note, Perfume, Status } from '@/lib/types'
import { HistoryList, type HistoryItem } from '@/components/atlas/history-list'
import { TasteProfile, type TasteProfileData } from '@/components/atlas/taste-profile'
import { NoteTile } from '@/components/notes'
import { EmptyState, Page, SectionTitle } from '@/components/page'
import { PerfumeCard, PerfumeGrid } from '@/components/perfume'
import { SavedRow } from '@/components/saved'
import { Segmented } from '@/components/segmented'
import { UserAvatar } from '@/components/shell/account-menu'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type MyPerfume = Perfume & { my?: { status: Status | null; rating: number | null; note: string | null } }
interface AtlasData {
  user: { username: string; created_at?: number }
  favorites: { perfumes: Perfume[]; notes: Note[] }
  collection: Record<Status, MyPerfume[]>
  rated_only: MyPerfume[]
  saved: any[]
  history: HistoryItem[]
  profile: TasteProfileData
}

const STATUS_TABS: [Status, string][] = [
  ['owned', 'Owned'],
  ['tried', 'Tried'],
  ['wishlist', 'Wishlist'],
]
type CollKey = Status | 'rated'
type Tab = 'collection' | 'favorites' | 'saved' | 'history'

function MyExtra({ it }: { it: MyPerfume }) {
  const m = it.my || ({} as NonNullable<MyPerfume['my']>)
  if (!m.rating && !m.note) return null
  return (
    <div className="flex flex-col gap-1 border-t border-dashed pt-1.5">
      {!!m.rating && (
        <span className="inline-flex gap-0.5 text-foreground" title={`My rating: ${m.rating} / 5`} aria-label={`My rating ${m.rating} of 5`}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} className={cn('size-3', i <= m.rating! ? 'fill-current' : 'text-muted-foreground/40')} />
          ))}
        </span>
      )}
      {m.note && <p className="line-clamp-2 text-xs text-muted-foreground italic">{m.note}</p>}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}

function Stat({ n, label, onClick }: { n: number; label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-start rounded-md px-1 text-left transition-opacity hover:opacity-70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      <span className="font-mono text-lg leading-tight font-semibold">{n.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </button>
  )
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-xs text-muted-foreground">{n}</span>
}

export default function AtlasView(_: ViewProps) {
  const { user, loaded } = useSession()
  const [data, setData] = useState<AtlasData | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('collection')
  const [coll, setColl] = useState<CollKey | null>(null)

  const uid = user?.id
  useEffect(() => {
    setData(null)
    setFailed(false)
    if (!uid) return
    let dead = false
    api.get('/api/me/atlas').then(
      (r: AtlasData) => {
        if (dead) return
        cacheNotes([...r.favorites.notes, ...r.profile.notes])
        setData(r)
        setColl((STATUS_TABS.find(([k]) => r.collection[k].length) || STATUS_TABS[0])[0])
      },
      () => !dead && setFailed(true),
    )
    return () => {
      dead = true
    }
  }, [uid])

  const header = (
    <div className="mb-6">
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[32px]">My Atlas</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">Your favorites, shelf, saved searches and history in one place.</p>
    </div>
  )

  if (!loaded)
    return (
      <Page>
        <Skeleton className="h-40 w-full rounded-2xl" />
      </Page>
    )

  if (!user)
    return (
      <Page>
        {header}
        <EmptyState
          icon={<UserRound className="size-5" />}
          title="Sign in to see your atlas"
          action={
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button onClick={() => authDialog.open({ mode: 'login' })}>Sign in</Button>
              <Button variant="outline" onClick={() => authDialog.open({ mode: 'signup' })}>
                Create an account
              </Button>
            </div>
          }
        >
          Browsing and searching work without an account. Sign in to keep favorites, a collection, saved searches and history.
        </EmptyState>
      </Page>
    )

  if (failed)
    return (
      <Page>
        {header}
        <p className="py-10 text-center text-sm text-muted-foreground">Could not load your atlas.</p>
      </Page>
    )

  if (!data)
    return (
      <Page>
        <div className="flex items-center gap-4 rounded-2xl border bg-card p-5">
          <Skeleton className="size-[72px] rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </Page>
    )

  const lists: Record<CollKey, MyPerfume[]> = { ...data.collection, rated: data.rated_only }
  const collCount = STATUS_TABS.reduce((s, [k]) => s + lists[k].length, 0)
  const favCount = data.favorites.perfumes.length + data.favorites.notes.length
  const k = coll || 'owned'
  const items = lists[k] || []
  const joined = data.user.created_at ? new Date(data.user.created_at * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null

  const deleteSaved = async (it: any) => {
    try {
      await api.del(`/api/me/saved/${it.id}`)
      setData((d) => d && { ...d, saved: d.saved.filter((x) => x.id !== it.id) })
    } catch {
      toast('Could not delete.')
    }
  }

  return (
    <Page>
      {/* ---------------------------------------------------------------- profile header */}
      <header className="mb-8 flex flex-col gap-5 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <UserAvatar name={user.username} size={72} />
          <div className="min-w-0">
            <div className="mb-0.5 font-mono text-[11px] tracking-[.08em] text-muted-foreground uppercase">My Atlas</div>
            <h1 className="truncate text-2xl leading-tight font-semibold tracking-[-0.03em] sm:text-[28px]">{user.username}</h1>
            <p className="text-sm text-muted-foreground">
              @{user.username}
              {joined && <> · Joined {joined}</>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 sm:justify-end">
          <Stat n={data.collection.owned.length} label="Owned" onClick={() => (setTab('collection'), setColl('owned'))} />
          <Stat n={data.collection.tried.length} label="Tried" onClick={() => (setTab('collection'), setColl('tried'))} />
          <Stat n={data.collection.wishlist.length} label="Wishlist" onClick={() => (setTab('collection'), setColl('wishlist'))} />
          <Stat n={favCount} label="Favorites" onClick={() => setTab('favorites')} />
          <Stat n={data.saved.length} label="Saved" onClick={() => setTab('saved')} />
        </div>
      </header>

      {/* ---------------------------------------------------------------- notes I gravitate to */}
      <section className="mb-10">
        <SectionTitle>Notes I gravitate to</SectionTitle>
        <TasteProfile pr={data.profile} />
      </section>

      {/* ---------------------------------------------------------------- tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-5">
        <div className="-mx-4 overflow-x-auto border-b px-4 scrollbar-none sm:mx-0 sm:px-0">
          <TabsList variant="line" className="h-10 gap-4">
            <TabsTrigger value="collection" className="flex-none px-0.5">
              <Bookmark />
              Collection <Count n={collCount + data.rated_only.length} />
            </TabsTrigger>
            <TabsTrigger value="favorites" className="flex-none px-0.5">
              <Heart />
              Favorites <Count n={favCount} />
            </TabsTrigger>
            <TabsTrigger value="saved" className="flex-none px-0.5">
              <Save />
              Saved searches <Count n={data.saved.length} />
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-none px-0.5">
              <History />
              History <Count n={data.history.length} />
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="collection" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented<CollKey>
              label="Collection"
              value={k}
              onChange={setColl}
              options={[
                ...STATUS_TABS.map(([v, l]) => ({ value: v, label: <>{l} <Count n={lists[v].length} /></> })),
                { value: 'rated' as const, label: <>Rated only <Count n={lists.rated.length} /></> },
              ]}
            />
            <Button asChild size="sm" variant="outline">
              <a href="#/collection">
                <Trophy />
                Leaderboard & scent profile
              </a>
            </Button>
          </div>
          {items.length ? (
            <PerfumeGrid>
              {items.map((it) => (
                <PerfumeCard key={it.id} p={it} extra={<MyExtra it={it} />} />
              ))}
            </PerfumeGrid>
          ) : (
            <Muted>{k === 'rated' ? 'Perfumes you rated without marking a status appear here.' : 'Nothing here yet. Use the bookmark on any perfume card to add it.'}</Muted>
          )}
        </TabsContent>

        <TabsContent value="favorites" className="flex flex-col gap-8">
          <section>
            <SectionTitle>
              Favorite perfumes <Count n={data.favorites.perfumes.length} />
            </SectionTitle>
            {data.favorites.perfumes.length ? (
              <PerfumeGrid>
                {data.favorites.perfumes.map((p) => (
                  <PerfumeCard key={p.id} p={p} />
                ))}
              </PerfumeGrid>
            ) : (
              <Muted>No favorite perfumes yet. Tap the heart on any card.</Muted>
            )}
          </section>
          <section>
            <SectionTitle>
              Favorite notes <Count n={data.favorites.notes.length} />
            </SectionTitle>
            {data.favorites.notes.length ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {data.favorites.notes.map((n) => (
                  <NoteTile key={n.slug} n={n} />
                ))}
              </div>
            ) : (
              <Muted>No favorite notes yet. Open a note page and tap its heart.</Muted>
            )}
          </section>
        </TabsContent>

        <TabsContent value="saved" className="flex flex-col gap-2">
          {data.saved.length ? (
            data.saved.map((it) => <SavedRow key={it.id} it={it} onOpen={() => go(it.kind === 'combine' ? '/combine' : '/pyramid', it.state)} onDelete={() => deleteSaved(it)} />)
          ) : (
            <Muted>Nothing saved yet. Use Save on the Combine or Pyramid pages to keep a search.</Muted>
          )}
        </TabsContent>

        <TabsContent value="history">
          <HistoryList items={data.history} onChange={(h) => setData((d) => d && { ...d, history: h })} />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
