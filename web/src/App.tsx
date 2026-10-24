import { lazy, Suspense, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { closeDrawer, go, match, useLocation } from '@/lib/router'
import { AuthDialog } from '@/components/shell/auth-dialog'
import { CommandPalette, openSearch } from '@/components/shell/command-palette'
import { Footer, Ribbon, useStatus } from '@/components/shell/footer'
import { Header } from '@/components/shell/header'
import { PerfumeDrawer } from '@/components/shell/perfume-drawer'

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
    if (loc.path === '/favorites') location.replace('#/atlas')
    else if (!found) go('/notes')
  }, [found, loc.path])
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

export default function App() {
  const { status, down } = useStatus()
  useEffect(() => {
    // "/" focuses the page's own search box (or opens global search); Escape closes the drawer
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
      } else if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) closeDrawer()
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
      <Footer status={status} />
      <PerfumeDrawer />
      <CommandPalette />
      <AuthDialog />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
