// Images that may point straight at fimgs.net / Wikimedia: on error we swap in the server's generated SVG once,
// and only then give up (a neutral tile stays in place).
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { noteImg } from '@/lib/format'
import type { Note } from '@/lib/types'

export function SmartImg({ src, fallback, alt = '', className }: { src: string; fallback?: string; alt?: string; className?: string }) {
  const [cur, setCur] = useState(src)
  const [state, setState] = useState<'loading' | 'loaded' | 'broken'>('loading')
  if (cur !== src && cur !== fallback) {
    // the src prop changed (a different perfume in the same slot)
    setCur(src)
    setState('loading')
  }
  return (
    <img
      src={cur}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      className={cn('lazy', state !== 'loading' && 'loaded', state === 'broken' && 'invisible', className)}
      onLoad={() => setState('loaded')}
      onError={() => {
        if (fallback && cur !== fallback) setCur(fallback)
        else setState('broken')
      }}
    />
  )
}

export function BottleImg({ p, alt, className }: { p: { id: number; image: string; name?: string }; alt?: string; className?: string }) {
  return <SmartImg src={p.image} fallback={`/img/perfume/${p.id}`} alt={alt ?? (p.name ? `${p.name} bottle` : '')} className={cn('object-contain', className)} />
}

export function NoteImg({ n, alt = '', className }: { n: Pick<Note, 'slug' | 'image'>; alt?: string; className?: string }) {
  return <SmartImg src={n.image || noteImg(n.slug)} fallback={noteImg(n.slug)} alt={alt} className={cn('object-cover', className)} />
}

/** A square bottle thumbnail on a quiet sand tile (the photos have white backgrounds). */
export function BottleThumb({ p, size = 48, className }: { p: { id: number; image: string; name?: string }; size?: number; className?: string }) {
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white dark:bg-sand-100', className)}
      style={{ width: size, height: size }}
    >
      <BottleImg p={p} className="h-full w-full mix-blend-multiply" />
    </span>
  )
}
