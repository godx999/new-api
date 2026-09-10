import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConsumptionDistributionChart } from '@/features/dashboard/components/models/consumption-distribution-chart'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { useIsModuleFeatureEnabled } from '@/hooks/use-sidebar-config'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { getModelUsage } from './api'
import type { UsageGranularity, UsageModelRow } from './types'

type RangeKey =
  | 'today'
  | 'thisWeek'
  | 'thisMonth'
  | 'last7'
  | 'last30'
  | 'last12Months'

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'thisMonth', label: 'Current month' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last12Months', label: 'Last 12 months' },
]

const GRANULARITY_OPTIONS: Array<{
  value: UsageGranularity
  label: string
}> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

/** Monday-based start of week; dayjs' startOf('week') is locale dependent. */
function startOfWeekMonday(date: dayjs.Dayjs): dayjs.Dayjs {
  return date.startOf('day').subtract((date.day() + 6) % 7, 'day')
}

function resolveRange(key: RangeKey): { start: number; end: number } {
  const now = dayjs()
  const end = now.unix()
  switch (key) {
    case 'today':
      return { start: now.startOf('day').unix(), end }
    case 'thisWeek':
      return { start: startOfWeekMonday(now).unix(), end }
    case 'thisMonth':
      return { start: now.startOf('month').unix(), end }
    case 'last7':
      return { start: now.startOf('day').subtract(6, 'day').unix(), end }
    case 'last30':
      return { start: now.startOf('day').subtract(29, 'day').unix(), end }
    default:
      return {
        start: now.startOf('month').subtract(11, 'month').unix(),
        end,
      }
  }
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

function StatCard(props: { label: string; value: string; foot?: string }) {
  return (
    <div className='bg-card rounded-xl border p-4 shadow-xs'>
      <div className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
        {props.label}
      </div>
      <div className='mt-1 text-2xl font-bold tracking-tight tabular-nums'>
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

export function UsageDetails() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)
  const featureEnabled = useIsModuleFeatureEnabled('/usage-details')

  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const [granularity, setGranularity] = useState<UsageGranularity>('day')
  const [search, setSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [username, setUsername] = useState('')

  const range = useMemo(() => resolveRange(rangeKey), [rangeKey])
  const tzOffsetSeconds = useMemo(
    () => -new Date().getTimezoneOffset() * 60,
    []
  )

  const query = useQuery({
    queryKey: [
      'usage-details',
      range.start,
      range.end,
      granularity,
      tzOffsetSeconds,
      username,
      isAdmin,
    ],
    queryFn: () =>
      getModelUsage({
        startTimestamp: range.start,
        endTimestamp: range.end,
        granularity,
        tzOffsetSeconds,
        username: isAdmin && username ? username : undefined,
        isAdmin,
      }),
    enabled: featureEnabled,
    staleTime: 60 * 1000,
  })

  const payload = query.data?.success ? query.data.data : undefined
  const models = payload?.models ?? []
  const summary = payload?.summary

  const visibleModels = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return models.filter((row) => {
      if (!showDeleted && !row.available) return false
      if (keyword && !row.model_name.toLowerCase().includes(keyword)) {
        return false
      }
      return true
    })
  }, [models, search, showDeleted])

  const deletedCount = models.filter((row) => !row.available).length

  const columns = useMemo<StaticDataTableColumn<UsageModelRow>[]>(() => {
    const totalQuota = summary?.quota ?? 0
    return [
      {
        id: 'model',
        header: th(t('Model')),
        cell: (row) => (
          <span className='flex min-w-0 items-center gap-2'>
            <span className='truncate font-medium'>{row.model_name}</span>
            {!row.available && (
              <span className='text-muted-foreground bg-muted shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium'>
                {t('Deleted')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'quota',
        header: th(t('Spend')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) => (
          <span className='font-medium tabular-nums'>
            {formatQuota(row.quota)}
          </span>
        ),
      },
      {
        id: 'tokens',
        header: th(t('Tokens')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) => (
          <span className='tabular-nums'>{formatTokens(row.token_used)}</span>
        ),
      },
      {
        id: 'count',
        header: th(t('Requests')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) => (
          <span className='tabular-nums'>{formatNumber(row.count)}</span>
        ),
      },
      {
        id: 'share',
        header: th(t('Share')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) => {
          const share = totalQuota > 0 ? (row.quota / totalQuota) * 100 : null
          return (
            <span className='flex items-center justify-end gap-2'>
              <span className='bg-muted hidden h-1 w-14 shrink-0 overflow-hidden rounded-full sm:block'>
                {share !== null && (
                  <span
                    className='bg-primary h-full rounded-full'
                    style={{ width: `${Math.min(100, share).toFixed(1)}%` }}
                  />
                )}
              </span>
              <span className='min-w-[42px] text-right font-medium tabular-nums'>
                {share !== null ? `${share.toFixed(1)}%` : '—'}
              </span>
            </span>
          )
        },
      },
      {
        id: 'lastUsed',
        header: th(t('Last used')),
        className: 'text-right',
        cellClassName: 'text-right',
        cell: (row) =>
          row.last_used_at > 0 ? (
            <span className='text-muted-foreground text-xs tabular-nums'>
              {dayjs(row.last_used_at * 1000).format('MM-DD HH:mm')}
            </span>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
    ]
  }, [summary?.quota, t])

  const chartData = useMemo<QuotaDataItem[]>(
    () =>
      (payload?.series ?? []).map((point) => ({
        model_name: point.model_name,
        created_at: point.created_at,
        quota: point.quota,
        token_used: point.token_used,
        count: point.count,
      })),
    [payload?.series]
  )

  if (!featureEnabled) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Usage Details')}</SectionPageLayout.Title>
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
      <SectionPageLayout.Title>{t('Usage Details')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <div className='bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-xs'>
            <div className='flex flex-wrap items-center gap-x-5 gap-y-2'>
              <span className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
                {t('Range')}
              </span>
              <Segmented
                value={rangeKey}
                onChange={setRangeKey}
                options={RANGE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.label),
                }))}
              />
              <span className='bg-border mx-1 hidden h-6 w-px self-center lg:block' />
              <span className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
                {t('Granularity')}
              </span>
              <Segmented
                value={granularity}
                onChange={setGranularity}
                options={GRANULARITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.label),
                }))}
              />
            </div>
            <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
              <Input
                className='h-8 w-48'
                placeholder={t('Search model')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <label className='text-muted-foreground flex cursor-pointer items-center gap-2 text-xs'>
                <Switch checked={showDeleted} onCheckedChange={setShowDeleted} />
                {t('Show deleted models')}
              </label>
              {isAdmin && (
                <Input
                  className='h-8 w-40'
                  placeholder={t('Username')}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              )}
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
            <StatCard
              label={t('Total spend')}
              value={summary ? formatQuota(summary.quota) : '—'}
            />
            <StatCard
              label={t('Total tokens')}
              value={summary ? formatTokens(summary.token_used) : '—'}
            />
            <StatCard
              label={t('Total requests')}
              value={summary ? formatNumber(summary.count) : '—'}
            />
            <StatCard
              label={t('Models used')}
              value={summary ? String(summary.model_count) : '—'}
              foot={
                deletedCount > 0 ? `${deletedCount} ${t('deleted')}` : undefined
              }
            />
          </div>

          <ConsumptionDistributionChart
            data={chartData}
            loading={query.isPending}
            timeGranularity={granularity}
            defaultChartType='area'
          />

          <StaticDataTable
            columns={columns}
            data={visibleModels}
            getRowKey={(row) => row.model_name}
            empty={!query.isPending && visibleModels.length === 0}
            emptyContent={t('No data available')}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
