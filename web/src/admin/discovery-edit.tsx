// New releases: the edit sheet. Everything the owner changes is saved as verified (the server sets its confidence to 100%).
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { admin, type DiscItem, type DiscNotes } from './data'
import { Bottle } from './discovery-card'
import { safeHref } from './discovery-util'
import { Field } from './person'

const NOTE_FIELDS: { key: keyof DiscNotes; label: string }[] = [
  { key: 'top', label: 'Top notes' },
  { key: 'middle', label: 'Middle notes' },
  { key: 'base', label: 'Base notes' },
  { key: 'general', label: 'General notes' },
]

const list = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
const joined = (a: string[] | undefined) => (a || []).join(', ')
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const NONE = '_none'

export function EditSheet({ item, onClose, onSaved, onChanged }: { item: DiscItem | null; onClose: () => void; onSaved: () => void; onChanged: () => void }) {
  // keep the last candidate around while the sheet animates closed
  const [shown, setShown] = useState<DiscItem | null>(item)
  if (item && item !== shown && item.id !== shown?.id) setShown(item)
  const it = item || shown
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[560px]">{it && <EditBody key={it.id} start={it} onClose={onClose} onSaved={onSaved} onChanged={onChanged} />}</SheetContent>
    </Sheet>
  )
}

function EditBody({ start, onClose, onSaved, onChanged }: { start: DiscItem; onClose: () => void; onSaved: () => void; onChanged: () => void }) {
  const [it, setIt] = useState(start) // the stored candidate (changes when the image is re-fetched)
  const [brand, setBrand] = useState(start.brand)
  const [name, setName] = useState(start.name)
  const [concentration, setConcentration] = useState(start.concentration || '')
  const [gender, setGender] = useState(start.gender || NONE)
  const [release, setRelease] = useState(start.release_date || '')
  const [status, setStatus] = useState(start.release_status || NONE)
  const [perfumers, setPerfumers] = useState(joined(start.perfumers))
  const [notes, setNotes] = useState<Record<keyof DiscNotes, string>>({ top: joined(start.notes.top), middle: joined(start.notes.middle), base: joined(start.notes.base), general: joined(start.notes.general) })
  const [family, setFamily] = useState(start.family || '')
  const [description, setDescription] = useState(start.description || '')
  const [imageUrl, setImageUrl] = useState(start.image_url || '')
  const [official, setOfficial] = useState(start.official_url || '')
  const [comment, setComment] = useState(start.comment || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)

  // only what changed is sent: every field sent counts as verified
  const body: Record<string, unknown> = {}
  const text = (k: string, v: string, was: string | null) => {
    if (v.trim() !== (was || '')) body[k] = v.trim()
  }
  text('brand', brand, it.brand)
  text('name', name, it.name)
  text('concentration', concentration, it.concentration)
  text('release_date', release, it.release_date)
  text('family', family, it.family)
  text('description', description, it.description)
  text('image_url', imageUrl, it.image_url)
  text('official_url', official, it.official_url)
  text('comment', comment, it.comment)
  if (gender !== (it.gender || NONE)) body.gender = gender === NONE ? '' : gender
  if (status !== (it.release_status || NONE)) body.release_status = status === NONE ? '' : status
  if (!sameList(list(perfumers), it.perfumers)) body.perfumers = list(perfumers)
  const newNotes = Object.fromEntries(NOTE_FIELDS.map((f) => [f.key, list(notes[f.key])])) as unknown as DiscNotes
  if (NOTE_FIELDS.some((f) => !sameList(newNotes[f.key], it.notes[f.key] || []))) body.notes = newNotes
  const changed = Object.keys(body).length > 0
  const urlChanged = imageUrl.trim() !== (it.image_url || '')
  const ready = !!brand.trim() && !!name.trim()

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await admin.patch<DiscItem>(`/discovery/items/${it.id}`, body)
      toast.success(`Saved “${name.trim()}”.`)
      onSaved()
    } catch (ex) {
      setErr(errorText(ex, 'That did not save.'))
      setBusy(false)
    }
  }

  const refetch = async () => {
    setErr('')
    setFetching(true)
    try {
      const r = await admin.post<DiscItem>(`/discovery/items/${it.id}/refetch-image`, {})
      setIt((cur) => ({ ...cur, image: r.image, missing: r.missing, confidence: r.confidence, overall: r.overall, state: r.state }))
      toast.success('Image fetched.')
      onChanged()
    } catch (ex) {
      setErr(errorText(ex, 'Could not fetch that image.'))
    } finally {
      setFetching(false)
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex min-h-full flex-col">
      <SheetHeader className="gap-1 border-b p-5 pr-12">
        <SheetTitle className="text-lg leading-snug tracking-[-0.02em] break-words">Edit candidate</SheetTitle>
        <SheetDescription>
          {start.brand} · {start.name} <span className="font-mono text-xs">· #{start.id}</span>. Fields you change count as verified (100%).
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="e-brand" label="Brand">
            <Input id="e-brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={120} autoComplete="off" />
          </Field>
          <Field id="e-name" label="Name">
            <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} autoComplete="off" />
          </Field>
          <Field id="e-conc" label="Concentration" hint="Eau de Parfum, Parfum, Extrait…">
            <Input id="e-conc" value={concentration} onChange={(e) => setConcentration(e.target.value)} maxLength={40} autoComplete="off" />
          </Field>
          <Field id="e-gender" label="Gender">
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger id="e-gender" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                <SelectItem value="women">Women</SelectItem>
                <SelectItem value="men">Men</SelectItem>
                <SelectItem value="unisex">Unisex</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="e-release" label="Release date" hint="YYYY, YYYY-MM or YYYY-MM-DD">
            <Input id="e-release" value={release} onChange={(e) => setRelease(e.target.value)} maxLength={10} placeholder="2026-09-15" inputMode="numeric" autoComplete="off" className="font-mono" />
          </Field>
          <Field id="e-status" label="Release status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="e-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                <SelectItem value="released">Released</SelectItem>
                <SelectItem value="announced">Announced</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field id="e-perfumers" label="Perfumers" hint="Separate with commas.">
          <Input id="e-perfumers" value={perfumers} onChange={(e) => setPerfumers(e.target.value)} autoComplete="off" />
        </Field>

        <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Notes</legend>
          <p className="-mt-1 text-xs text-muted-foreground">Separate notes with commas.</p>
          {NOTE_FIELDS.map((f) => (
            <Field key={f.key} id={`e-note-${f.key}`} label={f.label}>
              <Input id={`e-note-${f.key}`} value={notes[f.key]} onChange={(e) => setNotes((n) => ({ ...n, [f.key]: e.target.value }))} autoComplete="off" />
            </Field>
          ))}
        </fieldset>

        <Field id="e-family" label="Fragrance family">
          <Input id="e-family" value={family} onChange={(e) => setFamily(e.target.value)} maxLength={80} autoComplete="off" />
        </Field>
        <Field id="e-desc" label="Description">
          <Textarea id="e-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} rows={3} />
        </Field>

        <Field id="e-image" label="Image URL" hint={urlChanged ? 'Saving fetches the image from the new address.' : undefined}>
          <div className="flex items-start gap-3">
            <Bottle item={{ image: it.image, missing: it.image ? [] : ['image'], brand: it.brand, name: it.name }} className="w-20 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Input id="e-image" type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} maxLength={1000} placeholder="https://…" autoComplete="off" spellCheck={false} />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={fetching || urlChanged || !it.image_url} onClick={() => void refetch()}>
                  <RefreshCw className={fetching ? 'animate-spin' : undefined} />
                  Re-fetch image
                </Button>
                {safeHref(imageUrl) && (
                  <a href={safeHref(imageUrl)} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                    Open the source
                  </a>
                )}
              </div>
            </div>
          </div>
        </Field>
        <Field id="e-official" label="Official page URL">
          <Input id="e-official" type="url" value={official} onChange={(e) => setOfficial(e.target.value)} maxLength={1000} placeholder="https://…" autoComplete="off" spellCheck={false} />
        </Field>
        <Field id="e-comment" label="Your note" hint="Shown on the card. Not published.">
          <Textarea id="e-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={2} />
        </Field>
      </div>

      <SheetFooter className="sticky bottom-0 border-t bg-background p-4">
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !changed || !ready}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </SheetFooter>
    </form>
  )
}
