// The friends page leaderboard: what you and your friends own and like most (owned / liked / combined; top 3, 5 or 10).
import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { api } from '@/lib/api'
import { perfumeHref } from '@/lib/router'
import { profileHref } from '@/lib/social'
import type { Accord, TopBottle } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MiniAccords } from '@/components/accords'
import { UserAvatar } from '@/components/avatar'
import { BottleThumb } from '@/components/media'
import { EmptyState, SectionTitle } from '@/components/page'
import { Segmented } from '@/components/segmented'
import { medal } from '@/components/collection/podium'

type Board = 'owned' | 'liked' | 'combined'
type Did = 'owned' | 'tried' | 'wishlist' | 'favorite' | 'loved'
interface Who {
  username: string
  name: string
  avatar: string | null
  top?: TopBottle | null
  me: boolean
  did: Did[]
  place: number | null
}
interface Entry {
  perfume: { id: number; name: string; brand: string; image: string; accords: Accord[]; year?: number | null }
  score: number
  owners: number
  likers: number
  people: Who[]
}
interface Data {
  circle: number
  friends: number
  owned: Entry[]
  liked: Entry[]
  combined: Entry[]
}

const BOARDS: { value: Board; label: string }[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'liked', label: 'Liked' },
  { value: 'combined', label: 'Combined' },
]
const HINT: Record<Board, string> = {
  owned: 'On the most shelves in your circle.',
  liked: 'Hearted, wishlisted or rated 4 stars or more by the most people.',
  combined: 'Points: owning 3 (+2 if it is in their top 3), a heart 2, a wishlist or a 4+ rating 1.',
}
const DID: Record<Did, string> = { owned: 'owns it', favorite: 'hearted it', wishlist: 'wants it', loved: 'rated it 4+', tried: 'tried it' }

/** "You, Karim and 2 more own it" / "Lina likes it" */
function sentence(people: Who[], [one, many]: [string, string]) {
  const names = people.map((p) => (p.me ? 'You' : p.name.split(' ')[0]))
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0]
  return `${list} ${names.length > 1 || people[0]?.me ? many : one}`
}

function Faces({ people }: { people: Who[] }) {
  const shown = people.slice(0, 4)
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p) => (
        <Tooltip key={p.username}>
          <TooltipTrigger asChild>
            <a href={profileHref(p.username)} className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              <UserAvatar name={p.name} seed={p.username} src={p.avatar} size={28} className="ring-2 ring-card" />
            </a>
          </TooltipTrigger>
          <TooltipContent>
            {p.me ? 'You' : p.name}: {p.did.filter((d) => d !== 'tried' || p.did.length === 1).map((d) => (d === 'owned' && p.place ? `owns it (#${p.place})` : DID[d])).join(', ')}
          </TooltipContent>
        </Tooltip>
      ))}
      {people.length > shown.length && (
        <span className="grid size-7 place-items-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground ring-2 ring-card">+{people.length - shown.length}</span>
      )}
    </span>
  )
}

function Row({ e, place, board }: { e: Entry; place: number; board: Board }) {
  const verb: [string, string] | null = board === 'owned' ? ['owns it', 'own it'] : board === 'liked' ? ['likes it', 'like it'] : null
  return (
    <li className="flex items-center gap-3 border-b px-3 py-3 last:border-b-0 sm:gap-4 sm:px-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border bg-card font-mono text-sm font-semibold" style={medal(place)}>
        {place}
      </span>
      <a href={perfumeHref(e.perfume.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:gap-4">
        <BottleThumb p={e.perfume} size={56} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="truncate font-semibold tracking-[-0.015em]">{e.perfume.name}</b>
          <small className="truncate text-xs text-muted-foreground">{e.perfume.brand}</small>
          <small className="truncate text-xs text-muted-foreground">
            {verb ? sentence(e.people, verb) : e.people.length === 1 ? (e.people[0].me ? 'Just you so far' : `${e.people[0].name.split(' ')[0]} so far`) : `${e.people.length} people in your circle`}
          </small>
          <MiniAccords accords={e.perfume.accords} className="mt-1 hidden w-32 sm:flex" />
        </span>
      </a>
      <span className="hidden sm:block">
        <Faces people={e.people} />
      </span>
      <span className="flex w-12 shrink-0 flex-col items-end leading-tight">
        <b className="font-mono text-lg font-semibold">{e.score}</b>
        <small className="text-[11px] text-muted-foreground">{board === 'combined' ? (e.score === 1 ? 'point' : 'points') : e.score === 1 ? 'person' : 'people'}</small>
      </span>
    </li>
  )
}

export function FriendsTop() {
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)
  const [board, setBoard] = useState<Board>('combined')
  const [n, setN] = useState<3 | 5 | 10>(3)
  useEffect(() => {
    api.get<Data>('/api/friends/top', { limit: 10 }).then(setData, () => setFailed(true))
  }, [])

  if (failed) return null
  if (!data)
    return (
      <section className="flex flex-col gap-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </section>
    )
  if (!data.friends) return null // the page's own empty state already says how to add friends
  const list = data[board].slice(0, n)
  return (
    <section aria-label="What your circle loves" className="flex flex-col gap-4">
      <SectionTitle className="mb-0">
        What your circle loves
        <span className="ml-2 text-sm font-normal text-muted-foreground">you and {data.friends === 1 ? 'your friend' : `your ${data.friends} friends`}</span>
      </SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Board> label="Leaderboard" value={board} onChange={setBoard} options={BOARDS} size="sm" />
        <Segmented<string>
          label="How many"
          value={String(n)}
          onChange={(v) => setN(Number(v) as 3 | 5 | 10)}
          options={[3, 5, 10].map((k) => ({ value: String(k), label: `Top ${k}` }))}
          size="sm"
        />
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{HINT[board]}</p>
      {list.length ? (
        <ol className={cn('overflow-hidden rounded-xl border bg-card')}>
          {list.map((e, k) => (
            <Row key={e.perfume.id} e={e} place={k + 1} board={board} />
          ))}
        </ol>
      ) : (
        <EmptyState icon={<Trophy className="size-5" />} title="Nothing here yet" className="py-10">
          {board === 'owned' ? 'Once you or your friends add bottles to a collection, the most-owned show up here.' : 'Hearts, wishlists and 4-star ratings from your circle show up here.'}
        </EmptyState>
      )}
      {list.length > 0 && list.length < n && <p className="text-xs text-muted-foreground">That's everything so far.</p>}
    </section>
  )
}
