// Infinite list: loads page 1 whenever `deps` change, then the next page when the sentinel scrolls into view.
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Page<T> {
  items: T[]
  hasMore: boolean
}

export function useInfinite<T>(fetchPage: (page: number, signal: AbortSignal) => Promise<Page<T>>, deps: unknown[], { enabled = true } = {}) {
  const [items, setItems] = useState<T[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [page, setPage] = useState(0)
  const [gen, setGen] = useState(0)
  const ctrl = useRef<AbortController | null>(null)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const busy = useRef(false)

  const load = useCallback(
    async (next: number, g: number) => {
      if (busy.current) return
      busy.current = true
      setState('loading')
      const c = new AbortController()
      ctrl.current = c
      try {
        const r = await fetchRef.current(next, c.signal)
        if (c.signal.aborted) return
        setItems((x) => (next === 1 ? r.items : [...x, ...r.items]))
        setPage(next)
        setState(r.hasMore ? 'idle' : 'done')
      } catch (e: any) {
        if (c.signal.aborted || e?.name === 'AbortError') return
        setState('error')
      } finally {
        if (ctrl.current === c) busy.current = false
      }
      void g
    },
    [],
  )

  useEffect(() => {
    if (!enabled) return
    ctrl.current?.abort()
    busy.current = false
    setPage(0)
    const g = gen + 1
    setGen(g)
    load(1, g)
    return () => ctrl.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled])

  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || state !== 'idle' || page === 0) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && load(page + 1, gen), { rootMargin: '700px' })
    io.observe(el)
    return () => io.disconnect()
  }, [state, page, gen, load])

  return {
    items,
    setItems,
    loading: state === 'loading',
    error: state === 'error',
    done: state === 'done',
    empty: state === 'done' && page === 1 && items.length === 0,
    firstLoad: page === 0,
    sentinel,
    retry: () => load(page + 1, gen),
  }
}
