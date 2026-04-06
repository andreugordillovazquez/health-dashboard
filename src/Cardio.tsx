import { useMemo } from 'react'
import {
  ResponsiveContainer, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ReferenceArea, Scatter,
  AreaChart, Area, ComposedChart,
} from 'recharts'
import type { CardioRecord, DailyHR, DailyMetrics } from './types'
import type { Granularity } from './analysis'
import { StatBox, chartMargin, COLORS, shortDate, Legend, AISummaryButton, TabHeader, useChartTheme, ChartTooltip } from './ui'

// VO2 Max fitness age estimation (ACSM normative data for males)
const VO2_AGE_TABLE = [
  { age: 20, poor: 38, fair: 42, good: 46, excellent: 53 },
  { age: 25, poor: 37, fair: 41, good: 45, excellent: 52 },
  { age: 30, poor: 35, fair: 39, good: 44, excellent: 50 },
  { age: 35, poor: 33, fair: 37, good: 42, excellent: 48 },
  { age: 40, poor: 31, fair: 35, good: 40, excellent: 46 },
  { age: 45, poor: 29, fair: 33, good: 38, excellent: 44 },
  { age: 50, poor: 27, fair: 31, good: 36, excellent: 42 },
  { age: 55, poor: 25, fair: 29, good: 34, excellent: 40 },
  { age: 60, poor: 23, fair: 27, good: 32, excellent: 38 },
  { age: 65, poor: 21, fair: 25, good: 30, excellent: 36 },
]

function estimateFitnessAge(vo2max: number): number {
  const table = VO2_AGE_TABLE
  if (vo2max >= table[0].fair) {
    const extra = (vo2max - table[0].fair) / 2
    return Math.max(15, Math.round(table[0].age - extra))
  }
  for (let i = 0; i < table.length - 1; i++) {
    if (vo2max <= table[i].fair && vo2max >= table[i + 1].fair) {
      const ratio = (vo2max - table[i + 1].fair) / (table[i].fair - table[i + 1].fair)
      return Math.round(table[i + 1].age - ratio * (table[i + 1].age - table[i].age))
    }
  }
  return table[table.length - 1].age
}

function vo2maxCategory(vo2max: number, age: number): string {
  const row = VO2_AGE_TABLE.reduce((prev, curr) =>
    Math.abs(curr.age - age) < Math.abs(prev.age - age) ? curr : prev
  )
  if (vo2max >= row.excellent) return 'Excellent'
  if (vo2max >= row.good) return 'Good'
  if (vo2max >= row.fair) return 'Fair'
  return 'Below Average'
}

function recoveryRating(bpm: number): string {
  if (bpm >= 40) return 'Excellent'
  if (bpm >= 30) return 'Very Good'
  if (bpm >= 20) return 'Good'
  if (bpm >= 12) return 'Fair'
  return 'Below Average'
}

// Score sub-components for the fitness gauge (0-100 each)
function scoreRestingHR(hr: number): number {
  if (hr <= 50) return 100
  if (hr <= 60) return 85
  if (hr <= 70) return 65
  if (hr <= 80) return 45
  return 25
}

function scoreHRV(hrv: number): number {
  if (hrv >= 60) return 100
  if (hrv >= 40) return 80
  if (hrv >= 25) return 55
  if (hrv >= 15) return 35
  return 15
}

function scoreVO2(vo2: number, age: number): number {
  const cat = vo2maxCategory(vo2, age)
  if (cat === 'Excellent') return 100
  if (cat === 'Good') return 75
  if (cat === 'Fair') return 50
  return 25
}

function scoreRecovery(bpm: number): number {
  if (bpm >= 40) return 100
  if (bpm >= 30) return 80
  if (bpm >= 20) return 60
  if (bpm >= 12) return 35
  return 15
}

// Moving average for trend line
function movingAvg(data: { date: string; value: number }[], window: number): { date: string; value: number; trend: number }[] {
  return data.map((d, i) => {
    const start = Math.max(0, i - window + 1)
    const slice = data.slice(start, i + 1)
    const avg = Math.round(slice.reduce((s, p) => s + p.value, 0) / slice.length * 10) / 10
    return { ...d, trend: avg }
  })
}

interface Props {
  cardioRecords: CardioRecord[]
  dailyHR: DailyHR[]
  metrics: DailyMetrics[]
  dob: string
  cutoffDate: string
  granularity: Granularity
}

