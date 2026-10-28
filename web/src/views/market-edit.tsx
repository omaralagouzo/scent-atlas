// Sell a bottle (#/market/new, ?perfume=<id> prefills the fragrance) or edit one of mine (#/market/:id/edit).
// The fragrance comes from the catalogue, or is a custom name + brand that the site owner reviews first. Then the
// bottle size and roughly how much is left, the price, box / tester, a description, the pickup point (buyers only
// see the area) and up to config.max_photos photos, shrunk in the browser and uploaded after the listing exists.
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ImagePlus, Loader2, Lock, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ViewProps } from '@/App'
import { api, ApiError, errorText } from '@/lib/api'
import { go } from '@/lib/router'
import { formatPrice, useMarketConfig, type Address, type Listing, type Place } from '@/lib/market'
import { authDialog, useSession } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AddressPicker } from '@/components/address-picker'
import { BottleThumb } from '@/components/media'
import { EmptyState, Page, PageHeader } from '@/components/page'
import { PerfumePicker } from '@/components/picker'
import { BottleFill, photoId } from '@/components/market/listing-card'
import { shrinkPhoto } from '@/components/market/photos'
import { lastCurrency, rememberCurrency } from '@/components/market/prefs'
import type { WantedPerfume } from '@/components/market/wanted-dialog'

const DESC_MAX = 1000
const QUICK_SIZES = [10, 30, 50, 75, 100, 125, 150, 200]

interface Photo {
  key: string
  src: string
  /** an uploaded photo */
  pid?: number
  /** a new photo (data URL), uploaded on save */
  data?: string
}

const toPickup = (p: Place) => ({
  lat: p.lat,
  lng: p.lng,
  formatted: p.formatted || null,
  area: p.area || p.city || null,
  city: p.city || null,
  country: p.country || null,
})

function Section({ title, hint, children, className }: { title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3 border-b pb-7 last:border-b-0', className)}>
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em]">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Chip({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('inline-flex h-8 items-center rounded-full border px-3 font-mono text-[13px] transition-colors', on ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground', className)}
    >
      {children}
    </button>
  )
}

