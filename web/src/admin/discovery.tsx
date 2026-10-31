// New releases: candidate perfumes found by research, reviewed here before they join the catalogue. Sub-tabs by state
// (Complete is the review queue), search and sort, per-card actions, bulk approve / reject, publishing, and the research
// runs panel that finds new releases and completes the incomplete ones.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Check, RefreshCw, Rocket, RotateCcw, Search, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, errorText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { admin, num, useDebounced, useLoad, useVisibleInterval, type DiscConfig, type DiscCounts, type DiscItem, type DiscItemsPage, type DiscState } from './data'
import { CandidateRow, useNoteTips, type ActionKind } from './discovery-card'
import { EditSheet } from './discovery-edit'
import { RunsPanel } from './discovery-runs'
import { Muted, PageHead } from './parts'

// ---- the count shown on the nav tab ---------------------------------------------------------------------------------

let completeCount: number | null = null
const countSubs = new Set<() => void>()
const setComplete = (n: number) => {
  if (n === completeCount) return
  completeCount = n
  countSubs.forEach((fn) => fn())
}
const subscribeCount = (fn: () => void) => {
  countSubs.add(fn)
  return () => void countSubs.delete(fn)
}

/** Candidates with complete data waiting for review: loaded on sign-in, every minute while visible, and after each action here. */
export function useCompleteCount() {
  const n = useSyncExternalStore(subscribeCount, () => completeCount)
  const refresh = useCallback(() => {
    admin
      .get<DiscConfig>('/discovery/config')
      .then((c) => setComplete(c.counts.complete))
      .catch(() => {})
  }, [])
  useEffect(() => refresh(), [refresh])
  useVisibleInterval(refresh, 60_000)
  return n
}

// ---- tabs and sorting -----------------------------------------------------------------------------------------------

const TABS: { value: DiscState; label: string; empty: string }[] = [
  { value: 'complete', label: 'Complete', empty: 'Nothing waiting for review. Start a research run to find new releases.' },
  { value: 'incomplete', label: 'Incomplete', empty: 'No incomplete candidates. A run that completes the incomplete fills these in.' },
  { value: 'duplicate', label: 'Possible duplicates', empty: 'No candidate looks like a perfume the catalogue already has.' },
  // approving publishes now; Approved only shows while something is left there from before
  { value: 'approved', label: 'Approved', empty: 'Nothing waiting to be published.' },
  { value: 'published', label: 'Published', empty: 'Nothing published yet. Approve a candidate and it goes live on the site.' },
  { value: 'rejected', label: 'Rejected', empty: 'Nothing rejected.' },
]

const SORTS = [
  { value: 'confidence', label: 'Confidence' },
  { value: 'newest', label: 'Newest' },
  { value: 'release', label: 'Release date' },
  { value: 'brand', label: 'Brand' },
]

// one request loads a whole tab (the API allows up to 1000; the queue is a few hundred), so Select all means all of it
const LIMIT = 1000
const QUICK_REASONS = ['Not a new release.', 'Not enough reliable sources.', 'Looks like a perfume the catalogue already has.', 'Not a real fragrance product.']
const missingText = (it: DiscItem) => (it.missing.length ? it.missing.map((m) => m.replace('_', ' ')).join(', ') : 'some data')

const label = (it: DiscItem) => `“${it.name}”`
type RejectTarget = { ids: number[]; name: string; reason: string }

// ---- the screen -------------------------------------------------------------------------------------------------------

