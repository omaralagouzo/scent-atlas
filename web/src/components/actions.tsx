// Per-perfume personal actions: favourite heart and the owned / tried / wishlist menu.
import { useState } from 'react'
import { Bookmark, BookmarkCheck, Check, Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { favs, mine, requireAuth, STATUS_LABEL, useFav, useMine, useSession } from '@/lib/store'
import type { Status } from '@/lib/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const stop = (e: React.SyntheticEvent) => {
  e.stopPropagation()
  e.preventDefault()
}

export function HeartButton({ type = 'perfume', id, label = 'Favorite', className }: { type?: 'perfume' | 'note'; id: number | string; label?: string; className?: string }) {
  const on = useFav(type, id)
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={(e) => {
        stop(e)
        favs.toggle(type, id)
      }}
      className={cn(
        'grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        on && 'text-[#e5484d] hover:text-[#e5484d]',
        className,
      )}
    >
      <Heart className={cn('size-[18px] transition-transform', on && 'scale-110 fill-current')} />
    </button>
  )
}

const OPTIONS: Status[] = ['owned', 'tried', 'wishlist']

export function StatusButton({ pid, className }: { pid: number | string; className?: string }) {
  const s = useMine(pid)?.status || null
  const { user } = useSession()
  const [open, setOpen] = useState(false)
  const label = s ? `${STATUS_LABEL[s]} - change status` : 'Mark as owned, tried or wishlist'
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        if (o && !user) {
          requireAuth('Sign in to track what you own, have tried, or want.').then((ok) => ok && setOpen(true))
          return
        }
        setOpen(o)
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title="Owned · Tried · Wishlist"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            s && 'text-brand-ink hover:text-brand-ink',
            className,
          )}
        >
          {s ? <BookmarkCheck className="size-[18px] fill-brand-soft" /> : <Bookmark className="size-[18px]" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="min-w-40">
        <DropdownMenuLabel className="text-xs text-muted-foreground">My status</DropdownMenuLabel>
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o} onSelect={() => mine.save(pid, { status: o }).catch(() => {})}>
            <Check className={cn('size-4', s === o ? 'opacity-100' : 'opacity-0')} />
            {STATUS_LABEL[o]}
          </DropdownMenuItem>
        ))}
        {s && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => mine.save(pid, { status: null }).catch(() => {})}>
              <span className="size-4" />
              Clear status
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
