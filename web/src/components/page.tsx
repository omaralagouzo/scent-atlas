// Page scaffolding shared by every view.
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function Page({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-4 pt-6 pb-16 sm:px-6 sm:pt-8', wide ? 'max-w-[1400px]' : 'max-w-6xl', className)}>{children}</div>
}

/** One title and at most one line of explanation (it may wrap on narrow screens). */
export function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-lg font-semibold tracking-[-0.02em]">{children}</h2>
      {action}
    </div>
  )
}

export function EmptyState({ icon, title, children, action, className }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center', className)}>
      {icon && <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
      {action}
    </div>
  )
}

/** Footer of an infinite list: spinner, retry, or the empty message. */
export function ListStatus({ loading, error, empty, emptyText = 'Nothing to show.', retry, sentinel }: { loading: boolean; error: boolean; empty: boolean; emptyText?: React.ReactNode; retry: () => void; sentinel: React.Ref<HTMLDivElement> }) {
  return (
    <>
      <div ref={sentinel} aria-hidden="true" />
      {loading && (
        <div className="flex justify-center py-8 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {error && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Could not load.{' '}
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </p>
      )}
      {empty && <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>}
    </>
  )
}
