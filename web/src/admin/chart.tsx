// Hand-rolled SVG charts for the admin dashboard (no chart library).
// Method: docs from the dataviz skill. One y-axis (visitors and views are both counts); sign-ups sit in their own
// strip under the plot rather than on a second scale. 2px lines, a 10% wash under the lead series, hairline grid,
// crosshair + tooltip that snaps to the nearest day (keyboard too), and a table view as the tooltip-free twin.
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { compactNum, num, parseDay, type Day } from './data'

const SERIES = [
  { key: 'visitors', label: 'Visitors', color: 'var(--viz-1)' },
  { key: 'views', label: 'Page views', color: 'var(--viz-2)' },
] as const
const SIGNUPS = { label: 'Sign-ups', color: 'var(--viz-3)' }

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

const dayLabel = (s: string, withWeekday = false) =>
  parseDay(s).toLocaleDateString(undefined, withWeekday ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Legend: line keys for the lines, a dot for the sign-up marks (the legend mirrors the mark). */
export function DailyLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-[2px] w-3.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: SIGNUPS.color }} aria-hidden="true" />
        {SIGNUPS.label}
      </li>
    </ul>
  )
}

export function DailyChart({ days, dim }: { days: Day[]; dim?: boolean }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [rawHover, setHover] = useState<number | null>(null)
  const clipId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const n = days.length
  // a hover index from a longer range is dropped when the range shrinks
  const hover = rawHover != null && rawHover < n ? rawHover : null
  const phone = width > 0 && width < 520

  const padL = 52
  const padR = phone ? 12 : 52
  const padT = 10
  const plotH = phone ? 170 : 220
  const stripTop = padT + plotH + 8
  const stripH = 30
  const axisTop = stripTop + stripH + 4
  const H = axisTop + 20
  const plotW = Math.max(0, width - padL - padR)
  const step = n > 1 ? plotW / (n - 1) : 0
  const x = (i: number) => padL + (n > 1 ? i * step : plotW / 2)

  const ticks = useMemo(() => niceTicks(Math.max(1, ...days.map((d) => Math.max(d.visitors, d.views)))), [days])
  const top = ticks[ticks.length - 1]
  const y = (v: number) => padT + plotH - (v / top) * plotH


  const path = (k: 'visitors' | 'views') => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('')
  const area = n ? `${path('visitors')}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : ''

  // x labels at least ~70px apart, always including the last day
  const every = Math.max(1, Math.ceil(70 / Math.max(step, 1)))
  const xTicks = days.map((_, i) => i).filter((i) => (n - 1 - i) % every === 0)

  // direct end labels (desktop only); when the two would collide, push them apart and draw leader lines
  const last = n ? days[n - 1] : null
  let ends: { key: string; y0: number; y1: number; v: number; color: string }[] = []
  if (last && !phone) {
    ends = SERIES.map((s) => ({ key: s.key, y0: y(last[s.key]), y1: y(last[s.key]), v: last[s.key], color: s.color })).sort((a, b) => a.y0 - b.y0)
    if (ends[1].y1 - ends[0].y1 < 14) {
      const mid = (ends[0].y0 + ends[1].y0) / 2
      ends[0].y1 = mid - 7
      ends[1].y1 = mid + 7
    }
  }

  const maxSign = Math.max(0, ...days.map((d) => d.signups))
  const signLabels = step >= 12 || n <= 31

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect()
    const px = clientX - r.left
    const i = n > 1 ? Math.round((px - padL) / step) : 0
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setHover((h) => {
        const cur = h ?? n - 1
        if (e.key === 'Home') return 0
        if (e.key === 'End') return n - 1
        return Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)))
      })
    } else if (e.key === 'Escape') setHover(null)
  }

  const hd = hover != null ? days[hover] : null
  const tipLeft = hover != null ? x(hover) : 0
  const flip = tipLeft > width - 190

  return (
    <div ref={wrapRef} className={cn('relative w-full transition-opacity duration-200', dim && 'opacity-50')}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label={`Daily visitors and page views over ${n} days. Use the arrow keys to read each day; the table view lists every value.`}
          tabIndex={0}
          className="block touch-pan-y rounded-md outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
          onFocus={() => setHover((h) => h ?? n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          <defs>
            <clipPath id={`clip${clipId}`}>
              <rect x={padL - 4} y={0} width={plotW + 8} height={padT + plotH + 1} />
            </clipPath>
          </defs>
          {/* grid + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={y(t) + 0.5} y2={y(t) + 0.5} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                {compactNum(t)}
              </text>
            </g>
          ))}
          {/* series */}
          <g clipPath={`url(#clip${clipId})`}>
            <path d={area} fill="var(--viz-1)" fillOpacity={0.1} />
            {[...SERIES].reverse().map((s) => (
              <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </g>
          {/* end markers + direct labels */}
          {last &&
            SERIES.map((s) => <circle key={s.key} cx={x(n - 1)} cy={y(last[s.key])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />)}
          {ends.map((e) => (
            <g key={e.key}>
              {Math.abs(e.y1 - e.y0) > 1 && <line x1={x(n - 1) + 6} y1={e.y0} x2={x(n - 1) + 12} y2={e.y1} stroke="var(--viz-axis)" strokeWidth={1} />}
              <text x={x(n - 1) + 14} y={e.y1} dy="0.32em" className="fill-foreground font-mono text-[11px] font-medium tabular-nums">
                {compactNum(e.v)}
              </text>
            </g>
          ))}
          {/* sign-up strip */}
          <line x1={padL} x2={padL + plotW} y1={stripTop + stripH - 0.5} y2={stripTop + stripH - 0.5} stroke="var(--viz-grid)" strokeWidth={1} />
          <text x={padL - 8} y={stripTop + stripH - 9} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
            Sign-ups
          </text>
          {days.map((d, i) =>
            d.signups > 0 ? (
              <g key={d.day}>
                <circle cx={x(i)} cy={stripTop + stripH - 9} r={maxSign > 1 && d.signups === maxSign ? 5 : 4} fill={SIGNUPS.color} stroke="var(--card)" strokeWidth={2} />
                {signLabels && (
                  <text x={x(i)} y={stripTop + 6} textAnchor="middle" dy="0.32em" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                    {d.signups}
                  </text>
                )}
              </g>
            ) : null,
          )}
          {/* x axis labels */}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={axisTop + 10} textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'} className="fill-muted-foreground text-[10px]">
              {dayLabel(days[i].day)}
            </text>
          ))}
          {/* crosshair */}
          {hd && hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover) + 0.5} x2={x(hover) + 0.5} y1={padT} y2={stripTop + stripH} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(hd[s.key])} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              ))}
            </g>
          )}
          {/* full-height transparent hit layer so the pointer only has to be near a day */}
          <rect x={0} y={0} width={width} height={H} fill="transparent" />
        </svg>
      )}
      {!width && <div style={{ height: 300 }} />}
      {hd && hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-[172px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={flip ? { left: Math.max(0, tipLeft - 184) } : { left: tipLeft + 12 }}
          role="status"
          aria-live="polite"
        >
          <p className="mb-1.5 font-medium">{dayLabel(hd.day, true)}</p>
          {[...SERIES.map((s) => ({ label: s.label, color: s.color, v: hd[s.key], dot: false })), { label: SIGNUPS.label, color: SIGNUPS.color, v: hd.signups, dot: true }].map((r) => (
            <p key={r.label} className="flex items-center gap-2 py-0.5">
              {r.dot ? (
                <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
              ) : (
                <span className="h-[2px] w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              )}
              <span className="font-mono font-semibold tabular-nums">{num(r.v)}</span>
              <span className="text-muted-foreground">{r.label}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** The chart's table twin: every value, no hovering needed. */
export function DailyTable({ days }: { days: Day[] }) {
  return (
    <div className="max-h-[320px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 text-left font-medium sm:px-5">Day</th>
            <th className="px-3 py-2 text-right font-medium">Visitors</th>
            <th className="px-3 py-2 text-right font-medium">Page views</th>
            <th className="px-4 py-2 text-right font-medium sm:px-5">Sign-ups</th>
          </tr>
        </thead>
        <tbody>
          {[...days].reverse().map((d) => (
            <tr key={d.day} className="border-b last:border-0">
              <td className="px-4 py-1.5 whitespace-nowrap sm:px-5">{dayLabel(d.day, true)}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{num(d.visitors)}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{num(d.views)}</td>
              <td className="px-4 py-1.5 text-right font-mono tabular-nums sm:px-5">{num(d.signups)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
