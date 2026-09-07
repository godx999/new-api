import { api, type ApiRequestConfig } from '@/lib/api'

import type { CnbQuotaResponse } from './types'

export async function getCnbQuota(
  refresh = false
): Promise<CnbQuotaResponse> {
  const config: ApiRequestConfig = {
    skipBusinessError: true,
    skipErrorHandler: true,
  }
  if (refresh) {
    config.params = { refresh: 1 }
  }
  const response = await api.get<CnbQuotaResponse>('/api/cnb_quota', config)
  return response.data
}
