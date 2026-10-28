// Find an address as you type and pin the exact spot.
// With a Google Maps key (GOOGLE_MAPS_API_KEY on the server): Google Places suggestions and a map with a draggable pin.
// Without one: OpenStreetMap suggestions through our own /api/geo proxy, and "use my location" (no map to drag).
import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { api } from '@/lib/api'
import { marketConfig, myPosition, type Place } from '@/lib/market'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface Suggestion {
  id: string
  main: string
  secondary: string
  /** Google: the place prediction to resolve; OSM: the finished place */
  google?: any
  place?: Place
}

// ---------------------------------------------------------------- Google Maps JS loader (once per page)
let googleLoad: Promise<any> | null = null
function loadGoogle(key: string): Promise<any> {
  const w = window as any
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google)
  googleLoad ??= new Promise((resolve, reject) => {
    const cb = `__saMaps${Date.now()}`
    w[cb] = () => {
      delete w[cb]
      resolve(w.google)
    }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&loading=async&callback=${cb}`
    s.async = true
    s.onerror = () => {
      googleLoad = null
      reject(new Error('Google Maps did not load'))
    }
    document.head.appendChild(s)
  })
  return googleLoad
}

function fromGoogle(place: any): Place {
  const comp = (type: string, short = false) => {
    const c = (place.addressComponents || []).find((x: any) => x.types?.includes(type))
    return c ? (short ? c.shortText : c.longText) : null
  }
  const loc = place.location
  return {
    formatted: place.formattedAddress || place.displayName || null,
    lat: typeof loc?.lat === 'function' ? loc.lat() : loc?.lat,
    lng: typeof loc?.lng === 'function' ? loc.lng() : loc?.lng,
    building: comp('premise') || comp('subpremise') || (place.displayName !== place.formattedAddress ? place.displayName : null),
    street: [comp('street_number'), comp('route')].filter(Boolean).join(' ') || null,
    area: comp('sublocality_level_1') || comp('sublocality') || comp('neighborhood'),
    city: comp('locality') || comp('administrative_area_level_2'),
    region: comp('administrative_area_level_1'),
    country: comp('country', true),
    postal_code: comp('postal_code'),
    place_id: place.id ? `google:${place.id}` : null,
  }
}

export function AddressPicker({
  value,
  onChange,
  label = 'Location',
  placeholder = 'Search for a building, street or area…',
  near,
  className,
}: {
  value: Place | null
  onChange: (p: Place | null) => void
  label?: string
  placeholder?: string
  /** bias suggestions towards this point */
  near?: { lat: number; lng: number } | null
  className?: string
}) {
  const id = useId()
  const [key, setKey] = useState<string | null | undefined>(undefined)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const session = useRef<any>(null)
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<{ map: any; marker: any } | null>(null)

  useEffect(() => {
    marketConfig().then((c) => setKey(c.google_maps_key), () => setKey(null))
  }, [])

  // suggestions as you type
  useEffect(() => {
    const text = q.trim()
    if (text.length < 2 || key === undefined) {
      setItems([])
      return
    }
    let live = true
    const t = setTimeout(async () => {
      setBusy(true)
      setError('')
      try {
        if (key) {
          const g = await loadGoogle(key)
          const { AutocompleteSuggestion, AutocompleteSessionToken } = await g.maps.importLibrary('places')
          session.current ??= new AutocompleteSessionToken()
          const req: any = { input: text, sessionToken: session.current }
          if (near) req.locationBias = { center: near, radius: 50000 }
          const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req)
          if (!live) return
          setItems(
            (suggestions || [])
              .filter((s: any) => s.placePrediction)
              .map((s: any) => ({
                id: s.placePrediction.placeId,
                main: s.placePrediction.mainText?.toString() || s.placePrediction.text?.toString(),
                secondary: s.placePrediction.secondaryText?.toString() || '',
                google: s.placePrediction,
              })),
          )
        } else {
          const r = await api.get<{ results: (Place & { label: string })[] }>('/api/geo/search', { q: text, ...(near || {}) })
          if (!live) return
          setItems(
            r.results.map((p, k) => {
              const [main, ...rest] = p.label.split(', ')
              return { id: `${k}:${p.label}`, main, secondary: rest.join(', '), place: { ...p, formatted: p.label } }
            }),
          )
        }
        setActive(0)
        setOpen(true)
      } catch {
        if (live) setError('Address search is not available right now.')
      }
      if (live) setBusy(false)
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // the map with a draggable pin (Google only)
  useEffect(() => {
    if (!key || !value || !mapEl.current) return
    let live = true
    loadGoogle(key).then(async (g) => {
      if (!live || !mapEl.current) return
      const { Map } = await g.maps.importLibrary('maps')
      const pos = { lat: value.lat, lng: value.lng }
      if (!map.current) {
        const m = new Map(mapEl.current, { center: pos, zoom: 16, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'cooperative' })
        const marker = new g.maps.Marker({ map: m, position: pos, draggable: true })
        const move = (ll: any) => onChangeRef.current?.({ ...valueRef.current!, lat: ll.lat(), lng: ll.lng() })
        marker.addListener('dragend', (e: any) => move(e.latLng))
        m.addListener('click', (e: any) => {
          marker.setPosition(e.latLng)
          move(e.latLng)
        })
        map.current = { map: m, marker }
      } else {
        map.current.marker.setPosition(pos)
        map.current.map.panTo(pos)
      }
    }, () => {})
    return () => {
      live = false
    }
  }, [key, value?.lat, value?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!value) map.current = null // the map element goes away with the value; build a fresh one next time
  }, [value])
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  onChangeRef.current = onChange
  valueRef.current = value

  async function choose(s: Suggestion) {
    setOpen(false)
    setQ('')
    setError('')
    if (s.place) return onChange(s.place)
    setBusy(true)
    try {
      const place = s.google.toPlace()
      await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents', 'displayName', 'id'] })
      session.current = null // a session ends with the details request
      onChange(fromGoogle(place))
    } catch {
      setError('Could not load that address. Try another one.')
    }
    setBusy(false)
  }

  async function locate() {
    setBusy(true)
    setError('')
    const pos = await myPosition()
    if (!pos) {
      setError('Location is off for this site. Search for the address instead.')
      setBusy(false)
      return
    }
    try {
      const r = await api.get<{ result: (Place & { label: string }) | null }>('/api/geo/reverse', pos)
      onChange({ ...(r.result || {}), formatted: r.result?.label || 'My current location', lat: pos.lat, lng: pos.lng })
    } catch {
      onChange({ formatted: 'My current location', lat: pos.lat, lng: pos.lng })
    }
    setBusy(false)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {value ? (
        <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm">{value.formatted || 'Pinned location'}</span>
            <small className="text-xs text-muted-foreground">
              {[value.area, value.city, value.country].filter(Boolean).join(' · ') || `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}`}
            </small>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id={id}
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => items.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!open || !items.length) return
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)))
              else if (e.key === 'Enter') (e.preventDefault(), choose(items[active]))
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder={placeholder}
            className="h-11 w-full rounded-lg border border-input bg-card pr-9 pl-9 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-sm"
          />
          {busy ? (
            <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : q ? (
            <button type="button" aria-label="Clear" onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          ) : null}
          {open && items.length > 0 && (
            <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
              {items.map((s, k) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={k === active}
                  onMouseDown={(e) => (e.preventDefault(), choose(s))}
                  onMouseEnter={() => setActive(k)}
                  className={cn('flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm', k === active && 'bg-muted')}
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{s.main}</span>
                    {s.secondary && <small className="truncate text-xs text-muted-foreground">{s.secondary}</small>}
                  </span>
                </li>
              ))}
              {key && <li className="px-2.5 pt-1 pb-0.5 text-right text-[10px] text-muted-foreground">powered by Google</li>}
            </ul>
          )}
        </div>
      )}
      {!value && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={locate} disabled={busy}>
          <LocateFixed />
          Use my current location
        </Button>
      )}
      {value && key && (
        <>
          <div ref={mapEl} className="h-56 w-full overflow-hidden rounded-lg border bg-muted" aria-label="Map: drag the pin to the exact spot" />
          <small className="text-xs text-muted-foreground">Drag the pin (or tap the map) to the exact entrance.</small>
        </>
      )}
      {value && key === null && (
        <small className="text-xs text-muted-foreground">
          Pinned at {value.lat.toFixed(5)}, {value.lng.toFixed(5)}.
        </small>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
