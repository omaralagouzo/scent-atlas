// My saved Combine / Pyramid searches: open one to re-run it, or delete it.
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { go } from '@/lib/router'
import { SavedRow } from '@/components/saved'

export interface SavedSearch {
  id: number
  kind: 'combine' | 'pyramid'
  name?: string
  state: Record<string, any>
  notes: { slug: string; name: string; image?: string }[]
  [k: string]: any
}

export function SavedSearches({ items, onChange }: { items: SavedSearch[]; onChange: (items: SavedSearch[]) => void }) {
  const remove = async (it: SavedSearch) => {
    try {
      await api.del(`/api/me/saved/${it.id}`)
      onChange(items.filter((x) => x.id !== it.id))
    } catch {
      toast('Could not delete.')
    }
  }
  if (!items.length)
    return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Nothing saved yet. Use Save on the Combine or Pyramid pages to keep a search.</p>
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <SavedRow key={it.id} it={it} onOpen={() => go(it.kind === 'combine' ? '/combine' : '/pyramid', it.state)} onDelete={() => remove(it)} />
      ))}
    </div>
  )
}
