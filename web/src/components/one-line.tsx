// A wrapping row of chips that shows one line until "Show more" expands it.
import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function OneLine({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const [line, setLine] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const first = el.firstElementChild as HTMLElement | null
      if (!first) return setOverflows(false)
      const h = first.offsetHeight
      setLine(h)
      // anything starting below the first row means there is more than one line
      const top = first.offsetTop
      setOverflows([...el.children].some((c) => (c as HTMLElement).offsetTop > top + 2))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [children])
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <div ref={box} role="group" aria-label={label} className="flex min-w-0 flex-1 flex-wrap gap-1.5 overflow-hidden" style={!open && line ? { maxHeight: line } : undefined}>
        {children}
      </div>
      {(overflows || open) && (
        <Button size="sm" variant="ghost" className="h-8 shrink-0 text-muted-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  )
}
