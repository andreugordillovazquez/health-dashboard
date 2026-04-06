import { useMemo } from 'react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  ComposedChart, Area, Line, ReferenceArea, ReferenceLine,
} from 'recharts'
import type { Workout } from './types'
import { chartMargin, COLORS, shortDate, StatBox, Legend, AISummaryButton, TabHeader, fmt, useChartTheme, ChartTooltip } from './ui'

// Simplified TRIMP (Training Impulse) calculation
// Uses duration * HR intensity factor. When HR is missing, fall back to calories-based estimate.
function computeTrimp(workout: Workout): number {
  const durationMin = workout.duration
  if (durationMin <= 0) return 0

  if (workout.hrAvg && workout.hrAvg > 0) {
    // Banister's TRIMP simplified: duration * intensity factor
    // intensity = (HRavg - HRrest) / (HRmax - HRrest)
    // We estimate HRrest=60, HRmax=190 as defaults
    const hrRest = 60
    const hrMax = 190
    const intensity = Math.max(0, Math.min(1, (workout.hrAvg - hrRest) / (hrMax - hrRest)))
    return Math.round(durationMin * intensity * (0.64 * Math.exp(1.92 * intensity)))
  }

  // Fallback: use calories as proxy (roughly 1 TRIMP per 5 kcal for moderate exercise)
  if (workout.calories > 0) {
    return Math.round(workout.calories / 5)
  }

  // Last resort: duration-based estimate (moderate intensity)
  return Math.round(durationMin * 0.5)
}

interface DailyLoad {
  date: string
  trimp: number
  workoutCount: number
}

function buildDailyLoads(workouts: Workout[]): DailyLoad[] {
  const byDate = new Map<string, { trimp: number; count: number }>()
  for (const w of workouts) {
    const trimp = computeTrimp(w)
    const existing = byDate.get(w.date)
    if (existing) {
      existing.trimp += trimp
      existing.count++
    } else {
      byDate.set(w.date, { trimp, count: 1 })
    }
  }

  // Fill gaps between first and last workout date
  const dates = [...byDate.keys()].sort()
  if (dates.length === 0) return []

  const result: DailyLoad[] = []
  const start = new Date(dates[0])
  const end = new Date(dates[dates.length - 1])

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().substring(0, 10)
    const load = byDate.get(dateStr)
    result.push({
      date: dateStr,
      trimp: load?.trimp ?? 0,
      workoutCount: load?.count ?? 0,
    })
  }

  return result
}

// Exponentially weighted moving average
function ewma(data: number[], window: number): number[] {
  const alpha = 2 / (window + 1)
  const result: number[] = []
  let prev = data[0] || 0
  for (const v of data) {
    prev = alpha * v + (1 - alpha) * prev
    result.push(Math.round(prev * 10) / 10)
  }
  return result
}

interface Props {
  workouts: Workout[]
  cutoffDate: string
}

