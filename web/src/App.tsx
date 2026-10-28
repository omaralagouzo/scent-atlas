import { lazy, Suspense, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { go, match, perfumeHref, useLocation } from '@/lib/router'
import { AuthDialog } from '@/components/shell/auth-dialog'
import { CommandPalette, openSearch } from '@/components/shell/command-palette'
import { Footer, Ribbon, useStatus } from '@/components/shell/footer'
import { Header } from '@/components/shell/header'
import { toast } from 'sonner'
import { ProfileEditor, openProfileEditor } from '@/components/profile-editor'
import { useSession } from '@/lib/store'
import { trackView } from '@/lib/track'

export interface ViewProps {
  args: Record<string, string>
  /** the URL query (without `p`) at mount time */
  params: URLSearchParams
  path: string
}

const Notes = lazy(() => import('@/views/notes'))
const NoteView = lazy(() => import('@/views/note'))
const Combine = lazy(() => import('@/views/combine'))
const Pyramid = lazy(() => import('@/views/pyramid'))
const Like = lazy(() => import('@/views/like'))
const Layering = lazy(() => import('@/views/layering'))
const Collection = lazy(() => import('@/views/collection'))
const Atlas = lazy(() => import('@/views/atlas'))
const About = lazy(() => import('@/views/about'))
const Friends = lazy(() => import('@/views/friends'))
const Profile = lazy(() => import('@/views/profile'))
const PerfumePage = lazy(() => import('@/views/perfume'))
const People = lazy(() => import('@/views/people'))
const Market = lazy(() => import('@/views/market'))
const ListingView = lazy(() => import('@/views/listing'))
const MarketEdit = lazy(() => import('@/views/market-edit'))
const MarketMine = lazy(() => import('@/views/market-mine'))
const Messages = lazy(() => import('@/views/messages'))

const ROUTES: [string, React.ComponentType<ViewProps>][] = [
  ['/notes', Notes],
  ['/note/:slug', NoteView],
  ['/combine', Combine],
  ['/pyramid', Pyramid],
  ['/like', Like],
  ['/like/:id', Like],
  ['/atlas', Atlas],
  ['/collection', Collection],
  ['/layering', Layering],
  ['/layering/:id', Layering],
  ['/layering/:id/:other', Layering],
  ['/about', About],
  ['/friends', Friends],
  ['/u/:username', Profile],
  ['/perfume/:id', PerfumePage],
  ['/people', People],
  ['/market', Market],
  ['/market/new', MarketEdit],
  ['/market/mine', MarketMine],
  ['/market/:id/edit', MarketEdit],
  ['/market/:id', ListingView],
  ['/messages', Messages],
  ['/messages/:id', Messages],
]

function Router() {
  const loc = useLocation()
  let found: [React.ComponentType<ViewProps>, Record<string, string>] | null = null
  for (const [pattern, C] of ROUTES) {
    const args = match(pattern, loc.path)
    if (args) {
      found = [C, args]
      break
    }
  }
  useEffect(() => {
    if (found && !loc.drawer) trackView(loc.path)
  }, [loc.path, !!found, loc.drawer]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loc.drawer) location.replace(perfumeHref(loc.drawer)) // old links opened a drawer: ?p=<id>
    else if (loc.path === '/favorites') location.replace('#/atlas')
    else if (!found) go('/notes')
  }, [found, loc.path, loc.drawer])
  if (!found) return null
  const [View, args] = found
  const params = new URLSearchParams(loc.params)
  params.delete('p')
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      }
    >
      <View key={loc.mount} args={args} params={params} path={loc.path} />
    </Suspense>
  )
}

/** Accounts still called "User Name" get one gentle, self-dismissing nudge per visit to add their real name. */
function NamePrompt() {
  const { user } = useSession()
  useEffect(() => {
    if (!user?.needs_name) return
    const key = `sa-name-prompt-${user.id}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      /* storage blocked: still show it once for this page load */
    }
    const t = setTimeout(
      () => toast('Add your name so friends and family can find you.', { duration: 8000, action: { label: 'Add name', onClick: openProfileEditor } }),
      1200,
    )
    return () => clearTimeout(t)
  }, [user?.id, user?.needs_name])
  return null
}

export default function App() {
  const { status, down } = useStatus()
  useEffect(() => {
    // "/" focuses the page's own search box (or opens global search)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const tag = (t.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !document.querySelector('[role="dialog"]')) {
        e.preventDefault()
        const s = document.querySelector<HTMLInputElement>('main [data-search]')
        if (s) {
          s.focus()
          s.select?.()
        } else openSearch()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <TooltipProvider delayDuration={250}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      <Header />
      <Ribbon status={status} down={down} />
      <main id="main" tabIndex={-1} className="min-h-[70vh] outline-none">
        <Router />
      </main>
      <Footer />
      <ProfileEditor />
      <NamePrompt />
      <CommandPalette />
      <AuthDialog />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
