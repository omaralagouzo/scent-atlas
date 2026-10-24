export const compact = (n?: number | null) => {
  if (n == null) return ''
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export const plural = (n: number, one: string, many?: string) => `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`

export const LAYERS = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Heart' },
  { key: 'base', label: 'Base' },
] as const

export const layerLabel = (k: string) =>
  (({ top: 'Top', middle: 'Heart', base: 'Base', general: 'Notes', any: 'Any layer' }) as Record<string, string>)[k] || k

export const noteImg = (slug: string) => `/img/note/${encodeURIComponent(slug)}`

export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

export const csv = (s?: string | null) =>
  (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** Text colour that stays readable on a given hex background. */
export function readableOn(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c1710' : '#fff'
}

export function timeAgo(ts: number) {
  const s = Math.max(1, Math.round(Date.now() / 1000 - ts))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 60) return `${d}d`
  return new Date(ts * 1000).toLocaleDateString()
}
