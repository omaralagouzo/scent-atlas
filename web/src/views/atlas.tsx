import type { ViewProps } from '@/App'
import { Page, PageHeader } from '@/components/page'

export default function View(_: ViewProps) {
  return (
    <Page>
      <PageHeader title="atlas" description="Being rebuilt." />
    </Page>
  )
}
