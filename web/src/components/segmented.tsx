// Segmented control (a shadcn ToggleGroup that always keeps one value selected).
import { cn } from '@/lib/utils'

export interface SegOption<T extends string | number> {
  value: T
  label: React.ReactNode
  title?: string
}

export function Segmented<T extends string | number>({ options, value, onChange, label, size = 'default', className }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label?: string; size?: 'sm' | 'default'; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-lg bg-muted p-[3px] scrollbar-none', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            title={o.title}
            aria-pressed={on}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              on && 'bg-card text-foreground shadow-sm',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