export default function MarketEdit({ args, params }: ViewProps) {
  const editId = args.id ? Number(args.id) : null
  const { user, loaded } = useSession()
  const config = useMarketConfig()
  const [existing, setExisting] = useState<Listing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [perfume, setPerfume] = useState<WantedPerfume | null>(null)
  const [custom, setCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customBrand, setCustomBrand] = useState('')
  const [size, setSize] = useState<number | null>(null)
  const [otherSize, setOtherSize] = useState('')
  const [allSizes, setAllSizes] = useState(false)
  const [left, setLeft] = useState<number | null>(null)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(lastCurrency)
  const [box, setBox] = useState(false)
  const [tester, setTester] = useState(false)
  const [description, setDescription] = useState('')
  const [pickup, setPickup] = useState<Place | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [removed, setRemoved] = useState<number[]>([])
  const [shrinking, setShrinking] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const maxPhotos = config?.max_photos ?? 4

  // prefill: the listing being edited, or ?perfume=<id> and my saved address
  useEffect(() => {
    if (!loaded || !user) return
    let live = true
    if (editId) {
      api.get<Listing>(`/api/market/listings/${editId}`).then(
        (l) => {
          if (!live) return
          if (!l.mine) return setLoadError('You can only edit your own listings.')
          if (l.status === 'removed') return setLoadError('This listing was removed by the moderators and can’t be edited.')
          setExisting(l)
          if (l.perfume) setPerfume({ id: l.perfume.id, name: l.perfume.name, brand: l.perfume.brand, image: l.perfume.image })
          setCustom(l.custom)
          setCustomName(l.custom ? l.title : '')
          setCustomBrand(l.custom ? l.brand : '')
          setSize(l.ml_total)
          setLeft(l.ml_left)
          setPrice(String(l.price))
          setCurrency(l.currency)
          setBox(l.box)
          setTester(l.tester)
          setDescription(l.description || '')
          if (l.pickup) setPickup(l.pickup)
          setPhotos(l.photos.map((src) => ({ key: src, src, pid: photoId(src) })))
        },
        (e) => live && setLoadError(e instanceof ApiError && e.status === 404 ? 'This listing is gone.' : 'Could not load this listing.'),
      )
    } else {
      const pid = Number(params.get('perfume'))
      if (pid) api.get(`/api/perfumes/${pid}`).then((r) => live && setPerfume((cur) => cur || { id: r.id, name: r.name, brand: r.brand, image: r.image }), () => {})
      api.get<{ address: Address | null }>('/api/me/address').then((r) => live && r.address && setPickup((cur) => cur || r.address), () => {})
    }
    return () => {
      live = false
    }
  }, [loaded, user?.id, editId]) // eslint-disable-line react-hooks/exhaustive-deps

  const editing = !!editId
  const locked = editing // the API can't change the fragrance or the size of an existing listing
  const total = size || 0
  const ml = left == null ? total : Math.min(left, total)
  const priceNum = Number(price)
  const perMl = priceNum > 0 && ml > 0 ? priceNum / ml : null

  const leftTouched = useRef(false)
  const setLeftBy = (v: number | null) => {
    leftTouched.current = true
    setLeft(v)
  }
  // a new size starts full, unless the seller already said how much is left (and it still fits)
  const pickSize = (n: number | null) => {
    setSize(n)
    if (n) setLeft((cur) => (!leftTouched.current || cur == null || cur > n ? n : cur))
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    const room = maxPhotos - photos.length
    const list = Array.from(files).slice(0, Math.max(0, room))
    if (files.length > room) toast(`Up to ${maxPhotos} photos per listing.`)
    setShrinking((n) => n + list.length)
    for (const file of list) {
      try {
        const data = await shrinkPhoto(file)
        setPhotos((xs) => (xs.length >= maxPhotos ? xs : [...xs, { key: `${Date.now()}-${Math.random()}`, src: data, data }]))
      } catch {
        toast.error(`Could not read ${file.name}. Use a JPEG, PNG or WebP photo.`)
      }
      setShrinking((n) => n - 1)
    }
    if (fileInput.current) fileInput.current.value = ''
  }
  const removePhoto = (ph: Photo) => {
    setPhotos((xs) => xs.filter((x) => x.key !== ph.key))
    if (ph.pid) setRemoved((r) => [...r, ph.pid!])
  }

  function validate(): string | null {
    if (!editing) {
      if (custom ? customName.trim().length < 2 || !customBrand.trim() : !perfume) return custom ? "Give the fragrance's name and brand." : 'Choose the fragrance from the list, or add it as a custom one.'
      if (!size || size < 1 || size > 1000) return 'Choose the bottle size.'
    } else if (custom && (customName.trim().length < 2 || !customBrand.trim())) return "Give the fragrance's name and brand."
    if (!ml || ml < 1) return 'Say roughly how much is left.'
    if (!(priceNum > 0)) return 'Enter a price.'
    if (!pickup) return 'Choose the pickup location.'
    if (description.length > DESC_MAX) return `Keep the description under ${DESC_MAX} characters.`
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = validate()
    if (v) return setError(v)
    setError('')
    setBusy(true)
    try {
      let l: Listing
      if (!editing) {
        l = await api.post<Listing>('/api/market/listings', {
          perfume_id: custom ? null : perfume!.id,
          custom_name: custom ? customName.trim() : null,
          custom_brand: custom ? customBrand.trim() : null,
          ml_total: size,
          ml_left: ml,
          price: priceNum,
          currency,
          box,
          tester,
          description: description.trim() || null,
          pickup: toPickup(pickup!),
        })
      } else {
        const body: Record<string, unknown> = {
          ml_left: ml,
          price: priceNum,
          currency,
          box,
          tester,
          description: description.trim(),
          pickup: toPickup(pickup!),
        }
        // a changed custom name goes back into review, so only send it when it really changed
        if (existing?.custom && customName.trim() !== existing.title) body.custom_name = customName.trim()
        if (existing?.custom && customBrand.trim() !== existing.brand) body.custom_brand = customBrand.trim()
        l = await api.patch<Listing>(`/api/market/listings/${editId}`, body)
        for (const pid of removed) await api.del(`/api/market/listings/${editId}/photos/${pid}`).catch(() => {})
      }
      rememberCurrency(currency)
      let failed = 0
      for (const ph of photos.filter((x) => x.data)) {
        try {
          await api.post(`/api/market/listings/${l.id}/photos`, { data: ph.data })
        } catch {
          failed++
        }
      }
      if (failed) toast.error(`${failed === 1 ? 'One photo' : `${failed} photos`} could not be uploaded. You can add them again from Edit.`)
      toast.success(editing ? (l.status === 'pending' && existing?.status !== 'pending' ? 'Saved and sent for review.' : 'Listing saved.') : l.status === 'pending' ? 'Sent for review. We will notify you when it is live.' : 'Your bottle is up for sale.')
      go(`/market/${l.id}`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const title = editing ? 'Edit listing' : 'Sell a bottle'
  if (loaded && !user)
    return (
      <Page>
        <PageHeader title={title} />
        <EmptyState icon={<Lock className="size-5" />} title="Sign in to sell a bottle" action={<Button onClick={() => authDialog.open({ mode: 'login' })}>Sign in</Button>}>
          The marketplace is for members only.
        </EmptyState>
      </Page>
    )
  if (loadError)
    return (
      <Page>
        <EmptyState title={loadError} action={<Button variant="outline" onClick={() => go('/market/mine')}>My listings</Button>} />
      </Page>
    )
  if (!loaded || (editing && !existing))
    return (
      <Page className="max-w-3xl">
        <Skeleton className="mb-6 h-9 w-56" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Page>
    )

  const sizes = config?.sizes || QUICK_SIZES
  const shownSizes = allSizes ? sizes : sizes.filter((s) => QUICK_SIZES.includes(s))
  const sizeIsOther = size != null && !shownSizes.includes(size)

  return (
    <Page className="max-w-3xl">
      <a href={editing ? `#/market/${editId}` : '#/market'} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {editing ? 'Back to the listing' : 'Marketplace'}
      </a>
      <PageHeader title={title} description={editing ? undefined : 'Put up a bottle you no longer wear. Buyers message you to arrange a pickup.'} />

      <form onSubmit={submit} noValidate className="flex flex-col gap-7">
        {/* ---- fragrance */}
        <Section title="Fragrance" hint={locked ? undefined : 'Pick it from the catalogue so buyers can find it by name, accords and brand.'}>
          {locked && !custom ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-2.5">
              {perfume && <BottleThumb p={perfume} size={48} />}
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <b className="truncate text-[15px] font-semibold tracking-[-0.015em]">{perfume?.name}</b>
                <small className="truncate text-xs text-muted-foreground">{perfume?.brand}</small>
              </span>
              <Lock className="size-4 shrink-0 text-muted-foreground" />
            </div>
          ) : custom ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" />
                <p>
                  <b className="font-medium">Custom listings are reviewed before they go live.</b> The site owner checks the name and brand (and may link it to the catalogue); you'll get a notification. {editing && existing?.status === 'active' && 'Changing the name or brand sends it for review again.'}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="m-name">Name</Label>
                  <Input id="m-name" value={customName} maxLength={120} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Oud Royal Intense" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="m-brand">Brand</Label>
                  <Input id="m-brand" value={customBrand} maxLength={120} onChange={(e) => setCustomBrand(e.target.value)} placeholder="e.g. Ajmal" />
                </div>
              </div>
              {!editing && (
                <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setCustom(false)}>
                  Search the catalogue instead
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {perfume ? (
                <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
                  <BottleThumb p={perfume} size={52} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <b className="truncate text-[15px] font-semibold tracking-[-0.015em]">{perfume.name}</b>
                    <small className="truncate text-xs text-muted-foreground">{perfume.brand}</small>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPerfume(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <PerfumePicker onPick={(p) => setPerfume({ id: p.id, name: p.name, brand: p.brand, image: p.image })} label="Which fragrance are you selling?" placeholder="Search the catalogue: Aventus, Baccarat Rouge…" />
              )}
              <p className="text-[13px] text-muted-foreground">
                Not in the list?{' '}
                <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => setCustom(true)}>
                  Add it as a custom fragrance
                </button>{' '}
                (reviewed before it goes live).
              </p>
            </div>
          )}
        </Section>

        {/* ---- size + ml left */}
        <Section title="Bottle" hint={locked ? 'The bottle size can’t be changed on an existing listing. Withdraw it and post a new one if it’s wrong.' : 'The full size of the bottle, and roughly how much is left in it.'}>
          <div className="flex flex-col gap-2">
            <Label>Bottle size</Label>
            {locked ? (
              <div className="flex items-center gap-2 font-mono text-sm">
                <Lock className="size-3.5 text-muted-foreground" />
                {size} ml
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {shownSizes.map((s) => (
                  <Chip key={s} on={size === s && !otherSize} onClick={() => (setOtherSize(''), pickSize(s))}>
                    {s} ml
                  </Chip>
                ))}
                {!allSizes && sizes.length > shownSizes.length && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAllSizes(true)}>
                    More sizes
                  </Button>
                )}
                <div className="relative w-28">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1000}
                    aria-label="Other bottle size in ml"
                    placeholder="Other"
                    value={otherSize || (sizeIsOther ? String(size) : '')}
                    onChange={(e) => {
                      setOtherSize(e.target.value)
                      const n = Math.round(Number(e.target.value))
                      pickSize(n >= 1 && n <= 1000 ? n : null)
                    }}
                    className={cn('h-8 pr-8 font-mono', (otherSize || sizeIsOther) && 'border-foreground')}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">ml</span>
                </div>
              </div>
            )}
          </div>

          {total > 0 && (
            <div className="mt-2 flex items-center gap-5 rounded-xl border bg-card p-4">
              <BottleFill left={ml} total={total} className="h-24 w-[58px]" />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="m-left">About how much is left?</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="m-left"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={total}
                      value={left == null ? total : ml}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value))
                        setLeftBy(Number.isFinite(n) ? Math.max(0, Math.min(total, n)) : null)
                      }}
                      className="h-8 w-20 text-right font-mono"
                    />
                    <span className="font-mono text-sm text-muted-foreground">/ {total} ml</span>
                  </div>
                </div>
                <Slider min={1} max={total} step={1} value={[Math.max(1, ml)]} onValueChange={([v]) => setLeftBy(v)} aria-label="Millilitres left" />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    [1, 'Full'],
                    [0.75, '¾'],
                    [0.5, '½'],
                    [0.25, '¼'],
                  ].map(([k, label]) => {
                    const v = Math.max(1, Math.round(total * (k as number)))
                    return (
                      <Chip key={label} on={ml === v} onClick={() => setLeftBy(v)} className="h-7 px-2.5 text-xs">
                        {label}
                      </Chip>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* ---- price */}
        <Section title="Price">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-price">Asking price</Label>
              <div className="flex gap-2">
                <Input id="m-price" type="number" inputMode="decimal" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className="h-10 w-36 font-mono text-base" />
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger aria-label="Currency" className="h-10! w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(config?.currencies || [currency]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {perMl != null && (
              <p className="pb-2 font-mono text-sm text-muted-foreground">
                {formatPrice(Math.round(perMl * 100) / 100, currency)}/ml
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm">
              <span>
                <span className="font-medium">Comes with the box</span>
                <small className="block text-xs text-muted-foreground">The original packaging is included.</small>
              </span>
              <Switch checked={box} onCheckedChange={setBox} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm">
              <span>
                <span className="font-medium">It's a tester</span>
                <small className="block text-xs text-muted-foreground">A retail tester bottle (often no cap or box).</small>
              </span>
              <Switch checked={tester} onCheckedChange={setTester} />
            </label>
          </div>
        </Section>

        {/* ---- description */}
        <Section title="Description" hint="Batch code, how it was stored, why you're selling: anything a buyer would ask.">
          <Textarea value={description} maxLength={DESC_MAX} rows={4} onChange={(e) => setDescription(e.target.value)} placeholder="Bought in 2023, stored in a cool cupboard, about 20 sprays used." aria-label="Description" />
          <small className={cn('self-end font-mono text-xs text-muted-foreground', description.length > DESC_MAX - 50 && 'text-warning')}>
            {description.length} / {DESC_MAX}
          </small>
        </Section>

        {/* ---- pickup */}
        <Section title="Pickup location" hint="Buyers only see the area (and a position rounded to about 1 km), never the exact spot. You share that in messages when you agree.">
          <AddressPicker value={pickup} onChange={setPickup} label="Where can buyers pick it up?" />
        </Section>

        {/* ---- photos */}
        <Section title="Photos" hint={`Up to ${maxPhotos}. Show the bottle, how much is left and the batch code. Without photos, buyers see the catalogue picture.`}>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {photos.map((ph, k) => (
              <div key={ph.key} className="group relative aspect-square overflow-hidden rounded-lg border bg-mat">
                <img src={ph.src} alt={`Photo ${k + 1}`} className="absolute inset-0 size-full object-cover" />
                {k === 0 && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-card/90 px-2 text-[10px] leading-4 font-medium">Cover</span>}
                <button type="button" onClick={() => removePhoto(ph)} aria-label={`Remove photo ${k + 1}`} className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-card/90 text-muted-foreground shadow-sm hover:text-destructive">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {Array.from({ length: shrinking }, (_, k) => (
              <div key={`s${k}`} className="grid aspect-square place-items-center rounded-lg border bg-muted">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ))}
            {photos.length + shrinking < maxPhotos && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <ImagePlus className="size-5" />
                Add photo
              </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => addFiles(e.target.files)} />
        </Section>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Button type="button" variant="ghost" onClick={() => history.back()}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={busy || shrinking > 0} className="bg-brand text-brand-foreground hover:bg-brand/90">
            {busy && <Loader2 className="animate-spin" />}
            {editing ? 'Save changes' : custom ? 'Send for review' : 'Put it up for sale'}
          </Button>
        </div>
      </form>
    </Page>
  )
}
