// New releases: one compact, expandable candidate row (thumbnail, identity, note colour dots, confidence pill, actions
// menu; expanded: full details and sources) and the small pieces it shares with the edit sheet.
import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Ellipsis, ExternalLink, ImageOff, Pencil, RotateCcw, TriangleAlert, Undo2, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BottleThumb } from '@/components/media'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { when, type DiscItem, type DiscNotes, type DiscSource, type DiscState, type NoteMeta } from './data'
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

export function Bottle({ item, className, compact }: { item: Pick<DiscItem, 'image' | 'missing' | 'brand' | 'name'>; className?: string; compact?: boolean }) {
  if (item.image)
    return (
      <span className={cn('grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-mat', className)}>
        <img src={item.image} alt={`${item.name} bottle`} loading="lazy" decoding="async" className="h-[90%] w-[90%] object-contain mix-blend-multiply" />
      </span>
    )
  const missing = item.missing.includes('image')
  return (
    <span role="img" aria-label="No image" className={cn('flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground', missing && 'border-warning/60 bg-warning/10', className)}>
      <ImageOff className={cn('opacity-70', compact ? 'size-4' : 'size-5')} />
      {!compact && <span className="text-[11px]">No image</span>}
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

// ---- note colour dots ---------------------------------------------------------------------------------------------

const DOT_MAX = 10
const DOT_LINES: { key: keyof DiscNotes; letter: string; label: string }[] = [
  { key: 'top', letter: 'T', label: 'Top notes' },
  { key: 'middle', letter: 'M', label: 'Middle notes' },
  { key: 'base', letter: 'B', label: 'Base notes' },
  { key: 'general', letter: 'G', label: 'Notes' },
]
const NEUTRAL = '#a8a29e'

/** The notes of one line as { name, family, color }; falls back to the plain names (grey) if the API sent no colours. */
function metaOf(item: DiscItem, key: keyof DiscNotes): NoteMeta[] {
  const m = item.note_meta?.[key]
  if (m?.length) return m
  return (item.notes[key] || []).map((name) => ({ name, family: null, color: NEUTRAL }))
}

const noteTip = (n: NoteMeta) => (n.family ? `${n.name} (${n.family})` : n.name)

const NoteDots = memo(function NoteDots({ item, className }: { item: DiscItem; className?: string }) {
  let lines = DOT_LINES.slice(0, 3).map((l) => ({ ...l, notes: metaOf(item, l.key) })).filter((l) => l.notes.length)
  if (!lines.length) {
    const g = metaOf(item, 'general')
    if (g.length) lines = [{ ...DOT_LINES[3], notes: g }]
  }
  if (!lines.length) {
    const needed = item.missing.includes('notes')
    return <p className={cn('text-xs', needed ? 'font-medium' : 'text-muted-foreground', className)}>{needed ? 'Notes missing' : 'No notes'}</p>
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      {lines.map((l) => {
        const shown = l.notes.slice(0, DOT_MAX)
        const rest = l.notes.slice(DOT_MAX)
        return (
          <div key={l.key} role="group" aria-label={`${l.label}: ${l.notes.map((n) => n.name).join(', ')}`} className="flex h-3.5 items-center gap-1.5">
            <span aria-hidden className="w-2.5 shrink-0 text-center font-mono text-[10px] leading-none text-muted-foreground">
              {l.letter}
            </span>
            <span className="flex min-w-0 items-center gap-[3px]">
              {shown.map((n, i) => (
                <span key={i} role="img" aria-label={noteTip(n)} data-tip={noteTip(n)} className="size-[11px] shrink-0 rounded-full ring-1 ring-foreground/15 ring-inset" style={{ backgroundColor: n.color }} />
              ))}
              {rest.length > 0 && (
                <span data-tip={rest.map((n) => n.name).join(', ')} className="shrink-0 pl-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                  +{rest.length}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
})

/** One shared tooltip for every note dot in a list (hundreds of rows): event delegation on the list, one Radix tooltip
 * moved onto whichever dot is hovered. Spread `bind` on the list element and render `layer` once. */
export function useNoteTips() {
  const [tip, setTip] = useState<{ text: string; r: { x: number; y: number; w: number; h: number } } | null>(null)
  useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', hide, true)
  }, [tip])
  const bind = {
    onPointerOver: (e: React.PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null
      if (!el) return setTip((t) => (t ? null : t))
      const r = el.getBoundingClientRect()
      setTip({ text: el.dataset.tip || '', r: { x: r.left, y: r.top, w: r.width, h: r.height } })
    },
    onPointerLeave: () => setTip(null),
  }
  const layer = (
    <Tooltip open={!!tip}>
      <TooltipTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed" style={tip ? { left: tip.r.x, top: tip.r.y, width: tip.r.w, height: tip.r.h } : { display: 'none' }} />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {tip?.text}
      </TooltipContent>
    </Tooltip>
  )
  return { bind, layer }
}

// ---- the row -----------------------------------------------------------------------------------------------------

export type ActionKind = 'approve' | 'approveAnyway' | 'reject' | 'edit' | 'restore' | 'unpublish' | 'notDuplicate' | 'rejectDuplicate'

interface ActionDef {
  kind: ActionKind
  label: string
  icon: LucideIcon
  primary?: boolean
  destructive?: boolean
}
const A: Record<ActionKind, ActionDef> = {
  approve: { kind: 'approve', label: 'Approve', icon: Check, primary: true },
  approveAnyway: { kind: 'approveAnyway', label: 'Approve anyway', icon: Check, primary: true },
  reject: { kind: 'reject', label: 'Reject', icon: X, destructive: true },
  edit: { kind: 'edit', label: 'Edit', icon: Pencil },
  restore: { kind: 'restore', label: 'Restore', icon: RotateCcw, primary: true },
  unpublish: { kind: 'unpublish', label: 'Unpublish', icon: Undo2 },
  notDuplicate: { kind: 'notDuplicate', label: 'Not a duplicate', icon: Undo2 },
  rejectDuplicate: { kind: 'rejectDuplicate', label: 'Reject as duplicate', icon: X, destructive: true },
}
const ACTIONS: Record<DiscState, ActionKind[]> = {
  complete: ['approve', 'reject', 'edit'],
  incomplete: ['approveAnyway', 'reject', 'edit'],
  duplicate: ['approveAnyway', 'notDuplicate', 'rejectDuplicate', 'edit'],
  approved: ['reject', 'edit'],
  rejected: ['restore', 'edit'],
  published: ['unpublish'],
}

const pill = 'inline-flex items-center rounded-full px-1.5 py-px text-[10px] leading-4 font-medium'

/** The tiny confidence pill at the row's right edge; hovering (or tapping) it shows the per-field detail. */
function ConfBadge({ item }: { item: DiscItem }) {
  const [open, setOpen] = useState(false)
  const timer = useRef(0)
  const later = (to: boolean, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(to), ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const t = toneOf(item.overall)
  const showMissing = item.missing.length > 0 && item.state !== 'rejected' && item.state !== 'published'
  return (
    <Popover open={open} onOpenChange={(o) => later(o, 0)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Confidence ${pct(item.overall)} for ${item.name}`}
          onPointerEnter={(e) => e.pointerType === 'mouse' && later(true, 120)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && later(false, 160)}
          className={cn(pill, 'cursor-help font-mono tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', CHIP[t])}
        >
          {pct(item.overall)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2.5 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => later(true, 0)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && later(false, 160)}
      >
        <ConfBar value={item.overall} />
        <ConfChips item={item} />
        {showMissing && (
          <p className="text-xs">
            <span className="font-medium">Missing: </span>
            {missingList(item)}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

const missingList = (it: DiscItem) => it.missing.map((m) => m.replace('_', ' ')).join(', ')

function RowMenu({ item, busy, onAction }: { item: DiscItem; busy: boolean; onAction: (k: ActionKind, it: DiscItem) => void }) {
  const kinds = ACTIONS[item.state]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Actions for ${item.name}`} className="size-6 rounded-md text-muted-foreground">
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {kinds.map((k, i) => {
          const a = A[k]
          return (
            <Fragment key={k}>
              {a.destructive && i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem variant={a.destructive ? 'destructive' : 'default'} onSelect={() => onAction(k, item)}>
                <a.icon />
                {a.label}
              </DropdownMenuItem>
            </Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The small one-line state hint under the name: missing data, duplicate, reject reason, live status. */
function Hint({ item }: { item: DiscItem }) {
  const dup = item.duplicate_of
  if (item.state === 'published') return item.live ? <span className={cn(pill, 'bg-success/10 text-success')}>Live</span> : <span className={cn(pill, 'bg-warning/15 text-foreground')}>Going live…</span>
  if (item.state === 'approved') return <span className={cn(pill, 'bg-success/10 text-success')}>Approved</span>
  if (item.state === 'duplicate')
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-foreground">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span className="sm:truncate">possible duplicate of {dup?.name ? `${dup.name}${dup.brand ? ` by ${dup.brand}` : ''}` : 'a catalogue perfume'}</span>
      </span>
    )
  if (item.state === 'rejected')
    return <span className="min-w-0 text-destructive sm:truncate">{item.review_note ? `Rejected: ${item.review_note}` : 'Rejected'}</span>
  if (item.missing.length)
    return (
      <span className="inline-flex min-w-0 items-center gap-1 text-foreground">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span className="sm:truncate">missing: {missingList(item)}</span>
      </span>
    )
  return null
}

export const CandidateRow = memo(function CandidateRow({ item, selected, onSelect, busy, onAction }: { item: DiscItem; selected?: boolean; onSelect?: (id: number, on: boolean) => void; busy: boolean; onAction: (k: ActionKind, it: DiscItem) => void }) {
  const [open, setOpen] = useState(false)
  const rel = releaseText(item.release_date)
  const showMissing = item.missing.length > 0 && item.state !== 'rejected' && item.state !== 'published'
  const dup = item.duplicate_of
  const relMissing = item.missing.includes('release_date')
  const panel = `cand-${item.id}`
  const meta = [item.concentration, genderText(item.gender), rel, item.release_status === 'announced' ? 'Announced' : null].filter(Boolean).join(' · ')

  // a click on the row itself toggles it; controls, links and portalled menus/popovers (outside the row's DOM) do not
  const onRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (!e.currentTarget.contains(t) || t.closest('button,a,label,[role=checkbox],[role=menuitem]')) return
    setOpen((o) => !o)
  }

  return (
    <article aria-label={`${item.name} by ${item.brand}`} className={cn('transition-colors', selected && 'bg-primary/[0.04]')}>
      <div onClick={onRowClick} className={cn('flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-muted/40 sm:items-center sm:gap-3 sm:px-4', open && 'bg-muted/30')}>
        {onSelect && (
          <label className="-m-1.5 mt-[9px] grid shrink-0 cursor-pointer place-items-center self-start p-1.5 sm:mt-0 sm:self-center">
            <Checkbox checked={!!selected} onCheckedChange={(v) => onSelect(item.id, v === true)} aria-label={`Select ${item.brand} ${item.name}`} />
          </label>
        )}
        <Bottle item={item} compact className="w-12 shrink-0 sm:w-[52px]" />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col leading-tight sm:w-2/5 sm:flex-none">
            <h2 className="text-[15px] leading-5 font-semibold tracking-[-0.01em] break-words sm:truncate">{item.name}</h2>
            <p className="truncate text-[13px] leading-[18px] text-muted-foreground">{item.brand}</p>
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-muted-foreground sm:flex-nowrap">
              {meta && <span className="sm:truncate">{meta}</span>}
              <Hint item={item} />
            </p>
          </div>
          <NoteDots item={item} className="sm:flex-1" />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <ConfBadge item={item} />
          <RowMenu item={item} busy={busy} onAction={onAction} />
          <Button type="button" variant="ghost" size="icon" aria-expanded={open} aria-controls={panel} aria-label={`${open ? 'Hide' : 'Show'} details for ${item.name}`} onClick={() => setOpen((o) => !o)} className="size-6 rounded-md text-muted-foreground">
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {open && (
        <div id={panel} className="grid gap-4 border-t bg-muted/20 px-3 py-3.5 sm:grid-cols-[112px_minmax(0,1fr)] sm:px-4">
          <div className="hidden sm:block">
            <Bottle item={item} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
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

            {item.description && <p className="text-sm break-words text-muted-foreground">{item.description}</p>}

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
                {ACTIONS[item.state].map((k) => {
                  const a = A[k]
                  return (
                    <Button key={k} size="sm" variant={a.primary ? 'default' : 'outline'} disabled={busy} onClick={() => onAction(k, item)}>
                      <a.icon />
                      {a.label}
                    </Button>
                  )
                })}
              </div>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground" title={`Found ${when(item.created_at)}${item.attempts ? ` · completed ${item.attempts}×` : ''}`}>
                #{item.id} · {when(item.created_at)}
              </span>
            </div>
          </div>
        </div>
      )}
    </article>
  )
})
