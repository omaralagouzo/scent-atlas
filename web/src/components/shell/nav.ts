import { Combine, FlaskConical, Layers, ListOrdered, Sparkles, Triangle, UserSearch, Users } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  /** one line shown in the Discover menu */
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  /** decides whether this link is current for a path */
  match: (path: string) => boolean
}

/** "Discover fragrances": the exploring tools, in menu order. */
export const DISCOVER: NavItem[] = [
  { href: '/like', label: 'Smells like', hint: 'Pick a fragrance you love and see what smells like it', icon: Sparkles, match: (p) => p.startsWith('/like') },
  { href: '/layering', label: 'Layering', hint: 'What to wear together, rated by the community', icon: Layers, match: (p) => p.startsWith('/layering') },
  { href: '/notes', label: 'Notes library', hint: 'Every ingredient, and the fragrances that use it', icon: FlaskConical, match: (p) => p === '/notes' || p.startsWith('/note/') },
  { href: '/combine', label: 'Combination search', hint: 'Find fragrances that contain the notes you choose', icon: Combine, match: (p) => p.startsWith('/combine') },
  { href: '/pyramid', label: 'Scent pyramid builder', hint: 'Choose top, heart and base notes; get the closest fragrances', icon: Triangle, match: (p) => p.startsWith('/pyramid') },
]

/** The other top-level links, after the Discover menu. */
export const MAIN: NavItem[] = [
  { href: '/people', label: 'Discover people', icon: UserSearch, match: (p) => p.startsWith('/people') },
  { href: '/friends', label: 'Friends', icon: Users, match: (p) => p.startsWith('/friends') },
  { href: '/collection', label: 'My Collection', icon: ListOrdered, match: (p) => p.startsWith('/collection') },
]

/** Every page (the command palette lists these). */
export const NAV: NavItem[] = [...DISCOVER, ...MAIN]
