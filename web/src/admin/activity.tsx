// Activity: recent page views, newest first. Refreshes every 30 s while the tab is visible; "Load more" pages back.
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { admin, deviceName, fullTime, useVisibleInterval, when, type ActivityPage, type Hit } from './data'
import { Muted, PageHead, Who } from './parts'

const PAGE = 100

export function ActivityFeed() {
  const [items, setItems] = useState<Hit[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<'top' | 'more' | null>(null)
  const [fresh, setFresh] = useState<Set<number>>(new Set())
  const [updated, setUpdated] = useState<number | null>(null)
  const known = useRef<Set<number>>(new Set())

  // newest page; merges into what is already loaded so older pages fetched with "Load more" stay put
  const refresh = useCallback(async () => {
    setBusy((b) => b || 'top')
    try {
      const r = await admin.get<ActivityPage>('/activity', { limit: PAGE })
      const first = known.current.size === 0
      const added = r.items.filter((h) => !known.current.has(h.id))
      added.forEach((h) => known.current.add(h.id))
      if (first) {
        setItems(r.items)
        setNext(r.next_before)
      } else if (added.length) setItems((cur) => [...added, ...(cur || [])].sort((a, b) => b.id - a.id))
      setFresh(first ? new Set() : new Set(added.map((h) => h.id)))
      setUpdated(Date.now())
      setErr('')
    } catch (e) {
      setErr(errorText(e, "Couldn't load activity."))
    } finally {
      setBusy((b) => (b === 'top' ? null : b))
    }
  }, [])

  const more = async () => {
    if (!next) return
    setBusy('more')
    try {
      const r = await admin.get<ActivityPage>('/activity', { limit: PAGE, before: next })
      const added = r.items.filter((h) => !known.current.has(h.id))
      added.forEach((h) => known.current.add(h.id))
      setItems((cur) => [...(cur || []), ...added])
      setNext(r.next_before)
    } catch (e) {
      setErr(errorText(e, "Couldn't load more."))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [refresh])
  useVisibleInterval(() => void refresh(), 30_000)

  return (
    <>
      <PageHead title="Activity" lede="Page views as they happen. Updates every 30 seconds while this tab is open.">
        <div className="flex items-center gap-3">
          {updated && <span className="text-xs text-muted-foreground">Updated {new Date(updated).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={!!busy} className="text-muted-foreground">
            <RefreshCw className={cn(busy === 'top' && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </PageHead>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                {['Time', 'Who', 'Page', 'Device', 'Browser', 'Location'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2.5 text-left font-medium whitespace-nowrap first:pl-4 last:pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!items &&
                !err &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td colSpan={6} className="px-4 py-2.5">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))}
              {err && !items && (
                <tr>
                  <td colSpan={6}>
                    <Muted>{err}</Muted>
                  </td>
                </tr>
              )}
              {items?.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Muted>No page views recorded yet.</Muted>
                  </td>
                </tr>
              )}
              {items?.map((h) => (
                <tr key={h.id} className={cn('border-b transition-colors duration-1000 last:border-0', fresh.has(h.id) && 'bg-muted/60')}>
                  <td className="py-2 pr-3 pl-4 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                    <time dateTime={new Date(h.ts * 1000).toISOString()} title={fullTime(h.ts)}>
                      {when(h.ts)}
                    </time>
                  </td>
                  <td className="max-w-[220px] px-3 py-1.5">
                    <Who user={h.user} visitor={h.visitor} size={26} />
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    <span className="block truncate" title={h.path}>
                      {h.label || h.path}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{deviceName(h.device)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{h.browser || '–'}</td>
                  <td className="max-w-[200px] truncate py-2 pr-4 pl-3 text-muted-foreground">{h.place || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && items && <p className="border-t px-4 py-2 text-xs text-destructive">{err}</p>}
        {next && (
          <div className="border-t px-2 py-1.5">
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" disabled={!!busy} onClick={() => void more()}>
              {busy === 'more' ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
