// First-party page-view counting for the owner's dashboard: the page shown, a random visitor id kept in this browser,
// the referring site (first page of a visit only) and the device's time zone. No third-party script, no IP stored.
const rid = () => {
  const a = new Uint8Array(12)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('')
}

function stored(storage: () => Storage, key: string) {
  try {
    const s = storage()
    let v = s.getItem(key)
    if (!v || !/^[A-Za-z0-9_-]{8,40}$/.test(v)) {
      v = rid()
      s.setItem(key, v)
    }
    return v
  } catch {
    return rid() // storage blocked: counted as a new visitor each time
  }
}

let first = true

export function trackView(path: string) {
  try {
    const body = {
      path,
      visitor: stored(() => localStorage, 'sa-vid'),
      session: stored(() => sessionStorage, 'sa-sid'),
      referrer: first ? document.referrer || null : null,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    }
    first = false
    void fetch('/api/t', {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'scent-atlas' },
      body: JSON.stringify(body),
    }).catch(() => {})
  } catch {
    /* never let counting break the page */
  }
}
