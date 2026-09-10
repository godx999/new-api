/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import dayjs from '@/lib/dayjs'

import { padChartTimePoints } from './charts'

const march15 = dayjs('2026-03-15T12:00:00').unix()

describe('padChartTimePoints', () => {
  test('pads month buckets by calendar month without skips or duplicates', () => {
    const times = ['2026-01', '2026-02', '2026-03']
    const padded = padChartTimePoints(times, march15, 'month')

    expect(padded).toHaveLength(7)
    expect(new Set(padded).size).toBe(7)
    expect(padded).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ])
  })

  test('spans a non-30-day month boundary (February) correctly', () => {
    // A fixed 30-day stride from 2026-03-01 lands on 01-31 and then 01-01,
    // dropping February and repeating January.
    const times = ['2026-01', '2026-03']
    const padded = padChartTimePoints(times, march15, 'month')

    expect(padded).toContain('2026-02')
    expect(padded.filter((t) => t === '2026-01')).toHaveLength(1)
    expect(new Set(padded).size).toBe(padded.length)
  })

  test('keeps real months that fall outside the padded window', () => {
    const times = ['2024-01', '2026-03']
    const padded = padChartTimePoints(times, march15, 'month')

    expect(padded).toContain('2024-01')
    expect(padded).toContain('2026-03')
    expect([...padded].sort()).toEqual(padded)
  })

  test('leaves hour/day/week padding on the fixed stride', () => {
    const dayPadded = padChartTimePoints(['2026-03-15'], march15, 'day')
    expect(dayPadded).toHaveLength(7)
    expect(dayPadded[6]).toBe('03-15')
    expect(dayPadded[5]).toBe('03-14')
    expect(dayPadded[0]).toBe('03-09')

    const hourPadded = padChartTimePoints(['03-15 12:00'], march15, 'hour')
    expect(hourPadded).toHaveLength(7)
    expect(hourPadded[6]).toBe('03-15 12:00')
    expect(hourPadded[5]).toBe('03-15 11:00')
  })

  test('returns times untouched when enough points or no data exist', () => {
    const seven = [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]
    expect(padChartTimePoints(seven, march15, 'month')).toBe(seven)

    expect(padChartTimePoints([], 0, 'month')).toEqual([])
  })
})
