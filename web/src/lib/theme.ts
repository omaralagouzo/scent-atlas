import { useSyncExternalStore } from 'react'

const ls = new Set<() => void>()
const isDark = () => document.documentElement.classList.contains('dark')

export function setTheme(t: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try {
    localStorage.setItem('sa-theme', t)
  } catch {
    /* private mode */
  }
  ls.forEach((fn) => fn())
}

export function useTheme() {
  const dark = useSyncExternalStore(
    (fn) => {
      ls.add(fn)
      return () => ls.delete(fn)
    },
    isDark,
  )
  return { theme: dark ? ('dark' as const) : ('light' as const), toggle: () => setTheme(dark ? 'light' : 'dark') }
}
