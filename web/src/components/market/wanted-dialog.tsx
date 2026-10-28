// "Looking to buy": a wanted request (perfume, optional max price, minimum ml, area + radius, note). Members are
// notified when a matching bottle goes up; after posting we show what already matches.
import { useEffect, useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { useMarketConfig, type Listing, type Place, type Wanted } from '@/lib/market'
import type { Perfume } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AddressPicker } from '@/components/address-picker'
import { BottleThumb } from '@/components/media'
import { PerfumePicker } from '@/components/picker'
import { Segmented } from '@/components/segmented'
import { ListingCard } from './listing-card'
import { areaOf, lastCurrency, RADII, rememberCurrency } from './prefs'

export type WantedPerfume = Pick<Perfume, 'id' | 'name' | 'brand' | 'image'>

export function WantedDialog({
  open,
  onOpenChange,
  perfume = null,
  onPosted,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** preset when opened from a perfume page */
  perfume?: WantedPerfume | null
  onPosted?: (w: Wanted) => void
}) {
  const config = useMarketConfig()
  const [p, setP] = useState<WantedPerfume | null>(perfume)
  const [maxPrice, setMaxPrice] = useState('')
  const [currency, setCurrency] = useState(lastCurrency)
  const [minMl, setMinMl] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [radius, setRadius] = useState('25')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ wanted: Wanted; matches: Listing[] } | null>(null)

  useEffect(() => {
    if (!open) return
    setP(perfume)
    setMaxPrice('')
    setMinMl('')
    setPlace(null)
    setRadius('25')
    setNote('')
    setError('')
    setDone(null)
  }, [open, perfume?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!p) return setError('Choose the fragrance you are looking for.')
    const price = maxPrice.trim() ? Number(maxPrice) : null
    if (price != null && !(price > 0)) return setError('Enter a maximum price above zero, or leave it empty.')
    const ml = minMl.trim() ? Math.round(Number(minMl)) : null
    if (ml != null && !(ml >= 1 && ml <= 1000)) return setError('The minimum amount is between 1 and 1000 ml.')
    setBusy(true)
    setError('')
    try {
      const r = await api.post<{ wanted: Wanted; matches: Listing[] }>('/api/market/wanted', {
        perfume_id: p.id,
        max_price: price,
        currency: price != null ? currency : null,
        min_ml: ml,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        radius_km: place && radius ? Number(radius) : null,
        area: place ? areaOf(place) : null,
        note: note.trim() || null,
      })
      if (price != null) rememberCurrency(currency)
      setDone(r)
      onPosted?.(r.wanted)
      toast.success('Request posted. We will let you know when one goes up.')
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>You're on the lookout</DialogTitle>
              <DialogDescription>
                We'll notify you as soon as someone puts up {done.wanted.perfume?.name || 'this fragrance'} that matches your request.
              </DialogDescription>
            </DialogHeader>
            {done.matches.length ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">
                  Already for sale <span className="font-mono text-muted-foreground">{done.matches.length}</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {done.matches.map((l) => (
                    <ListingCard key={l.id} l={l} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing matching is for sale right now.</p>
            )}
            <DialogFooter>
              <Button variant="outline" asChild>
                <a href="#/market/mine" onClick={() => onOpenChange(false)}>
                  My requests
                </a>
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
            <DialogHeader>
              <DialogTitle>Looking for a bottle?</DialogTitle>
              <DialogDescription>Post a request and we'll notify you when a matching one goes up for sale.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label>Fragrance</Label>
              {p ? (
                <div className="flex items-center gap-3 rounded-lg border bg-card p-2">
                  <BottleThumb p={p} size={44} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <b className="truncate text-[15px] font-semibold tracking-[-0.015em]">{p.name}</b>
                    <small className="truncate text-xs text-muted-foreground">{p.brand}</small>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setP(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <PerfumePicker size="default" onPick={(x) => setP(x)} label="Fragrance you are looking for" placeholder="Search the catalogue…" autoFocus />
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="w-price">Max price (optional)</Label>
                <div className="flex gap-2">
                  <Input id="w-price" type="number" inputMode="decimal" min={0} step="any" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Any" className="font-mono" />
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger aria-label="Currency" className="w-24 shrink-0">
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="w-ml">At least (optional)</Label>
                <div className="relative">
                  <Input id="w-ml" type="number" inputMode="numeric" min={1} max={1000} value={minMl} onChange={(e) => setMinMl(e.target.value)} placeholder="Any amount" className="pr-10 font-mono" />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">ml left</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <AddressPicker value={place} onChange={setPlace} label="Area (optional)" placeholder="Search for an area or city…" />
              {place && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Within</span>
                  <Segmented size="sm" label="Distance" value={radius} onChange={setRadius} options={RADII} />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="w-note">Note (optional)</Label>
              <Textarea id="w-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Happy with a tester, batch from 2020 or later" rows={2} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !p}>
                {busy ? <Loader2 className="animate-spin" /> : <BellRing />}
                Post request
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
