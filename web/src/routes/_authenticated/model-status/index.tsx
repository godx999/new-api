import { createFileRoute } from '@tanstack/react-router'

import { ModelStatus } from '@/features/model-status'

export const Route = createFileRoute('/_authenticated/model-status/')({
  component: ModelStatus,
})
