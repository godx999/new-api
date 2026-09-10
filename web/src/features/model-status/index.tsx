import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable, type StaticDataTableColumn } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useIsModuleFeatureEnabled } from '@/hooks/use-sidebar-config'
import { formatNumber } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import { getModelStatus } from './api'
import type { ModelState, ModelStatusRow, ProbeResultCode } from './types'

const STATE_FILTERS: Array<{ key: 'all' | ModelState; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'ok', label: 'Healthy' },
  { key: 'warn', label: 'Degraded' },
  { key: 'err', label: 'Down' },
]

const STATE_LABELS: Record<ModelState, string> = {
  ok: 'Healthy',
  warn: 'Degraded',
  err: 'Down',
  idle: 'Not tested',
}

const STATE_CLASSES: Record<ModelState, string> = {
  ok: 'bg-success/10 text-success',
  warn: 'bg-warning/10 text-warning',
  err: 'bg-destructive/10 text-destructive',
  idle: 'bg-muted text-muted-foreground',
}

const PROBE_CLASSES: Record<ProbeResultCode, string> = {
  0: 'bg-success',
  1: 'bg-warning',
  2: 'bg-destructive',
}

function StateBadge(props: { state: ModelState }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        STATE_CLASSES[props.state]
      )}
    >
      {t(STATE_LABELS[props.state])}
    </span>
  )
}

/** One block per probe, oldest first; a gap shows when no probe exists yet. */
function ProbeStrip(props: { recent: ProbeResultCode[] }) {
  const { t } = useTranslation()
  if (props.recent.length === 0) {
    return <span className='text-muted-foreground text-xs'>—</span>
  }
  return (
    <span className='flex items-center gap-[2px]' title={t('Last 24 probes')}>
      {props.recent.map((code, index) => (
        <span
          key={index}
          className={cn('h-4 w-1 rounded-[2px]', PROBE_CLASSES[code])}
        />
      ))}
    </span>
  )
}

export function ModelStatus() {
  const { t } = useTranslation()
  const featureEnabled = useIsModuleFeatureEnabled('/model-status')
  const [stateFilter, setStateFilter] = useState<'all' | ModelState>('all')

  const query = useQuery({
    queryKey: ['model-status'],
    queryFn: getModelStatus,
    enabled: featureEnabled,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  const payload = query.data?.success ? query.data.data : undefined
  const probe = payload?.probe
  const rows = useMemo(() => payload?.models ?? [], [payload?.models])

  const counts = useMemo(() => {
    const result = { ok: 0, warn: 0, err: 0, idle: 0 }
    rows.forEach((row) => {
      result[row.state] += 1
    })
    return result
  }, [rows])

  const monitored = rows.length - counts.idle
  const availability = monitored > 0 ? ((monitored - counts.err) / monitored) * 100 : 0

  const visibleRows = useMemo(
    () => (stateFilter === 'all' ? rows : rows.filter((row) => row.state === stateFilter)),
    [rows, stateFilter]
  )

  const columns = useMemo<StaticDataTableColumn<ModelStatusRow>[]>(
    () => [
      {
        id: 'model',
        header: t('Model'),
        cell: (row) => <span className='font-medium'>{row.model_name}</span>,
      },
      {
        id: 'state',
        header: t('Status'),
        cell: (row) => <StateBadge state={row.state} />,
      },
      {
        id: 'latency',
        header: t('Response time'),
        className: 'text-right',
        cell: (row) =>
          row.latency_ms > 0
            ? `${formatNumber(row.latency_ms)} ms`
            : '—',
      },
      {
        id: 'channels',
        header: t('Channels'),
        className: 'text-right',
        cell: (row) => `${row.channels_up} / ${row.channels_total}`,
      },
      {
        id: 'lastProbe',
        header: t('Last check'),
        className: 'text-right',
        cell: (row) =>
          row.last_probe_at > 0
            ? dayjs(row.last_probe_at * 1000).format('MM-DD HH:mm')
            : '—',
      },
      {
        id: 'recent',
        header: t('Last 24 probes'),
        cell: (row) => <ProbeStrip recent={row.recent} />,
      },
    ],
    [t]
  )

  if (!featureEnabled) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Model Status')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='bg-card text-muted-foreground rounded-2xl border p-6 text-sm shadow-xs'>
            {t('This feature is disabled in system settings.')}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const statCard = (label: string, value: string, tone?: string) => (
    <div key={label} className='bg-card rounded-2xl border p-4 shadow-xs'>
      <div className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        {label}
      </div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tone)}>
        {value}
      </div>
    </div>
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Model Status')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <div className='bg-card flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border p-4 text-sm shadow-xs'>
            <span className='flex items-center gap-2'>
              <span className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
                {t('Interval')}
              </span>
              {t('every {{n}} min', {
                n: probe ? Math.round(probe.interval_minutes) : 10,
              })}
            </span>
            <span className='flex items-center gap-2'>
              <span className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
                {t('Last check')}
              </span>
              {probe && probe.last_at > 0
                ? dayjs(probe.last_at * 1000).format('MM-DD HH:mm')
                : '—'}
            </span>
            <span className='flex items-center gap-2'>
              <span className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
                {t('Channels')}
              </span>
              {probe ? `${probe.channels_covered} / ${probe.channels_total}` : '—'}
            </span>
          </div>

          <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
            {statCard(t('Healthy'), String(counts.ok), 'text-success')}
            {statCard(t('Degraded'), String(counts.warn), 'text-warning')}
            {statCard(t('Down'), String(counts.err), 'text-destructive')}
            {statCard(t('Availability'), `${availability.toFixed(1)}%`)}
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {STATE_FILTERS.map((filter) => (
              <Button
                key={filter.key}
                size='sm'
                variant={stateFilter === filter.key ? 'default' : 'outline'}
                onClick={() => setStateFilter(filter.key)}
              >
                {t(filter.label)}
              </Button>
            ))}
          </div>

          <StaticDataTable
            columns={columns}
            data={visibleRows}
            getRowKey={(row) => row.model_name}
            empty={!query.isPending && visibleRows.length === 0}
            emptyContent={t('No data available')}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
