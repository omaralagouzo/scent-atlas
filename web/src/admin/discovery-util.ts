// New releases: confidence tones, date text and link safety shared by the card and the edit sheet.
import type { ConfKey } from './data'

export const CONF_FIELDS: { key: ConfKey; label: string; missing?: string }[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'release_date', label: 'Release', missing: 'release_date' },
  { key: 'notes', label: 'Notes', missing: 'notes' },
  { key: 'perfumers', label: 'Perfumers' },
  { key: 'image', label: 'Image', missing: 'image' },
  { key: 'gender', label: 'Gender', missing: 'gender' },
  { key: 'concentration', label: 'Concentration' },
]

export type Tone = 'high' | 'mid' | 'low' | 'none'

/** green from 80%, amber from 50%, red below; grey when there is no value. */
export const toneOf = (v: number | null | undefined): Tone => (v == null || Number.isNaN(v) ? 'none' : v >= 0.8 ? 'high' : v >= 0.5 ? 'mid' : 'low')
export const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`


// ---- formatting -------------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-15" → "Sep 15, 2026", "2026-09" → "Sep 2026", "2026" → "2026". */
export function releaseText(s: string | null | undefined) {
  if (!s) return null
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s)
  if (!m) return s
  const mon = m[2] ? MONTHS[Number(m[2]) - 1] : null
  if (!mon) return m[1]
  return m[3] ? `${mon} ${Number(m[3])}, ${m[1]}` : `${mon} ${m[1]}`
}

const GENDER: Record<string, string> = { women: 'Women', men: 'Men', unisex: 'Unisex' }
export const genderText = (g: string | null | undefined) => (g ? GENDER[g] || g : null)

/** Source links come from a language model: only ever link http(s). */
export function safeHref(u: string | null | undefined) {
  if (!u) return undefined
  try {
    const url = new URL(u)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
