export type UsageGranularity = 'day' | 'week' | 'month'

export interface UsageSummary {
  quota: number
  token_used: number
  count: number
  model_count: number
}

export interface UsageModelRow {
  model_name: string
  quota: number
  token_used: number
  count: number
  last_used_at: number
  /** False once the model no longer has an enabled channel. */
  available: boolean
}

export interface UsageSeriesPoint {
  model_name: string
  created_at: number
  quota: number
  token_used: number
  count: number
}

export interface UsagePayload {
  summary: UsageSummary
  models: UsageModelRow[]
  series: UsageSeriesPoint[]
}

export interface UsageResponse {
  success: boolean
  message: string
  data: UsagePayload
}
