// About & credits: dataset licence, image attribution, accounts & privacy, non-commercial notice.
import { useEffect, useState } from 'react'
import type { ViewProps } from '@/App'
import { api } from '@/lib/api'
import { Page, PageHeader } from '@/components/page'

function Ext({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a href={to} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline decoration-border underline-offset-[3px] transition-colors hover:decoration-foreground">
      {children}
    </a>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-t py-7 md:grid-cols-[180px_minmax(0,1fr)] md:gap-8">
      <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

export default function AboutView(_: ViewProps) {
  const [credits, setCredits] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let dead = false
    api
      .get('/api/credits')
      .then((r) => {
        if (dead) return
        const seen = new Set<string>()
        setCredits(Object.values((r.note_images || {}) as Record<string, string>).filter((c) => !seen.has(c) && !!seen.add(c)))
      })
      .catch(() => !dead && setFailed(true))
    return () => {
      dead = true
    }
  }, [])

  return (
    <Page className="max-w-4xl">
      <PageHeader eyebrow="About" title="About & credits" description="Scent Atlas is a non-commercial personal project for exploring fragrance notes." className="mb-8" />

      <Section title="Data">
        <p>
          The catalogue (perfumes, notes, accords and ratings) is a merged, de-duplicated dataset derived from public Fragrantica-based datasets. The main sources
          are the Decant dump (<Ext to="https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes">ledecanteur on Kaggle</Ext>,{' '}
          <Ext to="https://codeberg.org/decant">codeberg.org/decant</Ext>) and{' '}
          <Ext to="https://www.kaggle.com/datasets/olgagmiufana1/fragrantica-com-fragrance-dataset">olgagmiufana1</Ext>, both released under{' '}
          <Ext to="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</Ext>, with additional fields from other public Kaggle/GitHub datasets
          listed in the repository's <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground">data/BUILD_REPORT.md</code>.
        </p>
        <p>
          Because of the share-alike and non-commercial terms, this derived catalogue is likewise offered under CC BY-NC-SA 4.0: attribute the sources above, no
          commercial use, share adaptations under the same licence.
        </p>
      </Section>

      <Section title="Images">
        <p>
          Bottle photos and note images are © Fragrantica and their respective owners. They are loaded directly from Fragrantica's image servers (fimgs.net) and
          are not stored or redistributed by this site. A handful of note photos come from Wikipedia/Wikimedia Commons under their own licences:
        </p>
        <ul className="flex flex-col divide-y rounded-xl border bg-card text-sm">
          {credits == null ? (
            <li className="px-4 py-3 text-muted-foreground">{failed ? 'Could not load the image credits.' : 'Loading…'}</li>
          ) : credits.length ? (
            credits.map((c) => (
              <li key={c} className="px-4 py-2.5 break-words text-foreground/85">
                {c}
              </li>
            ))
          ) : (
            <li className="px-4 py-3 text-muted-foreground">None in this build.</li>
          )}
        </ul>
      </Section>

      <Section title="Accounts & privacy">
        <p>
          Browsing needs no account. If you create one, we store your username, email (never used to send mail), a salted argon2id hash of your password, and the
          favorites, collection, ratings, notes, saved searches and history you add. Delete your account from the account menu to remove all of it.
        </p>
      </Section>

      <p className="border-t pt-6 text-sm text-muted-foreground">Not affiliated with or endorsed by Fragrantica. Perfume names and brands belong to their owners.</p>
    </Page>
  )
}
