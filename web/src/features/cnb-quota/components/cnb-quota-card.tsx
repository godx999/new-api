import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, Gem, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { getCnbQuota } from '@/features/cnb-quota/api'
import type { CnbResource, CnbUsageTotals } from '@/features/cnb-quota/types'
import { formatNumber, formatTokens } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import { PanelWrapper } from '../../dashboard/components/ui/panel-wrapper'

const REFRESH_INTERVAL = 5 * 60 * 1000

function usedPercent(resource: CnbResource): number {
  if (resource.total <= 0) return 0
  return Math.min(100, (resource.used / resource.total) * 100)
}

function barToneClass(percent: number): string {
  if (percent >= 85) return 'bg-destructive'
  if (percent >= 60) return 'bg-warning'
  return 'bg-success'
}

function textToneClass(percent: number): string {
  if (percent >= 85) return 'text-destructive'
  if (percent >= 60) return 'text-warning'
  return 'text-success'
}

function MeterRow(props: {
  label: string
  resource: CnbResource
  unit: string
}) {
  const percent = usedPercent(props.resource)
  return (
    <div>
      <div className='mb-1.5 flex items-baseline justify-between gap-2'>
        <span className='text-xs font-medium'>{props.label}</span>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {formatNumber(props.resource.used)} /{' '}
          {formatNumber(props.resource.total)} {props.unit}
          <span className={cn('ml-2', textToneClass(percent))}>
            {percent.toFixed(1)}%
          </span>
        </span>
      </div>
      <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            barToneClass(percent)
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function UsageStatBox(props: { title: string; usage: CnbUsageTotals }) {
  const { t } = useTranslation()
  const rows = [
    {
      icon: <ArrowUpRight className='size-3' aria-hidden='true' />,
      label: t('Input'),
      value: formatTokens(props.usage.prompt_tokens),
      iconClass: 'bg-primary/10 text-primary',
    },
    {
      icon: <ArrowDownRight className='size-3' aria-hidden='true' />,
      label: t('Output'),
      value: formatTokens(props.usage.completion_tokens),
      iconClass: 'bg-success/10 text-success',
    },
    {
      icon: <RefreshCw className='size-3' aria-hidden='true' />,
      label: t('Requests'),
      value: formatNumber(props.usage.requests),
      iconClass: 'bg-warning/10 text-warning',
    },
  ]

  return (
    <div className='bg-muted/40 flex flex-col gap-1.5 rounded-xl px-3 py-2.5'>
      <div className='text-muted-foreground text-[11px] font-medium tracking-wide'>
        {props.title}
      </div>
      {rows.map((row) => (
        <div key={row.label} className='flex items-center gap-2'>
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-md',
              row.iconClass
            )}
          >
            {row.icon}
          </span>
          <span className='text-sm font-semibold tabular-nums'>
            {row.value}
          </span>
          <span className='text-muted-foreground text-[11px]'>
            {row.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function Last7DaysChart(props: {
  daily: { date: string; prompt_tokens: number; completion_tokens: number }[]
}) {
  const { t } = useTranslation()
  const totals = props.daily.map(
    (day) => day.prompt_tokens + day.completion_tokens
  )
  const max = Math.max(...totals, 1)

  return (
    <div>
      <div className='text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide'>
        {t('Last 7 days')}
      </div>
      <div className='flex h-20 items-end gap-2'>
        {props.daily.map((day, index) => {
          const total = totals[index] ?? 0
          const isToday = index === props.daily.length - 1
          return (
            <div
              key={day.date}
              className='flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1'
              title={`${day.date} · ${formatTokens(total)} ${t('Tokens')}`}
            >
              <div
                className={cn(
                  'w-3/5 max-w-8 rounded-t-md transition-[height] duration-500',
                  isToday ? 'bg-primary' : 'bg-primary/30'
                )}
                style={{
                  height: `${Math.max(4, Math.round((total / max) * 100))}%`,
                }}
              />
              <span
                className={cn(
                  'truncate text-[10px] tabular-nums',
                  isToday
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {day.date.slice(5)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CnbQuotaCard() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['dashboard', 'overview', 'cnb-quota'],
    queryFn: () => getCnbQuota(),
    refetchInterval: REFRESH_INTERVAL,
    staleTime: 60 * 1000,
    retry: 1,
  })

  const payload = query.data
  if (query.isPending || query.isError || !payload) return null
  if (!payload.success) {
    return (
      <div className='bg-card overflow-hidden rounded-2xl border shadow-xs'>
        <div className='flex items-center gap-3 px-4 py-3 sm:px-5'>
          <IconBadge tone='warning' size='sm'>
            <Gem />
          </IconBadge>
          <div className='min-w-0'>
            <div className='text-sm font-medium'>{t('CNB AI Quota')}</div>
            <div className='text-muted-foreground truncate text-xs'>
              {payload.message}
            </div>
          </div>
        </div>
      </div>
    )
  }
  const quota = payload.data?.quota
  if (!payload.data?.enabled || !quota) return null

  const meters = [
    { key: 'credits', label: t('Credits'), resource: quota.credits, unit: 'cr' },
    {
      key: 'dev',
      label: t('Dev core-hours'),
      resource: quota.dev,
      unit: 'core-h',
    },
    { key: 'ci', label: t('CI core-hours'), resource: quota.ci, unit: 'core-h' },
  ].filter((meter) => meter.resource.total > 0 || meter.resource.used > 0)

  const inFlight =
    quota.credits.freeze > 0 || quota.dev.freeze > 0 || quota.ci.freeze > 0

  return (
    <PanelWrapper
      title={
        <span className='flex items-center gap-2'>
          <IconBadge tone='info' size='sm'>
            <Gem />
          </IconBadge>
          {t('CNB AI Quota')}
        </span>
      }
      description={quota.org}
      headerActions={
        <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
          <RefreshCw className='size-3' aria-hidden='true' />
          {t('Synced every 5 min')}
          <span className='mx-1 opacity-40'>·</span>
          {t('Updated {{time}}', {
            time: dayjs(quota.fetched_at * 1000).format('MM-DD HH:mm'),
          })}
        </span>
      }
    >
      <div className='grid gap-6 lg:grid-cols-2'>
        <div className='flex flex-col gap-4'>
          {meters.map((meter) => (
            <MeterRow
              key={meter.key}
              label={meter.label}
              resource={meter.resource}
              unit={meter.unit}
            />
          ))}
          <div className='bg-muted/40 flex items-center justify-between rounded-xl px-3 py-2 text-sm'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Remaining')} / {t('Total')}
            </span>
            <span className='font-semibold tabular-nums'>
              <span className={cn(textToneClass(usedPercent(quota.credits)))}>
                {formatNumber(
                  Math.max(0, quota.credits.total - quota.credits.used)
                )}
              </span>
              <span className='text-muted-foreground'> / </span>
              {formatNumber(quota.credits.total)} cr
            </span>
          </div>
          {inFlight && (
            <div className='text-muted-foreground text-xs'>
              {t('In-flight (not yet settled)')}:{' '}
              {[
                quota.credits.freeze > 0
                  ? `${formatNumber(quota.credits.freeze)} cr`
                  : null,
                quota.dev.freeze > 0
                  ? `${formatNumber(quota.dev.freeze)} core-h`
                  : null,
                quota.ci.freeze > 0
                  ? `${formatNumber(quota.ci.freeze)} core-h`
                  : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </div>
          )}
        </div>

        <div className='flex flex-col gap-3'>
          <div className='text-sm font-semibold'>{t('Token Usage')}</div>
          <div className='grid grid-cols-2 gap-2'>
            <UsageStatBox
              title={t('Today (UTC+8)')}
              usage={quota.usage.today}
            />
            <UsageStatBox
              title={t('Cumulative')}
              usage={quota.usage.cumulative}
            />
          </div>
          <Last7DaysChart daily={quota.usage.daily} />
        </div>
      </div>
    </PanelWrapper>
  )
}
