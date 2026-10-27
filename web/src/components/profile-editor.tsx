// Edit my profile: name and photo. Opened from anywhere with openProfileEditor(); <ProfileEditor/> is mounted once in App.
// Photos are cropped to a centred square and shrunk to 512x512 WebP (JPEG where WebP export is missing) in the
// browser, so the upload fits the server's 256 KB request limit; the server re-encodes it anyway.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { session, useSession } from '@/lib/store'
import { UserAvatar } from '@/components/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ---- open state
let isOpen = false
const ls = new Set<() => void>()
const setOpen = (o: boolean) => {
  isOpen = o
  ls.forEach((fn) => fn())
}
const useOpen = () =>
  useSyncExternalStore(
    (fn) => {
      ls.add(fn)
      return () => ls.delete(fn)
    },
    () => isOpen,
  )

export function openProfileEditor() {
  if (session.user) setOpen(true)
}

// ---- photo processing
const SIZE = 512
const MAX_CHARS = 240 * 1024

async function decode(file: File): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('decode')
  }
  return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
}

/** A centred square crop of `file`, 512x512, as a data URL under ~240 KB. */
export async function squarePhoto(file: File): Promise<string> {
  const { img, w, h, done } = await decode(file)
  try {
    if (!w || !h) throw new Error('decode')
    const s = Math.min(w, h)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.fillStyle = '#fff' // transparent PNGs get a white backdrop (JPEG has no alpha)
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIZE, SIZE)
    let q = 0.85
    let type = 'image/webp'
    let url = canvas.toDataURL(type, q)
    if (!url.startsWith('data:image/webp')) {
      type = 'image/jpeg'
      url = canvas.toDataURL(type, q)
    }
    while (url.length > MAX_CHARS && q > 0.35) {
      q -= 0.1
      url = canvas.toDataURL(type, q)
    }
    if (url.length > MAX_CHARS) throw new Error('size')
    return url
  } finally {
    done()
  }
}

// ---- the dialog
export function ProfileEditor() {
  const open = useOpen()
  const { user } = useSession()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState<'upload' | 'remove' | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const firstInput = useRef<HTMLInputElement>(null)

  // fill the fields each time the dialog opens (placeholder "User Name" accounts start empty)
  useEffect(() => {
    if (!open || !session.user) return
    const u = session.user
    setFirst(u.needs_name ? '' : u.first_name || '')
    setLast(u.needs_name ? '' : u.last_name || '')
    setError(null)
  }, [open])
  useEffect(() => {
    if (open && !user) setOpen(false) // signed out meanwhile
  }, [open, user])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false) // navigating away (e.g. Back) closes it
    window.addEventListener('hashchange', close)
    return () => window.removeEventListener('hashchange', close)
  }, [open])

  if (!user) return null
  const name = user.name || user.username

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.type && !f.type.startsWith('image/')) {
      toast('That file is not an image.')
      return
    }
    setPhotoBusy('upload')
    try {
      let data: string
      try {
        data = await squarePhoto(f)
      } catch (err: any) {
        toast(err?.message === 'size' ? 'That photo is too detailed to upload. Try another one.' : 'Could not read that image. Try a JPEG, PNG or WebP photo.')
        return
      }
      await api.put('/api/me/avatar', { data })
      await session.refresh()
      toast('Profile photo updated.')
    } catch (err) {
      toast(errorText(err, 'Could not upload the photo.'))
    } finally {
      setPhotoBusy(null)
    }
  }

  const removePhoto = async () => {
    setPhotoBusy('remove')
    try {
      await api.del('/api/me/avatar')
      await session.refresh()
      toast('Profile photo removed.')
    } catch (err) {
      toast(errorText(err, 'Could not remove the photo.'))
    } finally {
      setPhotoBusy(null)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const f = first.trim()
    const l = last.trim()
    if (!f) {
      setError('Please enter your first name.')
      firstInput.current?.focus()
      return
    }
    if (!user.needs_name && f === user.first_name && l === user.last_name) {
      setOpen(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.put('/api/me/name', { first_name: f, last_name: l })
      await session.refresh()
      toast('Name saved.')
      setOpen(false)
    } catch (err) {
      setError(errorText(err, 'Could not save your name.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={(e) => {
          if (session.user?.needs_name) {
            e.preventDefault()
            firstInput.current?.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>{user.needs_name ? 'Add your name so friends and family can find you.' : 'Your name and photo are visible to everyone signed in.'}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <span className="relative shrink-0">
            <UserAvatar name={user.needs_name && first.trim() ? first : name} seed={user.username} src={user.avatar} top={user.top} size={84} />
            {photoBusy && (
              <span className="absolute inset-0 grid place-items-center rounded-full bg-background/60">
                <Loader2 className="size-5 animate-spin" />
              </span>
            )}
          </span>
          <div className="flex min-w-0 flex-col items-start gap-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!!photoBusy} onClick={() => file.current?.click()}>
                <Camera />
                {user.avatar ? 'Change photo' : 'Upload photo'}
              </Button>
              {user.avatar && (
                <Button type="button" size="sm" variant="ghost" disabled={!!photoBusy} onClick={removePhoto}>
                  <Trash2 />
                  Remove photo
                </Button>
              )}
            </div>
            <small className="text-xs text-muted-foreground">Cropped to a square. JPEG, PNG or WebP.</small>
            <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Upload photo" onChange={onFile} />
          </div>
        </div>

        <form id="profile-name" onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="pe-first">First name</Label>
            <Input
              id="pe-first"
              ref={firstInput}
              value={first}
              onChange={(e) => (setFirst(e.target.value), setError(null))}
              autoComplete="given-name"
              maxLength={60}
              required
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'pe-error' : undefined}
              className="h-10"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pe-last">
              Last name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="pe-last" value={last} onChange={(e) => (setLast(e.target.value), setError(null))} autoComplete="family-name" maxLength={60} className="h-10" />
          </div>
          {error && (
            <p id="pe-error" role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="profile-name" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
