// "Notes I gravitate to": the signed-in user's taste profile, shown on their own profile.
import { Search } from 'lucide-react'
import { go } from '@/lib/router'
import { NoteImg } from '@/components/media'
import { Button } from '@/components/ui/button'

export interface TasteProfileData {
  based_on: Record<'favorites' | 'owned' | 'tried' | 'wishlist' | 'rated', number>
  notes: { slug: string; name: string; image?: string; color?: string; share: number; perfumes: number }[]
  families: { name: string; color: string; share: number }[]
  pyramid_params: Record<string, string>
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export function TasteProfile({ pr }: { pr: TasteProfileData }) {
  if (!pr.notes.length)
    return (
      <p className="text-sm text-muted-foreground">
        Heart a few perfumes, mark some as owned or tried, or rate them, and the notes you favor show up here, weighted toward your strongest signals and rarer
        notes.
      </p>
    )
  const b = pr.based_on
  const bits = (
    [
      [b.favorites, 'favorite'],
      [b.owned, 'owned'],
      [b.tried, 'tried'],
      [b.wishlist, 'on wishlist'],
      [b.rated, 'rated'],
    ] as [number, string][]
  ).filter(([n]) => n)
  const top3 = pr.notes
    .slice(0, 3)
    .map((n) => n.slug)
    .join(',')
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        From{' '}
        {bits.map(([n, l], i) => (
          <span key={l}>
            {i > 0 && ' · '}
            <span className="font-mono text-foreground">{n}</span> {l}
          </span>
        ))}
        .
      </p>

      {pr.families.length > 0 && (
        <div className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={'Note families: ' + pr.families.map((f) => `${f.name} ${pct(f.share)}`).join(', ')}
            className="flex h-2 gap-0.5 overflow-hidden rounded-full"
          >
            {pr.families.map((f) => (
              <span key={f.name} title={`${f.name} ${pct(f.share)}`} style={{ flexGrow: f.share, background: f.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
            {pr.families.map((f) => (
              <span key={f.name} className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: f.color }} />
                <span className="capitalize">{f.name}</span>
                <span className="font-mono">{pct(f.share)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <ol className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
        {pr.notes.map((n, i) => (
          <li key={n.slug}>
            <a
              href={`#/note/${encodeURIComponent(n.slug)}`}
              title={`${n.name}: in ${n.perfumes} of your perfumes`}
              className="grid grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_4rem_1.5rem] items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
              <NoteImg n={n} className="size-9 rounded-full border" />
              <span className="truncate text-sm font-medium">{n.name}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <i className="block h-full rounded-full" style={{ width: `${Math.max(6, Math.round(n.share * 100))}%`, background: n.color }} />
              </span>
              <small className="text-right font-mono text-xs text-muted-foreground">{n.perfumes}</small>
            </a>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => go('/pyramid', pr.pyramid_params)}>
          <Search />
          Find perfumes like this profile
        </Button>
        <Button variant="outline" onClick={() => go('/combine', { include: top3 })}>
          Perfumes with my top 3 notes
        </Button>
      </div>
    </div>
  )
}
