// Admin shell: boots from /api/admin/me, then shows sign-in or the dashboard (hash routes, so it works at / and /admin).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Activity, BarChart3, LogOut, Moon, ShieldCheck, Store, Sun, Users } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Logo, Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { admin, onSignedOut, type Me } from './data'
import { Disabled, SignIn } from './sign-in'
import { Overview } from './overview'
import { People } from './people'
import { ActivityFeed } from './activity'
import { Security } from './security'
import { Market, usePendingCount } from './market'

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'people', label: 'People', icon: Users },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'market', label: 'Marketplace', icon: Store },
  { key: 'security', label: 'Security', icon: ShieldCheck },
] as const
type Tab = (typeof TABS)[number]['key']

const readTab = (): Tab => {
  const k = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (TABS.find((t) => t.key === k)?.key || 'overview') as Tab
}
const subscribeHash = (fn: () => void) => {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}

type State = { kind: 'loading' } | { kind: 'disabled' } | { kind: 'error' } | { kind: 'signed-out'; me: Me } | { kind: 'in'; me: Me }

export function AdminApp() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const boot = useCallback(async () => {
    try {
      const me = await admin.me()
      setState(me.authenticated ? { kind: 'in', me } : { kind: 'signed-out', me })
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? { kind: 'disabled' } : { kind: 'error' })
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])
  useEffect(() => onSignedOut(() => setState((s) => (s.kind === 'in' ? { kind: 'signed-out', me: { ...s.me, authenticated: false } } : s))), [])

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-svh flex-col bg-background text-foreground">
        {state.kind === 'in' ? (
          <Dashboard
            me={state.me}
            onSignOut={async () => {
              try {
                await admin.logout()
              } catch {
                /* the cookie is cleared server-side either way */
              }
              setState({ kind: 'signed-out', me: { ...state.me, authenticated: false } })
            }}
          />
        ) : (
          <>
            <BareHeader />
            <main className="grid flex-1 place-items-start justify-center px-4 pt-[12vh] pb-16">
              {state.kind === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
              {state.kind === 'disabled' && <Disabled />}
              {state.kind === 'error' && (
                <div className="w-full max-w-sm text-center">
                  <h1 className="text-xl font-semibold tracking-[-0.02em]">Can't reach the server</h1>
                  <p className="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
                  <Button className="mt-5" variant="outline" onClick={() => void boot()}>
                    Try again
                  </Button>
                </div>
              )}
              {state.kind === 'signed-out' && <SignIn twoFactor={state.me.two_factor} onDone={() => void boot()} />}
            </main>
          </>
        )}
      </div>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

function ThemeButton() {
  const { theme, toggle } = useTheme()
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}

function Brand() {
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <Logo size={28} />
      <Wordmark className="hidden text-[16px] sm:inline" />
      <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">Admin</span>
    </span>
  )
}

function BareHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:h-16 sm:px-6">
        <Brand />
        <div className="ml-auto">
          <ThemeButton />
        </div>
      </div>
    </header>
  )
}

function Dashboard({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const tab = useSyncExternalStore(subscribeHash, readTab)
  const pending = usePendingCount()
  const link = (t: (typeof TABS)[number], compact: boolean) => {
    const on = t.key === tab
    return (
      <a
        key={t.key}
        href={`#/${t.key}`}
        aria-current={on ? 'page' : undefined}
        className={cn(
          compact
            ? 'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground'
            : 'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
          on && (compact ? 'bg-foreground font-medium text-background' : 'bg-muted font-medium text-foreground'),
          'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        )}
      >
        <t.icon className="size-4 opacity-80" />
        {t.label}
        {t.key === 'market' && !!pending && (
          <span
            className={cn(
              'min-w-[18px] rounded-full px-1.5 text-center font-mono text-[11px] leading-[18px] font-semibold tabular-nums',
              on && compact ? 'bg-background text-foreground' : 'bg-brand text-brand-foreground',
            )}
            aria-label={`${pending} waiting for review`}
          >
            {pending > 99 ? '99+' : pending}
          </span>
        )}
      </a>
    )
  }
  const compactNav = useRef<HTMLElement>(null)
  useEffect(() => {
    document.title = `${TABS.find((t) => t.key === tab)?.label} · Scent Atlas admin`
    window.scrollTo(0, 0)
  }, [tab])
  // phones: keep the current tab (with its badge) visible in the scrolling pill row
  useEffect(() => {
    compactNav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab, pending])
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:h-16 sm:gap-5 sm:px-6">
          <Brand />
          <nav aria-label="Admin" className="hidden items-center gap-0.5 md:flex">
            {TABS.map((t) => link(t, false))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeButton />
            <Button variant="outline" size="sm" onClick={onSignOut}>
              <LogOut />
              Sign out
            </Button>
          </div>
        </div>
        <nav ref={compactNav} aria-label="Admin" className="flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain px-3 pb-2 scrollbar-none md:hidden">
          {TABS.map((t) => link(t, true))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-16 sm:px-6 sm:pt-8">
        {tab === 'overview' && <Overview />}
        {tab === 'people' && <People />}
        {tab === 'activity' && <ActivityFeed />}
        {tab === 'market' && <Market />}
        {tab === 'security' && <Security twoFactor={me.two_factor} />}
      </main>
    </>
  )
}
