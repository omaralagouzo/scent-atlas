// Recent history (viewed perfumes, "smells like" lookups and searches), newest first. Shown on my own profile.
import { useState } from 'react'
import { Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { go, openPerfume } from '@/lib/router'
import { BottleThumb } from '@/components/media'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface HistoryItem {
  id: number
  kind: 'view' | 'like' | 'pyramid' | 'combine'
  label: string
  created_at: number
  state: Record<string, any> | null
  perfume?: { id: number; name: string; brand: string; image: string }
}

const KIND: Record<string, string> = { view: 'Viewed', like: 'Smells like', pyramid: 'Pyramid', combine: 'Combine' }

export function ago(ts: number) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts))
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

function open(it: HistoryItem) {
  if (it.kind === 'view' && it.perfume) openPerfume(it.perfume.id)
  else if (it.kind === 'like' && it.perfume) go(`/like/${it.perfume.id}`)
  else go(it.kind === 'combine' ? '/combine' : '/pyramid', it.state || {})
}

export function HistoryList({ items, onChange }: { items: HistoryItem[]; onChange: (items: HistoryItem[]) => void }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function clearAll() {
    setBusy(true)
    try {
      await api.del('/api/me/history')
      onChange([])
      setConfirm(false)
      toast('History cleared.')
    } catch {
      toast('Could not clear history.')
    }
    setBusy(false)
  }

  async function remove(it: HistoryItem) {
    try {
      await api.del(`/api/me/history/${it.id}`)
      onChange(items.filter((x) => x.id !== it.id))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Perfumes you open and searches you run, newest first.</p>
        {items.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            <Trash2 />
            Clear history
          </Button>
        )}
      </div>
      {items.length ? (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2">
              {it.perfume ? (
                <BottleThumb p={it.perfume} size={56} />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-[23%] bg-muted text-muted-foreground">
                  <Search className="size-4" />
                </span>
              )}
              <button
                type="button"
                onClick={() => open(it)}
                className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="text-[11px] font-medium tracking-[.06em] text-muted-foreground uppercase">{KIND[it.kind] || it.kind}</span>
                <span className="w-full truncate text-sm hover:underline">
                  {it.perfume ? (
                    <>
                      <span className="font-semibold tracking-[-0.015em] text-[15px]">{it.perfume.name}</span>
                      <span className="text-muted-foreground"> · {it.perfume.brand}</span>
                    </>
                  ) : (
                    it.label
                  )}
                </span>
              </button>
              <small className="shrink-0 font-mono text-xs text-muted-foreground">{ago(it.created_at)}</small>
              <Button size="icon-sm" variant="ghost" aria-label="Remove from history" title="Remove" onClick={() => remove(it)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing yet. Perfumes you open and searches you run are listed here (newest first, last 200 kept).
        </p>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Clear your whole history?</DialogTitle>
            <DialogDescription>Every viewed perfume and past search is removed. Favorites, your collection and saved searches stay.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={clearAll}>
              Clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
