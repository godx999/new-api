import { api, type ApiRequestConfig } from '@/lib/api'

import type { ModelStatusResponse } from './types'

export async function getModelStatus(): Promise<ModelStatusResponse> {
  const config: ApiRequestConfig = {
    skipBusinessError: true,
    skipErrorHandler: true,
  }
  const response = await api.get<ModelStatusResponse>('/api/model_status', config)
  return response.data
}
