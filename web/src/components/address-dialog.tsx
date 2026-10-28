// My delivery address: private, only used for deliveries. Opened from anywhere with openAddressDialog();
// <AddressDialog/> is mounted once in App. useMyAddress() shares the loaded address (the profile line reads it).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Loader2, Lock, MapPin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import type { Address, Place } from '@/lib/market'
import { refreshUnread } from '@/lib/notifications'
import { session, useSession } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AddressPicker } from '@/components/address-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

// ---- shared state: open flag + my address (undefined = not loaded yet)
let isOpen = false
let mine: Address | null | undefined = undefined
let loading: Promise<Address | null> | null = null
let owner: number | null = null
const ls = new Set<() => void>()
const emit = () => ls.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  ls.add(fn)
  return () => ls.delete(fn)
}
const setOpen = (o: boolean) => {
  isOpen = o
  emit()
}
function setMine(a: Address | null | undefined) {
  mine = a
  emit()
}

function loadAddress(force = false): Promise<Address | null> {
  const uid = session.user?.id ?? null
  if (owner !== uid) {
    owner = uid
    mine = undefined
    loading = null
  }
  if (!uid) return Promise.resolve(null)
  if (!force && mine !== undefined) return Promise.resolve(mine)
  if (!force && loading) return loading
  const p = api
    .get<{ address: Address | null }>('/api/me/address')
    .then((r) => {
      if (owner === uid) setMine(r.address)
      return r.address
    })
    .finally(() => {
      if (loading === p) loading = null
    })
  loading = p
  return p
}

export function openAddressDialog() {
  if (session.user) setOpen(true)
}

/** My saved delivery address (undefined while loading, null when none). */
export function useMyAddress() {
  const { user } = useSession()
  useEffect(() => {
    if (user) loadAddress().catch(() => {})
  }, [user?.id, user?.has_address])
  const a = useSyncExternalStore(subscribe, () => mine)
  return user && owner === user.id ? a : undefined
}

/** "Al Barsha, Dubai": the short, human part of an address. */
export function addressShort(a: Pick<Place, 'area' | 'city' | 'formatted' | 'building' | 'street'>) {
  const parts = [a.area, a.city].filter((x, i, all) => x && all.indexOf(x) === i)
  return parts.join(', ') || a.building || a.street || a.formatted?.split(',').slice(0, 2).join(',') || 'Saved'
}

