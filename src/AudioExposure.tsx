import { useMemo } from 'react'
import {
  ResponsiveContainer, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, AreaChart, Area, BarChart, Bar, ReferenceLine,
} from 'recharts'
import type { DailyAudio } from './types'
import type { Granularity } from './analysis'
import { StatBox, AISummaryButton, TabHeader, useChartTheme, chartMargin, COLORS, shortDate, shortMonth, avg } from './ui'

// WHO/NIOSH safe exposure thresholds
const SAFE_HEADPHONE_DB = 80 // 80 dB for prolonged exposure
const LOUD_ENV_DB = 85

interface Props {
  dailyAudio: DailyAudio[]
  cutoffDate: string
  granularity: Granularity
}

export default function AudioExposure({ dailyAudio, cutoffDate, granularity: _granularity }: Props) {
  const ct = useChartTheme()
  const filtered = useMemo(() => {
    if (!cutoffDate) return dailyAudio
    return dailyAudio.filter(d => d.date >= cutoffDate)
  }, [dailyAudio, cutoffDate])

  // Weekly headphone levels
  const weeklyHeadphone = useMemo(() => {
    const data = filtered.filter(d => d.headphoneAvg !== null)
    if (data.length === 0) return []
    const result: { week: string; avg: number; max: number }[] = []
    let weekStart = data[0].date
    let avgs: number[] = [], maxs: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (avgs.length > 0) result.push({ week: weekStart, avg: Math.round(avg(avgs)), max: Math.round(Math.max(...maxs)) })
        weekStart = d.date
        avgs = []; maxs = []
      }
      avgs.push(d.headphoneAvg!)
      if (d.headphoneMax) maxs.push(d.headphoneMax)
    }
    if (avgs.length > 0) result.push({ week: weekStart, avg: Math.round(avg(avgs)), max: Math.round(Math.max(...maxs)) })
    return result
  }, [filtered])

  // Weekly environmental levels
  const weeklyEnv = useMemo(() => {
    const data = filtered.filter(d => d.envAvg !== null)
    if (data.length === 0) return []
    const result: { week: string; avg: number; max: number }[] = []
    let weekStart = data[0].date
    let avgs: number[] = [], maxs: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (avgs.length > 0) result.push({ week: weekStart, avg: Math.round(avg(avgs)), max: Math.round(Math.max(...maxs)) })
        weekStart = d.date
        avgs = []; maxs = []
      }
      avgs.push(d.envAvg!)
      if (d.envMax) maxs.push(d.envMax)
    }
    if (avgs.length > 0) result.push({ week: weekStart, avg: Math.round(avg(avgs)), max: Math.round(Math.max(...maxs)) })
    return result
  }, [filtered])

  // Days above safe threshold
  const daysAboveHeadphone = filtered.filter(d => d.headphoneAvg !== null && d.headphoneAvg > SAFE_HEADPHONE_DB).length
  const daysAboveEnv = filtered.filter(d => d.envAvg !== null && d.envAvg > LOUD_ENV_DB).length
  const totalEvents = filtered.reduce((s, d) => s + d.eventsAboveLimit, 0)

  // Monthly exposure time
  const monthlyExposure = useMemo(() => {
    const map = new Map<string, { hp: number; env: number }>()
    for (const d of filtered) {
      const month = d.date.substring(0, 7)
      const existing = map.get(month) || { hp: 0, env: 0 }
      existing.hp += d.headphoneMinutes
      existing.env += d.envMinutes
      map.set(month, existing)
    }
    return Array.from(map.entries())
      .map(([month, data]) => ({
        month,
        headphone: Math.round(data.hp / 60),
        env: Math.round(data.env / 60),
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [filtered])

  // Summary stats
  const recent = filtered.slice(-30)
  const avgHeadphone = recent.filter(d => d.headphoneAvg !== null).map(d => d.headphoneAvg!)
  const avgEnv = recent.filter(d => d.envAvg !== null).map(d => d.envAvg!)
  const totalHpHours = Math.round(filtered.reduce((s, d) => s + d.headphoneMinutes, 0) / 60)

  if (filtered.length === 0) {
    return <div className="text-zinc-500 text-center py-20">No audio exposure data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Audio Exposure" description="Headphone audio levels and environmental noise exposure to help protect your hearing." />
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {avgHeadphone.length > 0 && (
          <StatBox
            label="Headphone Avg"
            value={`${Math.round(avg(avgHeadphone))}`}
            unit="dB"
            color={avg(avgHeadphone) > SAFE_HEADPHONE_DB ? COLORS.red : COLORS.green}
            sub="Last 30 days"
          />
        )}
        {avgEnv.length > 0 && (
          <StatBox
            label="Environment Avg"
            value={`${Math.round(avg(avgEnv))}`}
            unit="dB"
            color={avg(avgEnv) > LOUD_ENV_DB ? COLORS.red : COLORS.green}
            sub="Last 30 days"
          />
        )}
        <StatBox
          label="Days > 80 dB"
          value={`${daysAboveHeadphone}`}
          sub="Headphone exposure"
          color={daysAboveHeadphone > 0 ? COLORS.red : COLORS.green}
        />
        <StatBox
          label="Days > 85 dB"
          value={`${daysAboveEnv}`}
          sub="Environmental"
          color={daysAboveEnv > 0 ? COLORS.red : COLORS.green}
        />
        <StatBox label="Loud Events" value={`${totalEvents}`} sub="Momentary limit alerts" />
        <StatBox label="Headphone Time" value={`${totalHpHours}`} unit="hrs" sub="Total listening" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Headphone levels */}
        {weeklyHeadphone.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Headphone Audio Levels (weekly)</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Average and peak levels. WHO safe limit: 80 dB for prolonged exposure.</p>
              </div>
              <AISummaryButton title="Headphone Audio Levels (weekly)" description="Average and peak levels. WHO safe limit: 80 dB for prolonged exposure." chartData={weeklyHeadphone} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyHeadphone}>
                  <defs>
                    <linearGradient id="hpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceLine y={SAFE_HEADPHONE_DB} stroke={COLORS.red} strokeDasharray="3 3" label={{ value: '80 dB limit', position: 'right', fill: ct.tick, fontSize: 10 }} />
                  <Tooltip {...ct.tooltip} formatter={(v, name) => [`${v} dB`, name === 'avg' ? 'Average' : 'Peak']} />
                  <Area type="monotone" dataKey="max" stroke={COLORS.purple} fill="url(#hpGrad)" strokeWidth={1} strokeOpacity={0.4} dot={false} />
                  <Line type="monotone" dataKey="avg" stroke={COLORS.purple} strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Environmental levels */}
        {weeklyEnv.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Environmental Noise (weekly)</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Average and peak ambient noise from Apple Watch. Safe limit: 85 dB.</p>
              </div>
              <AISummaryButton title="Environmental Noise (weekly)" description="Average and peak ambient noise from Apple Watch. Safe limit: 85 dB." chartData={weeklyEnv} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyEnv}>
                  <defs>
                    <linearGradient id="envGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceLine y={LOUD_ENV_DB} stroke={COLORS.red} strokeDasharray="3 3" label={{ value: '85 dB limit', position: 'right', fill: ct.tick, fontSize: 10 }} />
                  <Tooltip {...ct.tooltip} formatter={(v, name) => [`${v} dB`, name === 'avg' ? 'Average' : 'Peak']} />
                  <Area type="monotone" dataKey="max" stroke={COLORS.orange} fill="url(#envGrad)" strokeWidth={1} strokeOpacity={0.4} dot={false} />
                  <Line type="monotone" dataKey="avg" stroke={COLORS.orange} strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Monthly listening time */}
      {monthlyExposure.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Monthly Exposure Time (hours)</h3>
            </div>
            <AISummaryButton title="Monthly Exposure Time (hours)" chartData={monthlyExposure} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <BarChart margin={chartMargin} data={monthlyExposure}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortMonth} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip {...ct.tooltip} formatter={(v, name) => [`${v}h`, name === 'headphone' ? 'Headphone' : 'Environmental']} />
                <Bar dataKey="headphone" fill={COLORS.purple} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
