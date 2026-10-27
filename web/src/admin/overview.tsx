// Overview: headline numbers, the daily chart and the ranked lists for the selected range.
import { useState } from 'react'
import { RefreshCw, Table2 } from 'lucide-react'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BottleThumb } from '@/components/media'
import { Segmented } from '@/components/segmented'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { browserTz, deviceName, num, useLoad, useVisibleInterval, type Analytics } from './data'
import { DailyChart, DailyLegend, DailyTable } from './chart'
import { RankedList } from './ranked'
import { Muted, PageHead, Panel } from './parts'

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

function Tile({ label, value, hint, live }: { label: string; value: number | undefined; hint?: string; live?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-4 py-3.5">
      <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        {live && <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />}
        {label}
      </span>
      {value === undefined ? <Skeleton className="h-8 w-16" /> : <span className="font-mono text-2xl leading-8 font-semibold tracking-[-0.02em]">{num(value)}</span>}
      {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function Overview() {
  const [days, setDays] = useState<Range>(30)
  const [table, setTable] = useState(false)
  const tz = browserTz()
  const { data, error, loading, reload } = useLoad<Analytics>('/analytics', { days, tz })
  // the dashboard stays current while it's open
  useVisibleInterval(reload, 60_000)
  const t = data?.totals
  const stale = loading && !!data && data.days !== days

  return (
    <>
      <PageHead title="Overview" lede="Who visits Scent Atlas, where they go, and who joined.">
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading} className="text-muted-foreground">
          <RefreshCw className={cn(loading && 'animate-spin')} />
          Refresh
        </Button>
      </PageHead>

      {!!error && !data ? (
        <Panel title="Couldn't load analytics">
          <Muted>{errorText(error, 'The server did not answer.')}</Muted>
        </Panel>
      ) : (
        <>
          <section aria-label="Traffic" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="Active now" value={t?.active_now} live />
            <Tile label="Visitors today" value={t?.visitors_today} />
            <Tile label="Visitors, 7 days" value={t?.visitors_7d} />
            <Tile label="Visitors, 30 days" value={t?.visitors_30d} />
            <Tile label="Page views, 30 days" value={t?.views_30d} />
          </section>
          <section aria-label="Accounts" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Signed-in visitors, 30 days" value={t?.signed_in_30d} />
            <Tile label="Accounts" value={t?.accounts_total} />
            <Tile label="New accounts, 7 days" value={t?.accounts_new_7d} />
            <Tile label="New accounts, 30 days" value={t?.accounts_new_30d} />
          </section>

          {/* one filter row, above everything it scopes */}
          <div className="mt-8 mb-3 flex flex-wrap items-center gap-3">
            <Segmented<Range> label="Range" options={RANGES.map((r) => ({ value: r, label: `${r} days` }))} value={days} onChange={setDays} />
            <span className="text-xs text-muted-foreground">Days in your time zone ({tz}).</span>
          </div>

          <Panel
            title="Visitors and page views"
            hint={`Daily, last ${days} days`}
            action={
              <Button variant={table ? 'secondary' : 'ghost'} size="sm" aria-pressed={table} onClick={() => setTable((v) => !v)} className="text-muted-foreground">
                <Table2 />
                Table
              </Button>
            }
          >
            <div className="px-4 pb-1 sm:px-5">
              <DailyLegend />
            </div>
            {data ? (
              table ? (
                <div className="mt-2 border-t">
                  <DailyTable days={data.daily} />
                </div>
              ) : (
                <div className="px-2 pt-2 pb-3 sm:px-3">
                  <DailyChart days={data.daily} dim={stale} />
                </div>
              )
            ) : (
              <div className="px-4 pt-2 pb-4 sm:px-5">
                <Skeleton className="h-[280px] w-full" />
              </div>
            )}
          </Panel>

          {data && (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <RankedList title="Top sections" hint="Which parts of the site get used" dim={stale} rows={data.sections.map((s) => ({ key: s.key, label: s.label, views: s.views, visitors: s.visitors }))} />
              <RankedList
                title="Top perfumes"
                hint="Perfume pages opened"
                dim={stale}
                className="xl:row-span-2"
                limit={12}
                rows={data.top_perfumes.map((p) => ({
                  key: String(p.id),
                  lead: <BottleThumb p={p} size={40} />,
                  label: (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold tracking-[-0.01em]">{p.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{p.brand}</span>
                    </span>
                  ),
                  views: p.views,
                  visitors: p.visitors,
                }))}
              />
              <RankedList title="Top notes" hint="Note pages opened" dim={stale} rows={data.top_notes.map((n) => ({ key: n.slug, label: n.name, views: n.views, visitors: n.visitors }))} />
              <RankedList
                title="Top pages"
                dim={stale}
                rows={data.top_pages.map((p) => ({ key: p.path, label: p.label, sub: <span className="font-mono">{p.path}</span>, views: p.views, visitors: p.visitors }))}
              />
              <RankedList title="Referrers" hint="Where visitors came from" dim={stale} rows={data.referrers.map((r) => ({ key: r.host ?? '(direct)', label: r.host ?? 'Direct', visitors: r.visitors }))} />
              <RankedList title="Devices" dim={stale} rows={data.devices.map((d) => ({ key: d.name, label: deviceName(d.name), visitors: d.visitors }))} />
              <RankedList title="Browsers" dim={stale} rows={data.browsers.map((b) => ({ key: b.name, label: b.name, visitors: b.visitors }))} />
              <RankedList
                title="Location (device time zone)"
                hint="From each browser's time zone, not its IP address"
               
                dim={stale}
                rows={data.locations.map((l) => ({ key: l.tz, label: l.place || l.tz, sub: l.place ? l.tz : undefined, visitors: l.visitors }))}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
