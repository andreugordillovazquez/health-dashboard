import { useMemo, useState } from 'react'
import type { DailyMetrics } from './types'
import type { Granularity } from './analysis'
import { TabHeader } from './ui'

const METRICS: { key: keyof DailyMetrics; label: string; unit: string; colorScale: string[] }[] = [
  { key: 'steps', label: 'Steps', unit: 'steps', colorScale: ['#0f1729', '#1e3a5f', '#1d4ed8', '#3b82f6', '#93c5fd'] },
  { key: 'activeEnergy', label: 'Active Energy', unit: 'kcal', colorScale: ['#1a0f0f', '#5c1a1a', '#dc2626', '#ef4444', '#fca5a5'] },
  { key: 'exerciseMinutes', label: 'Exercise', unit: 'min', colorScale: ['#071a0f', '#14532d', '#16a34a', '#22c55e', '#86efac'] },
  { key: 'sleepHours', label: 'Sleep', unit: 'hrs', colorScale: ['#0f172a', '#1e1b4b', '#6366f1', '#818cf8', '#c7d2fe'] },
  { key: 'distance', label: 'Distance', unit: 'km', colorScale: ['#0a1a1a', '#134e4a', '#0d9488', '#14b8a6', '#99f6e4'] },
  { key: 'restingHeartRate', label: 'Resting HR', unit: 'bpm', colorScale: ['#fca5a5', '#ef4444', '#dc2626', '#991b1b', '#450a0a'] },
]

const DAYS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getWeekday(date: Date): number {
  const d = date.getDay()
  return d === 0 ? 6 : d - 1
}

interface Props {
  metrics: DailyMetrics[]
  granularity: Granularity
}

