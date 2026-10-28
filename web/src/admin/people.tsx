// People: every account, with a search filter; a person opens a side sheet with their activity and account actions.
import { useState } from 'react'
import { Search } from 'lucide-react'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/avatar'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ago, dateOnly, fullTime, num, useDebounced, useLoad, type Account } from './data'
import { Muted, PageHead } from './parts'
import { PersonSheet } from './person'

const COLS = [
  { key: 'who', label: 'Person', className: 'text-left' },
  { key: 'email', label: 'Email', className: 'text-left' },
  { key: 'joined', label: 'Joined', className: 'text-left' },
  { key: 'seen', label: 'Last seen', className: 'text-left' },
  { key: 'views', label: 'Views, 30 d', className: 'text-right' },
  { key: 'owned', label: 'Bottles', className: 'text-right' },
  { key: 'friends', label: 'Friends', className: 'text-right' },
  { key: 'reviews', label: 'Reviews', className: 'text-right' },
  { key: 'sessions', label: 'Sessions', className: 'text-right' },
]

export function People() {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 200)
  const { data, error, loading, reload } = useLoad<{ users: Account[] }>('/users', { q: dq })
  const [openId, setOpenId] = useState<number | null>(null)
  const users = data?.users
  const open = users?.find((u) => u.id === openId) || null

  return (
    <>
      <PageHead title="People" lede="Every account. Open one to see what they've been doing and to manage it." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, username or email" aria-label="Search accounts" autoComplete="off" className="pl-9" />
        </div>
        {users && (
          <span className="text-sm text-muted-foreground">
            <span className="font-mono">{num(users.length)}</span> account{users.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className={cn('overflow-x-auto transition-opacity', loading && users && 'opacity-60')}>
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                {COLS.map((c) => (
                  <th key={c.key} scope="col" className={cn('px-3 py-2.5 font-medium whitespace-nowrap first:pl-4 last:pr-4', c.className)}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!users &&
                !error &&
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td colSpan={COLS.length} className="px-4 py-3">
                      <Skeleton className="h-7 w-full" />
                    </td>
                  </tr>
                ))}
              {!!error && !users && (
                <tr>
                  <td colSpan={COLS.length}>
                    <Muted>{errorText(error, "Couldn't load accounts.")}</Muted>
                  </td>
                </tr>
              )}
              {users?.length === 0 && (
                <tr>
                  <td colSpan={COLS.length}>
                    <Muted>{dq ? 'No account matches that search.' : 'No accounts yet.'}</Muted>
                  </td>
                </tr>
              )}
              {users?.map((u) => (
                <tr key={u.id} className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50" onClick={() => setOpenId(u.id)}>
                  <td className="py-2 pr-3 pl-4">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenId(u.id)
                      }}
                      aria-label={`Open ${u.name || u.username}`}
                    >
                      <UserAvatar name={u.name || u.username} seed={u.username} src={u.avatar} size={32} />
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="max-w-[200px] truncate font-medium">{u.name || u.username}</span>
                        <span className="max-w-[200px] truncate text-xs text-muted-foreground">@{u.username}</span>
                      </span>
                    </button>
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap" title={fullTime(u.created_at)}>
                    {dateOnly(u.created_at)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" title={u.last_seen_at ? fullTime(u.last_seen_at) : undefined}>
                    {ago(u.last_seen_at)}
                  </td>
                  {[u.views_30d, u.owned, u.friends, u.reviews].map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right font-mono tabular-nums">
                      {num(v)}
                    </td>
                  ))}
                  <td className={cn('py-2 pr-4 pl-3 text-right font-mono tabular-nums', !u.sessions && 'text-muted-foreground')}>{num(u.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PersonSheet
        user={open}
        onClose={() => setOpenId(null)}
        onChanged={reload}
        onDeleted={() => {
          setOpenId(null)
          reload()
        }}
      />
    </>
  )
}
