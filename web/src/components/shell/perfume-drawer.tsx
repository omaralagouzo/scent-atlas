// Perfume detail drawer: opened by the `p` URL param on top of any view.
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Layers, Lock, Search, Star, Triangle } from 'lucide-react'
import { api, errorText } from '@/lib/api'
import { cacheNotes, history, mine, requireAuth, useSession } from '@/lib/store'
import { closeDrawer, go, useLocation } from '@/lib/router'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { AccordBars, RatingBadge } from '@/components/accords'
import { HeartButton, StatusButton } from '@/components/actions'
import { BrandLink, DupeSections, TagBadges, confLabel } from '@/components/brandtags'
import { BottleImg } from '@/components/media'
import { PyramidDiagram } from '@/components/notes'
import { Segmented } from '@/components/segmented'

export function PerfumeDrawer() {
  const { drawer } = useLocation()
  const [shown, setShown] = useState<string | null>(drawer)
  const [p, setP] = useState<any>(null)
  const [failed, setFailed] = useState(false)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!drawer) return
    setShown(drawer)
    setP(null)
    setFailed(false)
    let live = true
    api
      .get(`/api/perfumes/${encodeURIComponent(drawer)}`)
      .then((r) => {
        if (!live) return
        for (const k of ['top', 'middle', 'base', 'general']) cacheNotes(r.pyramid[k])
        setP(r)
        body.current?.scrollTo(0, 0)
        history.record({ kind: 'view', perfume_id: r.id })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [drawer])

  return (
    <Sheet open={!!drawer} onOpenChange={(o) => !o && closeDrawer()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[640px]" aria-describedby={undefined}>
        <div ref={body} className="h-full overflow-y-auto overscroll-contain">
          {p && String(p.id) === String(shown) ? (
            <Detail p={p} />
          ) : failed ? (
            <div className="p-8">
              <SheetTitle className="sr-only">Perfume</SheetTitle>
              <p className="text-sm text-muted-foreground">Could not load this fragrance.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-6">
              <SheetTitle className="sr-only">Loading</SheetTitle>
              <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Detail({ p }: { p: any }) {
  const pyrParams: Record<string, string> = {}
  for (const [k, qk] of [
    ['top', 'top'],
    ['middle', 'middle'],
    ['base', 'base'],
    ['general', 'any'],
  ]) {
    const slugs = (p.pyramid[k] || []).map((n: any) => n.slug)
    if (slugs.length) pyrParams[qk] = slugs.join(',')
  }
  const gender = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : null
  const meta = [p.year, gender, p.country].filter(Boolean)
  return (
    <article className="flex flex-col">
      <div className="flex flex-col gap-5 border-b p-5 pt-12 sm:flex-row sm:p-6 sm:pt-6">
        <div className="relative mx-auto grid aspect-square w-full max-w-60 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white ring-1 ring-border sm:mx-0 sm:w-52 sm:max-w-none dark:bg-sand-100">
          <BottleImg p={p} className="h-[86%] w-[86%] mix-blend-multiply" />
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:pr-8">
          <div className="text-sm text-muted-foreground">
            <BrandLink name={p.brand} className="font-medium text-foreground" />
          </div>
          <BrandStrip p={p} />
          <SheetTitle className="font-serif text-[34px] leading-[1.02] font-normal tracking-[-0.01em]">{p.name}</SheetTitle>
          <SheetDescription className="text-sm">{meta.join(' · ')}</SheetDescription>
          <div className="flex items-center gap-2 text-sm">
            <RatingBadge p={p} className="text-sm" />
            {p.rating_count ? <span className="text-muted-foreground">{plural(p.rating_count, 'vote')}</span> : null}
          </div>
          {p.perfumers?.length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">{p.perfumers.length > 1 ? 'Perfumers ' : 'Perfumer '}</span>
              {p.perfumers.join(', ')}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1">
            <StatusButton pid={p.id} className="size-9 border" />
            <HeartButton id={p.id} label="Add to favorites" className="size-9 border" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b px-5 py-4 sm:px-6">
        <Button onClick={() => go(`/like/${p.id}`)}>
          <Search />
          Find similar
        </Button>
        <Button variant="outline" onClick={() => go(`/layering/${p.id}`)} title="What to layer this fragrance with">
          <Layers />
          Layering
        </Button>
        <Button variant="outline" onClick={() => go('/pyramid', pyrParams)} title="Load this pyramid into the builder">
          <Triangle />
          Edit as pyramid
        </Button>
        <Button variant="ghost" asChild>
          <a href={p.link} target="_blank" rel="noopener noreferrer" title={p.link_is_exact ? 'Open on Fragrantica' : 'Search on Fragrantica'}>
            {p.link_is_exact ? 'Fragrantica' : 'Search Fragrantica'}
            <ExternalLink />
          </a>
        </Button>
      </div>

      <div className="flex flex-col gap-8 p-5 sm:p-6">
        <DupeSections key={p.id} p={p} />
        <PersonalPanel key={`me${p.id}`} pid={p.id} />
        {p.accords.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-semibold">Main accords</h3>
            <AccordBars accords={p.accords} />
          </section>
        )}
        <section
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a[href^="#/note/"]')
            if (a) {
              e.preventDefault()
              go(a.getAttribute('href')!.slice(1))
            }
          }}
        >
          <h3 className="mb-3 text-sm font-semibold">Fragrance pyramid</h3>
          <PyramidDiagram pyr={p.pyramid} />
        </section>
      </div>
    </article>
  )
}

function BrandStrip({ p }: { p: any }) {
  const i = p.brand_info
  if (!i) return null
  const meta = [i.origin_country, i.parent_company ? `part of ${i.parent_company}` : null].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <TagBadges p={{ brand: p.brand, brand_tags: p.brand_tags, brand_tags_inferred: i.inferred }} mode="full" link />
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
      {i.notes && (
        <p className="text-xs leading-snug text-muted-foreground">
          {i.notes}
          {i.confidence ? ` (${confLabel(i.confidence).toLowerCase()} confidence${i.inferred ? ', inferred' : ''})` : ''}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- "my notes": status, rating, private note
function PersonalPanel({ pid }: { pid: number }) {
  const { user } = useSession()
  const [cur, setCur] = useState<any>(null)
  const [flash, setFlash] = useState('')
  const [note, setNote] = useState('')
  const last = useRef('')

  useEffect(() => {
    if (!user) return
    let live = true
    api.get(`/api/me/perfumes/${pid}`).then((r) => {
      if (!live) return
      setCur(r)
      setNote(r.note || '')
      last.current = r.note || ''
    }, () => live && setCur({ error: true }))
    return () => {
      live = false
    }
  }, [user, pid])

  const say = (m: string) => {
    setFlash(m)
    setTimeout(() => setFlash((f) => (f === m ? '' : f)), 1600)
  }
  const put = async (fields: any) => {
    try {
      const r = await mine.save(pid, fields)
      if (r) {
        setCur(r)
        say('Saved')
      }
      return r
    } catch (e) {
      say(errorText(e, 'Could not save'))
      return null
    }
  }

  if (!user)
    return (
      <section className="flex items-center gap-4 rounded-xl border border-dashed p-4">
        <Lock className="size-5 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-sm text-muted-foreground">Sign in to mark this owned, tried or on your wishlist, rate it and keep a private note.</p>
        <Button size="sm" variant="outline" onClick={() => requireAuth('Sign in to keep your own collection.')}>
          Sign in
        </Button>
      </section>
    )
  if (!cur)
    return (
      <section className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
      </section>
    )
  if (cur.error) return <p className="text-sm text-muted-foreground">Could not load your notes.</p>
  return (
    <section aria-label="My notes on this fragrance" className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">My notes</h3>
        <small className="text-xs text-muted-foreground">Only you can see this.</small>
        <span role="status" aria-live="polite" className="ml-auto text-xs font-medium text-success">
          {flash}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Personal status"
          value={cur.status || ''}
          onChange={(v) => put({ status: v || null })}
          options={[
            { value: '', label: 'None' },
            { value: 'owned', label: 'Owned' },
            { value: 'tried', label: 'Tried' },
            { value: 'wishlist', label: 'Wishlist' },
          ]}
          className="bg-card"
        />
        <div role="group" aria-label="My rating" className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={cur.rating >= n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              title={cur.rating === n ? 'Click again to clear' : `${n} / 5`}
              onClick={() => put({ rating: cur.rating === n ? null : n })}
              className="grid size-8 place-items-center rounded-md hover:bg-card"
            >
              <Star className={cn('size-5 transition-transform', cur.rating >= n ? 'fill-gold text-gold' : 'text-sand-300')} />
            </button>
          ))}
        </div>
      </div>
      <Textarea
        rows={3}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={async () => {
          if (note.trim() !== last.current.trim()) {
            const r = await put({ note: note.trim() || null })
            if (r) last.current = note
          }
        }}
        placeholder="A private note: when you wear it, what it reminds you of…"
        aria-label="Private note"
        className="bg-card"
      />
    </section>
  )
}