export default function CalendarHeatmap({ metrics, granularity }: Props) {
  const metricsMap = useMemo(() => {
    const m = new Map<string, DailyMetrics>()
    for (const d of metrics) m.set(d.date, d)
    return m
  }, [metrics])

  const years = useMemo(() => {
    const yrs = new Set<number>()
    for (const m of metrics) yrs.add(parseInt(m.date.substring(0, 4)))
    return Array.from(yrs).sort((a, b) => b - a)
  }, [metrics])

  const [selectedYear, setSelectedYear] = useState(years[0] || 2026)
  const [hoveredDay, setHoveredDay] = useState<{ date: string; values: Record<string, number | null>; x: number; y: number } | null>(null)

  // Compute percentiles per metric (across all data, not just selected year)
  const percentiles = useMemo(() => {
    const result: Record<string, { p20: number; p40: number; p60: number; p80: number }> = {}
    for (const m of METRICS) {
      const vals = metrics
        .map(d => d[m.key] as number | null)
        .filter((v): v is number => v !== null && v > 0)
        .sort((a, b) => a - b)
      if (vals.length === 0) {
        result[m.key] = { p20: 0, p40: 0, p60: 0, p80: 0 }
      } else {
        result[m.key] = {
          p20: vals[Math.floor(vals.length * 0.2)],
          p40: vals[Math.floor(vals.length * 0.4)],
          p60: vals[Math.floor(vals.length * 0.6)],
          p80: vals[Math.floor(vals.length * 0.8)],
        }
      }
    }
    return result
  }, [metrics])

  function getColor(metricIdx: number, value: number | null): string {
    if (value === null || value <= 0) return '#09090b'
    const m = METRICS[metricIdx]
    const p = percentiles[m.key]
    const cs = m.colorScale
    if (value <= p.p20) return cs[0]
    if (value <= p.p40) return cs[1]
    if (value <= p.p60) return cs[2]
    if (value <= p.p80) return cs[3]
    return cs[4]
  }

  return (
    <div className="space-y-4">
      <TabHeader title="Calendar" description="Daily health metrics visualized as a calendar heatmap — spot patterns at a glance." />
      {/* Year selector */}
      <div className="flex gap-1.5 flex-wrap">
        {years.map(y => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              y === selectedYear
                ? 'bg-zinc-800 border-zinc-700 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {/* One grid per metric */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 740px), 1fr))' }}>
        {METRICS.map((metric, mi) => (
          <MetricYearGrid
            key={`${selectedYear}-${metric.key}-${granularity}`}
            year={selectedYear}
            metric={metric}
            metricIdx={mi}
            metricsMap={metricsMap}
            getColor={getColor}
            onHover={setHoveredDay}
            granularity={granularity}
          />
        ))}
      </div>

      {/* Tooltip */}
      {hoveredDay && (
        <div
          className="fixed z-50 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs shadow-lg pointer-events-none"
          style={{ left: hoveredDay.x + 10, top: hoveredDay.y - 40 }}
        >
          <div className="text-zinc-300 font-medium mb-1">{hoveredDay.date}</div>
          {METRICS.map(m => {
            const v = hoveredDay.values[m.key]
            return (
              <div key={m.key} className="text-zinc-400">
                {m.label}: {v !== null && v > 0
                  ? `${m.key === 'sleepHours' ? (v).toFixed(1) : Math.round(v)} ${m.unit}`
                  : '--'}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MetricYearGrid({
  year, metric, metricIdx, metricsMap, getColor, onHover, granularity,
}: {
  year: number
  metric: typeof METRICS[number]
  metricIdx: number
  metricsMap: Map<string, DailyMetrics>
  getColor: (idx: number, v: number | null) => string
  onHover: (d: { date: string; values: Record<string, number | null>; x: number; y: number } | null) => void
  granularity: Granularity
}) {
  const { cells, monthLabels, totalWeeks, yearAvg, yearTotal, dayCount, rows } = useMemo(() => {
    if (granularity === 'monthly') {
      // Monthly: 12 cells in a row
      const cells: { date: string; value: number | null; week: number; day: number }[] = []
      for (let m = 0; m < 12; m++) {
        const monthStr = `${year}-${String(m + 1).padStart(2, '0')}`
        const daysInMonth: number[] = []
        for (const [date, dm] of metricsMap) {
          if (date.startsWith(monthStr)) {
            const v = dm[metric.key] as number | null
            if (v !== null && v > 0) daysInMonth.push(v)
          }
        }
        const avg = daysInMonth.length > 0 ? daysInMonth.reduce((a, b) => a + b, 0) / daysInMonth.length : null
        cells.push({ date: `${monthStr}-01`, value: avg, week: m, day: 0 })
      }
      const vals = cells.map(c => c.value).filter((v): v is number => v !== null && v > 0)
      return {
        cells,
        monthLabels: MONTHS.map((m, i) => ({ month: m, week: i })),
        totalWeeks: 12,
        yearAvg: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
        yearTotal: vals.reduce((a, b) => a + b, 0),
        dayCount: vals.length,
        rows: 1,
      }
    }

    if (granularity === 'weekly') {
      // Weekly: one cell per week
      const weekMap = new Map<number, number[]>()
      const jan1 = new Date(year, 0, 1)
      const dec31 = new Date(year, 11, 31)
      const d = new Date(jan1)
      let week = 0
      while (d <= dec31) {
        const dateStr = d.toISOString().substring(0, 10)
        const dayOfWeek = getWeekday(d)
        if (dayOfWeek === 0 && week > 0 || (d.getTime() > jan1.getTime() && dayOfWeek === 0)) week++
        const m = metricsMap.get(dateStr)
        const v = m ? (m[metric.key] as number | null) : null
        if (v !== null && v > 0) {
          const arr = weekMap.get(week) || []
          arr.push(v)
          weekMap.set(week, arr)
        }
        d.setDate(d.getDate() + 1)
      }
      const totalW = week + 1
      const cells: { date: string; value: number | null; week: number; day: number }[] = []
      for (let w = 0; w < totalW; w++) {
        const vals = weekMap.get(w)
        const avg = vals && vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
        // Compute approximate date for this week
        const weekDate = new Date(year, 0, 1 + w * 7)
        cells.push({ date: weekDate.toISOString().substring(0, 10), value: avg, week: w, day: 0 })
      }

      const monthLabels: { month: string; week: number }[] = []
      for (let m = 0; m < 12; m++) {
        const firstOfMonth = new Date(year, m, 1)
        const daysSinceJan1 = Math.floor((firstOfMonth.getTime() - jan1.getTime()) / 86400000)
        monthLabels.push({ month: MONTHS[m], week: Math.floor(daysSinceJan1 / 7) })
      }

      const allVals = cells.map(c => c.value).filter((v): v is number => v !== null && v > 0)
      return {
        cells,
        monthLabels,
        totalWeeks: totalW,
        yearAvg: allVals.length > 0 ? allVals.reduce((a, b) => a + b, 0) / allVals.length : null,
        yearTotal: allVals.reduce((a, b) => a + b, 0),
        dayCount: allVals.length,
        rows: 1,
      }
    }

    // Daily (default): full 7-row grid
    const cells: { date: string; value: number | null; week: number; day: number }[] = []
    const jan1 = new Date(year, 0, 1)
    const dec31 = new Date(year, 11, 31)

    let week = 0
    const d = new Date(jan1)
    while (d <= dec31) {
      const dateStr = d.toISOString().substring(0, 10)
      const dayOfWeek = getWeekday(d)
      if (dayOfWeek === 0 && cells.length > 0) week++
      const m = metricsMap.get(dateStr)
      const val = m ? (m[metric.key] as number | null) : null
      cells.push({ date: dateStr, value: val, week, day: dayOfWeek })
      d.setDate(d.getDate() + 1)
    }

    const monthLabels: { month: string; week: number }[] = []
    let lastMonth = -1
    for (const c of cells) {
      const month = parseInt(c.date.substring(5, 7)) - 1
      if (month !== lastMonth) {
        monthLabels.push({ month: MONTHS[month], week: c.week })
        lastMonth = month
      }
    }

    const vals = cells.map(c => c.value).filter((v): v is number => v !== null && v > 0)
    const yearAvg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    const yearTotal = vals.reduce((a, b) => a + b, 0)
    const totalWeeks = cells.length > 0 ? cells[cells.length - 1].week + 1 : 53

    return { cells, monthLabels, totalWeeks, yearAvg, yearTotal, dayCount: vals.length, rows: 7 }
  }, [year, metricsMap, metric.key, granularity])

  const cellSize = granularity === 'daily' ? 11 : granularity === 'weekly' ? 14 : 28
  const gap = 2
  const labelWidth = granularity === 'daily' ? 28 : 0

  function handleHover(c: typeof cells[number], e: React.MouseEvent) {
    const m = metricsMap.get(c.date)
    const values: Record<string, number | null> = {}
    for (const mt of METRICS) values[mt.key] = m ? (m[mt.key] as number | null) : null
    onHover({ date: c.date, values, x: e.clientX, y: e.clientY })
  }

  function fmtSummary(): string {
    if (yearAvg === null) return `${dayCount} days`
    const avg = metric.key === 'sleepHours' ? yearAvg.toFixed(1) : Math.round(yearAvg).toLocaleString()
    let extra = ''
    if (metric.key === 'steps') extra = ` · ${yearTotal >= 1e6 ? `${(yearTotal / 1e6).toFixed(1)}M` : `${Math.round(yearTotal / 1000)}k`} total`
    else if (metric.key === 'distance') extra = ` · ${yearTotal.toFixed(0)} km`
    else if (metric.key === 'exerciseMinutes') extra = ` · ${Math.round(yearTotal / 60)} hrs`
    return `Avg: ${avg} ${metric.unit}${extra} · ${dayCount} days`
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: metric.colorScale[3] }} />
          <h3 className="text-sm font-medium text-zinc-200">{metric.label}</h3>
        </div>
        <div className="text-[10px] text-zinc-500">{fmtSummary()}</div>
      </div>
      <div className="overflow-x-auto">
        <svg
          width={labelWidth + totalWeeks * (cellSize + gap) + 10}
          height={20 + rows * (cellSize + gap)}
        >
          {monthLabels.map((l, i) => (
            <text key={i} x={labelWidth + l.week * (cellSize + gap)} y={10} fill="#71717a" fontSize={9}>{l.month}</text>
          ))}
          {granularity === 'daily' && DAYS.map((d, i) => (
            d && <text key={i} x={0} y={20 + i * (cellSize + gap) + cellSize - 2} fill="#52525b" fontSize={8}>{d}</text>
          ))}
          {cells.map(c => (
            <rect
              key={c.date}
              x={labelWidth + c.week * (cellSize + gap)}
              y={18 + c.day * (cellSize + gap)}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={getColor(metricIdx, c.value)}
              stroke="#18181b"
              strokeWidth={0.5}
              onMouseEnter={e => handleHover(c, e.nativeEvent as unknown as React.MouseEvent)}
              onMouseLeave={() => onHover(null)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-600">
        <span>Less</span>
        <div className="flex gap-0.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#09090b', border: '1px solid #27272a' }} />
          {metric.colorScale.map((c, i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  )
}
