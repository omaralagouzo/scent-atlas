import { ChevronDown, Compass, Moon, Search, Sun } from 'lucide-react'
import { go, useLocation } from '@/lib/router'
import { useFriends } from '@/lib/social'
import { useSession } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Logo, Wordmark } from '@/components/brand'
import { AccountMenu } from './account-menu'
import { openSearch } from './command-palette'
import { DISCOVER, MAIN } from './nav'
import { NotificationBell } from './notifications'

/** "Discover fragrances" menu: the exploring tools, each with a one-line explanation. */
function DiscoverMenu({ path, compact = false }: { path: string; compact?: boolean }) {
  const current = DISCOVER.find((n) => n.match(path))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          compact
            ? 'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground outline-none'
            : 'flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:text-foreground',
          current && (compact ? 'bg-foreground font-medium text-background' : 'bg-muted font-medium text-foreground'),
        )}
      >
        {compact && (current ? <current.icon className="size-3.5" /> : <Compass className="size-3.5" />)}
        {compact && current ? current.label : 'Discover fragrances'}
        <ChevronDown className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(340px,calc(100vw-24px))] p-1.5">
        {DISCOVER.map((n) => (
          <DropdownMenuItem key={n.href} onSelect={() => go(n.href)} className={cn('items-start gap-3 rounded-lg px-2.5 py-2', n.match(path) && 'bg-muted')}>
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border bg-card">
              <n.icon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{n.label}</span>
              <span className="text-xs leading-snug text-muted-foreground">{n.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Header() {
  const { path } = useLocation()
  const { user } = useSession()
  const { theme, toggle } = useTheme()
  const incoming = useFriends()?.incoming.length || 0
  const badge = (href: string) =>
    href === '/friends' && incoming > 0 ? (
      <span className="ml-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 font-mono text-[10px] font-semibold text-brand-foreground" aria-label={`${incoming} friend requests`}>
        {incoming}
      </span>
    ) : null
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:h-16 sm:gap-5 sm:px-6">
        <a href="#/notes" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-label="Scent Atlas home">
          <Logo size={30} />
          <Wordmark className="hidden text-[17px] sm:inline" />
        </a>
        <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 lg:flex">
          <DiscoverMenu path={path} />
          {MAIN.map((n) => {
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
                {badge(n.href)}
              </a>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={openSearch}
            className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:w-56 xl:w-64"
            aria-label="Search fragrances, brands, notes and people"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search…</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[11px] sm:inline">⌘K</kbd>
          </button>
          {user && <NotificationBell />}
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <AccountMenu />
        </div>
      </div>
      {/* below lg the nav scrolls sideways under the header */}
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-t px-3 py-1.5 scrollbar-none lg:hidden">
        <DiscoverMenu path={path} compact />
        {MAIN.map((n) => {
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
              {badge(n.href)}
            </a>
          )
        })}
      </nav>
    </header>
  )
}
