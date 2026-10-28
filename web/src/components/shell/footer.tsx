import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Glyph } from '@/components/brand'

export function useStatus() {
  const [s, setS] = useState<any>(null)
  const [down, setDown] = useState(false)
  useEffect(() => {
    api.get('/api/status').then(setS, () => setDown(true))
  }, [])
  return { status: s, down }
}

export function Ribbon({ status, down }: { status: any; down: boolean }) {
  if (status?.env === 'development')
    return (
      <div className="bg-warning/20 px-4 py-1.5 text-center text-xs font-medium text-foreground">
        Development site: made-up test data. Nothing here touches scentatlas.app.
      </div>
    )
  if (down)
    return <div className="bg-warning/15 px-4 py-2 text-center text-sm text-foreground">Cannot reach the Scent Atlas server. If you run it locally, is start.bat still running?</div>
  if (status?.kind === 'fixture')
    return (
      <div className="bg-warning/15 px-4 py-2 text-center text-sm text-foreground">
        Demo data: {status.perfumes} perfumes, {status.notes} notes — the full dataset is not built yet.
      </div>
    )
  return null
}

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <Glyph size={14} className="text-brand" /> Scent Atlas
        </span>
        <a className="underline-offset-2 hover:text-foreground hover:underline" href="#/about">
          About &amp; credits
        </a>
        <span className="ml-auto hidden sm:inline">
          <kbd className="rounded border bg-muted px-1.5 font-mono">/</kbd> to search
        </span>
      </div>
    </footer>
  )
}