export function Discovery() {
  const [state, setState] = useState<DiscState>('complete')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 250)
  const [sort, setSort] = useState('confidence')
    const items = useLoad<DiscItemsPage>('/discovery/items', { state, q: dq, sort, limit: LIMIT })
  const cfg = useLoad<DiscConfig>('/discovery/config')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busyId, setBusyId] = useState<number | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [reject, setReject] = useState<RejectTarget | null>(null)
  const [anyway, setAnyway] = useState<DiscItem | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [confirmAnyway, setConfirmAnyway] = useState<{ picked: DiscItem[]; weak: DiscItem[] } | null>(null)

  const { reload: reloadItems } = items
  const { reload: reloadConfig } = cfg
  const refresh = useCallback(() => {
    reloadItems()
    reloadConfig()
  }, [reloadItems, reloadConfig])

  const config = cfg.data
  // while approvals are on their way to the site, check every 15 s so the banner and "Live" badges update
  const waiting = (config?.pending_restart ?? 0) > 0
  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(refresh, 15000)
    return () => window.clearInterval(t)
  }, [waiting, refresh])
  const counts: DiscCounts | undefined = items.data?.counts ?? config?.counts
  useEffect(() => {
    if (counts) setComplete(counts.complete)
  }, [counts])

  // a different tab, search or sort starts a fresh selection
  useEffect(() => {
    setSelected(new Set())
  }, [state, dq, sort])

  const list = items.data?.items
  const total = items.data?.total ?? 0
  // drop selections that left the list (acted on elsewhere)
  useEffect(() => {
    if (!list) return
    setSelected((cur) => {
      const ids = new Set(list.map((i) => i.id))
      const next = new Set([...cur].filter((id) => ids.has(id)))
      return next.size === cur.size ? cur : next
    })
  }, [list])

  const canSelect = state === 'complete' || state === 'incomplete' || state === 'duplicate' || state === 'rejected'
  const editing = (editId !== null && list?.find((i) => i.id === editId)) || null
  const tab = TABS.find((t) => t.value === state)!
  const approved = counts?.approved ?? 0

  // ---- single-candidate actions
  const act = useCallback(async (it: DiscItem, run: () => Promise<unknown>, ok: string) => {
    setBusyId(it.id)
    try {
      await run()
      toast.success(ok)
      refresh()
    } catch (e) {
      toast.error(errorText(e, 'That did not work.'))
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) refresh()
    } finally {
      setBusyId(null)
    }
  }, [refresh])
  const approve = useCallback(async (it: DiscItem) => {
    setBusyId(it.id)
    try {
      await admin.post(`/discovery/items/${it.id}/approve`, {})
      toast.success(`Approved ${label(it)}. It goes live on the site in a couple of minutes.`)
      refresh()
    } catch (e) {
      // 409: still incomplete (or a possible duplicate): offer to approve anyway
      if (e instanceof ApiError && e.status === 409 && (it.state === 'incomplete' || it.state === 'duplicate')) setAnyway(it)
      else toast.error(errorText(e, 'Could not approve that.'))
    } finally {
      setBusyId(null)
    }
  }, [refresh])

  // ---- bulk
  type BulkResult = { done: number[]; failed: { id: number; error: string }[] }
  const runBulk = async (ids: number[], action: 'approve' | 'restore', force: boolean, keep: number[] = []) => {
    setBulkBusy(true)
    try {
      const r = await admin.post<BulkResult>('/discovery/bulk', { ids, action, ...(force ? { force: true } : {}) })
      const verb = action === 'approve' ? 'Approved' : 'Restored'
      const live = action === 'approve' ? ' They go live on the site in about a minute.' : ''
      if (r.failed.length) toast.warning(`${verb} ${r.done.length}.${live} ${r.failed.length} could not be ${verb.toLowerCase()}: ${r.failed[0].error}`, { duration: 8000 })
      else toast.success(`${verb} ${r.done.length}.${live}`)
      setSelected(new Set(keep))
      refresh()
    } catch (e) {
      toast.error(errorText(e, 'That did not work.'))
    } finally {
      setBulkBusy(false)
    }
  }
  // Approve on a selection that holds incomplete / duplicate candidates asks once whether to approve those anyway
  const bulkApprove = () => {
    const picked = (list || []).filter((i) => selected.has(i.id))
    const weak = picked.filter((i) => i.state === 'incomplete' || i.state === 'duplicate')
    if (weak.length) setConfirmAnyway({ picked, weak })
    else void runBulk(picked.map((i) => i.id), 'approve', false)
  }

  const allOn = !!list?.length && list.every((i) => selected.has(i.id))
  const someOn = selected.size > 0

  // stable row callbacks: ticking one checkbox re-renders one row, not hundreds
  const onSelect = useCallback((id: number, on: boolean) => {
    setSelected((cur) => {
      if (cur.has(id) === on) return cur
      const next = new Set(cur)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const onAction = useCallback((kind: ActionKind, it: DiscItem) => {
    const post = (path: string) => () => admin.post(`/discovery/items/${it.id}/${path}`, {})
    switch (kind) {
      case 'approve': return void approve(it)
      case 'approveAnyway': return setAnyway(it)
      case 'reject': return setReject({ ids: [it.id], name: label(it), reason: '' })
      case 'edit': return setEditId(it.id)
      case 'restore': return void act(it, post('restore'), `Restored ${label(it)}.`)
      case 'unpublish': return void act(it, post('unpublish'), `Unpublished ${label(it)}. It comes off the site in a couple of minutes and is back in the queue.`)
      case 'notDuplicate': return void act(it, post('not-duplicate'), `Marked ${label(it)} as not a duplicate.`)
      case 'rejectDuplicate': return setReject({ ids: [it.id], name: label(it), reason: it.duplicate_of?.name ? `Duplicate of ${it.duplicate_of.name}${it.duplicate_of.brand ? ` by ${it.duplicate_of.brand}` : ''}.` : 'Duplicate of a catalogue perfume.' })
    }
  }, [approve, act])
  const tips = useNoteTips()

  return (
    <>
      <PageHead title="New releases" lede="Perfumes found by research wait here for your review. Approve the ones you want and they go live on the site within a couple of minutes.">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={refresh} disabled={items.loading} className="text-muted-foreground">
            <RefreshCw className={cn(items.loading && items.data && 'animate-spin')} />
            Refresh
          </Button>
          {approved > 0 && (
            <Button size="sm" onClick={() => setPublishing(true)}>
              <Rocket />
              Publish {num(approved)} approved
            </Button>
          )}
        </div>
      </PageHead>

      {!!config && config.pending_restart > 0 && <GoingLive config={config} />}

      <RunsPanel config={config} onChanged={refresh} />

      <Segmented<DiscState>
        label="Candidate state"
        className="mb-3"
        value={state}
        onChange={setState}
        options={TABS.filter((t) => t.value !== 'approved' || (counts?.approved ?? 0) > 0 || state === 'approved').map((t) => {
          const n = counts?.[t.value]
          return {
            value: t.value,
            label: (
              <>
                {t.label}
                {n !== undefined && (
                  <span className={cn('min-w-5 rounded-full px-1.5 py-px text-center font-mono text-[11px] leading-4 tabular-nums', t.value === 'complete' && n > 0 ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.07] text-muted-foreground')}>{num(n)}</span>
                )}
              </>
            ),
          }
        })}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand or name" aria-label="Search candidates" autoComplete="off" className="bg-background pl-9" />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger aria-label="Sort by" className="w-[170px] bg-background">
            <span className="text-muted-foreground">Sort:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canSelect && !!list?.length && (
          <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-muted-foreground">
            <Checkbox checked={allOn ? true : someOn ? 'indeterminate' : false} onCheckedChange={(v) => setSelected(v === true ? new Set(list.map((i) => i.id)) : new Set())} aria-label={`Select all ${list.length} in this tab`} />
            Select all
            <span className="font-mono text-xs tabular-nums">{num(list.length)}</span>
          </label>
        )}
      </div>

      {!list && !items.error && (
        <div className="flex flex-col gap-px overflow-hidden rounded-xl border" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[68px] w-full rounded-none first:rounded-t-xl last:rounded-b-xl" />
          ))}
        </div>
      )}
      {!!items.error && !list && (
        <div className="rounded-xl border bg-card">
          <Muted>{errorText(items.error, "Couldn't load the candidates.")}</Muted>
        </div>
      )}
      {list?.length === 0 && (
        <div className="rounded-xl border bg-card">
          <Muted>{dq ? `No candidate matches “${dq}” here.` : tab.empty}</Muted>
        </div>
      )}
      {!!list?.length && (
        <>
          <ol {...tips.bind} className={cn('divide-y rounded-xl border bg-card transition-opacity', items.loading && 'opacity-60')} aria-label="Candidates">
            {list.map((it) => (
              <li key={it.id}>
                <CandidateRow item={it} busy={busyId === it.id || bulkBusy} selected={selected.has(it.id)} onSelect={canSelect ? onSelect : undefined} onAction={onAction} />
              </li>
            ))}
          </ol>
          {tips.layer}
          {total > list.length && <p className="mt-3 text-center text-sm text-muted-foreground">Showing the first {num(list.length)} of {num(total)}. Search to narrow the list.</p>}
        </>
      )}

      {someOn && (
        <div className="sticky bottom-3 z-30 mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2.5 pl-4 shadow-lg" role="region" aria-label="Selected candidates">
          <span className="mr-auto text-sm font-medium" aria-live="polite">
            {num(selected.size)} selected
          </span>
          {state === 'rejected' ? (
            <Button size="sm" disabled={bulkBusy} onClick={() => void runBulk([...selected], 'restore', false)}>
              <RotateCcw />
              Restore
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={bulkBusy} onClick={bulkApprove}>
                <Check />
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => setReject({ ids: [...selected], name: `${selected.size} candidate${selected.size === 1 ? '' : 's'}`, reason: '' })}>
                <X />
                Reject
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <EditSheet
        item={editing}
        onClose={() => setEditId(null)}
        onChanged={refresh}
        onSaved={() => {
          setEditId(null)
          refresh()
        }}
      />
      <RejectDialog
        target={reject}
        onClose={() => setReject(null)}
        onDone={() => {
          setReject(null)
          setSelected(new Set())
          refresh()
        }}
      />
      <ApproveAnywayDialog
        item={anyway}
        onClose={() => setAnyway(null)}
        onDone={() => {
          setAnyway(null)
          refresh()
        }}
      />
      <BulkAnywayDialog
        target={confirmAnyway}
        onClose={() => setConfirmAnyway(null)}
        onChoose={(all) => {
          const t = confirmAnyway!
          setConfirmAnyway(null)
          if (all) void runBulk(t.picked.map((i) => i.id), 'approve', true)
          else void runBulk(t.picked.filter((i) => i.state === 'complete').map((i) => i.id), 'approve', false, t.weak.map((i) => i.id))
        }}
      />
      <PublishDialog
        open={publishing}
        count={approved}
        onClose={() => setPublishing(false)}
        onDone={() => {
          setPublishing(false)
          refresh()
        }}
      />
    </>
  )
}

// ---- dialogs -------------------------------------------------------------------------------------------------------------

function RejectDialog({ target, onClose, onDone }: { target: RejectTarget | null; onClose: () => void; onDone: () => void }) {
  // keep the last target while the dialog animates closed
  const [shown, setShown] = useState<RejectTarget | null>(target)
  if (target && target !== shown) setShown(target)
  const t = target || shown
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-md">{t && <RejectBody key={`${t.ids.join(',')}-${t.reason}`} t={t} onClose={onClose} onDone={onDone} />}</DialogContent>
    </Dialog>
  )
}

function RejectBody({ t, onClose, onDone }: { t: RejectTarget; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(t.reason)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const clean = reason.split(/\s+/).filter(Boolean).join(' ')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const body = clean ? { reason: clean } : {}
      if (t.ids.length === 1) {
        await admin.post(`/discovery/items/${t.ids[0]}/reject`, body)
        toast.success(`Rejected ${t.name}.`)
      } else {
        const r = await admin.post<{ done: number[]; failed: { id: number; error: string }[] }>('/discovery/bulk', { ids: t.ids, action: 'reject', ...body })
        if (r.failed.length) toast.warning(`Rejected ${r.done.length}. ${r.failed.length} could not be rejected: ${r.failed[0].error}`, { duration: 8000 })
        else toast.success(`Rejected ${r.done.length}.`)
      }
      onDone()
    } catch (ex) {
      setErr(errorText(ex, 'That did not work.'))
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="pr-6 break-words">Reject {t.name}?</DialogTitle>
        <DialogDescription>They move to Rejected, where you can restore them. A reason is optional and only you see it.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={clean === r}
            onClick={() => setReason(r)}
            className={cn('rounded-xl border bg-background px-2.5 py-1 text-left text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50', clean === r && 'border-foreground/40 bg-muted')}
          >
            {r}
          </button>
        ))}
      </div>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} placeholder="Reason (optional)" aria-label="Reason" className="bg-background" />
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? 'Working…' : 'Reject'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function ApproveAnywayDialog({ item, onClose, onDone }: { item: DiscItem | null; onClose: () => void; onDone: () => void }) {
  const [shown, setShown] = useState<DiscItem | null>(item)
  if (item && item !== shown) setShown(item)
  const it = item || shown
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    if (!it) return
    setBusy(true)
    setErr('')
    try {
      await admin.post(`/discovery/items/${it.id}/approve`, { force: true })
      toast.success(`Approved “${it.name}” anyway.`)
      setBusy(false)
      onDone()
    } catch (ex) {
      setErr(errorText(ex, 'Could not approve that.'))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => {
        if (!o) {
          setErr('')
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-md">
        {it && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 break-words">Approve “{it.name}” anyway?</DialogTitle>
              <DialogDescription>
                {it.state === 'duplicate' ? 'It looks like a perfume the catalogue already has. ' : `It is still missing: ${missingText(it)}. `}
                If you approve it now, it will be published with the data it has.
              </DialogDescription>
            </DialogHeader>
            {err && (
              <p role="alert" className="text-sm text-destructive">
                {err}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={() => void go()}>
                {busy ? 'Working…' : 'Approve anyway'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BulkAnywayDialog({ target, onClose, onChoose }: { target: { picked: DiscItem[]; weak: DiscItem[] } | null; onClose: () => void; onChoose: (all: boolean) => void }) {
  const [shown, setShown] = useState(target)
  if (target && target !== shown) setShown(target)
  const t = target || shown
  if (!t) return <Dialog open={false} />
  const complete = t.picked.length - t.weak.length
  // what is missing most often among the selected, for the sentence ("image, gender…")
  const tally = new Map<string, number>()
  for (const i of t.weak) for (const m of i.missing) tally.set(m, (tally.get(m) || 0) + 1)
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m.replace('_', ' '))
  const dups = t.weak.filter((i) => i.state === 'duplicate').length
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve incomplete ones too?</DialogTitle>
          <DialogDescription>
            {t.weak.length === t.picked.length ? (t.picked.length === 1 ? 'The selected perfume' : `All ${num(t.picked.length)} selected`) : `${num(t.weak.length)} of the ${num(t.picked.length)} selected`} still miss{t.weak.length === 1 ? 'es' : ''} data{top.length ? ` (${top.join(', ')}${tally.size > top.length ? '…' : ''})` : ''}
            {dups > 0 ? ` or may be duplicates (${num(dups)})` : ''}. Approve them anyway? Approved perfumes go live on the site in about a minute.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="outline" disabled={complete === 0} onClick={() => onChoose(false)}>
            Only the {num(complete)} complete
          </Button>
          <Button type="button" onClick={() => onChoose(true)}>
            Approve all {num(t.picked.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PublishDialog({ open, count, onClose, onDone }: { open: boolean; count: number; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await admin.post<{ published: number; pending_restart: number }>('/discovery/publish', {})
      toast.success(`Published ${r.published}. They go live on the site in a couple of minutes.`)
      setBusy(false)
      onDone()
    } catch (ex) {
      setErr(errorText(ex, 'Could not publish.'))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setErr('')
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Publish {num(count)} approved perfume{count === 1 ? '' : 's'}?
          </DialogTitle>
          <DialogDescription>
            These were approved before approving published by itself. They go live on the site in a couple of minutes; you can unpublish one later from the Published tab.
          </DialogDescription>
        </DialogHeader>
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void go()}>
            <Rocket />
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GoingLive({ config }: { config: DiscConfig }) {
  const { mode, due_at } = config.live
  const n = config.pending_restart
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(t)
  }, [])
  const left = due_at ? Math.max(0, Math.round(due_at - now)) : null
  const what = `${num(n)} approved perfume${n === 1 ? '' : 's'}`
  let text: string
  if (mode === 'manual') text = `${what} waiting: restart the app to put them on the site.`
  else if (left !== null && left > 0)
    text = `${what} go live in about ${left < 60 ? `${left} s` : `${Math.ceil(left / 60)} min`}${mode === 'self_restart' ? ' (the site restarts to load them and is offline for about half a minute)' : ''}. Approving more resets the wait, so a batch goes live together.`
  else text = `${what} going live now: the site is reloading its catalogue. This page updates by itself.`
  return (
    <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm" role="status">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <span className="min-w-0">{text}</span>
    </p>
  )
}