/** "Delivery address: Add" / "Delivery address: Al Barsha, Dubai · Edit": for my own profile header (only I see it). */
export function AddressLine({ className }: { className?: string }) {
  const { user } = useSession()
  const a = useMyAddress()
  if (!user) return null
  const has = a ? true : a === null ? false : user.has_address
  return (
    <p className={cn('flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <MapPin className="size-3.5 shrink-0" />
      <span className="shrink-0">Delivery address:</span>
      {has ? (
        <>
          {a && <span className="min-w-0 truncate text-foreground">{addressShort(a)}</span>}
          {a && <span aria-hidden="true">·</span>}
          <button type="button" onClick={openAddressDialog} className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
            Edit
          </button>
        </>
      ) : has === false ? (
        <button type="button" onClick={openAddressDialog} className="shrink-0 font-medium text-brand-ink underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
          Add
        </button>
      ) : null}
      <Lock className="size-3 shrink-0 opacity-70" aria-label="Only you can see this" />
    </p>
  )
}

// ---- the dialog
const cut = (s: string | null | undefined, n: number) => {
  const t = (s || '').trim()
  return t ? t.slice(0, n) : null
}
const PHONE_HINT = '+971 50 123 4567'

export function AddressDialog() {
  const open = useSyncExternalStore(subscribe, () => isOpen)
  const { user } = useSession()
  const [ready, setReady] = useState(false)
  const [place, setPlace] = useState<Place | null>(null)
  const [unit, setUnit] = useState('')
  const [floor, setFloor] = useState('')
  const [building, setBuilding] = useState('')
  const [street, setStreet] = useState('')
  const [area, setArea] = useState('')
  const [recipient, setRecipient] = useState('')
  const [phone, setPhone] = useState('')
  const [instructions, setInstructions] = useState('')
  const [error, setError] = useState<{ field?: 'place' | 'phone'; text: string } | null>(null)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [saved, setSaved] = useState(false)
  const phoneInput = useRef<HTMLInputElement>(null)

  // fill the fields each time the dialog opens
  useEffect(() => {
    if (!open || !session.user) return
    let live = true
    setReady(false)
    setError(null)
    setConfirmRemove(false)
    loadAddress(true)
      .catch(() => (live && setError({ text: 'Could not load your address. You can still enter it.' }), mine ?? null))
      .then((a) => {
        if (!live) return
        const u = session.user
        setSaved(!!a)
        setPlace(a ? { formatted: a.formatted, lat: a.lat, lng: a.lng, building: a.building, street: a.street, area: a.area, city: a.city, region: a.region, country: a.country, postal_code: a.postal_code, place_id: a.place_id } : null)
        setUnit(a?.unit || '')
        setFloor(a?.floor || '')
        setBuilding(a?.building || '')
        setStreet(a?.street || '')
        setArea(a?.area || '')
        setRecipient(a?.recipient || (u && !u.needs_name ? u.name : '') || '')
        setPhone(a?.phone || '')
        setInstructions(a?.instructions || '')
        setReady(true)
      })
    return () => {
      live = false
    }
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

  const choosePlace = (p: Place | null) => {
    // a newly found building, street or area fills its field, unless the member already typed their own
    if (p && (!building.trim() || building === (place?.building || ''))) setBuilding(p.building || '')
    if (p && (!street.trim() || street === (place?.street || ''))) setStreet(p.street || '')
    if (p && (!area.trim() || area === (place?.area || ''))) setArea(p.area || '')
    setPlace(p)
    if (error?.field === 'place') setError(null)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!place) return setError({ field: 'place', text: 'Search for your address, or use your current location, so we know where to deliver.' })
    const digits = phone.replace(/[^\d]/g, '')
    if (digits.length < 6) {
      setError({ field: 'phone', text: `Enter a phone number a courier can call, with the country code (e.g. ${PHONE_HINT}).` })
      phoneInput.current?.focus()
      return
    }
    const typed = [street, area, place.city].map((x) => x?.trim()).filter(Boolean).join(', ')
    // "My current location" (the reverse lookup failed) says nothing to a courier: use what was typed instead
    const formatted = cut(place.formatted && place.formatted !== 'My current location' ? place.formatted : typed || place.formatted, 300) || `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
    const country = place.country && place.country.trim().length === 2 ? place.country.trim().toUpperCase() : null
    setBusy('save')
    setError(null)
    try {
      const r = await api.put<{ address: Address }>('/api/me/address', {
        formatted,
        lat: place.lat,
        lng: place.lng,
        building: cut(building, 120),
        street: cut(street, 160),
        area: cut(area, 120),
        city: cut(place.city, 80),
        region: cut(place.region, 80),
        country,
        postal_code: cut(place.postal_code, 20),
        place_id: cut(place.place_id, 300),
        unit: cut(unit, 40),
        floor: cut(floor, 20),
        recipient: cut(recipient, 80),
        phone: phone.trim(),
        instructions: cut(instructions, 300),
      })
      setMine(r.address)
      await session.refresh()
      refreshUnread() // saving withdraws the "add your address" reminder
      toast(saved ? 'Delivery address updated.' : 'Delivery address saved. Only you can see it.')
      setOpen(false)
    } catch (err) {
      setError({ text: errorText(err, 'Could not save your address.') })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!confirmRemove) return setConfirmRemove(true)
    setBusy('remove')
    try {
      await api.del('/api/me/address')
      setMine(null)
      await session.refresh()
      toast('Delivery address removed.')
      setOpen(false)
    } catch (err) {
      setError({ text: errorText(err, 'Could not remove your address.') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Delivery address</DialogTitle>
          <DialogDescription>Where a courier can bring a bottle to you: enough detail to find your door.</DialogDescription>
        </DialogHeader>

        <p className="flex items-start gap-2.5 rounded-lg bg-muted/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-foreground" />
          <span>
            <b className="font-medium text-foreground">Private.</b> Only used to arrange deliveries later. It is never shown on your profile, and buyers and
            sellers never see it.
          </span>
        </p>

        {!ready ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <form id="address-form" onSubmit={save} className="grid grid-cols-2 items-start gap-x-3 gap-y-4 sm:gap-x-4" noValidate>
            <div className="col-span-2">
              <AddressPicker label="Address" value={place} onChange={choosePlace} placeholder="Search for your building, street or area…" />
              {error?.field === 'place' && (
                <p role="alert" className="mt-1.5 text-xs text-destructive">
                  {error.text}
                </p>
              )}
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="ad-building">Building or compound name</Label>
              <Input id="ad-building" value={building} onChange={(e) => setBuilding(e.target.value)} maxLength={120} placeholder="e.g. Marina Heights Tower" className="h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ad-unit">
                <span className="sm:hidden">Apt / villa / office</span>
                <span className="max-sm:hidden">Apartment, villa or office no.</span>
              </Label>
              <Input id="ad-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} placeholder="e.g. 1204 or Villa 17" autoComplete="address-line2" className="h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ad-floor">
                Floor <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="ad-floor" value={floor} onChange={(e) => setFloor(e.target.value)} maxLength={20} placeholder="e.g. 12" className="h-10" />
            </div>
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="ad-street">Street</Label>
              <Input id="ad-street" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={160} autoComplete="address-line1" placeholder="e.g. Al Marsa Street" className="h-10" />
            </div>
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="ad-area">Area</Label>
              <Input id="ad-area" value={area} onChange={(e) => setArea(e.target.value)} maxLength={120} placeholder="e.g. Dubai Marina" className="h-10" />
            </div>
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="ad-recipient">Recipient name</Label>
              <Input id="ad-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={80} autoComplete="name" className="h-10" />
            </div>
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="ad-phone">Phone</Label>
              <Input
                id="ad-phone"
                ref={phoneInput}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => (setPhone(e.target.value), error?.field === 'phone' && setError(null))}
                maxLength={32}
                required
                placeholder={PHONE_HINT}
                aria-invalid={error?.field === 'phone' || undefined}
                aria-describedby="ad-phone-hint"
                className="h-10 font-mono"
              />
              <small id="ad-phone-hint" className={error?.field === 'phone' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} role={error?.field === 'phone' ? 'alert' : undefined}>
                {error?.field === 'phone' ? error.text : 'With the country code, so the courier can call.'}
              </small>
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="ad-notes">
                Delivery instructions <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="ad-notes"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="e.g. Leave it with the concierge, gate code 4512, call on arrival"
                className="min-h-16"
              />
            </div>
            {error && !error.field && (
              <p role="alert" className="col-span-2 text-sm text-destructive">
                {error.text}
              </p>
            )}
          </form>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {saved ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto" disabled={!!busy} onClick={remove}>
              {busy === 'remove' ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {confirmRemove ? 'Remove for good?' : 'Remove address'}
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={!!busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="address-form" disabled={!!busy || !ready}>
              {busy === 'save' && <Loader2 className="animate-spin" />}
              Save address
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
