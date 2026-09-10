import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable, type StaticDataTableColumn } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConsumptionDistributionChart } from '@/features/dashboard/components/models/consumption-distribution-chart'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
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

const RANGE_KEYS: RangeKey[] = [
  'today',
  'thisWeek',
  'thisMonth',
  'last7',
  'last30',
  'last12Months',
]

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today',
  thisWeek: 'This week',
  thisMonth: 'This month',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  last12Months: 'Last 12 months',
}

const GRANULARITIES: UsageGranularity[] = ['day', 'week', 'month']

const GRANULARITY_LABELS: Record<UsageGranularity, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

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

export function UsageDetails() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)

  const [rangeKey, setRangeKey] = useState<RangeKey>('last12Months')
  const [granularity, setGranularity] = useState<UsageGranularity>('month')
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
        header: t('Model'),
        cell: (row) => (
          <span className='flex items-center gap-2'>
            <span className='truncate font-medium'>{row.model_name}</span>
            {!row.available && (
              <span className='text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 text-[10px]'>
                {t('Deleted')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'quota',
        header: t('Spend'),
        className: 'text-right',
        cell: (row) => formatQuota(row.quota),
      },
      {
        id: 'tokens',
        header: t('Tokens'),
        className: 'text-right',
        cell: (row) => formatTokens(row.token_used),
      },
      {
        id: 'count',
        header: t('Requests'),
        className: 'text-right',
        cell: (row) => formatNumber(row.count),
      },
      {
        id: 'share',
        header: t('Share'),
        className: 'text-right',
        cell: (row) =>
          totalQuota > 0
            ? `${((row.quota / totalQuota) * 100).toFixed(1)}%`
            : '—',
      },
      {
        id: 'lastUsed',
        header: t('Last used'),
        className: 'text-right',
        cell: (row) =>
          row.last_used_at > 0
            ? dayjs(row.last_used_at * 1000).format('MM-DD HH:mm')
            : '—',
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

  const statCard = (label: string, value: string) => (
    <div key={label} className='bg-card rounded-2xl border p-4 shadow-xs'>
      <div className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        {label}
      </div>
      <div className='mt-1.5 text-2xl font-semibold tabular-nums'>{value}</div>
    </div>
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Usage Details')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <div className='bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-xs'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
                {t('Range')}
              </span>
              {RANGE_KEYS.map((key) => (
                <Button
                  key={key}
                  size='sm'
                  variant={rangeKey === key ? 'default' : 'outline'}
                  onClick={() => setRangeKey(key)}
                >
                  {t(RANGE_LABELS[key])}
                </Button>
              ))}
              <span className='text-muted-foreground ml-2 text-xs font-semibold tracking-wide uppercase'>
                {t('Granularity')}
              </span>
              {GRANULARITIES.map((key) => (
                <Button
                  key={key}
                  size='sm'
                  variant={granularity === key ? 'default' : 'outline'}
                  onClick={() => setGranularity(key)}
                >
                  {t(GRANULARITY_LABELS[key])}
                </Button>
              ))}
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <Input
                className='h-8 w-48'
                placeholder={t('Search model')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <label className='text-muted-foreground flex items-center gap-2 text-xs'>
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
            {statCard(
              t('Total spend'),
              summary ? formatQuota(summary.quota) : '—'
            )}
            {statCard(
              t('Total tokens'),
              summary ? formatTokens(summary.token_used) : '—'
            )}
            {statCard(
              t('Total requests'),
              summary ? formatNumber(summary.count) : '—'
            )}
            {statCard(
              t('Models used'),
              summary
                ? `${summary.model_count}${deletedCount > 0 ? ` (${deletedCount} ${t('deleted')})` : ''}`
                : '—'
            )}
          </div>

          <ConsumptionDistributionChart
            data={chartData}
            loading={query.isPending}
            timeGranularity={granularity}
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
