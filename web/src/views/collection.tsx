import type { ViewProps } from '@/App'
import { Page, PageHeader } from '@/components/page'

export default function View(_: ViewProps) {
  return (
    <Page>
      <PageHeader title="collection" description="Being rebuilt." />
    </Page>
  )
}
