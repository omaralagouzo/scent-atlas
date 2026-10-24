import { Moon, Search, Sun } from 'lucide-react'
import { useLocation } from '@/lib/router'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Logo, Wordmark } from '@/components/brand'
import { AccountMenu } from './account-menu'
import { openSearch } from './command-palette'
import { NAV } from './nav'

export function Header() {
  const { path } = useLocation()
  const { theme, toggle } = useTheme()
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:h-16 sm:gap-5 sm:px-6">
        <a href="#/notes" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-label="Scent Atlas home">
          <Logo size={30} />
          <Wordmark className="hidden text-[17px] sm:inline" />
        </a>
        <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 lg:flex">
          {NAV.map((n) => {
            const on = n.match(path)
            return (
              <a
                key={n.href}
                href={`#${n.href}`}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
                  on && 'bg-muted font-medium text-foreground',
                )}
              >
                {n.label}
              </a>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={openSearch}
            className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:w-56 xl:w-64"
            aria-label="Search perfumes, notes and pages"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search…</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[11px] sm:inline">⌘K</kbd>
          </button>
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <AccountMenu />
        </div>
      </div>
      {/* below lg the nav scrolls sideways under the header */}
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 scrollbar-none lg:hidden">
        {NAV.map((n) => {
          const on = n.match(path)
          return (
            <a
              key={n.href}
              href={`#${n.href}`}
              aria-current={on ? 'page' : undefined}
              ref={(el) => {
                if (on && el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground', on && 'bg-foreground font-medium text-background')}
            >
              <n.icon className="size-3.5" />
              {n.label}
            </a>
          )
        })}
      </nav>
    </header>
  )
}
