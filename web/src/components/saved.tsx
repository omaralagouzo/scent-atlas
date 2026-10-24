// "Save" + "Saved" buttons for the Combine and Pyramid views, and the saved-search row (also used on My Atlas).
import { useState } from 'react'
import { Bookmark, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { requireAuth, useSession } from '@/lib/store'
import { go } from '@/lib/router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field, FormError } from './shell/auth-dialog'
import { NoteImg } from './media'

const PATH = { combine: '/combine', pyramid: '/pyramid' } as const
type Kind = keyof typeof PATH

export function SavedBar({ kind, getState, hasNotes, suggest }: { kind: Kind; getState: () => Record<string, any>; hasNotes: () => boolean; suggest: () => string }) {
  const { user } = useSession()
  const [saveOpen, setSaveOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [items, setItems] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!hasNotes()) return toast('Add a note first, then save the search.')
    if (!user && !(await requireAuth('Sign in to save searches.'))) return
    setErr('')
    setSaveOpen(true)
  }
  const openList = async () => {
    if (!user && !(await requireAuth('Sign in to see your saved searches.'))) return
    setItems(null)
    setListOpen(true)
    try {
      setItems((await api.get('/api/me/saved', { kind })).items)
    } catch {
      setItems([])
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') || '').trim()
    if (!name) return setErr('Give it a name.')
    setBusy(true)
    try {
      await api.post('/api/me/saved', { kind, name, state: getState() })
      toast('Saved to My Atlas.')
      setSaveOpen(false)
    } catch (ex) {
      setErr(errorText(ex, 'Could not save.'))
    }
    setBusy(false)
  }

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" onClick={save} title="Save this search to My Atlas">
        <Save />
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={openList} title="Re-open a saved search">
        <Bookmark />
        Saved
      </Button>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Save search</DialogTitle>
            <DialogDescription>Saving with an existing name replaces that search.</DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <Field id="save-name" label={kind === 'combine' ? 'Name this note combination' : 'Name this pyramid'}>
              <Input id="save-name" name="name" required maxLength={80} defaultValue={(suggest() || '').slice(0, 80)} autoComplete="off" autoFocus onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <FormError>{err}</FormError>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{kind === 'combine' ? 'Saved combinations' : 'Saved pyramids'}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {items === null ? (
              <Skeleton className="h-14 w-full" />
            ) : !items.length ? (
              <p className="text-sm text-muted-foreground">Nothing saved yet. Build something and press Save.</p>
            ) : (
              items.map((it) => (
                <SavedRow
                  key={it.id}
                  it={it}
                  onOpen={() => {
                    setListOpen(false)
                    go(PATH[kind as Kind], it.state)
                  }}
                  onDelete={async () => {
                    try {
                      await api.del(`/api/me/saved/${it.id}`)
                      setItems((x) => (x || []).filter((y) => y.id !== it.id))
                    } catch {
                      toast('Could not delete.')
                    }
                  }}
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function SavedRow({ it, onOpen, onDelete }: { it: any; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-2.5">
      <div className="flex shrink-0 -space-x-2">
        {it.notes.slice(0, 4).map((n: any) => (
          <NoteImg key={n.slug} n={n} alt={n.name} className="size-8 rounded-full ring-2 ring-card" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-sm font-medium">{it.name}</b>
        <small className="truncate text-xs text-muted-foreground">
          {it.kind === 'combine' ? 'Combine' : 'Pyramid'} · {it.summary}
        </small>
      </div>
      <Button size="sm" onClick={onOpen}>
        Open
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${it.name}`} title="Delete" onClick={onDelete}>
        <Trash2 />
      </Button>
    </div>
  )
}
