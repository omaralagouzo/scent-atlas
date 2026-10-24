// Advanced note query for the Combine page:  (layer: a OR b) AND (layer: c OR d) ... AND NOT (e OR f)
//
// State:  { clauses: [{ id, layer: 'any'|'top'|'middle'|'base', notes: [{slug,name,image,color,variants}] }],
//           exclude: [note], gen: bool }   (immutable: every helper returns a new object)
// URL:    adv=1  q=top:tea*,mint~middle:rose,lily~base:amber*  x=oud*,vetiver  gen=0
//         (`*` after a slug = also every note whose name contains that word; `~` separates conditions)
import { api } from './api'
import { noteImg } from './format'
import { resolveSlugs } from './store'
import type { Note } from './types'

export type AdvLayer = 'any' | 'top' | 'middle' | 'base'
export type AdvNote = Note & { variants: boolean }
export interface Clause {
  id: number
  layer: AdvLayer
  notes: AdvNote[]
}
export interface Adv {
  clauses: Clause[]
  exclude: AdvNote[]
  gen: boolean
}

export const LAYER_OPTS: { value: AdvLayer; label: string; title?: string }[] = [
  { value: 'any', label: 'Any layer', title: 'The note can be in any layer' },
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Heart' },
  { value: 'base', label: 'Base' },
]
const WORD: Record<AdvLayer, string> = { top: 'Top', middle: 'Heart', base: 'Base', any: 'Any layer' }

let seq = 0
export const newClause = (layer: AdvLayer = 'any', notes: AdvNote[] = []): Clause => ({ id: ++seq, layer, notes })
export const newAdv = (): Adv => ({ clauses: [], exclude: [], gen: true })

/** A plain note (from search, a suggestion or a drop) as an advanced-query note. */
export const toAdvNote = (n: { slug: string; name: string; image?: string; color?: string }): AdvNote => ({
  slug: n.slug,
  name: n.name,
  image: n.image || noteImg(n.slug),
  color: n.color,
  variants: false,
})

/** The builder always shows at least one (possibly empty) condition. */
export const withRow = (a: Adv): Adv => (a.clauses.length ? a : { ...a, clauses: [newClause()] })

/** Add a note as a NEW AND condition (fills the first empty condition if there is one). */
export function addAsRow(a: Adv, n: Note): Adv {
  const note = toAdvNote(n)
  const i = a.clauses.findIndex((c) => !c.notes.length)
  if (i >= 0) return { ...a, clauses: a.clauses.map((c, j) => (j === i ? { ...c, notes: [...c.notes, note] } : c)) }
  return { ...a, clauses: [...a.clauses, newClause('any', [note])] }
}

export function addExclude(a: Adv, n: Note): Adv {
  if (a.exclude.some((x) => x.slug === n.slug)) return a
  return { ...a, exclude: [...a.exclude, toAdvNote(n)] }
}

export const hasAdvQuery = (a: Adv) => a.clauses.some((c) => c.notes.length > 0)

// ------------------------------------------------------------------ URL codec
export function encodeAdv(a: Adv): Record<string, string> {
  const tok = (n: AdvNote) => n.slug + (n.variants ? '*' : '')
  const q = a.clauses
    .filter((c) => c.notes.length)
    .map((c) => `${c.layer}:${c.notes.map(tok).join(',')}`)
    .join('~')
  return { adv: '1', q, x: a.exclude.map(tok).join(','), gen: a.gen ? '' : '0' }
}

type Token = { slug: string; variants: boolean }
export interface RawAdv {
  clauses: { layer: AdvLayer; tokens: Token[] }[]
  exclude: Token[]
  gen: boolean
}

/** Parse the URL params (names are resolved by hydrateAdv). */
export function readAdv(params: URLSearchParams): RawAdv {
  const tokens = (s: string | null): Token[] =>
    (s || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ slug: t.replace(/\*+$/, ''), variants: t.endsWith('*') }))
  const clauses = (params.get('q') || '')
    .split('~')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const i = seg.indexOf(':')
      let layer: AdvLayer = 'any'
      let rest = seg
      if (i >= 0) {
        const l = seg.slice(0, i).trim().toLowerCase()
        layer = l === 'heart' || l === 'mid' ? 'middle' : (['top', 'middle', 'base'] as string[]).includes(l) ? (l as AdvLayer) : 'any'
        rest = seg.slice(i + 1)
      }
      return { layer, tokens: tokens(rest) }
    })
  return { clauses, exclude: tokens(params.get('x')), gen: params.get('gen') !== '0' }
}

export async function hydrateAdv(raw: RawAdv): Promise<Adv> {
  const slugs = [...raw.clauses.flatMap((c) => c.tokens), ...raw.exclude].map((t) => t.slug)
  const notes = await resolveSlugs(slugs)
  const by = Object.fromEntries(notes.map((n) => [n.slug, n]))
  const mk = (t: Token): AdvNote | null => (by[t.slug] ? { ...by[t.slug], variants: t.variants } : null)
  return {
    clauses: raw.clauses.map((c) => newClause(c.layer, c.tokens.map(mk).filter(Boolean) as AdvNote[])),
    exclude: raw.exclude.map(mk).filter(Boolean) as AdvNote[],
    gen: raw.gen,
  }
}

// ------------------------------------------------------------------ sentence
const joinOr = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`)
const nm = (n: { name: string; variants?: boolean }) => n.name.toLowerCase() + (n.variants ? '-ish' : '')
export function advSentence(a: Adv, extra: { must?: { name: string; variants?: boolean }[]; not?: { name: string; variants?: boolean }[] } = {}) {
  const bits = a.clauses.filter((c) => c.notes.length).map((c) => `${WORD[c.layer]} has ${joinOr(c.notes.map(nm))}`)
  if (extra.must && extra.must.length) bits.push(`also has ${extra.must.map(nm).join(' and ')}`)
  const out = [...a.exclude, ...(extra.not || [])]
  if (out.length) bits.push(`without ${joinOr(out.map(nm))}`)
  return bits.length ? bits.join(' · ') : ''
}

// ------------------------------------------------------------------ variants (notes sharing the word)
export interface Variants {
  slug: string
  name: string
  count: number
  notes: Note[]
}
const vCache = new Map<string, Promise<Variants>>()
export function getVariants(slug: string): Promise<Variants> {
  if (!vCache.has(slug))
    vCache.set(
      slug,
      api.get<Variants>(`/api/notes/${encodeURIComponent(slug)}/variants`).catch((e) => {
        vCache.delete(slug)
        throw e
      }),
    )
  return vCache.get(slug)!
}
