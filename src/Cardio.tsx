import { useMemo } from 'react'
import {
  ResponsiveContainer, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ScatterChart, Scatter, ZAxis,
  AreaChart, Area,
} from 'recharts'
import type { CardioRecord, DailyHR, DailyMetrics } from './types'
import type { Granularity } from './analysis'
import { StatBox, tooltipStyle, chartMargin, COLORS, shortDate, Legend } from './ui'

// VO2 Max fitness age estimation
// Based on published normative data for males (ACSM guidelines)
// Maps VO2 Max to approximate "fitness age" — the typical age at which that VO2 Max is average
const VO2_AGE_TABLE_MALE = [
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
  const table = VO2_AGE_TABLE_MALE
  // If above the youngest age group's fair value, interpolate down toward a lower age
  if (vo2max >= table[0].fair) {
    // Extrapolate: for every 2 mL/kg/min above fair@20, subtract 1 year
    const extra = (vo2max - table[0].fair) / 2
    return Math.max(15, Math.round(table[0].age - extra))
  }
  // Find the bracket
  for (let i = 0; i < table.length - 1; i++) {
    if (vo2max <= table[i].fair && vo2max >= table[i + 1].fair) {
      const ratio = (vo2max - table[i + 1].fair) / (table[i].fair - table[i + 1].fair)
      return Math.round(table[i + 1].age - ratio * (table[i + 1].age - table[i].age))
    }
  }
  return table[table.length - 1].age
}

