// Small layout pieces shared by the admin screens.
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/avatar'
import type { MiniUser } from './data'

/** One title and at most one line of explanation (docs/DESIGN.md "Page headers"). */
export function PageHead({ title, lede, children }: { title: string; lede?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-[28px]">{title}</h1>
        {lede && <p className="mt-1 text-sm text-muted-foreground">{lede}</p>}
      </div>
      {children}
    </div>
  )
}

/** A flat bordered card with a title row. */
export function Panel({ title, hint, action, className, children }: { title: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border bg-card', className)}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A member (photo, name, @username) or an anonymous visitor ("Visitor a1b2c3"). */
export function Who({ user, visitor, size = 28, className }: { user: MiniUser | null; visitor?: string; size?: number; className?: string }) {
  if (!user)
    return (
      <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
        <span className="grid shrink-0 place-items-center rounded-full border border-dashed text-muted-foreground" style={{ width: size, height: size }} aria-hidden="true">
          <svg viewBox="0 0 16 16" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="5.5" r="2.75" />
            <path d="M2.75 14c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          Visitor <span className="font-mono text-xs">{(visitor || '').slice(0, 6)}</span>
        </span>
      </span>
    )
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <UserAvatar name={user.name || user.username} seed={user.username} src={user.avatar} size={size} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{user.name || user.username}</span>
        <span className="truncate text-xs text-muted-foreground">@{user.username}</span>
      </span>
    </span>
  )
}

/** Centered muted line for empty / error states inside a panel or table. */
export function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('px-4 py-8 text-center text-sm text-muted-foreground', className)}>{children}</p>
}
