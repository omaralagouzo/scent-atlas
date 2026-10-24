// Result filter state: shared by Combine, the note page and the Pyramid / Smells-like results.
// State is a plain immutable object that round-trips through flat URL params (readFilters / filterParams).
import { compact } from './format'
import { resolveSlugs } from './store'
import type { Note } from './types'
import { TAGS } from '@/components/brandtags'

export const encList = (a: string[]) => a.map((x) => String(x).replace(/\\/g, '\\\\').replace(/~/g, '\\~')).join('~')
export function decList(s?: string | null) {
  const out: string[] = []
  let cur = ''
  let esc = false
  for (const ch of s || '') {
    if (esc) {
      cur += ch
      esc = false
    } else if (ch === '\\') esc = true
    else if (ch === '~') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out.filter(Boolean)
}

export type FNote = Note & { variants: boolean }

export interface Filters {
  name: string
  year_min: string
  year_max: string
  year_unknown: boolean
  brands: string[]
  perfumers: string[]
  accords: string[]
  acc_any: boolean
  acc_main: boolean
  genders: string[]
  countries: string[]
  rating_min: string
  votes_min: string
  must: FNote[]
  not: FNote[]
  brandText: string
  btags: string[]
  btags_not: string[]
  has_dupes: boolean
  is_dupe: boolean
}

export const newFilters = (): Filters => ({
  name: '',
  year_min: '',
  year_max: '',
  year_unknown: false,
  brands: [],
  perfumers: [],
  accords: [],
  acc_any: false,
  acc_main: false,
  genders: [],
  countries: [],
  rating_min: '',
  votes_min: '',
  must: [],
  not: [],
  brandText: '',
  btags: [],
  btags_not: [],
  has_dupes: false,
  is_dupe: false,
})

const noteTokens = (s: string): FNote[] =>
  (s || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ slug: t.replace(/\*+$/, ''), name: t.replace(/\*+$/, '').replace(/-/g, ' '), variants: t.endsWith('*') }))

export function readFilters(params: URLSearchParams): Filters {
  const g = (k: string) => params.get(k) || ''
  return {
    name: g('name'),
    year_min: g('year_min'),
    year_max: g('year_max'),
    year_unknown: g('year_unknown') === '1',
    brands: decList(g('brands')),
    perfumers: decList(g('perfumers')),
    accords: decList(g('accords')),
    acc_any: g('acc_any') === '1',
    acc_main: g('acc_main') === '1',
    genders: g('gender')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    countries: decList(g('countries')),
    rating_min: g('rating_min'),
    votes_min: g('votes_min'),
    must: noteTokens(g('must')),
    not: noteTokens(g('not')),
    brandText: g('brand'),
    btags: decList(g('btags')),
    btags_not: decList(g('btags_not')),
    has_dupes: g('has_dupes') === '1',
    is_dupe: g('is_dupe') === '1',
  }
}

export const noteList = (arr: { slug: string; variants?: boolean }[]) => arr.map((n) => n.slug + (n.variants ? '*' : '')).join(',')

/** Flat URL / query params for the filters (empty strings are dropped by the router and api helpers). */
export function filterParams(f: Filters): Record<string, string> {
  return {
    name: f.name.trim(),
    year_min: f.year_min,
    year_max: f.year_max,
    year_unknown: f.year_unknown && (f.year_min || f.year_max) ? '1' : '',
    brands: encList(f.brands),
    perfumers: encList(f.perfumers),
    accords: encList(f.accords),
    acc_any: f.accords.length > 1 && f.acc_any ? '1' : '',
    acc_main: f.accords.length && f.acc_main ? '1' : '',
    gender: f.genders.join(','),
    countries: encList(f.countries),
    rating_min: f.rating_min,
    votes_min: f.votes_min,
    must: noteList(f.must),
    not: noteList(f.not),
    brand: f.brandText,
    btags: encList(f.btags),
    btags_not: encList(f.btags_not),
    has_dupes: f.has_dupes ? '1' : '',
    is_dupe: f.is_dupe ? '1' : '',
  }
}

/** Same as filterParams but without empty values (for JSON request bodies). */
export const filterBody = (f: Filters) => Object.fromEntries(Object.entries(filterParams(f)).filter(([, v]) => v !== '' && v != null))

