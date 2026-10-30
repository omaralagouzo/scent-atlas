// New releases: one candidate card (image, identity, notes, confidence, sources, review actions) and the small
// pieces it shares with the edit sheet (confidence tones, date formatting, safe links).
import { Check, ExternalLink, ImageOff, Pencil, RotateCcw, TriangleAlert, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BottleThumb } from '@/components/media'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { when, type DiscItem, type DiscNotes, type DiscSource } from './data'
import { CONF_FIELDS, genderText, pct, releaseText, safeHref, toneOf, type Tone } from './discovery-util'

// ---- confidence -------------------------------------------------------------------------------------------------

const TONE_WORD: Record<Tone, string> = { high: 'high', mid: 'medium', low: 'low', none: 'not rated' }
const CHIP: Record<Tone, string> = {
  high: 'bg-success/10 text-success',
  mid: 'bg-warning/15 text-foreground',
  low: 'bg-destructive/10 text-destructive',
  none: 'bg-muted text-muted-foreground',
}
const BAR: Record<Tone, string> = { high: 'bg-success', mid: 'bg-warning', low: 'bg-destructive', none: 'bg-muted-foreground/40' }

export function ConfBar({ value }: { value: number }) {
  const t = toneOf(value)
  return (
    <div className="flex items-center gap-3">
      <span className="w-[72px] shrink-0 text-xs text-muted-foreground">Confidence</span>
      <div role="meter" aria-label="Overall confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', BAR[t])} style={{ width: pct(value) }} />
      </div>
      <span className="w-11 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">{pct(value)}</span>
    </div>
  )
}

export function ConfChips({ item }: { item: DiscItem }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Confidence per field">
      {CONF_FIELDS.map((f) => {
        const v = item.confidence[f.key]
        const t = toneOf(v)
        return (
          <li key={f.key} title={t === 'none' ? `${f.label}: not rated` : `${f.label}: ${pct(v!)} (${TONE_WORD[t]})`} className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs', CHIP[t])}>
            <span className="font-medium">{f.label}</span>
            <span className="font-mono tabular-nums">{t === 'none' ? '–' : pct(v!)}</span>
          </li>
        )
      })}
    </ul>
  )
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

const KIND_LABEL: Record<DiscSource['kind'], string> = { official: 'Official', retailer: 'Retailer', news: 'News', aggregator: 'Aggregator', social: 'Social' }

const NOTE_ROWS: { key: keyof DiscNotes; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Middle' },
  { key: 'base', label: 'Base' },
  { key: 'general', label: 'General' },
]

// ---- pieces ------------------------------------------------------------------------------------------------------

export function Bottle({ item, className }: { item: Pick<DiscItem, 'image' | 'missing' | 'brand' | 'name'>; className?: string }) {
  if (item.image)
    return (
      <span className={cn('grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-mat', className)}>
        <img src={item.image} alt={`${item.name} bottle`} loading="lazy" decoding="async" className="h-[90%] w-[90%] object-contain mix-blend-multiply" />
      </span>
    )
  const missing = item.missing.includes('image')
  return (
    <span className={cn('flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground', missing && 'border-warning/60 bg-warning/10', className)}>
      <ImageOff className="size-5 opacity-70" />
      <span className="text-[11px]">No image</span>
    </span>
  )
}

export function NotesPyramid({ item }: { item: DiscItem }) {
  const rows = NOTE_ROWS.filter((r) => (item.notes[r.key] || []).length > 0)
  if (!rows.length)
    return (
      <p className={cn('text-sm', item.missing.includes('notes') ? 'font-medium' : 'text-muted-foreground')}>
        {item.missing.includes('notes') && <TriangleAlert className="mr-1.5 inline size-3.5 align-[-2px] text-warning" />}
        No notes yet
      </p>
    )
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
      {rows.map((r) => (
        <div key={r.key} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-xs leading-5 text-muted-foreground">{r.label}</dt>
          <dd className="break-words">{(item.notes[r.key] || []).join(', ')}</dd>
        </div>
      ))}
    </dl>
  )
}

