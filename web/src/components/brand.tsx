// The Scent Atlas mark: a four-wing moth whose hindwings form an "A", cut out of an ember tile.
import { useId } from 'react'
import { cn } from '@/lib/utils'

const WINGS = [
  'M8 -8C13 -68 49 -118 99 -126C95 -68 63 -22 8 -8Z',
  'M8 8C11.3 47.6 35.06 80.6 68.06 85.88C65.42 47.6 44.3 17.24 8 8Z',
  'M-8 -8C-13 -68 -49 -118 -99 -126C-95 -68 -63 -22 -8 -8Z',
  'M-8 8C-11.3 47.6 -35.06 80.6 -68.06 85.88C-65.42 47.6 -44.3 17.24 -8 8Z',
]

/** The app-icon tile. `grain` adds the 15% static (skip it below ~24px, where it only adds noise). */
export function Logo({ size = 32, grain = size >= 24, className }: { size?: number; grain?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg viewBox="-100 -100 200 200" width={size} height={size} className={cn('shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF9A4D" />
          <stop offset=".5" stopColor="#F77F2F" />
          <stop offset="1" stopColor="#E0651F" />
        </linearGradient>
        <clipPath id={`c${id}`}>
          <rect x="-100" y="-100" width="200" height="200" rx="46" />
        </clipPath>
        {grain && (
          <filter id={`n${id}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="linear" slope="3" intercept="-1" />
              <feFuncG type="linear" slope="3" intercept="-1" />
              <feFuncB type="linear" slope="3" intercept="-1" />
              <feFuncA type="linear" slope="0" intercept="1" />
            </feComponentTransfer>
          </filter>
        )}
      </defs>
      <g clipPath={`url(#c${id})`}>
        <rect x="-100" y="-100" width="200" height="200" fill={`url(#g${id})`} />
        {grain && <rect x="-100" y="-100" width="200" height="200" filter={`url(#n${id})`} opacity="0.15" />}
      </g>
      <g transform="translate(0 15.15) scale(0.7551)" fill="#fff">
        {WINGS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}

/** The moth alone, in the current text colour. */
export function Glyph({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="-102 -129 204 218" height={size} width={(size * 204) / 218} className={cn('shrink-0', className)} fill="currentColor" aria-hidden="true">
      {WINGS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-semibold tracking-[-0.04em]', className)}>Scent Atlas</span>
}
