export interface CnbResource {
  total: number
  used: number
  freeze: number
}

export interface CnbUsageTotals {
  prompt_tokens: number
  completion_tokens: number
  requests: number
}

export interface CnbDailyPoint extends CnbUsageTotals {
  date: string
}

export interface CnbUsageView {
  today: CnbUsageTotals
  cumulative: CnbUsageTotals
  daily: CnbDailyPoint[]
}

export interface CnbQuotaSnapshot {
  org: string
  credits: CnbResource
  dev: CnbResource
  ci: CnbResource
  usage: CnbUsageView
  fetched_at: number
}

export interface CnbQuotaData {
  enabled: boolean
  quota?: CnbQuotaSnapshot
}

export interface CnbQuotaResponse {
  success: boolean
  message: string
  data: CnbQuotaData
}
