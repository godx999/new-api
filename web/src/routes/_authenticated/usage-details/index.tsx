import { createFileRoute } from '@tanstack/react-router'

import { UsageDetails } from '@/features/usage-details'

export const Route = createFileRoute('/_authenticated/usage-details/')({
  component: UsageDetails,
})