function Sources({ item }: { item: DiscItem }) {
  const official = safeHref(item.official_url)
  const listed = item.sources.filter((s) => safeHref(s.url))
  const extra = official && !listed.some((s) => safeHref(s.url) === official)
  if (!listed.length && !extra) return <p className="text-xs text-muted-foreground">No sources recorded.</p>
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">Sources</span>
      <ul className="flex flex-wrap gap-1.5">
        {extra && (
          <li className="max-w-full">
            <SourceLink href={official} kind="official" title="Official page" />
          </li>
        )}
        {listed.map((s) => (
          <li key={s.url} className="max-w-full">
            <SourceLink href={safeHref(s.url)!} kind={s.kind} title={s.title || hostOf(s.url)} supports={s.supports} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function SourceLink({ href, kind, title, supports }: { href: string; kind: DiscSource['kind']; title: string; supports?: string[] }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${title}\n${hostOf(href)}${supports?.length ? `\nSupports: ${supports.join(', ')}` : ''}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className={cn('shrink-0 rounded px-1 py-px text-[10px] font-medium tracking-wide uppercase', kind === 'official' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>{KIND_LABEL[kind] || kind}</span>
      <span className="min-w-0 truncate">{title}</span>
      <ExternalLink className="size-3 shrink-0 opacity-60" />
    </a>
  )
}

// ---- the card ----------------------------------------------------------------------------------------------------

export interface CardActions {
  approve: () => void
  reject: () => void
  edit: () => void
  restore: () => void
  unpublish: () => void
  notDuplicate: () => void
  rejectDuplicate: () => void
}

export function CandidateCard({ item, selected, onSelect, busy, act }: { item: DiscItem; selected?: boolean; onSelect?: (on: boolean) => void; busy: boolean; act: CardActions }) {
  const rel = releaseText(item.release_date)
  const showMissing = item.missing.length > 0 && item.state !== 'rejected' && item.state !== 'published'
  const dup = item.duplicate_of
  const relMissing = item.missing.includes('release_date')
  const genderMissing = item.missing.includes('gender')
  return (
    <article className="cand-card rounded-xl border bg-card p-4 sm:p-5" aria-label={`${item.name} by ${item.brand}`}>
      <div className="relative [grid-area:img]">
        <Bottle item={item} />
        {onSelect && (
          <label className="absolute top-1 left-1 grid size-8 cursor-pointer place-items-center rounded-md border bg-background/90 shadow-xs backdrop-blur">
            <Checkbox checked={!!selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Select ${item.brand} ${item.name}`} />
          </label>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 [grid-area:head]">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.state === 'published' && (item.live ? <Badge className="bg-success/10 text-success">Live</Badge> : <Badge className="bg-warning/15 text-foreground">Going live…</Badge>)}
          {item.state === 'approved' && <Badge className="bg-success/10 text-success">Approved</Badge>}
          {item.state === 'duplicate' && <Badge className="bg-warning/15 text-foreground">Possible duplicate</Badge>}
          {item.concentration && <Badge variant="outline">{item.concentration}</Badge>}
          {genderText(item.gender) ? <Badge variant="secondary">{genderText(item.gender)}</Badge> : genderMissing ? <Badge className="bg-warning/15 text-foreground">Gender missing</Badge> : null}
          {item.release_status && <Badge variant="outline" className="text-muted-foreground">{item.release_status === 'announced' ? 'Announced' : 'Released'}</Badge>}
        </div>
        <h2 className="text-[17px] leading-snug font-semibold tracking-[-0.01em] break-words">{item.name}</h2>
        <p className="-mt-1 text-sm text-muted-foreground">{item.brand}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-3 [grid-area:body]">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] text-muted-foreground">Release</dt>
            <dd className={cn(relMissing && 'font-medium')}>
              {rel ? <span className="font-mono tabular-nums">{rel}</span> : relMissing ? <><TriangleAlert className="mr-1 inline size-3.5 align-[-2px] text-warning" />Date missing</> : <span className="text-muted-foreground">–</span>}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[11px] text-muted-foreground">Perfumers</dt>
            <dd className="break-words">{item.perfumers.length ? item.perfumers.join(', ') : <span className="text-muted-foreground">–</span>}</dd>
          </div>
          {item.family && (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[11px] text-muted-foreground">Family</dt>
              <dd className="break-words">{item.family}</dd>
            </div>
          )}
        </dl>

        <NotesPyramid item={item} />

        <div className="flex flex-col gap-2.5 rounded-lg bg-muted/40 p-3">
          <ConfBar value={item.overall} />
          <ConfChips item={item} />
        </div>

        {showMissing && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="min-w-0">
              <span className="font-medium">Missing: </span>
              {item.missing.map((m) => m.replace('_', ' ')).join(', ')}
            </span>
          </p>
        )}
        {item.comment && (
          <p className="rounded-lg border bg-background px-3 py-2 text-sm break-words">
            <span className="font-medium">Note: </span>
            {item.comment}
          </p>
        )}
        {item.state === 'rejected' && item.review_note && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm break-words">
            <span className="font-medium text-destructive">Rejected: </span>
            {item.review_note}
          </p>
        )}

        {dup && (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3">
            <p className="text-xs font-medium">Looks like a perfume already in the catalogue</p>
            <div className="flex items-center gap-3">
              {dup.image ? <BottleThumb p={{ id: dup.id, image: dup.image, name: dup.name }} size={52} /> : <span className="grid size-[52px] shrink-0 place-items-center rounded-lg border border-dashed text-muted-foreground"><ImageOff className="size-4" /></span>}
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-medium">{dup.name || `Catalogue perfume #${dup.id}`}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[dup.brand, dup.year, genderText(dup.gender)].filter(Boolean).join(' · ')}
                  <span className="font-mono"> · #{dup.id}</span>
                </span>
              </span>
            </div>
          </div>
        )}

        <Sources item={item} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
          <div className="flex flex-wrap gap-2">
            {(item.state === 'complete' || item.state === 'incomplete') && (
              <>
                <Button size="sm" disabled={busy} onClick={act.approve}>
                  <Check />
                  Approve
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={act.reject}>
                  <X />
                  Reject
                </Button>
              </>
            )}
            {item.state === 'duplicate' && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={act.notDuplicate}>
                  <Undo2 />
                  Not a duplicate
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={act.rejectDuplicate}>
                  <X />
                  Reject as duplicate
                </Button>
              </>
            )}
            {item.state === 'approved' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={act.reject}>
                <X />
                Reject
              </Button>
            )}
            {item.state === 'rejected' && (
              <Button size="sm" disabled={busy} onClick={act.restore}>
                <RotateCcw />
                Restore
              </Button>
            )}
            {item.state === 'published' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={act.unpublish}>
                <Undo2 />
                Unpublish
              </Button>
            )}
            {item.state !== 'published' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={act.edit}>
                <Pencil />
                Edit
              </Button>
            )}
          </div>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground" title={`Found ${when(item.created_at)}${item.attempts ? ` · completed ${item.attempts}×` : ''}`}>
            #{item.id} · {when(item.created_at)}
          </span>
        </div>
      </div>
    </article>
  )
}
