// New releases: the "Research runs" panel. Start a run (find new releases, complete the incomplete, or both), watch it
// while it goes (polled every 3 s), cancel it, and read the history of earlier runs.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, FlaskConical, Square } from 'lucide-react'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { admin, ago, fullTime, num, useLoad, useVisibleInterval, when, type DiscConfig, type DiscKind, type DiscModel, type DiscRun, type DiscRunsPage } from './data'
import { Field } from './person'

const KINDS: { value: DiscKind; title: string; hint: string }[] = [
  { value: 'discover', title: 'Find new releases', hint: 'Search the web for perfumes the catalogue lacks.' },
  { value: 'complete', title: 'Complete the incomplete', hint: 'Fill the missing data of candidates under Incomplete.' },
  { value: 'full', title: 'Both', hint: 'Find new ones, then complete what is missing.' },
]
const KIND_LABEL: Record<DiscRun['kind'], string> = { discover: 'Find new', complete: 'Complete', full: 'Find + complete', import: 'Import' }
const MODEL_LABEL: Record<DiscModel, string> = { sonnet: 'Sonnet 5.5', haiku: 'Haiku 5.5' }

const STATUS: Record<DiscRun['status'], { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-brand-soft text-brand-ink' },
  done: { label: 'Done', className: 'bg-success/10 text-success' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
  interrupted: { label: 'Interrupted', className: 'bg-warning/15 text-foreground' },
}

const usd = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDay(d)
}
const duration = (from: number | null, to: number | null) => {
  if (!from) return ''
  const s = Math.max(0, Math.round((to || Date.now() / 1000) - from))
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

function StatusPill({ status }: { status: DiscRun['status'] }) {
  const s = STATUS[status]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', s.className)}>
      {status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />}
      {s.label}
    </span>
  )
}

export function RunsPanel({ config, onChanged }: { config: DiscConfig | null; onChanged: () => void }) {
  const history = useLoad<DiscRunsPage>('/discovery/runs')
  const [tracked, setTracked] = useState<DiscRun | null>(null)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const running = tracked?.status === 'running'
  const runs = history.data?.runs
  const open = userOpen ?? (!!config && (!!config.running || runs?.length === 0))

  const reloadHistory = history.reload
  const finish = useCallback(
    (r: DiscRun) => {
      setTracked(r)
      if (r.status !== 'running') {
        reloadHistory()
        onChanged()
        toast(r.status === 'done' ? `Run #${r.id} finished: ${num(r.stats.new)} new, ${num(r.stats.updated)} updated.` : `Run #${r.id} ${STATUS[r.status].label.toLowerCase()}.`)
      }
    },
    [onChanged, reloadHistory],
  )

  // a run already going (this page was opened or reloaded while it ran)
  const runningId = config?.running ?? null
  useEffect(() => {
    if (runningId && tracked?.id !== runningId) {
      admin
        .get<DiscRun>(`/discovery/runs/${runningId}`)
        .then(setTracked)
        .catch(() => {})
    }
  }, [runningId, tracked?.id])

  useVisibleInterval(() => {
    if (!tracked || tracked.status !== 'running') return
    admin
      .get<DiscRun>(`/discovery/runs/${tracked.id}`)
      .then(finish)
      .catch(() => {})
  }, 3000)

  const last = runs?.[0]
  const summary = running
    ? `Run #${tracked.id} going · ${usd(tracked.stats.cost_usd)}`
    : !config
      ? ''
      : !config.engine_ready
        ? 'Needs an API key'
        : last
          ? `Last run ${ago(last.finished_at || last.created_at)} · ${STATUS[last.status].label.toLowerCase()} · ${num(last.stats.new)} new`
          : 'No runs yet'

  return (
    <section className="mb-5 rounded-xl border bg-card" aria-label="Research runs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-5"
      >
        <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight sm:flex-row sm:items-baseline sm:gap-3">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Research runs</span>
          <span className="truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        {running && <StatusPill status="running" />}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="flex flex-col gap-5 border-t px-4 py-4 sm:px-5">
          {config && !config.engine_ready && (
            <p className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
              <span className="font-medium">Research is switched off. </span>
              Set <code className="rounded bg-muted px-1 font-mono text-[13px]">ANTHROPIC_API_KEY</code> on the server (Render → Environment) and restart the service. Reviewing, editing and publishing work without it.
            </p>
          )}

          {tracked && <ActiveRun run={tracked} config={config} onCancelled={(r) => finish(r)} />}

          {!running && config && <StartForm config={config} onStarted={(r) => { setTracked(r); onChanged(); reloadHistory() }} />}

          <History runs={runs} error={history.error} />
        </div>
      )}
    </section>
  )
}

// ---- the running (or just finished) run ------------------------------------------------------------------------------

