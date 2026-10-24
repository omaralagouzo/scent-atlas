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

export function Footer({ status }: { status: any }) {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <Glyph size={14} className="text-brand" /> Scent Atlas
        </span>
        <span>Non-commercial personal project</span>
        {status && (
          <span className="font-mono">
            {status.perfumes.toLocaleString()} perfumes · {status.notes.toLocaleString()} notes
          </span>
        )}
        <span>
          Data{' '}
          <a className="underline underline-offset-2 hover:text-foreground" href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">
            CC BY-NC-SA 4.0
          </a>{' '}
          (Decant, olgagmiufana1 &amp; others) · Images © Fragrantica ·{' '}
          <a className="underline underline-offset-2 hover:text-foreground" href="#/about">
            About &amp; credits
          </a>
        </span>
        <span className="ml-auto hidden sm:inline">
          <kbd className="rounded border bg-muted px-1.5 font-mono">/</kbd> search · <kbd className="rounded border bg-muted px-1.5 font-mono">Esc</kbd> close
        </span>
      </div>
    </footer>
  )
}
