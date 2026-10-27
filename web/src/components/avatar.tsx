// A member's profile photo, or their initial on a colour derived from their username (stable, muted). With `top`,
// their #1 bottle sits in a small translucent white disc at the bottom centre of the photo.
import { useState } from 'react'
import { perfumeHref } from '@/lib/router'
import type { TopBottle } from '@/lib/types'
import { cn } from '@/lib/utils'
import { BottleImg } from '@/components/media'

export function UserAvatar({
  name,
  seed,
  src,
  size = 32,
  className,
  top,
  linkTop = false,
}: {
  name: string
  seed?: string
  src?: string | null
  size?: number
  className?: string
  /** their #1 bottle (only sent for yourself and your friends) */
  top?: TopBottle | null
  /** make the bottle a link to its page (only where the avatar is not itself inside a link) */
  linkTop?: boolean
}) {
  const [broken, setBroken] = useState<string | null>(null)
  let h = 0
  for (const c of seed || name) h = (h * 31 + c.charCodeAt(0)) % 360
  const badge = top && size >= 24
  const face =
    src && broken !== src ? (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(src)}
        className={cn('shrink-0 rounded-full bg-muted object-cover', badge && 'block', className)}
        style={{ width: size, height: size }}
      />
    ) : (
      <span
        className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white select-none', className)}
        style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.66 0.09 ${h})` }}
        aria-hidden="true"
      >
        {name.trim()[0]?.toUpperCase()}
      </span>
    )
  if (!badge) return face
  // The bottle photo is multiplied so its white background melts into the disc. That only works while neither the
  // disc nor anything between it and the photo starts a stacking context: no transform, blur, opacity or z-index.
  const b = Math.max(13, Math.round(size * 0.38))
  const cls = cn(
    'absolute grid place-items-center overflow-hidden rounded-full bg-white/75 ring-background',
    size >= 64 ? 'shadow-[0_1px_3px_rgb(0_0_0/0.18)] ring-2' : 'shadow-[0_1px_2px_rgb(0_0_0/0.16)] ring-[1.5px]',
  )
  const style = { width: b, height: b, left: `calc(50% - ${b / 2}px)`, bottom: -Math.round(b * 0.22) }
  const img = <BottleImg p={{ id: top.id, image: top.image || '' }} alt="" className="size-[78%] object-contain mix-blend-multiply" />
  const label = `#1: ${top.name} by ${top.brand}`
  return (
    <span className="relative inline-block shrink-0 align-middle" style={{ width: size, height: size }}>
      {face}
      {linkTop ? (
        <a href={perfumeHref(top.id)} title={label} aria-label={`Number one fragrance: ${top.name} by ${top.brand}`} className={cn(cls, 'transition-shadow hover:shadow-[0_2px_8px_rgb(0_0_0/0.28)] focus-visible:ring-ring focus-visible:outline-none')} style={style}>
          {img}
        </a>
      ) : (
        <span title={label} className={cls} style={style}>
          {img}
        </span>
      )}
    </span>
  )
}
