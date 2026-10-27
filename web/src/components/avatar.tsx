// A member's profile photo, or their initial on a colour derived from their username (stable, muted).
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function UserAvatar({ name, seed, src, size = 32, className }: { name: string; seed?: string; src?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null)
  let h = 0
  for (const c of seed || name) h = (h * 31 + c.charCodeAt(0)) % 360
  if (src && broken !== src)
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(src)}
        className={cn('shrink-0 rounded-full bg-muted object-cover', className)}
        style={{ width: size, height: size }}
      />
    )
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white select-none', className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.66 0.09 ${h})` }}
      aria-hidden="true"
    >
      {name.trim()[0]?.toUpperCase()}
    </span>
  )
}
