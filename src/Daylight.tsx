import { useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, BarChart, Bar, ReferenceLine,
} from 'recharts'
import type { Granularity } from './analysis'
import { StatBox, AISummaryButton, TabHeader, ChartTooltip, useChartTheme, COLORS, shortDate, avg } from './ui'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  dailyDaylight: { date: string; minutes: number }[]
  cutoffDate: string
  granularity: Granularity
}

export default function Daylight({ dailyDaylight, cutoffDate, granularity: _granularity }: Props) {
  const ct = useChartTheme()
  const filtered = useMemo(() => {
    if (!cutoffDate) return dailyDaylight
    return dailyDaylight.filter(d => d.date >= cutoffDate)
  }, [dailyDaylight, cutoffDate])

  // Weekly trend
  const weeklyData = useMemo(() => {
    if (filtered.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = filtered[0].date
    let vals: number[] = []
    for (const d of filtered) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals)) })
        weekStart = d.date
        vals = []
      }
      vals.push(d.minutes)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals)) })
    return result
  }, [filtered])

  // Monthly seasonal pattern — avg minutes per calendar month across all years
  const monthlyPattern = useMemo(() => {
    const byMonth: number[][] = Array.from({ length: 12 }, () => [])
    for (const d of dailyDaylight) { // Use all data, not filtered, for seasonal pattern
      const month = parseInt(d.date.substring(5, 7)) - 1
      byMonth[month].push(d.minutes)
    }
    return byMonth.map((vals, i) => ({
      month: MONTHS[i],
      avg: vals.length > 0 ? Math.round(avg(vals)) : 0,
      days: vals.length,
    })).filter(m => m.days > 0)
  }, [dailyDaylight])

  // Monthly by year for year-over-year comparison
  const monthlyByYear = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const d of filtered) {
      const key = d.date.substring(0, 7) // YYYY-MM
      const arr = map.get(key) || []
      arr.push(d.minutes)
      map.set(key, arr)
    }
    return Array.from(map.entries())
      .map(([month, vals]) => ({ month, avg: Math.round(avg(vals)) }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [filtered])

  // Summary
  const recent = filtered.slice(-30)
  const avgRecent = recent.length > 0 ? avg(recent.map(d => d.minutes)) : 0
  const daysBelow20 = recent.filter(d => d.minutes < 20).length
  const daysAbove60 = recent.filter(d => d.minutes >= 60).length
  const maxDay = recent.length > 0 ? Math.max(...recent.map(d => d.minutes)) : 0
  const totalDays = filtered.length

  if (filtered.length === 0) {
    return <div className="text-zinc-500 text-center py-20">No daylight data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Daylight" description="Time spent in daylight — important for circadian rhythm, mood, and vitamin D." />
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox
          label="Daily Average"
          value={`${Math.round(avgRecent)}`}
          unit="min"
          color={avgRecent >= 30 ? '#22c55e' : avgRecent >= 15 ? '#f97316' : '#ef4444'}
          sub="Last 30 days"
        />
        <StatBox
          label="Days < 20 min"
          value={`${daysBelow20}`}
          sub={`of last ${recent.length} days`}
          color={daysBelow20 > 15 ? '#ef4444' : '#f97316'}
        />
        <StatBox
          label="Days > 1 hr"
          value={`${daysAbove60}`}
          sub={`of last ${recent.length} days`}
          color="#22c55e"
        />
        <StatBox label="Best Day" value={`${maxDay}`} unit="min" sub="Last 30 days" />
        <StatBox label="Total Days" value={`${totalDays}`} sub="With daylight data" />
        <StatBox
          label="Goal"
          value="30+"
          unit="min"
          sub="Recommended daily"
          color="#71717a"
        />
      </div>

      {/* Weekly trend */}
      {weeklyData.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Daily Daylight Exposure (weekly avg)</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Minutes of outdoor light detected by Apple Watch. 30+ min/day supports circadian rhythm, vitamin D, and mood.</p>
            </div>
            <AISummaryButton title="Daily Daylight Exposure (weekly avg)" description="Minutes of outdoor light detected by Apple Watch. 30+ min/day supports circadian rhythm, vitamin D, and mood." chartData={weeklyData} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }} data={weeklyData}>
                <defs>
                  <linearGradient id="daylightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.yellow} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.yellow} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <ReferenceLine y={30} stroke="#71717a" strokeDasharray="3 3" label={{ value: '30 min goal', position: 'right', fill: ct.tick, fontSize: 10 }} />
                <Tooltip content={<ChartTooltip formatter={(v) => [`${v} min`, 'Daylight']} />} />
                <Area type="monotone" dataKey="value" stroke={COLORS.yellow} fill="url(#daylightGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Seasonal pattern */}
        {monthlyPattern.length > 6 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Seasonal Pattern</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Average daily daylight by month (all years combined)</p>
              </div>
              <AISummaryButton title="Seasonal Pattern" description="Average daily daylight by month (all years combined)" chartData={monthlyPattern} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <BarChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }} data={monthlyPattern}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: ct.tick }} />
                  <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceLine y={30} stroke="#71717a" strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} min/day`, 'Avg Daylight']} />} />
                  <Bar dataKey="avg" fill={COLORS.yellow} radius={[4, 4, 0, 0]} opacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Monthly over time */}
        {monthlyByYear.length > 2 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Monthly Average Over Time</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Avg daily minutes per month — shows year-over-year trends</p>
              </div>
              <AISummaryButton title="Monthly Average Over Time" description="Avg daily minutes per month — shows year-over-year trends" chartData={monthlyByYear} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <BarChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }} data={monthlyByYear}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: ct.tick }}
                    tickFormatter={d => {
                      const parts = d.split('-')
                      return `${MONTHS[parseInt(parts[1]) - 1]} '${parts[0].substring(2)}`
                    }}
                  />
                  <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceLine y={30} stroke="#71717a" strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} min/day`, 'Avg Daylight']} />} />
                  <Bar dataKey="avg" fill={COLORS.yellow} radius={[4, 4, 0, 0]} opacity={0.7} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