/** Fill in names / images of the must / must-not notes after reading them from the URL. */
export async function hydrateFilters(f: Filters): Promise<Filters> {
  const all = [...f.must, ...f.not]
  if (!all.length) return f
  const notes = await resolveSlugs(all.map((x) => x.slug))
  const by = Object.fromEntries(notes.map((n) => [n.slug, n]))
  return {
    ...f,
    must: f.must.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], variants: x.variants })),
    not: f.not.filter((x) => by[x.slug]).map((x) => ({ ...by[x.slug], variants: x.variants })),
  }
}

export function filterCount(f: Filters) {
  return [
    f.name.trim(),
    f.year_min || f.year_max,
    f.brands.length,
    f.perfumers.length,
    f.accords.length,
    f.genders.length,
    f.countries.length,
    f.rating_min,
    f.votes_min,
    f.must.length,
    f.not.length,
    f.brandText,
    f.btags.length,
    f.btags_not.length,
    f.has_dupes,
    f.is_dupe,
  ].filter(Boolean).length
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Active filters as removable pills: each `remove(f)` returns the filters without that one. */
export function describeFilters(f: Filters): { key: string; label: string; remove: (f: Filters) => Filters }[] {
  const out: { key: string; label: string; remove: (f: Filters) => Filters }[] = []
  const one = (key: string, label: string, remove: (f: Filters) => Partial<Filters>) => out.push({ key, label, remove: (x) => ({ ...x, ...remove(x) }) })
  const without = (a: string[], v: string) => a.filter((x) => x !== v)
  if (f.name.trim()) one('name', `Name: “${f.name.trim()}”`, () => ({ name: '' }))
  if (f.year_min || f.year_max) {
    const a = f.year_min || '…'
    const b = f.year_max || '…'
    one('year', `Year ${a === b ? a : `${a}–${b}`}${f.year_unknown ? ' + unknown' : ''}`, () => ({ year_min: '', year_max: '', year_unknown: false }))
  }
  f.brands.forEach((b) => one('brand:' + b, b, (x) => ({ brands: without(x.brands, b) })))
  if (f.brandText) one('brandText', `Brand contains “${f.brandText}”`, () => ({ brandText: '' }))
  f.perfumers.forEach((b) => one('pf:' + b, `Perfumer: ${b}`, (x) => ({ perfumers: without(x.perfumers, b) })))
  f.accords.forEach((b) => one('acc:' + b, `${cap(b)}${f.acc_main ? ' (main)' : ''}`, (x) => ({ accords: without(x.accords, b) })))
  f.genders.forEach((b) => one('g:' + b, cap(b), (x) => ({ genders: without(x.genders, b) })))
  f.countries.forEach((b) => one('c:' + b, b, (x) => ({ countries: without(x.countries, b) })))
  if (f.rating_min) one('rating', `Rating ≥ ${f.rating_min}`, () => ({ rating_min: '' }))
  if (f.votes_min) one('votes', `≥ ${compact(Number(f.votes_min))} votes`, () => ({ votes_min: '' }))
  f.btags.forEach((t) => one('bt:' + t, `House: ${TAGS[t] ? TAGS[t].label : t}`, (x) => ({ btags: without(x.btags, t) })))
  f.btags_not.forEach((t) => one('btn:' + t, `Not ${TAGS[t] ? TAGS[t].label.toLowerCase() : t}`, (x) => ({ btags_not: without(x.btags_not, t) })))
  if (f.has_dupes) one('has_dupes', 'Has known dupes', () => ({ has_dupes: false }))
  if (f.is_dupe) one('is_dupe', 'Is a dupe', () => ({ is_dupe: false }))
  f.must.forEach((n) => one('must:' + n.slug, `Also ${n.name}${n.variants ? '-ish' : ''}`, (x) => ({ must: x.must.filter((y) => y.slug !== n.slug) })))
  f.not.forEach((n) => one('not:' + n.slug, `No ${n.name}${n.variants ? '-ish' : ''}`, (x) => ({ not: x.not.filter((y) => y.slug !== n.slug) })))
  return out
}