export default function TrainingLoad({ workouts, cutoffDate }: Props) {
  const ct = useChartTheme()
  const dailyLoads = useMemo(() => buildDailyLoads(workouts), [workouts])

  const chartData = useMemo(() => {
    if (dailyLoads.length === 0) return []
    const trimps = dailyLoads.map(d => d.trimp)
    const atl = ewma(trimps, 7)  // Acute (fatigue) — 7-day
    const ctl = ewma(trimps, 42) // Chronic (fitness) — 42-day

    const all = dailyLoads.map((d, i) => ({
      date: d.date,
      trimp: d.trimp,
      atl: atl[i],
      ctl: ctl[i],
      tsb: Math.round((ctl[i] - atl[i]) * 10) / 10, // Training Stress Balance (form)
    }))

    if (!cutoffDate) return all
    return all.filter(d => d.date >= cutoffDate)
  }, [dailyLoads, cutoffDate])

  // Weekly load summary
  const weeklyLoad = useMemo(() => {
    if (chartData.length === 0) return []
    const result: { week: string; trimp: number; count: number }[] = []
    let weekStart = chartData[0].date
    let sum = 0, count = 0
    for (const d of chartData) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        result.push({ week: weekStart, trimp: sum, count })
        weekStart = d.date
        sum = 0; count = 0
      }
      sum += d.trimp
      const dl = dailyLoads.find(l => l.date === d.date)
      if (dl) count += dl.workoutCount
    }
    if (sum > 0 || count > 0) result.push({ week: weekStart, trimp: sum, count })
    return result
  }, [chartData, dailyLoads])

  // Current values
  const latest = chartData.length > 0 ? chartData[chartData.length - 1] : null
  const currentATL = latest?.atl ?? null
  const currentCTL = latest?.ctl ?? null
  const currentTSB = latest?.tsb ?? null

  const formStatus = currentTSB !== null
    ? currentTSB > 15 ? 'Freshened' : currentTSB > 0 ? 'Fresh' : currentTSB > -15 ? 'Optimal' : currentTSB > -30 ? 'Fatigued' : 'Overreaching'
    : null
  const formColor = currentTSB !== null
    ? currentTSB > 15 ? COLORS.blue : currentTSB > 0 ? COLORS.green : currentTSB > -15 ? COLORS.cyan : currentTSB > -30 ? COLORS.orange : COLORS.red
    : undefined

  // Recent week trimp
  const recentWeekTrimp = weeklyLoad.length > 0 ? weeklyLoad[weeklyLoad.length - 1].trimp : null

  if (chartData.length < 7) {
    return <div className="text-zinc-500 text-center py-20">Not enough workout data to compute training load (need at least 7 days).</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Training Load" description="Track your fitness, fatigue, and form using the TRIMP model — based on workout duration and heart rate intensity." />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {currentCTL !== null && <StatBox label="Fitness (CTL)" value={fmt(currentCTL, 0)} color={COLORS.blue} sub="42-day chronic load" />}
        {currentATL !== null && <StatBox label="Fatigue (ATL)" value={fmt(currentATL, 0)} color={COLORS.red} sub="7-day acute load" />}
        {currentTSB !== null && <StatBox label="Form (TSB)" value={`${currentTSB > 0 ? '+' : ''}${fmt(currentTSB, 0)}`} color={formColor} sub={formStatus ?? undefined} />}
        {recentWeekTrimp !== null && <StatBox label="Weekly Load" value={fmt(recentWeekTrimp, 0)} unit="TRIMP" sub="Current week" />}
        <StatBox label="Workouts" value={`${workouts.length}`} sub="Total recorded" />
      </div>

      {/* Explainer */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <h3 className="text-sm font-medium text-zinc-300 mb-1.5">How to read this</h3>
        <p className="text-xs text-zinc-500 leading-relaxed">
          <strong className="text-zinc-300">Fitness (CTL)</strong> is your long-term training load — it builds slowly over weeks. <strong className="text-zinc-300">Fatigue (ATL)</strong> is your short-term load — it spikes with hard training. <strong className="text-zinc-300">Form (TSB)</strong> is the balance: when fitness exceeds fatigue, you're fresh and ready to perform. When fatigue exceeds fitness, you need recovery. The sweet spot for racing is TSB between -10 and +15.
        </p>
      </div>

      {/* Main ATL/CTL/TSB chart */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-sm font-medium text-zinc-300">Fitness, Fatigue & Form</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Blue = long-term fitness, red = short-term fatigue, green area = form (freshness).</p>
          </div>
          <AISummaryButton title="Fitness, Fatigue & Form" description="ATL/CTL/TSB training load model" chartData={chartData} />
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
            <ComposedChart margin={chartMargin} data={chartData}>
              <defs>
                <linearGradient id="tsbPosGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tsbNegGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
              <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
              {/* Optimal TSB zone */}
              <ReferenceArea y1={-10} y2={15} fill="#22c55e" fillOpacity={0.03} />
              <ReferenceLine y={0} stroke="#71717a" strokeDasharray="3 3" />
              <Tooltip content={<ChartTooltip formatter={(v, name) => {
                  if (name === 'ctl') return [`${v}`, 'Fitness (CTL)']
                  if (name === 'atl') return [`${v}`, 'Fatigue (ATL)']
                  if (name === 'tsb') return [`${v}`, 'Form (TSB)']
                  return [`${v}`, 'TRIMP']
                }} />} />
              <Area type="monotone" dataKey="tsb" stroke="#22c55e" fill="url(#tsbPosGrad)" strokeWidth={1} dot={false} />
              <Line type="monotone" dataKey="ctl" stroke={COLORS.blue} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="atl" stroke={COLORS.red} strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 justify-center mt-2">
          <Legend color={COLORS.blue} label="Fitness (CTL)" />
          <Legend color={COLORS.red} label="Fatigue (ATL)" />
          <Legend color="#22c55e" label="Form (TSB)" />
          <div className="flex items-center gap-1.5 text-xs text-zinc-600">
            <div className="w-4 h-2 rounded-sm bg-green-500/10 border border-green-500/20" />
            Race-ready zone
          </div>
        </div>
      </div>

      {/* Weekly training load */}
      {weeklyLoad.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Weekly Training Load</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Total TRIMP per week. Avoid increasing more than 10-15% week over week.</p>
            </div>
            <AISummaryButton title="Weekly Training Load" description="Weekly TRIMP totals" chartData={weeklyLoad} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ComposedChart margin={chartMargin} data={weeklyLoad}>
                <defs>
                  <linearGradient id="weeklyTrimpGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(v, name) => [name === 'trimp' ? `${v} TRIMP` : `${v} sessions`, name === 'trimp' ? 'Load' : 'Workouts']} />} />
                <Area type="monotone" dataKey="trimp" stroke={COLORS.orange} fill="url(#weeklyTrimpGrad)" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
