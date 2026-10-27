// A ranked list: each row names the thing, shows its numbers, and draws a thin bar for the metric it is ranked by.
// The bar wears that metric's series colour (visitors blue, page views orange, as in the daily chart); text stays in
// text tokens. Values are always printed, so nothing is hidden behind a hover.
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { num } from './data'
import { Muted, Panel } from './parts'

export type Metric = 'views' | 'visitors'
const METRIC: Record<Metric, { label: string; color: string }> = {
  views: { label: 'Views', color: 'var(--viz-2)' },
  visitors: { label: 'Visitors', color: 'var(--viz-1)' },
}

export interface RankRow {
  key: string
  label: React.ReactNode
  sub?: React.ReactNode
  lead?: React.ReactNode
  views?: number
  visitors: number
}

export function RankedList({ title, hint, rows, by = 'visitors', limit = 8, dim, className }: { title: string; hint?: string; rows: RankRow[]; by?: Metric; limit?: number; dim?: boolean; className?: string }) {
  const [all, setAll] = useState(false)
  // the server ranks every list by visitors; views (when the list has them) ride along as a second column
  const cols: Metric[] = rows.some((r) => r.views != null) ? [by, by === 'views' ? 'visitors' : 'views'] : [by]
  const max = Math.max(1, ...rows.map((r) => r[by] ?? 0))
  const shown = all ? rows : rows.slice(0, limit)
  return (
    <Panel
      title={title}
      hint={hint}
      className={className}
      action={
        rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-3 pt-0.5 text-[11px] text-muted-foreground">
            {cols.map((c) => (
              <span key={c} className="flex w-12 items-center justify-end gap-1.5">
                {c === by && <span className="h-1 w-2.5 rounded-full" style={{ background: METRIC[c].color }} aria-hidden="true" />}
                {METRIC[c].label}
              </span>
            ))}
          </div>
        )
      }
    >
      <div className={dim ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
        {rows.length === 0 ? (
          <Muted>No data for this range yet.</Muted>
        ) : (
          <ol className="pb-2">
            {shown.map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-4 py-1.5 sm:px-5">
                {r.lead}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm">{r.label}</span>
                    {r.sub && <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{r.sub}</span>}
                  </div>
                  <div className="mt-1 h-1 w-full" aria-hidden="true">
                    <div className="h-1 rounded-r-full" style={{ width: `${Math.max(1, ((r[by] ?? 0) / max) * 100)}%`, background: METRIC[by].color }} />
                  </div>
                </div>
                {cols.map((c) => (
                  <span key={c} className={'w-12 shrink-0 text-right font-mono text-[13px] tabular-nums ' + (c === by ? 'text-foreground' : 'text-muted-foreground')}>
                    {num(r[c])}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        )}
        {rows.length > limit && (
          <div className="border-t px-2 py-1.5">
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  )
}
