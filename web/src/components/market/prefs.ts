// Small per-browser marketplace conveniences (never needed for anything to work).
const CURRENCY_KEY = 'sa-market-currency'

/** The currency this member last priced or searched in (AED by default). */
export function lastCurrency(fallback = 'AED') {
  try {
    return localStorage.getItem(CURRENCY_KEY) || fallback
  } catch {
    return fallback
  }
}

export function rememberCurrency(c: string) {
  try {
    localStorage.setItem(CURRENCY_KEY, c)
  } catch {
    /* storage blocked */
  }
}

/** Search radii offered for "near me" / an area (null = anywhere). */
export const RADII: { value: string; label: string }[] = [
  { value: '5', label: '5 km' },
  { value: '10', label: '10 km' },
  { value: '25', label: '25 km' },
  { value: '50', label: '50 km' },
  { value: '', label: 'Anywhere' },
]

/** Whether the visitor already allowed location (so we can ask for it without a prompt). */
export async function locationGranted() {
  try {
    const r = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return r?.state === 'granted'
  } catch {
    return false
  }
}

/** The area name a place should be shown by. */
export const areaOf = (p: { area?: string | null; city?: string | null; formatted?: string | null }) => p.area || p.city || p.formatted?.split(',')[0] || null
