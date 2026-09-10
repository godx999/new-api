import { api, type ApiRequestConfig } from '@/lib/api'

import type { UsageGranularity, UsageResponse } from './types'

export interface ModelUsageQuery {
  startTimestamp: number
  endTimestamp: number
  granularity: UsageGranularity
  /** Minutes east of UTC, so the backend can align day buckets. */
  tzOffsetSeconds: number
  username?: string
  isAdmin: boolean
}

/**
 * Per-model usage for one range. Admins read every user's totals (optionally
 * narrowed to one username); everyone else reads their own.
 */
export async function getModelUsage(
  query: ModelUsageQuery
): Promise<UsageResponse> {
  const config: ApiRequestConfig = {
    skipBusinessError: true,
    skipErrorHandler: true,
    params: {
      start_timestamp: query.startTimestamp,
      end_timestamp: query.endTimestamp,
      granularity: query.granularity,
      tz_offset: query.tzOffsetSeconds,
      ...(query.username ? { username: query.username } : {}),
    },
  }
  const url = query.isAdmin ? '/api/data/models' : '/api/data/models/self'
  const response = await api.get<UsageResponse>(url, config)
  return response.data
}
