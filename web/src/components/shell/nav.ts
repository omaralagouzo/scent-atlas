import { BookMarked, Combine, FlaskConical, Layers, ListOrdered, Sparkles, Triangle, Users } from 'lucide-react'

/** Main navigation, in order. `match` decides which link is current for a path. */
export const NAV = [
  { href: '/notes', label: 'Notes', icon: FlaskConical, match: (p: string) => p === '/notes' || p.startsWith('/note/') },
  { href: '/combine', label: 'Combine', icon: Combine, match: (p: string) => p.startsWith('/combine') },
  { href: '/pyramid', label: 'Pyramid', icon: Triangle, match: (p: string) => p.startsWith('/pyramid') },
  { href: '/like', label: 'Smells like', icon: Sparkles, match: (p: string) => p.startsWith('/like') },
  { href: '/layering', label: 'Layering', icon: Layers, match: (p: string) => p.startsWith('/layering') },
  { href: '/collection', label: 'My Collection', icon: ListOrdered, match: (p: string) => p.startsWith('/collection') },
  { href: '/atlas', label: 'My Atlas', icon: BookMarked, match: (p: string) => p.startsWith('/atlas') },
  { href: '/friends', label: 'Friends', icon: Users, match: (p: string) => p.startsWith('/friends') || p.startsWith('/u/') },
]