function vo2maxCategory(vo2max: number, age: number): string {
  const row = VO2_AGE_TABLE_MALE.reduce((prev, curr) =>
    Math.abs(curr.age - age) < Math.abs(prev.age - age) ? curr : prev
  )
  if (vo2max >= row.excellent) return 'Excellent'
  if (vo2max >= row.good) return 'Good'
  if (vo2max >= row.fair) return 'Fair'
  return 'Below Average'
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
    filtered
      .filter(r => r.type === 'vo2max')
      .map(r => ({ date: r.date, value: Math.round(r.value * 10) / 10 })),
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

  // HR Recovery data
  const hrRecoveryData = useMemo(() =>
    filtered
      .filter(r => r.type === 'hrRecovery')
      .map(r => ({ date: r.date, value: Math.round(r.value * 10) / 10 }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [filtered]
  )

  // Weekly walking HR
  const weeklyWalkingHR = useMemo(() => {
    if (walkingHRData.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = walkingHRData[0].date
    let vals: number[] = []
    for (const d of walkingHRData) {
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
  }, [walkingHRData])

  // Weekly resting HR
  const weeklyRestingHR = useMemo(() => {
    const data = filteredMetrics.filter(m => m.restingHeartRate && m.restingHeartRate > 0)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const m of data) {
      const diff = (new Date(m.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) })
        weekStart = m.date
        vals = []
      }
      vals.push(m.restingHeartRate!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) })
    return result
  }, [filteredMetrics])

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

  // Weekly HRV
  const weeklyHRV = useMemo(() => {
    const data = filteredMetrics.filter(m => m.hrv && m.hrv > 0)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const m of data) {
      const diff = (new Date(m.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) })
        weekStart = m.date
        vals = []
      }
      vals.push(m.hrv!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) })
    return result
  }, [filteredMetrics])

  // VO2 Max with fitness age overlay
  const vo2WithAge = useMemo(() =>
    vo2Data.map(d => ({
      ...d,
      fitnessAge: estimateFitnessAge(d.value),
    })),
    [vo2Data]
  )

  // Summary stats
  const latestVO2 = vo2Data.length > 0 ? vo2Data[vo2Data.length - 1].value : null
  const fitnessAge = latestVO2 ? estimateFitnessAge(latestVO2) : null
  const vo2Category = latestVO2 ? vo2maxCategory(latestVO2, age) : null

  const recentWalkingHR = walkingHRData.slice(-30)
  const avgWalkingHR = recentWalkingHR.length > 0
    ? Math.round(recentWalkingHR.reduce((s, d) => s + d.value, 0) / recentWalkingHR.length)
    : null

  const recentRestingHR = filteredMetrics.slice(-30).filter(m => m.restingHeartRate && m.restingHeartRate > 0)
  const avgRestingHR = recentRestingHR.length > 0
    ? Math.round(recentRestingHR.reduce((s, m) => s + m.restingHeartRate!, 0) / recentRestingHR.length)
    : null

  const latestRecovery = hrRecoveryData.length > 0 ? hrRecoveryData[hrRecoveryData.length - 1].value : null
  const avgRecovery = hrRecoveryData.length > 0
    ? Math.round(hrRecoveryData.reduce((s, d) => s + d.value, 0) / hrRecoveryData.length * 10) / 10
    : null

  const hasData = vo2Data.length > 0 || walkingHRData.length > 0 || hrRecoveryData.length > 0 || weeklyHRRange.length > 0

  if (!hasData) {
    return <div className="text-zinc-500 text-center py-20">No cardiovascular data found.</div>
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {latestVO2 !== null && (
          <StatBox label="VO2 Max" value={`${latestVO2}`} unit="mL/kg/min" color={COLORS.green} sub={vo2Category ?? undefined} />
        )}
        {fitnessAge !== null && (
          <StatBox
            label="Fitness Age"
            value={`${fitnessAge}`}
            unit="yrs"
            color={COLORS.purple}
            sub={`Actual age: ${age} (${fitnessAge < age ? `${age - fitnessAge}yr younger` : fitnessAge > age ? `${fitnessAge - age}yr older` : 'match'})`}
          />
        )}
        {avgRestingHR !== null && (
          <StatBox label="Resting HR" value={`${avgRestingHR}`} unit="bpm" color={COLORS.red} sub="Avg last 30d" />
        )}
        {avgWalkingHR !== null && (
          <StatBox label="Walking HR" value={`${avgWalkingHR}`} unit="bpm" color={COLORS.orange} sub="Avg last 30d" />
        )}
        {latestRecovery !== null && (
          <StatBox
            label="HR Recovery"
            value={`${latestRecovery}`}
            unit="bpm"
            color={COLORS.blue}
            sub={recoveryRating(latestRecovery)}
          />
        )}
        {avgRecovery !== null && hrRecoveryData.length > 1 && (
          <StatBox label="Avg Recovery" value={`${avgRecovery}`} unit="bpm" sub={`${hrRecoveryData.length} measurements`} />
        )}
      </div>

      {/* VO2 Max + Fitness Age */}
      {vo2WithAge.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-1">VO2 Max & Fitness Age</h3>
          <p className="text-xs text-zinc-500 mb-3">Higher VO2 Max = lower fitness age. Based on ACSM normative data for males.</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={vo2WithAge}>
                <defs>
                  <linearGradient id="vo2Grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                <YAxis yAxisId="vo2" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                <YAxis yAxisId="age" orientation="right" reversed domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, name) => {
                    if (name === 'value') return [`${value} mL/kg/min`, 'VO2 Max']
                    return [`${value} yrs`, 'Fitness Age']
                  }}
                />
                <ReferenceLine yAxisId="age" y={age} stroke="#71717a" strokeDasharray="3 3" label={{ value: `Actual age (${age})`, position: 'right', fill: '#71717a', fontSize: 10 }} />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Resting HR */}
        {weeklyRestingHR.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-1">Resting Heart Rate (weekly avg)</h3>
            <p className="text-xs text-zinc-500 mb-3">Lower resting HR indicates better cardiovascular fitness</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyRestingHR}>
                  <defs>
                    <linearGradient id="restingHRGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} bpm`, 'Resting HR']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.red} fill="url(#restingHRGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Walking HR */}
        {weeklyWalkingHR.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-1">Walking Heart Rate (weekly avg)</h3>
            <p className="text-xs text-zinc-500 mb-3">Average heart rate during walks</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyWalkingHR}>
                  <defs>
                    <linearGradient id="walkingHRGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} bpm`, 'Walking HR']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.orange} fill="url(#walkingHRGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* HR Recovery scatter */}
        {hrRecoveryData.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-1">Heart Rate Recovery (1 min)</h3>
            <p className="text-xs text-zinc-500 mb-3">BPM drop in first minute after exercise. Higher = better cardiovascular fitness.</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <ScatterChart margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis dataKey="value" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <ZAxis range={[30, 60]} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} bpm`, 'Recovery']} />
                  <ReferenceLine y={20} stroke="#71717a" strokeDasharray="3 3" />
                  <Scatter data={hrRecoveryData} fill={COLORS.blue} opacity={0.7} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-zinc-600 text-center mt-1">Below 12 bpm may indicate poor fitness. Above 20 bpm is good.</p>
          </div>
        )}
      </div>

      {/* HR Range Band */}
      {weeklyHRRange.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-1">Heart Rate Range (weekly)</h3>
          <p className="text-xs text-zinc-500 mb-3">Min, average, and max HR each week — wider band = more cardiac flexibility</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={weeklyHRRange}>
                <defs>
                  <linearGradient id="hrBandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v, name) => [`${v} bpm`, name === 'max' ? 'Max HR' : name === 'min' ? 'Min HR' : 'Avg HR']}
                />
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

      {/* HRV */}
      {weeklyHRV.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-1">Heart Rate Variability (weekly avg)</h3>
          <p className="text-xs text-zinc-500 mb-3">Higher HRV indicates better autonomic nervous system health and recovery capacity</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={weeklyHRV}>
                <defs>
                  <linearGradient id="hrvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip {...tooltipStyle} formatter={(v) => [`${v} ms`, 'HRV (SDNN)']} />
                <Area type="monotone" dataKey="value" stroke="#a855f7" fill="url(#hrvGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

function recoveryRating(bpm: number): string {
  if (bpm >= 40) return 'Excellent'
  if (bpm >= 30) return 'Very Good'
  if (bpm >= 20) return 'Good'
  if (bpm >= 12) return 'Fair'
  return 'Below Average'
}

