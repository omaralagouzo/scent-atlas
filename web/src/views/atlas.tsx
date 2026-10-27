// My Atlas now lives on my own profile (#/u/<me>): taste profile, saved searches and history are its private tabs.
// #/atlas (and old links to it) redirect there, keeping a tab when the link named one.
import { useEffect } from 'react'
import { UserRound } from 'lucide-react'
import type { ViewProps } from '@/App'
import { authDialog, useSession } from '@/lib/store'
import { buildHash } from '@/lib/router'
import { EmptyState, Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// old My Atlas tab names → profile tabs
const TAB: Record<string, string> = { taste: 'taste', profile: 'taste', saved: 'saved', history: 'history', favorites: 'favorites', wishlist: 'wishlist', tried: 'tried' }

export default function AtlasView({ params }: ViewProps) {
  const { user, loaded } = useSession()
  const tab = TAB[params.get('tab') || ''] || 'taste'
  useEffect(() => {
    if (user) location.replace(buildHash(`/u/${encodeURIComponent(user.username)}`, { tab }))
  }, [user, tab])

  if (!loaded || user)
    return (
      <Page>
        <Skeleton className="h-40 w-full rounded-2xl" />
      </Page>
    )

  return (
    <Page>
      <PageHeader title="My Atlas" description="Your profile, shelf, taste profile, saved searches and history in one place." />
      <EmptyState
        icon={<UserRound className="size-5" />}
        title="Sign in to see your atlas"
        action={
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button onClick={() => authDialog.open({ mode: 'login' })}>Sign in</Button>
            <Button variant="outline" onClick={() => authDialog.open({ mode: 'signup' })}>
              Create an account
            </Button>
          </div>
        }
      >
        Browsing and searching work without an account. Sign in to keep favorites, a collection, saved searches and history.
      </EmptyState>
    </Page>
  )
}
