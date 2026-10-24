// Match score as a thin ring gauge: a full circle is 100%. The colour runs from red (50% and below) through
// yellow (~70%) to green (90% and above).
import { cn } from '@/lib/utils'

export function scoreColor(pct: number) {
  const t = Math.max(0, Math.min(1, (pct - 50) / 40))
  return `oklch(0.64 0.16 ${25 + t * 120})`
}

export function ScoreRing({ pct, size = 46, className, title }: { pct: number; size?: number; className?: string; title?: string }) {
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, pct))
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center rounded-full bg-card/90 backdrop-blur-sm', className)} style={{ width: size, height: size }} title={title ?? `${v}% match`} role="img" aria-label={`${v}% match`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(v)} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <span className="font-mono text-[13px] leading-none font-semibold tabular-nums" style={{ fontSize: size * 0.29 }}>
        {v}
        <span className="text-[0.7em] text-muted-foreground">%</span>
      </span>
    </span>
  )
}
