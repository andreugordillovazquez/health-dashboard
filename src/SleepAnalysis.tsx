import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, ScatterChart, Scatter, ZAxis, ReferenceLine, ComposedChart, Line,
} from 'recharts'
import type { SleepRecord, DailySleep, WristTempRecord, DailyBreathing } from './types'
import type { Granularity } from './analysis'
import { StatBox, chartMargin, COLORS, shortDate, avg, Legend, AISummaryButton, TabHeader, useChartTheme, ChartTooltip } from './ui'

const SLEEP_COLORS = { core: '#6366f1', deep: COLORS.purple, rem: COLORS.cyan, awake: COLORS.orange, temp: COLORS.red }

function buildDailySleep(records: SleepRecord[]): DailySleep[] {
  const byDate = new Map<string, SleepRecord[]>()
  for (const r of records) {
    const existing = byDate.get(r.date) || []
    existing.push(r)
    byDate.set(r.date, existing)
  }

  const result: DailySleep[] = []
  for (const [date, recs] of byDate) {
    let core = 0, deep = 0, rem = 0, awake = 0
    let earliest = '', latest = ''
    let earliestInBed = ''

    // Check if granular stages exist — if so, ignore 'unspecified' to avoid double-counting
    const hasStages = recs.some(r => r.stage === 'core' || r.stage === 'deep' || r.stage === 'rem')

    for (const r of recs) {
      if (r.stage === 'inbed') {
        if (!earliestInBed || r.startDate < earliestInBed) earliestInBed = r.startDate
        continue
      }
      if (r.stage === 'awake') awake += r.minutes
      else if (r.stage === 'unspecified') {
        if (!hasStages) core += r.minutes // Only count if no granular data
      }
      else if (r.stage === 'core') core += r.minutes
      else if (r.stage === 'deep') deep += r.minutes
      else if (r.stage === 'rem') rem += r.minutes

      if (!earliest || r.startDate < earliest) earliest = r.startDate
      if (!latest || r.endDate > latest) latest = r.endDate
    }

    const total = core + deep + rem
    if (total < 60) continue

    // Sleep latency: minutes from bed → first asleep stage. Only meaningful if InBed was logged before sleep onset.
    let latency: number | null = null
    if (earliestInBed && earliest && earliestInBed < earliest) {
      const mins = (new Date(earliest).getTime() - new Date(earliestInBed).getTime()) / 60000
      if (mins >= 0 && mins < 180) latency = Math.round(mins)
    }

    // WASO: sum of 'awake' stage minutes whose records fall within [firstSleep, lastSleep]
    let waso = 0
    if (earliest && latest) {
      for (const r of recs) {
        if (r.stage !== 'awake') continue
        if (r.startDate >= earliest && r.endDate <= latest) waso += r.minutes
      }
    }

    // Midsleep: time-of-day midpoint between sleep onset and final wake
    let midSleep: number | null = null
    if (earliest && latest) {
      const midMs = (new Date(earliest).getTime() + new Date(latest).getTime()) / 2
      const md = new Date(midMs)
      midSleep = md.getHours() * 60 + md.getMinutes()
    }

    result.push({
      date,
      core: Math.round(core), deep: Math.round(deep), rem: Math.round(rem), awake: Math.round(awake),
      total: Math.round(total),
      bedtime: earliest ? formatTimeOfDay(earliest) : '',
      wakeTime: latest ? formatTimeOfDay(latest) : '',
      latency,
      waso: Math.round(waso),
      midSleep,
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

function formatTimeOfDay(iso: string): string {
  const match = iso.match(/(\d{2}):(\d{2}):\d{2}/)
  if (match) return `${match[1]}:${match[2]}`
  try {
    const d = new Date(iso)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch { return '' }
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(m: number): string {
  const h = Math.floor(((m % 1440) + 1440) % 1440 / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const mean = avg(arr)
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length)
}

// Sleep consistency score: 0-100 based on bedtime regularity, wake regularity, and duration regularity
function computeConsistencyScore(daily: DailySleep[]): number | null {
  if (daily.length < 7) return null

  const bedtimes = daily.filter(d => d.bedtime).map(d => {
    let m = timeToMinutes(d.bedtime)
    if (m < 720) m += 1440
    return m
  })
  const wakes = daily.filter(d => d.wakeTime).map(d => timeToMinutes(d.wakeTime))
  const durations = daily.map(d => d.total)

  if (bedtimes.length < 5) return null

  // Score each component: lower std dev = higher score
  // Bedtime: <15min std = 100, >90min std = 0
  const bedStd = stdDev(bedtimes)
  const bedScore = Math.max(0, Math.min(100, 100 - (bedStd - 15) * (100 / 75)))

  const wakeStd = stdDev(wakes)
  const wakeScore = Math.max(0, Math.min(100, 100 - (wakeStd - 15) * (100 / 75)))

  const durStd = stdDev(durations)
  const durScore = Math.max(0, Math.min(100, 100 - (durStd - 15) * (100 / 75)))

  return Math.round((bedScore * 0.4 + wakeScore * 0.4 + durScore * 0.2))
}

function weeklyAverageSleep(daily: DailySleep[]): { week: string; core: number; deep: number; rem: number; awake: number }[] {
  if (daily.length === 0) return []
  const result: { week: string; core: number; deep: number; rem: number; awake: number }[] = []
  let weekStart = daily[0].date
  let coreAcc: number[] = [], deepAcc: number[] = [], remAcc: number[] = [], awakeAcc: number[] = []

  for (const d of daily) {
    const daysDiff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
    if (daysDiff >= 7) {
      if (coreAcc.length > 0) {
        result.push({
          week: weekStart,
          core: Math.round(avg(coreAcc) / 60 * 10) / 10,
          deep: Math.round(avg(deepAcc) / 60 * 10) / 10,
          rem: Math.round(avg(remAcc) / 60 * 10) / 10,
          awake: Math.round(avg(awakeAcc) / 60 * 10) / 10,
        })
      }
      weekStart = d.date
      coreAcc = []; deepAcc = []; remAcc = []; awakeAcc = []
    }
    coreAcc.push(d.core); deepAcc.push(d.deep); remAcc.push(d.rem); awakeAcc.push(d.awake)
  }
  if (coreAcc.length > 0) {
    result.push({
      week: weekStart,
      core: Math.round(avg(coreAcc) / 60 * 10) / 10,
      deep: Math.round(avg(deepAcc) / 60 * 10) / 10,
      rem: Math.round(avg(remAcc) / 60 * 10) / 10,
      awake: Math.round(avg(awakeAcc) / 60 * 10) / 10,
    })
  }
  return result
}

interface Props {
  sleepRecords: SleepRecord[]
  wristTempRecords: WristTempRecord[]
  dailyBreathing: DailyBreathing[]
  cutoffDate: string
  granularity: Granularity
}

export default function SleepAnalysis({ sleepRecords, wristTempRecords, dailyBreathing, cutoffDate, granularity: _granularity }: Props) {
  const ct = useChartTheme()
  const filtered = useMemo(() => {
    if (!cutoffDate) return sleepRecords
    return sleepRecords.filter(r => r.date >= cutoffDate)
  }, [sleepRecords, cutoffDate])

  const dailySleep = useMemo(() => buildDailySleep(filtered), [filtered])
  const weeklyData = useMemo(() => weeklyAverageSleep(dailySleep), [dailySleep])

  // Summary stats (last 30 nights)
  const recent = dailySleep.slice(-30)
  const avgTotal = recent.length ? avg(recent.map(d => d.total)) / 60 : 0
  const avgDeep = recent.length ? avg(recent.map(d => d.deep)) / 60 : 0
  const avgRem = recent.length ? avg(recent.map(d => d.rem)) / 60 : 0
  const avgCore = recent.length ? avg(recent.map(d => d.core)) / 60 : 0

  // Bedtime/wake stats
  const bedtimes = recent.filter(d => d.bedtime).map(d => {
    let mins = timeToMinutes(d.bedtime)
    if (mins < 720) mins += 1440
    return mins
  })
  const avgBedtime = bedtimes.length ? avg(bedtimes) : 0
  const bedtimeStd = stdDev(bedtimes)

  const wakeTimes = recent.filter(d => d.wakeTime).map(d => timeToMinutes(d.wakeTime))
  const avgWake = wakeTimes.length ? avg(wakeTimes) : 0
  const wakeStd = stdDev(wakeTimes)

  // Sleep consistency score
  const consistencyScore = useMemo(() => computeConsistencyScore(recent), [recent])

  // Sleep efficiency (sleep / (sleep + awake))
  const avgEfficiency = recent.length > 0
    ? Math.round(avg(recent.map(d => d.total / (d.total + d.awake) * 100)))
    : null

  // Weekly bedtime/wake trend lines
  const weeklySchedule = useMemo(() => {
    if (dailySleep.length === 0) return []
    const result: { week: string; bedtime: number | null; wake: number | null }[] = []
    let weekStart = dailySleep[0].date
    let bedAcc: number[] = [], wakeAcc: number[] = []

    for (const d of dailySleep) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        result.push({
          week: weekStart,
          bedtime: bedAcc.length ? Math.round(avg(bedAcc)) : null,
          wake: wakeAcc.length ? Math.round(avg(wakeAcc)) : null,
        })
        weekStart = d.date
        bedAcc = []; wakeAcc = []
      }
      if (d.bedtime) {
        let m = timeToMinutes(d.bedtime)
        if (m < 720) m += 1440
        bedAcc.push(m)
      }
      if (d.wakeTime) wakeAcc.push(timeToMinutes(d.wakeTime))
    }
    if (bedAcc.length > 0 || wakeAcc.length > 0) {
      result.push({
        week: weekStart,
        bedtime: bedAcc.length ? Math.round(avg(bedAcc)) : null,
        wake: wakeAcc.length ? Math.round(avg(wakeAcc)) : null,
      })
    }
    return result
  }, [dailySleep])

  // Wrist temperature
  const tempData = useMemo(() => {
    let data = wristTempRecords
    if (cutoffDate) data = data.filter(r => r.date >= cutoffDate)
    if (data.length === 0) return []
    return [...data].sort((a, b) => a.date.localeCompare(b.date))
  }, [wristTempRecords, cutoffDate])

  const avgTemp = tempData.length > 0 ? avg(tempData.map(t => t.value)) : null
  const tempStd = tempData.length > 1 ? stdDev(tempData.map(t => t.value)) : null

  // Wrist temp deviation from personal baseline (more useful than absolute)
  const tempDeviationData = useMemo(() => {
    if (tempData.length < 7) return []
    const baseline = avg(tempData.map(t => t.value))
    return tempData.map(t => ({
      date: t.date,
      deviation: Math.round((t.value - baseline) * 100) / 100,
      absolute: t.value,
    }))
  }, [tempData])

  // Breathing data
  const filteredBreathing = useMemo(() => {
    if (!cutoffDate) return dailyBreathing
    return dailyBreathing.filter(d => d.date >= cutoffDate)
  }, [dailyBreathing, cutoffDate])

  const weeklyDisturbances = useMemo(() => {
    const data = filteredBreathing.filter(d => d.disturbances !== null)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
        weekStart = d.date
        vals = []
      }
      vals.push(d.disturbances!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
    return result
  }, [filteredBreathing])

  const weeklyRespRate = useMemo(() => {
    const data = filteredBreathing.filter(d => d.respiratoryRate !== null)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
        weekStart = d.date
        vals = []
      }
      vals.push(d.respiratoryRate!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
    return result
  }, [filteredBreathing])

  const weeklySpo2 = useMemo(() => {
    const data = filteredBreathing.filter(d => d.spo2 !== null)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
        weekStart = d.date
        vals = []
      }
      vals.push(d.spo2!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
    return result
  }, [filteredBreathing])

  const recentBreathing = filteredBreathing.slice(-30)
  const recentDist = recentBreathing.filter(d => d.disturbances !== null).map(d => d.disturbances!)
  const avgDist = recentDist.length > 0 ? avg(recentDist) : null

  // Sleep debt: cumulative deficit against 8h target (rolling 14-day window)
  const TARGET_HOURS = 8
  const sleepDebtData = useMemo(() => {
    if (dailySleep.length === 0) return []
    const sorted = [...dailySleep].sort((a, b) => a.date.localeCompare(b.date))
    let cumDebt = 0
    return sorted.map(d => {
      const hoursSlept = d.total / 60
      const diff = hoursSlept - TARGET_HOURS
      cumDebt += diff
      return {
        date: d.date,
        debt: Math.round(cumDebt * 10) / 10,
        nightly: Math.round(diff * 10) / 10,
      }
    })
  }, [dailySleep])

  const filteredDebt = useMemo(() => {
    if (!cutoffDate) return sleepDebtData
    return sleepDebtData.filter(d => d.date >= cutoffDate)
  }, [sleepDebtData, cutoffDate])

  const currentDebt = filteredDebt.length > 0 ? filteredDebt[filteredDebt.length - 1].debt : null
  // Recent 7-day debt
  const recent7Debt = useMemo(() => {
    const last7 = dailySleep.slice(-7)
    if (last7.length === 0) return null
    return Math.round(last7.reduce((s, d) => s + (d.total / 60 - TARGET_HOURS), 0) * 10) / 10
  }, [dailySleep])

  // --- Deep-dive: consistency trend (rolling 14-day score) ---
  const consistencyTrend = useMemo(() => {
    const filteredDaily = cutoffDate ? dailySleep.filter(d => d.date >= cutoffDate) : dailySleep
    if (filteredDaily.length < 14) return []
    const out: { date: string; score: number }[] = []
    for (let i = 13; i < filteredDaily.length; i++) {
      const window = filteredDaily.slice(i - 13, i + 1)
      const score = computeConsistencyScore(window)
      if (score !== null) out.push({ date: filteredDaily[i].date, score })
    }
    return out
  }, [dailySleep, cutoffDate])

  // --- Deep-dive: latency ---
  const latencyData = useMemo(() => {
    const filteredDaily = cutoffDate ? dailySleep.filter(d => d.date >= cutoffDate) : dailySleep
    return filteredDaily.filter(d => d.latency !== null).map(d => ({ date: d.date, value: d.latency! }))
  }, [dailySleep, cutoffDate])

  const recentLatency = latencyData.slice(-30)
  const avgLatency = recentLatency.length > 0 ? Math.round(avg(recentLatency.map(d => d.value))) : null

  // --- Deep-dive: WASO ---
  const wasoData = useMemo(() => {
    const filteredDaily = cutoffDate ? dailySleep.filter(d => d.date >= cutoffDate) : dailySleep
    return filteredDaily.filter(d => d.waso > 0).map(d => ({ date: d.date, value: d.waso }))
  }, [dailySleep, cutoffDate])

  const recentWaso = wasoData.slice(-30)
  const avgWaso = recentWaso.length > 0 ? Math.round(avg(recentWaso.map(d => d.value))) : null

  // --- Deep-dive: chronotype drift (monthly midsleep mean) ---
  const chronotypeData = useMemo(() => {
    const filteredDaily = cutoffDate ? dailySleep.filter(d => d.date >= cutoffDate) : dailySleep
    const byMonth = new Map<string, number[]>()
    for (const d of filteredDaily) {
      if (d.midSleep === null) continue
      const month = d.date.substring(0, 7)
      const arr = byMonth.get(month) || []
      arr.push(d.midSleep)
      byMonth.set(month, arr)
    }
    return Array.from(byMonth.entries())
      .map(([month, vals]) => ({
        month: month + '-01',
        midSleep: Math.round(avg(vals)),
        spread: Math.round(stdDev(vals)),
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
  }, [dailySleep, cutoffDate])

  const recentMidSleep = dailySleep.slice(-30).filter(d => d.midSleep !== null).map(d => d.midSleep!)
  const avgMidSleep = recentMidSleep.length > 0 ? Math.round(avg(recentMidSleep)) : null

  // --- Deep-dive: respiratory rate anomalies (rolling 30-day baseline + 1 SD) ---
  const respAnomalyData = useMemo(() => {
    const data = filteredBreathing.filter(d => d.respiratoryRate !== null)
      .map(d => ({ date: d.date, value: d.respiratoryRate! }))
    if (data.length < 14) return { series: [] as Array<{ date: string; value: number; baseline: number | null; upper: number | null; lower: number | null; anomaly: number | null }>, anomalyCount: 0 }
    let anomalyCount = 0
    const series = data.map((d, i) => {
      const start = Math.max(0, i - 29)
      const window = data.slice(start, i).map(p => p.value) // baseline from PRIOR days only
      if (window.length < 7) {
        return { date: d.date, value: d.value, baseline: null, upper: null, lower: null, anomaly: null }
      }
      const mean = avg(window)
      const sd = stdDev(window)
      const upper = mean + sd
      const lower = mean - sd
      const isAnomaly = d.value > upper || d.value < lower
      if (isAnomaly) anomalyCount++
      return {
        date: d.date,
        value: Math.round(d.value * 10) / 10,
        baseline: Math.round(mean * 10) / 10,
        upper: Math.round(upper * 10) / 10,
        lower: Math.round(lower * 10) / 10,
        anomaly: isAnomaly ? Math.round(d.value * 10) / 10 : null,
      }
    })
    return { series, anomalyCount }
  }, [filteredBreathing])

  if (dailySleep.length === 0 && filteredBreathing.length === 0) {
    return <div className="text-zinc-500 text-center py-20">No sleep stage data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Sleep" description="Sleep duration, stages, schedule patterns, and breathing metrics during sleep." />
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatBox label="Avg Sleep" value={`${avgTotal.toFixed(1)}h`} sub="Last 30 nights" />
        <StatBox label="Deep" value={`${avgDeep.toFixed(1)}h`} sub={`${avgTotal > 0 ? Math.round(avgDeep / avgTotal * 100) : 0}%`} color={SLEEP_COLORS.deep} />
        <StatBox label="REM" value={`${avgRem.toFixed(1)}h`} sub={`${avgTotal > 0 ? Math.round(avgRem / avgTotal * 100) : 0}%`} color={SLEEP_COLORS.rem} />
        <StatBox label="Core" value={`${avgCore.toFixed(1)}h`} sub={`${avgTotal > 0 ? Math.round(avgCore / avgTotal * 100) : 0}%`} color={SLEEP_COLORS.core} />
        <StatBox
          label="Bedtime"
          value={minutesToTime(avgBedtime > 1440 ? avgBedtime - 1440 : avgBedtime)}
          sub={`±${Math.round(bedtimeStd)} min`}
        />
        <StatBox label="Wake" value={minutesToTime(avgWake)} sub={`±${Math.round(wakeStd)} min`} />
        {consistencyScore !== null && (
          <StatBox
            label="Consistency"
            value={`${consistencyScore}`}
            sub={consistencyScore >= 80 ? 'Excellent' : consistencyScore >= 60 ? 'Good' : consistencyScore >= 40 ? 'Fair' : 'Poor'}
            color={consistencyScore >= 80 ? '#22c55e' : consistencyScore >= 60 ? '#f97316' : '#ef4444'}
          />
        )}
        {avgEfficiency !== null && (
          <StatBox
            label="Efficiency"
            value={`${avgEfficiency}%`}
            sub="Sleep / time in bed"
            color={avgEfficiency >= 85 ? '#22c55e' : avgEfficiency >= 75 ? '#f97316' : '#ef4444'}
          />
        )}
        {recent7Debt !== null && (
          <StatBox
            label="7-Day Debt"
            value={`${recent7Debt > 0 ? '+' : ''}${recent7Debt}h`}
            sub={recent7Debt >= 0 ? 'Surplus' : 'Deficit'}
            color={recent7Debt >= 0 ? '#22c55e' : recent7Debt >= -3 ? '#f97316' : '#ef4444'}
          />
        )}
        {avgLatency !== null && (
          <StatBox
            label="Latency"
            value={`${avgLatency}m`}
            sub="Time to fall asleep"
            color={avgLatency <= 20 ? '#22c55e' : avgLatency <= 35 ? '#f97316' : '#ef4444'}
          />
        )}
        {avgWaso !== null && (
          <StatBox
            label="WASO"
            value={`${avgWaso}m`}
            sub="Awake mid-sleep"
            color={avgWaso <= 20 ? '#22c55e' : avgWaso <= 40 ? '#f97316' : '#ef4444'}
          />
        )}
        {avgMidSleep !== null && (
          <StatBox
            label="Midsleep"
            value={minutesToTime(avgMidSleep)}
            sub="Chronotype marker"
          />
        )}
      </div>

      {/* Sleep Debt Tracker */}
      {filteredDebt.length > 7 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Sleep Debt</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Cumulative surplus or deficit against an {TARGET_HOURS}h nightly target. Below zero means you owe your body sleep.</p>
            </div>
            <AISummaryButton title="Sleep Debt" description={`Cumulative sleep surplus/deficit vs ${TARGET_HOURS}h target`} chartData={filteredDebt} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ComposedChart margin={chartMargin} data={filteredDebt}>
                <defs>
                  <linearGradient id="debtPosGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="debtNegGrad" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
                <Tooltip content={<ChartTooltip formatter={(v, name) => [
                  name === 'debt' ? `${v}h` : `${(v as number) > 0 ? '+' : ''}${v}h`,
                  name === 'debt' ? 'Cumulative Debt' : 'Nightly Δ'
                ]} />} />
                <Area type="monotone" dataKey="debt" stroke={currentDebt !== null && currentDebt >= 0 ? '#22c55e' : '#ef4444'} fill={currentDebt !== null && currentDebt >= 0 ? 'url(#debtPosGrad)' : 'url(#debtNegGrad)'} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="nightly" stroke={COLORS.cyan} strokeWidth={1} dot={false} strokeOpacity={0.4} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {currentDebt !== null && (
            <p className="text-xs text-zinc-500 text-center mt-2">
              {currentDebt >= 0
                ? `You're ${currentDebt}h ahead of your ${TARGET_HOURS}h target.`
                : `You owe your body ${Math.abs(currentDebt)}h of sleep.`
              }
            </p>
          )}
        </div>
      )}

      {/* Sleep stages stacked bar (weekly) */}
      {weeklyData.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Sleep Stages (weekly avg, hours)</h3>
            </div>
            <AISummaryButton title="Sleep Stages" description="Weekly average sleep stages in hours" chartData={weeklyData} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <BarChart margin={chartMargin} data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(value, name) => [`${value}h`, name === 'core' ? 'Core' : name === 'deep' ? 'Deep' : name === 'rem' ? 'REM' : 'Awake']} />} />
                <Bar dataKey="deep" stackId="sleep" fill={SLEEP_COLORS.deep} radius={[0, 0, 0, 0]} />
                <Bar dataKey="rem" stackId="sleep" fill={SLEEP_COLORS.rem} />
                <Bar dataKey="core" stackId="sleep" fill={SLEEP_COLORS.core} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2">
            {Object.entries(SLEEP_COLORS).filter(([k]) => k !== 'temp').map(([key, color]) => (
              <div key={key} className="flex items-center gap-1.5 text-xs text-zinc-400">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bedtime & wake schedule trend */}
        {weeklySchedule.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Bedtime & Wake Schedule (weekly avg)</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Consistent schedule = better sleep quality</p>
              </div>
              <AISummaryButton title="Bedtime & Wake Schedule" description="Consistent schedule = better sleep quality" chartData={weeklySchedule} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklySchedule}>
                  <defs>
                    <linearGradient id="bedtimeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SLEEP_COLORS.deep} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SLEEP_COLORS.deep} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="wakeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 10, fill: ct.tick }}
                    tickFormatter={v => minutesToTime(v > 1440 ? v - 1440 : v)}
                  />
                  <Tooltip content={<ChartTooltip formatter={(v, name) => [minutesToTime((v as number) > 1440 ? (v as number) - 1440 : (v as number)), name === 'bedtime' ? 'Bedtime' : 'Wake time']} />} />
                  <Area type="monotone" dataKey="bedtime" stroke={SLEEP_COLORS.deep} fill="url(#bedtimeGrad)" strokeWidth={1.5} dot={false} connectNulls />
                  <Area type="monotone" dataKey="wake" stroke="#f97316" fill="url(#wakeGrad)" strokeWidth={1.5} dot={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 justify-center mt-2">
              <Legend color={SLEEP_COLORS.deep} label="Bedtime" />
              <Legend color="#f97316" label="Wake time" />
            </div>
          </div>
        )}

        {/* Total sleep duration trend */}
        {weeklyData.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Total Sleep Trend (weekly avg)</h3>
              </div>
              <AISummaryButton title="Total Sleep Trend" description="Weekly average total sleep duration" chartData={weeklyData.map(w => ({ week: w.week, total: Math.round((w.core + w.deep + w.rem) * 10) / 10 }))} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyData.map(w => ({ week: w.week, total: Math.round((w.core + w.deep + w.rem) * 10) / 10 }))}>
                  <defs>
                    <linearGradient id="sleepTotalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v}h`, 'Total Sleep']} />} />
                  <Area type="monotone" dataKey="total" stroke="#6366f1" fill="url(#sleepTotalGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Bedtime consistency scatter */}
        {dailySleep.length > 7 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Bedtime Scatter</h3>
              </div>
              <AISummaryButton title="Bedtime Scatter" description="Daily bedtime consistency scatter plot" chartData={dailySleep.filter(d => d.bedtime).map(d => { let bedMins = timeToMinutes(d.bedtime); if (bedMins < 720) bedMins += 1440; return { date: d.date, bedtime: bedMins, total: d.total / 60 } })} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <ScatterChart margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: ct.tick }}
                    tickFormatter={shortDate}
                  />
                  <YAxis
                    dataKey="bedtime"
                    tick={{ fontSize: 10, fill: ct.tick }}
                    domain={['auto', 'auto']}
                    tickFormatter={v => minutesToTime(v > 1440 ? v - 1440 : v)}
                    reversed
                  />
                  <ZAxis dataKey="total" range={[20, 80]} />
                  <Tooltip content={<ChartTooltip formatter={(value, name) => {
                      if (typeof value !== 'number') return [`${value}`, String(name)]
                      if (name === 'bedtime') return [minutesToTime(value > 1440 ? value - 1440 : value), 'Bedtime']
                      if (name === 'total') return [`${value.toFixed(1)}h`, 'Total']
                      return [`${value}`, String(name)]
                    }} />} />
                  <Scatter
                    data={dailySleep.filter(d => d.bedtime).map(d => {
                      let bedMins = timeToMinutes(d.bedtime)
                      if (bedMins < 720) bedMins += 1440
                      return { date: d.date, bedtime: bedMins, total: d.total / 60 }
                    })}
                    fill="#8b5cf6"
                    opacity={0.5}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Wrist temperature deviation */}
        {tempDeviationData.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Wrist Temperature During Sleep</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Deviation from baseline ({avgTemp?.toFixed(1)}°C ±{tempStd?.toFixed(2)}°C). Spikes may indicate illness or cycle changes.
                </p>
              </div>
              <AISummaryButton title="Wrist Temperature During Sleep" description="Deviation from baseline wrist temperature. Spikes may indicate illness or cycle changes." chartData={tempDeviationData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={tempDeviationData}>
                  <defs>
                    <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SLEEP_COLORS.temp} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SLEEP_COLORS.temp} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={v => `${v > 0 ? '+' : ''}${v}°`} />
                  <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip formatter={(v, name) => {
                      if (name === 'deviation') return [`${(v as number) > 0 ? '+' : ''}${v}°C`, 'Deviation']
                      return [`${v}°C`, 'Temperature']
                    }} />} />
                  <Area type="monotone" dataKey="deviation" stroke={SLEEP_COLORS.temp} fill="url(#tempGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Deep-dive section */}
      {(consistencyTrend.length > 0 || latencyData.length > 0 || wasoData.length > 0 || chronotypeData.length > 1) && (
        <h2 className="text-sm font-medium text-zinc-400 mt-2">Deep Dive</h2>
      )}

      {/* Sleep Consistency trend */}
      {consistencyTrend.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Sleep Consistency (rolling 14-day)</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Higher = steadier bed/wake times and duration. Low variance is a stronger health predictor than any single night.</p>
            </div>
            <AISummaryButton title="Sleep Consistency" description="Rolling 14-day consistency score. Higher = steadier sleep schedule." chartData={consistencyTrend} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={consistencyTrend}>
                <defs>
                  <linearGradient id="consistencyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: ct.tick }} />
                <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'Excellent', position: 'right', fill: ct.tick, fontSize: 10 }} />
                <ReferenceLine y={60} stroke="#f97316" strokeDasharray="3 3" label={{ value: 'Good', position: 'right', fill: ct.tick, fontSize: 10 }} />
                <Tooltip content={<ChartTooltip formatter={(v) => [`${v}`, 'Score']} />} />
                <Area type="monotone" dataKey="score" stroke="#22c55e" fill="url(#consistencyGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sleep Latency */}
        {latencyData.length > 3 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Sleep Latency</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Minutes from bed to first sleep stage. Healthy range: 10–20 min. &gt;30 min suggests stress, screens, or late caffeine.</p>
              </div>
              <AISummaryButton title="Sleep Latency" description="Minutes from bed to first sleep stage" chartData={latencyData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={latencyData}>
                  <defs>
                    <linearGradient id="latencyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={[0, 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} min`, 'Latency']} />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.cyan} fill="url(#latencyGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* WASO */}
        {wasoData.length > 3 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Wake After Sleep Onset (WASO)</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Minutes awake between falling asleep and final wake. Healthy: &lt;20 min. Rising trend can indicate fragmentation.</p>
              </div>
              <AISummaryButton title="WASO" description="Minutes awake between first sleep and final wake" chartData={wasoData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={wasoData}>
                  <defs>
                    <linearGradient id="wasoGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SLEEP_COLORS.awake} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={SLEEP_COLORS.awake} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={[0, 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} min`, 'WASO']} />} />
                  <Area type="monotone" dataKey="value" stroke={SLEEP_COLORS.awake} fill="url(#wasoGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Chronotype drift */}
      {chronotypeData.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Chronotype Drift (monthly midsleep)</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Midpoint between sleep onset and final wake. A shifting midsleep signals social jet lag or lifestyle changes.</p>
            </div>
            <AISummaryButton title="Chronotype Drift" description="Monthly average midsleep time (midpoint between sleep onset and final wake)" chartData={chronotypeData} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={chronotypeData}>
                <defs>
                  <linearGradient id="chronoGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis
                  tick={{ fontSize: 10, fill: ct.tick }}
                  tickFormatter={(v) => minutesToTime(v)}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<ChartTooltip formatter={(v, name) => {
                  if (name === 'midSleep') return [minutesToTime(v as number), 'Midsleep']
                  return [`±${v} min`, 'Spread (σ)']
                }} />} />
                <Area type="monotone" dataKey="midSleep" stroke={COLORS.purple} fill="url(#chronoGrad)" strokeWidth={1.5} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Respiratory Rate Anomalies */}
      {respAnomalyData.series.length > 14 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Respiratory Rate Anomalies</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Nights more than 1 SD from your 30-day baseline. Elevated resp rate often precedes illness by 1–2 days.
                {respAnomalyData.anomalyCount > 0 && <> Flagged: <span className="text-orange-400">{respAnomalyData.anomalyCount} night{respAnomalyData.anomalyCount === 1 ? '' : 's'}</span>.</>}
              </p>
            </div>
            <AISummaryButton title="Respiratory Rate Anomalies" description="Nights outside 1 SD of rolling 30-day baseline" chartData={respAnomalyData.series} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ComposedChart margin={chartMargin} data={respAnomalyData.series}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(v, name) => {
                  if (name === 'value') return [`${v} br/min`, 'Resp Rate']
                  if (name === 'baseline') return [`${v} br/min`, 'Baseline']
                  if (name === 'upper') return [`${v} br/min`, '+1 SD']
                  if (name === 'lower') return [`${v} br/min`, '−1 SD']
                  if (name === 'anomaly') return [`${v} br/min`, 'Anomaly']
                  return [`${v}`, String(name)]
                }} />} />
                <Area type="monotone" dataKey="upper" stroke="none" fill={COLORS.cyan} fillOpacity={0.08} />
                <Area type="monotone" dataKey="lower" stroke="none" fill="#0a0a0a" fillOpacity={1} />
                <Line type="monotone" dataKey="baseline" stroke={COLORS.cyan} strokeWidth={1} strokeDasharray="4 4" dot={false} strokeOpacity={0.6} />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                <Scatter dataKey="anomaly" fill="#ef4444" shape="circle" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2 flex-wrap">
            <Legend color="#3b82f6" label="Resp rate" />
            <Legend color={COLORS.cyan} label="30-day baseline" dashed />
            <Legend color="#ef4444" label="Anomaly (>1 SD)" />
          </div>
        </div>
      )}

      {/* Breathing & Respiratory section */}
      {(weeklyDisturbances.length > 1 || weeklyRespRate.length > 1 || weeklySpo2.length > 1) && (
        <>
          <h2 className="text-sm font-medium text-zinc-400 mt-2">Breathing & Respiratory</h2>

          {/* Disturbances */}
          {weeklyDisturbances.length > 1 && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="text-sm font-medium text-zinc-300">Breathing Disturbances (weekly avg)</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Events/hr during sleep. Under 5 is normal.
                    {avgDist !== null && <> Current avg: <span className={avgDist < 5 ? 'text-green-400' : avgDist < 15 ? 'text-orange-400' : 'text-red-400'}>{avgDist.toFixed(1)}/hr</span></>}
                  </p>
                </div>
                <AISummaryButton title="Breathing Disturbances" description="Events per hour during sleep. Under 5 is normal." chartData={weeklyDisturbances} />
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                  <AreaChart margin={chartMargin} data={weeklyDisturbances}>
                    <defs>
                      <linearGradient id="distGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                    <YAxis domain={[0, 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                    <ReferenceLine y={5} stroke="#f97316" strokeDasharray="3 3" label={{ value: 'Mild', position: 'right', fill: ct.tick, fontSize: 10 }} />
                    <ReferenceLine y={15} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Moderate', position: 'right', fill: ct.tick, fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip formatter={(v) => [`${v}/hr`, 'Disturbances']} />} />
                    <Area type="monotone" dataKey="value" stroke="#ef4444" fill="url(#distGrad2)" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Respiratory rate */}
            {weeklyRespRate.length > 1 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <h3 className="text-sm font-medium text-zinc-300">Respiratory Rate (weekly avg)</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Normal: 12-20 breaths/min at rest</p>
                  </div>
                  <AISummaryButton title="Respiratory Rate" description="Normal: 12-20 breaths/min at rest" chartData={weeklyRespRate} />
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                    <AreaChart margin={chartMargin} data={weeklyRespRate}>
                      <defs>
                        <linearGradient id="sleepRespRateGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                      <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                      <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                      <ReferenceLine y={12} stroke="#71717a" strokeDasharray="3 3" />
                      <ReferenceLine y={20} stroke="#71717a" strokeDasharray="3 3" />
                      <Tooltip content={<ChartTooltip formatter={(v) => [`${v} br/min`, 'Respiratory Rate']} />} />
                      <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="url(#sleepRespRateGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* SpO2 */}
            {weeklySpo2.length > 1 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <h3 className="text-sm font-medium text-zinc-300">Blood Oxygen (weekly avg)</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Normal: 95-100%</p>
                  </div>
                  <AISummaryButton title="Blood Oxygen" description="Normal: 95-100%" chartData={weeklySpo2} />
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                    <AreaChart margin={chartMargin} data={weeklySpo2}>
                      <defs>
                        <linearGradient id="spo2Grad2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                      <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                      <YAxis domain={['auto', 100]} tick={{ fontSize: 10, fill: ct.tick }} />
                      <ReferenceLine y={95} stroke="#71717a" strokeDasharray="3 3" />
                      <Tooltip content={<ChartTooltip formatter={(v) => [`${v}%`, 'SpO2']} />} />
                      <Area type="monotone" dataKey="value" stroke="#22c55e" fill="url(#spo2Grad2)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

