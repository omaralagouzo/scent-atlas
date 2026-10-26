// Head-to-head ranking game for My Collection: "which do you love more?" questions that place a bottle on the
// leaderboard by binary insertion (about log2(n) questions).
import { useEffect, useRef, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MiniAccords } from '@/components/accords'
import { BottleImg } from '@/components/media'
import { medal } from './podium'

export interface DuelRequest {
  it: Perfume
  /** the current leaderboard without `it`, best first */
  list: Perfume[]
  batch: { n: number; of: number } | null
  resolve: (pos: number | null) => void
}

/** Controlled dialog: shows the duel while `req` is set. Each request resolves once (insert index, or null). */
export function DuelDialog({ req, rankOf }: { req: DuelRequest | null; rankOf: (id: number) => number }) {
  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && req?.resolve(null)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        {req && <DuelBody key={`${req.it.id}:${req.batch?.n ?? 0}`} req={req} rankOf={rankOf} />}
      </DialogContent>
    </Dialog>
  )
}

function DuelBody({ req, rankOf }: { req: DuelRequest; rankOf: (id: number) => number }) {
  const { it, list, batch } = req
  const [lo, setLo] = useState(0)
  const [hi, setHi] = useState(list.length)
  const [undo, setUndo] = useState<[number, number][]>([])
  const [picked, setPicked] = useState<'new' | 'old' | null>(null)
  const [placed, setPlaced] = useState<number | null>(null)
  const done = useRef(false)
  const first = useRef<HTMLButtonElement>(null)
  const total = Math.ceil(Math.log2(list.length + 1))
  const asked = undo.length
  const mid = (lo + hi) >> 1
  const other = list[mid] as Perfume | undefined

  const finish = (pos: number) => {
    if (done.current) return
    done.current = true
    setPlaced(pos)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.setTimeout(() => req.resolve(pos), reduce ? 350 : 750)
  }
  useEffect(() => {
    if (lo >= hi) finish(lo)
    else first.current?.focus({ preventScroll: true })
  }, [lo, hi])

  const pick = (newWins: boolean) => {
    if (done.current || lo >= hi) return
    const [l, h] = newWins ? [lo, mid] : [mid + 1, hi]
    setPicked(newWins ? 'new' : 'old')
    setUndo((u) => [...u, [lo, hi]])
    setLo(l)
    setHi(h)
    // the last answer settles it: show the result in this same render (there is no next opponent to show)
    if (l >= h) finish(l)
  }
  const back = () => {
    if (!undo.length || done.current) return
    const [l, h] = undo[undo.length - 1]
    setUndo((u) => u.slice(0, -1))
    setPicked(null)
    setLo(l)
    setHi(h)
  }

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          pick(true)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          pick(false)
        }
      }}
    >
      <DialogHeader className="gap-1 border-b px-5 pt-5 pb-4 text-left sm:px-6">
        <DialogTitle className="text-lg tracking-[-0.02em]">Which do you love more?</DialogTitle>
        <DialogDescription className="text-xs">
          Placing <span className="font-semibold tracking-[-0.015em] text-[14px] text-foreground">{it.name}</span>
          {batch ? (
            <>
              {' '}
              (<span className="font-mono">{batch.n}</span> of <span className="font-mono">{batch.of}</span>)
            </>
          ) : null}
          {placed == null && (
            <>
              {' '}
              · question <span className="font-mono">{asked + 1}</span> of about <span className="font-mono">{Math.max(total, asked + 1)}</span>
            </>
          )}
        </DialogDescription>
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {Array.from({ length: Math.max(total, asked + (placed == null ? 1 : 0)) }, (_, k) => (
            <span key={k} className={cn('h-1 flex-1 rounded-full bg-muted transition-colors duration-300', (k < asked || placed != null) && 'bg-foreground/70', k === asked && placed == null && 'bg-foreground/25')} />
          ))}
        </div>
      </DialogHeader>

      {placed != null || !other ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="status">
          <span className="grid size-16 place-items-center rounded-full border-2 bg-card font-mono text-2xl font-semibold animate-in zoom-in-50 duration-500 ease-spring" style={(placed ?? lo) < 3 ? medal((placed ?? lo) + 1) : undefined}>
            {(placed ?? lo) + 1}
          </span>
          <p className="text-sm text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
            <span className="font-semibold tracking-[-0.015em] text-[16px] text-foreground">{it.name}</span> lands at <b className="font-mono font-medium text-foreground">#{(placed ?? lo) + 1}</b>
          </p>
        </div>
      ) : (
        <div key={`${lo}-${hi}`} className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6">
          <DuelCard ref={first} p={it} tag={<span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">New</span>} onPick={() => pick(true)} keyHint="←" side="left" was={picked === 'new'} />
          <span className="self-center font-semibold tracking-[-0.015em] text-xl text-muted-foreground italic animate-in fade-in zoom-in-75 duration-300" aria-hidden="true">
            or
          </span>
          <DuelCard
            p={other}
            tag={
              <span className="rounded-full border bg-card px-2 py-0.5 font-mono text-[11px] font-medium" style={rankOf(other.id) <= 3 ? medal(rankOf(other.id)) : undefined}>
                #{rankOf(other.id)}
              </span>
            }
            onPick={() => pick(false)}
            keyHint="→"
            side="right"
            was={picked === 'old'}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t bg-muted/40 px-3 py-2.5 sm:px-4">
        <Button size="sm" variant="ghost" disabled={!undo.length || placed != null} onClick={back}>
          <Undo2 />
          Back
        </Button>
        <Button size="sm" variant="ghost" disabled={placed != null} title="They are about equal: place it right here" onClick={() => finish(mid)}>
          Too close to call
        </Button>
        <Button size="sm" variant="ghost" disabled={placed != null} onClick={() => finish(list.length)}>
          Put it last
        </Button>
        <span className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          to choose
        </span>
      </div>
    </div>
  )
}

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border bg-card px-1 font-mono text-[11px] shadow-xs">{children}</kbd>

function DuelCard({ p, tag, onPick, keyHint, side, was, ref }: { p: Perfume; tag: React.ReactNode; onPick: () => void; keyHint: string; side: 'left' | 'right'; was: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      aria-keyshortcuts={side === 'left' ? 'ArrowLeft' : 'ArrowRight'}
      aria-label={`${p.name} by ${p.brand}`}
      className={cn(
        'group relative flex min-w-0 flex-col items-center gap-2 rounded-2xl border bg-card p-3 text-center transition-[transform,box-shadow,border-color] duration-300 ease-spring hover:-translate-y-1 hover:border-foreground/30 hover:shadow-lg focus-visible:-translate-y-1 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.97] sm:p-4',
        'animate-in fade-in duration-300 ease-spring',
        side === 'left' ? 'slide-in-from-left-3' : 'slide-in-from-right-3',
        was && 'zoom-in-95',
      )}
    >
      <span className="flex w-full items-center justify-between">
        {tag}
        <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">{keyHint}</span>
      </span>
      <span className="grid aspect-[4/5] w-full max-w-72 place-items-center overflow-hidden rounded-xl bg-mat">
        <BottleImg p={p} alt="" className="h-[90%] w-[90%] mix-blend-multiply transition-transform duration-300 ease-spring group-hover:scale-105" />
      </span>
      <b className="line-clamp-2 font-semibold tracking-[-0.015em] text-[16px] leading-tight sm:text-[19px]">{p.name}</b>
      <small className="-mt-1 truncate text-xs text-muted-foreground">{p.brand}</small>
      <MiniAccords accords={p.accords} className="mt-auto w-full max-w-36" />
    </button>
  )
}
