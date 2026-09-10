import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { useIsModuleFeatureEnabled } from '@/hooks/use-sidebar-config'
import { formatNumber } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import { getModelStatus } from './api'
import type {
  ModelState,
  ModelStatusRow,
  ProbeResultCode,
  RecentProbe,
} from './types'

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

const STATE_DOT_CLASSES: Record<ModelState, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  err: 'bg-destructive',
  idle: 'bg-muted-foreground/50',
}

const PROBE_CLASSES: Record<ProbeResultCode, string> = {
  0: 'bg-success',
  1: 'bg-warning',
  2: 'bg-destructive',
}

/** Small segmented control, visually matching the approved preview. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className='bg-muted text-muted-foreground inline-flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5'>
      {options.map((option) => (
        <button
          key={option.value}
          type='button'
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
            value === option.value
              ? 'bg-background text-foreground shadow-sm'
              : 'hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Table header rendered like the preview: small, muted, uppercase. */
function th(label: string) {
  return (
    <span className='text-muted-foreground text-[11px] font-semibold tracking-wider uppercase'>
      {label}
    </span>
  )
}

function StateBadge(props: { state: ModelState }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        STATE_CLASSES[props.state]
      )}
    >
      <span className='size-1.5 rounded-full bg-current' aria-hidden='true' />
      {t(STATE_LABELS[props.state])}
    </span>
  )
}

/** One block per probe, oldest first; hovering shows when it ran and its latency. */
function ProbeStrip(props: { recent: RecentProbe[] }) {
  const { t } = useTranslation()
  if (props.recent.length === 0) {
    return <span className='text-muted-foreground text-xs'>—</span>
  }
  return (
    <span className='flex items-center gap-[2px]'>
      {props.recent.map((probe, index) => {
        const label =
          probe.code === 0
            ? t('Passed')
            : probe.code === 1
              ? t('Slow')
              : t('Failed')
        const time = dayjs(probe.ts * 1000).format('MM-DD HH:mm')
        const tooltip =
          probe.latency_ms > 0
            ? `${time} · ${label} · ${formatNumber(probe.latency_ms)} ms`
            : `${time} · ${label}`
        return (
          <span
            key={`${probe.ts}-${index}`}
            title={tooltip}
            className={cn(
              'h-4 w-1 shrink-0 cursor-default rounded-[2px]',
              PROBE_CLASSES[probe.code]
            )}
          />
        )
      })}
    </span>
  )
}

function InfoItem(props: { label: string; value: React.ReactNode }) {
  return (
    <span className='flex min-w-0 items-center gap-2'>
      <span className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
        {props.label}
      </span>
      <span className='text-sm font-semibold tabular-nums whitespace-nowrap'>
        {props.value}
      </span>
    </span>
  )
}

function StatCard(props: {
  label: string
  value: string
  tone?: string
  foot?: string
}) {
  return (
    <div className='bg-card rounded-xl border p-4 shadow-xs'>
      <div className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
        {props.label}
      </div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold tracking-tight tabular-nums',
          props.tone
        )}
      >
        {props.value}
      </div>
      {props.foot ? (
        <div className='text-muted-foreground mt-0.5 text-[11px]'>
          {props.foot}
        </div>
      ) : null}
    </div>
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
  const availability =
    monitored > 0 ? ((monitored - counts.err) / monitored) * 100 : 0

  const visibleRows = useMemo(
    () =>
      stateFilter === 'all'
        ? rows
        : rows.filter((row) => row.state === stateFilter),
    [rows, stateFilter]
  )

  const columns = useMemo<StaticDataTableColumn<ModelStatusRow>[]>(
    () => [
      {
        id: 'model',
        header: th(t('Model')),
        cell: (row) => (
          <span className='flex min-w-0 items-center gap-2'>
            <span
              className={cn(
                'size-2 shrink-0 rounded-[3px]',
                STATE_DOT_CLASSES[row.state]
              )}
              aria-hidden='true'
            />
            <span className='truncate font-medium'>{row.model_name}</span>
          </span>
        ),
      },
      {
        id: 'state',
        header: th(t('Status')),
        cell: (row) => <StateBadge state={row.state} />,
      },
      {
        id: 'latency',
        header: th(t('Response time')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) =>
          row.latency_ms > 0 ? (
            <span
              className={cn(
                'font-medium tabular-nums',
                row.state === 'warn' && 'text-warning'
              )}
            >
              {formatNumber(row.latency_ms)} ms
            </span>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        id: 'channels',
        header: th(t('Channels')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) => (
          <span className='tabular-nums'>
            {row.channels_up} / {row.channels_total}
          </span>
        ),
      },
      {
        id: 'lastProbe',
        header: th(t('Last check')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) =>
          row.last_probe_at > 0 ? (
            <span className='text-muted-foreground text-xs tabular-nums'>
              {dayjs(row.last_probe_at * 1000).format('MM-DD HH:mm')}
            </span>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        id: 'recent',
        header: th(t('Last 24 probes')),
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

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Model Status')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <div className='bg-card flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border p-4 shadow-xs'>
            <InfoItem
              label={t('Interval')}
              value={t('every {{n}} min', {
                n: probe ? Math.round(probe.interval_minutes) : 10,
              })}
            />
            <span className='bg-border hidden h-6 w-px self-center sm:block' />
            <InfoItem
              label={t('Last check')}
              value={
                probe && probe.last_at > 0
                  ? dayjs(probe.last_at * 1000).format('MM-DD HH:mm')
                  : '—'
              }
            />
            <span className='bg-border hidden h-6 w-px self-center sm:block' />
            <InfoItem
              label={t('Next check')}
              value={
                probe && probe.next_at > 0
                  ? dayjs(probe.next_at * 1000).format('MM-DD HH:mm')
                  : '—'
              }
            />
            <span className='bg-border hidden h-6 w-px self-center sm:block' />
            <InfoItem
              label={t('Channels')}
              value={
                probe
                  ? `${probe.channels_covered} / ${probe.channels_total}`
                  : '—'
              }
            />
          </div>

          <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
            <StatCard
              label={t('Healthy')}
              value={String(counts.ok)}
              tone='text-success'
              foot={`${t('Models used')} ${rows.length}`}
            />
            <StatCard
              label={t('Degraded')}
              value={String(counts.warn)}
              tone='text-warning'
            />
            <StatCard
              label={t('Down')}
              value={String(counts.err)}
              tone='text-destructive'
            />
            <StatCard
              label={t('Availability')}
              value={`${availability.toFixed(1)}%`}
            />
          </div>

          <div className='flex flex-wrap items-center justify-between gap-3'>
            <Segmented
              value={stateFilter}
              onChange={setStateFilter}
              options={STATE_FILTERS.map((filter) => ({
                value: filter.key,
                label: t(filter.label),
              }))}
            />
            <div className='text-muted-foreground flex flex-wrap items-center gap-4 text-[11px]'>
              <span className='flex items-center gap-1.5'>
                <span className='bg-success h-2.5 w-1 rounded-[2px]' />
                {t('Passed')}
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='bg-warning h-2.5 w-1 rounded-[2px]' />
                {t('Slow')}
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='bg-destructive h-2.5 w-1 rounded-[2px]' />
                {t('Failed')}
              </span>
            </div>
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