function ActiveRun({ run, config, onCancelled }: { run: DiscRun; config: DiscConfig | null; onCancelled: (r: DiscRun) => void }) {
  const [busy, setBusy] = useState(false)
  const going = run.status === 'running'
  const budget = run.params.budget_usd || 0
  const cost = run.stats.cost_usd || 0
  const segs = Object.values(run.stats.segments || {})
  const title = (key: string) => config?.segments.find((s) => s.key === key)?.title || key
  const lines = (run.log || []).slice(-30)
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  const cancel = async () => {
    setBusy(true)
    try {
      await admin.post(`/discovery/runs/${run.id}/cancel`, {})
      toast('Cancelling… what the run found so far is kept.')
      onCancelled(await admin.get<DiscRun>(`/discovery/runs/${run.id}`))
    } catch (e) {
      toast.error(errorText(e, 'Could not cancel that run.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold">
          Run #{run.id} <span className="font-normal text-muted-foreground">· {KIND_LABEL[run.kind]}</span>
        </h3>
        <StatusPill status={run.status} />
        <span className="text-xs text-muted-foreground" title={run.started_at ? fullTime(run.started_at) : undefined}>
          {going ? 'started ' + ago(run.started_at || run.created_at) : `took ${duration(run.started_at, run.finished_at)}`}
        </span>
        {going && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => void cancel()}>
            <Square />
            Cancel run
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
        <Stat label="Cost" value={budget ? `${usd(cost)} of ${usd(budget)}` : usd(cost)} />
        <Stat label="Searches" value={num(run.stats.searches ?? 0)} />
        <Stat label="Requests" value={num(run.stats.requests ?? 0)} />
        <Stat label="New" value={num(run.stats.new ?? 0)} />
        <Stat label="Updated" value={num(run.stats.updated ?? 0)} />
      </dl>
      {budget > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(Math.min(100, (cost / budget) * 100))}% of the budget used`}>
          <div className={cn('h-full rounded-full', cost / budget > 0.9 ? 'bg-warning' : 'bg-foreground/70')} style={{ width: `${Math.min(100, (cost / budget) * 100)}%` }} />
        </div>
      )}

      {segs.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label="Progress per segment">
          {segs.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 basis-40 truncate font-medium">{title(s.key)}</span>
              <span className="text-xs text-muted-foreground capitalize">{s.status}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {s.requests} req · {s.new} new · {s.updated} upd · {usd(s.cost_usd)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {run.error && <p className={cn('text-sm', run.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{run.error}</p>}

      {run.log !== undefined && (
        <pre ref={box} tabIndex={0} aria-label="Run log" className="max-h-56 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {lines.length ? lines.join('\n') : 'Waiting for the first log line…'}
        </pre>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

// ---- starting a run ------------------------------------------------------------------------------------------------

function StartForm({ config, onStarted }: { config: DiscConfig; onStarted: (r: DiscRun) => void }) {
  const [kind, setKind] = useState<DiscKind>('full')
  const [picked, setPicked] = useState<string[] | null>(null) // null: all segments
  const [model, setModel] = useState<DiscModel>('sonnet')
  const [completeModel, setCompleteModel] = useState<DiscModel>('haiku')
  const [budget, setBudget] = useState(String(config.default_budget_usd))
  const [maxItems, setMaxItems] = useState('60')
  const [since, setSince] = useState(() => daysAgo(120))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const all = config.segments.map((s) => s.key)
  const segments = picked ?? all
  const finds = kind !== 'complete'
  const completes = kind !== 'discover'
  const budgetN = Number(budget)
  const maxN = Number(maxItems)
  const problem = !(budgetN > 0 && budgetN <= 200)
    ? 'The budget must be between $0.01 and $200.'
    : completes && !(Number.isInteger(maxN) && maxN >= 1 && maxN <= 500)
      ? 'Max incomplete items must be a whole number from 1 to 500.'
      : finds && segments.length === 0
        ? 'Pick at least one segment.'
        : finds && !/^\d{4}-\d{2}-\d{2}$/.test(since)
          ? 'Pick the date to search from.'
          : ''
  const toggle = (key: string, on: boolean) => setPicked(on ? all.filter((k) => k === key || segments.includes(k)) : segments.filter((k) => k !== key))

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    if (problem) return setErr(problem)
    setErr('')
    setBusy(true)
    try {
      const r = await admin.post<DiscRun>('/discovery/runs', {
        kind,
        ...(finds ? { segments } : {}),
        model,
        complete_model: completeModel,
        budget_usd: budgetN,
        max_items: Number.isInteger(maxN) && maxN > 0 ? maxN : 60,
        since: /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : daysAgo(120),
      })
      toast.success(`Run #${r.id} started.`)
      onStarted(r)
    } catch (ex) {
      setErr(errorText(ex, 'Could not start the run.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={start} noValidate className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Start a run</h3>
      <RadioGroup value={kind} onValueChange={(v) => setKind(v as DiscKind)} aria-label="What to do" className="grid-cols-1 gap-2 sm:grid-cols-3">
        {KINDS.map((k) => (
          <Label key={k.value} htmlFor={`kind-${k.value}`} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 leading-snug transition-colors hover:bg-muted/50', kind === k.value && 'border-foreground/40 bg-muted/60')}>
            <RadioGroupItem id={`kind-${k.value}`} value={k.value} className="mt-0.5" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>{k.title}</span>
              <span className="text-xs font-normal text-muted-foreground">{k.hint}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>

      {finds && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 flex w-full items-center justify-between gap-3 text-sm font-medium">
            <span>Where to look</span>
            <button type="button" className="text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setPicked(segments.length === all.length ? [] : null)}>
              {segments.length === all.length ? 'Clear all' : 'Select all'}
            </button>
          </legend>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {config.segments.map((s) => (
              <Label key={s.key} htmlFor={`seg-${s.key}`} className="cursor-pointer py-1.5 font-normal">
                <Checkbox id={`seg-${s.key}`} checked={segments.includes(s.key)} onCheckedChange={(v) => toggle(s.key, v === true)} />
                <span className="min-w-0 leading-snug">{s.title}</span>
              </Label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {finds && (
          <Field id="run-model" label="Model for finding">
            <ModelSelect id="run-model" value={model} onChange={setModel} />
          </Field>
        )}
        {completes && (
          <Field id="run-cmodel" label="Model for completing">
            <ModelSelect id="run-cmodel" value={completeModel} onChange={setCompleteModel} />
          </Field>
        )}
        <Field id="run-budget" label="Budget (USD)">
          <Input id="run-budget" type="number" inputMode="decimal" min={0.5} max={200} step={0.5} value={budget} onChange={(e) => setBudget(e.target.value)} className="font-mono" />
        </Field>
        {completes && (
          <Field id="run-max" label="Max incomplete items">
            <Input id="run-max" type="number" inputMode="numeric" min={1} max={500} step={1} value={maxItems} onChange={(e) => setMaxItems(e.target.value)} className="font-mono" />
          </Field>
        )}
        {finds && (
          <Field id="run-since" label="Releases since">
            <Input id="run-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} className="font-mono" />
          </Field>
        )}
      </div>

      <p className="text-xs text-muted-foreground">A full run of all segments typically costs a few dollars with Sonnet; completing with Haiku costs cents. The run stops by itself at the budget and keeps what it found.</p>

      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy || !config.engine_ready}>
          <FlaskConical />
          {busy ? 'Starting…' : 'Start run'}
        </Button>
      </div>
    </form>
  )
}

function ModelSelect({ id, value, onChange }: { id: string; value: DiscModel; onChange: (m: DiscModel) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DiscModel)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sonnet">{MODEL_LABEL.sonnet}</SelectItem>
        <SelectItem value="haiku">{MODEL_LABEL.haiku}</SelectItem>
      </SelectContent>
    </Select>
  )
}

// ---- history -------------------------------------------------------------------------------------------------------

const COLS = 'sm:grid-cols-[8.5rem_8rem_6.5rem_minmax(0,1fr)_4.5rem]'

function History({ runs, error }: { runs: DiscRun[] | undefined; error: unknown }) {
  return (
    <section aria-label="Run history" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">History</h3>
      {!runs && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!!error && !runs && <p className="text-sm text-muted-foreground">{errorText(error, "Couldn't load the run history.")}</p>}
      {runs?.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
      {!!runs?.length && (
        <div className="overflow-hidden rounded-lg border">
          <div className={cn('hidden gap-x-3 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:grid', COLS)} aria-hidden="true">
            <span>Date</span>
            <span>Kind</span>
            <span>Status</span>
            <span>New / updated</span>
            <span className="text-right">Cost</span>
          </div>
          <ol className="divide-y">
            {runs.map((r) => (
              <li key={r.id} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:items-center sm:px-4', COLS)}>
                <time className="whitespace-nowrap sm:order-1" title={fullTime(r.created_at)}>
                  {when(r.created_at)}
                </time>
                <span className="justify-self-end sm:order-3 sm:justify-self-start">
                  <StatusPill status={r.status} />
                </span>
                <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground sm:contents">
                  <span className="text-xs sm:order-2 sm:text-sm">
                    {KIND_LABEL[r.kind]}
                    <span className="font-mono text-[11px]"> #{r.id}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums sm:order-4 sm:text-sm">
                    {num(r.stats.new ?? 0)} new · {num(r.stats.updated ?? 0)} updated
                  </span>
                  <span className="ml-auto font-mono text-xs tabular-nums sm:order-5 sm:text-right sm:text-sm">{usd(r.stats.cost_usd)}</span>
                </div>
                {r.error && <p className={cn('col-span-2 text-xs break-words sm:order-6 sm:col-span-full', r.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{r.error}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
