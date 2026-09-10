export type ModelState = 'ok' | 'warn' | 'err' | 'idle'

/** Probe result codes: 0 passed, 1 slow, 2 failed. */
export type ProbeResultCode = 0 | 1 | 2

export interface ModelProbeInfo {
  enabled: boolean
  interval_minutes: number
  last_at: number
  next_at: number
  channels_covered: number
  channels_total: number
}

export interface ModelStatusRow {
  model_name: string
  state: ModelState
  latency_ms: number
  channels_up: number
  channels_total: number
  last_probe_at: number
  recent: ProbeResultCode[]
}

export interface ModelStatusPayload {
  probe: ModelProbeInfo
  models: ModelStatusRow[]
}

export interface ModelStatusResponse {
  success: boolean
  message: string
  data: ModelStatusPayload
}