export default function Cardio({ cardioRecords, dailyHR, metrics, dob, cutoffDate, granularity: _granularity }: Props) {
  const ct = useChartTheme()
  const filtered = useMemo(() => {
    if (!cutoffDate) return cardioRecords
    return cardioRecords.filter(r => r.date >= cutoffDate)
  }, [cardioRecords, cutoffDate])

  const filteredMetrics = useMemo(() => {
    if (!cutoffDate) return metrics
    return metrics.filter(m => m.date >= cutoffDate)
  }, [metrics, cutoffDate])

  const age = useMemo(() => {
    if (!dob) return 25
    const now = new Date()
    const birth = new Date(dob)
    return now.getFullYear() - birth.getFullYear()
  }, [dob])

  // VO2 Max data
  const vo2Data = useMemo(() =>
    filtered.filter(r => r.type === 'vo2max').map(r => ({ date: r.date, value: Math.round(r.value * 10) / 10 })),
    [filtered]
  )

  // Walking HR data (daily averages)
  const walkingHRData = useMemo(() => {
    const byDate = new Map<string, number[]>()
    for (const r of filtered) {
      if (r.type !== 'walkingHR') continue
      const arr = byDate.get(r.date) || []
      arr.push(r.value)
      byDate.set(r.date, arr)
    }
    return Array.from(byDate.entries())
      .map(([date, vals]) => ({ date, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [filtered])

  // HR Recovery data with moving average
  const hrRecoveryData = useMemo(() => {
    const raw = filtered.filter(r => r.type === 'hrRecovery')
      .map(r => ({ date: r.date, value: Math.round(r.value * 10) / 10 }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return movingAvg(raw, 5)
  }, [filtered])

  // Weekly aggregation helper
  const weeklyAgg = (data: { date: string; value: number }[]) => {
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) })
        weekStart = d.date
        vals = []
      }
      vals.push(d.value)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) })
    return result
  }

  const weeklyWalkingHR = useMemo(() => weeklyAgg(walkingHRData), [walkingHRData])

  const weeklyRestingHR = useMemo(() => {
    const data = filteredMetrics.filter(m => m.restingHeartRate && m.restingHeartRate > 0)
      .map(m => ({ date: m.date, value: m.restingHeartRate! }))
    return weeklyAgg(data)
  }, [filteredMetrics])

  const weeklyHRV = useMemo(() => {
    const data = filteredMetrics.filter(m => m.hrv && m.hrv > 0)
      .map(m => ({ date: m.date, value: m.hrv! }))
    return weeklyAgg(data)
  }, [filteredMetrics])

  // Combined Resting HR + HRV overlay
  const hrHrvOverlay = useMemo(() => {
    const hrMap = new Map(weeklyRestingHR.map(d => [d.week, d.value]))
    const hrvMap = new Map(weeklyHRV.map(d => [d.week, d.value]))
    const allWeeks = [...new Set([...hrMap.keys(), ...hrvMap.keys()])].sort()
    return allWeeks.map(w => ({
      week: w,
      restingHR: hrMap.get(w) ?? null,
      hrv: hrvMap.get(w) ?? null,
    }))
  }, [weeklyRestingHR, weeklyHRV])

  // Weekly HR range (min/avg/max band)
  const weeklyHRRange = useMemo(() => {
    const filteredHR = cutoffDate ? dailyHR.filter(d => d.date >= cutoffDate) : dailyHR
    if (filteredHR.length === 0) return []
    const result: { week: string; min: number; avg: number; max: number }[] = []
    let weekStart = filteredHR[0].date
    let mins: number[] = [], avgs: number[] = [], maxs: number[] = []
    for (const d of filteredHR) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (mins.length > 0) {
          result.push({
            week: weekStart,
            min: Math.round(Math.min(...mins)),
            avg: Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length),
            max: Math.round(Math.max(...maxs)),
          })
        }
        weekStart = d.date
        mins = []; avgs = []; maxs = []
      }
      mins.push(d.min); avgs.push(d.avg); maxs.push(d.max)
    }
    if (mins.length > 0) {
      result.push({
        week: weekStart,
        min: Math.round(Math.min(...mins)),
        avg: Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length),
        max: Math.round(Math.max(...maxs)),
      })
    }
    return result
  }, [dailyHR, cutoffDate])

  // VO2 Max with fitness age overlay
  const vo2WithAge = useMemo(() =>
    vo2Data.map(d => ({ ...d, fitnessAge: estimateFitnessAge(d.value) })),
    [vo2Data]
  )

  // Cardiac efficiency ratio (Walking HR / Resting HR)
  const efficiencyData = useMemo(() => {
    if (weeklyWalkingHR.length === 0 || weeklyRestingHR.length === 0) return []
    const walkMap = new Map(weeklyWalkingHR.map(d => [d.week, d.value]))
    const restMap = new Map(weeklyRestingHR.map(d => [d.week, d.value]))
    const allWeeks = [...new Set([...walkMap.keys(), ...restMap.keys()])].sort()
    const result: { week: string; ratio: number }[] = []
    for (const w of allWeeks) {
      const walk = walkMap.get(w)
      const rest = restMap.get(w)
      if (walk && rest && rest > 0) {
        result.push({ week: w, ratio: Math.round((walk / rest) * 100) / 100 })
      }
    }
    return result
  }, [weeklyWalkingHR, weeklyRestingHR])

  // === Summary stats ===
  const latestVO2 = vo2Data.length > 0 ? vo2Data[vo2Data.length - 1].value : null
  const fitnessAge = latestVO2 ? estimateFitnessAge(latestVO2) : null
  const vo2Category = latestVO2 ? vo2maxCategory(latestVO2, age) : null

  const recent30 = filteredMetrics.slice(-30)
  const prev30 = filteredMetrics.slice(-60, -30)

  const avgVal = (arr: DailyMetrics[], key: 'restingHeartRate' | 'hrv') => {
    const vals = arr.map(m => m[key]).filter((v): v is number => v !== null && v > 0)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  const avgRestingHR = avgVal(recent30, 'restingHeartRate')
  const prevRestingHR = avgVal(prev30, 'restingHeartRate')
  const avgHRV = avgVal(recent30, 'hrv')
  const prevHRV = avgVal(prev30, 'hrv')

  const recentWalkingHR = walkingHRData.slice(-30)
  const prevWalkingHR = walkingHRData.slice(-60, -30)
  const avgWalkHR = recentWalkingHR.length > 0 ? Math.round(recentWalkingHR.reduce((s, d) => s + d.value, 0) / recentWalkingHR.length) : null
  const prevAvgWalkHR = prevWalkingHR.length > 0 ? Math.round(prevWalkingHR.reduce((s, d) => s + d.value, 0) / prevWalkingHR.length) : null

  const latestRecovery = hrRecoveryData.length > 0 ? hrRecoveryData[hrRecoveryData.length - 1].value : null
  // Week-over-week delta helper
  const delta = (curr: number | null, prev: number | null) => {
    if (curr === null || prev === null) return undefined
    const d = curr - prev
    return d === 0 ? undefined : `${d > 0 ? '+' : ''}${d} vs prev 30d`
  }

  // === Cardio fitness score (0-100) ===
  const cardioScore = useMemo(() => {
    const components: { label: string; score: number; weight: number }[] = []
    if (avgRestingHR !== null) components.push({ label: 'Resting HR', score: scoreRestingHR(avgRestingHR), weight: 3 })
    if (avgHRV !== null) components.push({ label: 'HRV', score: scoreHRV(avgHRV), weight: 3 })
    if (latestVO2 !== null) components.push({ label: 'VO2 Max', score: scoreVO2(latestVO2, age), weight: 2.5 })
    if (latestRecovery !== null) components.push({ label: 'Recovery', score: scoreRecovery(latestRecovery), weight: 1.5 })
    if (components.length === 0) return null
    const totalWeight = components.reduce((s, c) => s + c.weight, 0)
    const weighted = components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight
    return { score: Math.round(weighted), components }
  }, [avgRestingHR, avgHRV, latestVO2, latestRecovery, age])

  const scoreColor = (s: number) => s >= 80 ? '#22c55e' : s >= 60 ? '#3b82f6' : s >= 40 ? '#f97316' : '#ef4444'
  const scoreLabel = (s: number) => s >= 80 ? 'Excellent' : s >= 60 ? 'Good' : s >= 40 ? 'Fair' : 'Needs Work'

  const hasData = vo2Data.length > 0 || walkingHRData.length > 0 || hrRecoveryData.length > 0 || weeklyHRRange.length > 0

  if (!hasData) {
    return <div className="text-zinc-500 text-center py-20">No cardiovascular data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Cardio" description="Heart rate, HRV, VO2 Max, and cardiovascular fitness trends from your Apple Watch." />

      {/* Cardio Fitness Gauge + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4">
        {/* Gauge */}
        {cardioScore && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 flex flex-col items-center justify-center min-w-[200px]">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke={ct.grid} strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke={scoreColor(cardioScore.score)}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${cardioScore.score * 3.267} 326.7`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold tabular-nums" style={{ color: scoreColor(cardioScore.score) }}>{cardioScore.score}</span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">/ 100</span>
              </div>
            </div>
            <div className="text-sm font-medium mt-2" style={{ color: scoreColor(cardioScore.score) }}>{scoreLabel(cardioScore.score)}</div>
            <div className="text-[10px] text-zinc-600 mt-1">Cardio Fitness</div>
            {/* Sub-scores */}
            <div className="mt-3 w-full space-y-1.5">
              {cardioScore.components.map(c => (
                <div key={c.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 w-16 text-right">{c.label}</span>
                  <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.score}%`, backgroundColor: scoreColor(c.score) }} />
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums w-6">{c.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stat boxes */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
          {latestVO2 !== null && (
            <StatBox label="VO2 Max" value={`${latestVO2}`} unit="mL/kg/min" color={COLORS.green} sub={vo2Category ?? undefined} />
          )}
          {fitnessAge !== null && (
            <StatBox
              label="Fitness Age"
              value={`${fitnessAge}`}
              unit="yrs"
              color={COLORS.purple}
              sub={`Actual: ${age} (${fitnessAge < age ? `${age - fitnessAge}yr younger` : fitnessAge > age ? `${fitnessAge - age}yr older` : 'match'})`}
            />
          )}
          {avgRestingHR !== null && (
            <StatBox label="Resting HR" value={`${avgRestingHR}`} unit="bpm" color={COLORS.red} sub={delta(avgRestingHR, prevRestingHR) || 'Avg last 30d'} />
          )}
          {avgWalkHR !== null && (
            <StatBox label="Walking HR" value={`${avgWalkHR}`} unit="bpm" color={COLORS.orange} sub={delta(avgWalkHR, prevAvgWalkHR) || 'Avg last 30d'} />
          )}
          {avgHRV !== null && (
            <StatBox label="HRV" value={`${avgHRV}`} unit="ms" color={COLORS.purple} sub={delta(avgHRV, prevHRV) || 'Avg last 30d'} />
          )}
          {latestRecovery !== null && (
            <StatBox label="HR Recovery" value={`${latestRecovery}`} unit="bpm" color={COLORS.blue} sub={recoveryRating(latestRecovery)} />
          )}
        </div>
      </div>

      {/* VO2 Max + Fitness Age */}
      {vo2WithAge.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">VO2 Max & Fitness Age</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Higher VO2 Max = lower fitness age. Based on ACSM normative data.</p>
            </div>
            <AISummaryButton title="VO2 Max & Fitness Age" description="Higher VO2 Max = lower fitness age" chartData={vo2WithAge} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={vo2WithAge}>
                <defs>
                  <linearGradient id="vo2Grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis yAxisId="vo2" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <YAxis yAxisId="age" orientation="right" reversed domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(value, name) => {
                    if (name === 'value') return [`${value} mL/kg/min`, 'VO2 Max']
                    return [`${value} yrs`, 'Fitness Age']
                  }} />} />
                <ReferenceLine yAxisId="age" y={age} stroke="#71717a" strokeDasharray="3 3" label={{ value: `Age ${age}`, position: 'right', fill: ct.tick, fontSize: 10 }} />
                <Area yAxisId="vo2" type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#vo2Grad)" strokeWidth={2} dot={{ r: 2 }} />
                <Line yAxisId="age" type="monotone" dataKey="fitnessAge" stroke={COLORS.purple} strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 1.5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2">
            <Legend color={COLORS.green} label="VO2 Max" />
            <Legend color={COLORS.purple} label="Fitness Age" dashed />
            <Legend color="#71717a" label={`Actual Age (${age})`} dashed />
          </div>
        </div>
      )}

      {/* Resting HR + HRV Overlay (dual axis) */}
      {hrHrvOverlay.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Resting HR & HRV</h3>
              <p className="text-xs text-zinc-500 mt-0.5">These typically move in opposite directions — lower resting HR with higher HRV signals good cardiovascular fitness.</p>
            </div>
            <AISummaryButton title="Resting HR & HRV" description="Dual axis: lower HR + higher HRV = better fitness" chartData={hrHrvOverlay} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ComposedChart margin={chartMargin} data={hrHrvOverlay}>
                <defs>
                  <linearGradient id="restHRGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="hrvGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis yAxisId="hr" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <YAxis yAxisId="hrv" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                {/* Reference band: normal resting HR */}
                <ReferenceArea yAxisId="hr" y1={50} y2={70} fill="#22c55e" fillOpacity={0.05} />
                <Tooltip content={<ChartTooltip formatter={(value, name) => {
                    if (name === 'restingHR') return [`${value} bpm`, 'Resting HR']
                    return [`${value} ms`, 'HRV']
                  }} />} />
                <Area yAxisId="hr" type="monotone" dataKey="restingHR" stroke={COLORS.red} fill="url(#restHRGrad2)" strokeWidth={1.5} dot={false} connectNulls />
                <Area yAxisId="hrv" type="monotone" dataKey="hrv" stroke={COLORS.purple} fill="url(#hrvGrad2)" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2">
            <Legend color={COLORS.red} label="Resting HR (bpm)" />
            <Legend color={COLORS.purple} label="HRV (ms)" />
            <div className="flex items-center gap-1.5 text-xs text-zinc-600">
              <div className="w-4 h-2 rounded-sm bg-green-500/10 border border-green-500/20" />
              Normal HR range
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Walking HR with reference range */}
        {weeklyWalkingHR.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Walking Heart Rate</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Weekly average. A declining trend indicates improving fitness.</p>
              </div>
              <AISummaryButton title="Walking Heart Rate" description="Weekly average walking HR" chartData={weeklyWalkingHR} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyWalkingHR}>
                  <defs>
                    <linearGradient id="walkingHRGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} bpm`, 'Walking HR']} />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.orange} fill="url(#walkingHRGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* HR Recovery scatter with trend line + reference zones */}
        {hrRecoveryData.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Heart Rate Recovery</h3>
                <p className="text-xs text-zinc-500 mt-0.5">BPM drop in first minute after exercise. The trend line shows your recovery direction.</p>
              </div>
              <AISummaryButton title="Heart Rate Recovery" description="BPM drop after exercise with trend" chartData={hrRecoveryData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <ComposedChart margin={chartMargin} data={hrRecoveryData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  {/* Reference zones */}
                  <ReferenceArea y1={20} y2={60} fill="#22c55e" fillOpacity={0.04} label={{ value: 'Good', position: 'insideTopLeft', fill: '#22c55e40', fontSize: 10 }} />
                  <ReferenceArea y1={0} y2={12} fill="#ef4444" fillOpacity={0.04} label={{ value: 'Low', position: 'insideBottomLeft', fill: '#ef444440', fontSize: 10 }} />
                  <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.3} />
                  <ReferenceLine y={12} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip formatter={(v, name) => [`${v} bpm`, name === 'trend' ? 'Trend' : 'Recovery']} />} />
                  <Scatter dataKey="value" fill={COLORS.blue} opacity={0.6} />
                  <Line type="monotone" dataKey="trend" stroke={COLORS.cyan} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* HR Range Band */}
      {weeklyHRRange.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Heart Rate Range</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Weekly min, average, and max. A wider band shows more cardiac flexibility.</p>
            </div>
            <AISummaryButton title="Heart Rate Range" description="Weekly min, avg, max HR band" chartData={weeklyHRRange} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={weeklyHRRange}>
                <defs>
                  <linearGradient id="hrBandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(v, name) => [`${v} bpm`, name === 'max' ? 'Max HR' : name === 'min' ? 'Min HR' : 'Avg HR']} />} />
                <Area type="monotone" dataKey="max" stroke="#ef4444" fill="url(#hrBandGrad)" strokeWidth={1} strokeOpacity={0.5} dot={false} />
                <Area type="monotone" dataKey="min" stroke="#3b82f6" fill="#101014" strokeWidth={1} strokeOpacity={0.5} dot={false} />
                <Line type="monotone" dataKey="avg" stroke="#f97316" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2">
            <Legend color="#ef4444" label="Max HR" />
            <Legend color="#f97316" label="Avg HR" />
            <Legend color="#3b82f6" label="Min HR" />
          </div>
        </div>
      )}

      {/* Cardiac Efficiency Ratio */}
      {efficiencyData.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Cardiac Efficiency</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Walking HR divided by resting HR. A lower ratio means your heart handles exertion more efficiently.</p>
            </div>
            <AISummaryButton title="Cardiac Efficiency" description="Walking HR / Resting HR ratio — lower is better" chartData={efficiencyData} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={efficiencyData}>
                <defs>
                  <linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(v) => [`${v}x`, 'Efficiency Ratio']} />} />
                <ReferenceArea y1={1.4} y2={1.7} fill="#22c55e" fillOpacity={0.05} />
                <Area type="monotone" dataKey="ratio" stroke={COLORS.cyan} fill="url(#effGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-3 justify-center mt-2">
            <div className="flex items-center gap-1.5 text-xs text-zinc-600">
              <div className="w-4 h-2 rounded-sm bg-green-500/10 border border-green-500/20" />
              Efficient range (1.4–1.7x)
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
