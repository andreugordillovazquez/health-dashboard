import { useMemo } from 'react'
import type { DailyMetrics, Workout } from './types'
import { TabHeader } from './ui'

interface YearStats {
  year: string
  totalSteps: number
  avgSteps: number
  totalDistance: number // km
  totalActiveEnergy: number
  avgSleep: number | null
  avgRestingHR: number | null
  avgHRV: number | null
  bestVO2: number | null
  workoutCount: number
  workoutMinutes: number
  workoutCalories: number
  daysTracked: number
}

function avg(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function fmt(n: number | null, d = 0): string {
  if (n === null) return '--'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return n.toFixed(d)
}

function pctChange(curr: number | null, prev: number | null): { text: string; positive: boolean | null } {
  if (curr === null || prev === null || prev === 0) return { text: '', positive: null }
  const pct = ((curr - prev) / prev) * 100
  return {
    text: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`,
    positive: pct > 0,
  }
}

interface Props {
  metrics: DailyMetrics[]
  workouts: Workout[]
}

export default function YearInReview({ metrics, workouts }: Props) {
  const years = useMemo(() => {
    const byYear = new Map<string, DailyMetrics[]>()
    for (const m of metrics) {
      const y = m.date.substring(0, 4)
      const arr = byYear.get(y) || []
      arr.push(m)
      byYear.set(y, arr)
    }

    const workoutsByYear = new Map<string, Workout[]>()
    for (const w of workouts) {
      const y = w.date.substring(0, 4)
      const arr = workoutsByYear.get(y) || []
      arr.push(w)
      workoutsByYear.set(y, arr)
    }

    const result: YearStats[] = []
    for (const [year, days] of byYear) {
      const yw = workoutsByYear.get(year) || []
      const sleepDays = days.filter(d => d.sleepHours && d.sleepHours > 0).map(d => d.sleepHours!)
      const hrDays = days.filter(d => d.restingHeartRate && d.restingHeartRate > 0).map(d => d.restingHeartRate!)
      const hrvDays = days.filter(d => d.hrv && d.hrv > 0).map(d => d.hrv!)
      const vo2Days = days.filter(d => d.vo2max && d.vo2max > 0).map(d => d.vo2max!)

      result.push({
        year,
        totalSteps: days.reduce((s, d) => s + d.steps, 0),
        avgSteps: Math.round(days.reduce((s, d) => s + d.steps, 0) / days.length),
        totalDistance: days.reduce((s, d) => s + d.distance, 0),
        totalActiveEnergy: days.reduce((s, d) => s + d.activeEnergy, 0),
        avgSleep: avg(sleepDays),
        avgRestingHR: avg(hrDays),
        avgHRV: avg(hrvDays),
        bestVO2: vo2Days.length > 0 ? Math.max(...vo2Days) : null,
        workoutCount: yw.length,
        workoutMinutes: yw.reduce((s, w) => s + w.duration, 0),
        workoutCalories: yw.reduce((s, w) => s + w.calories, 0),
        daysTracked: days.length,
      })
    }

    return result.sort((a, b) => b.year.localeCompare(a.year))
  }, [metrics, workouts])

  if (years.length === 0) {
    return <div className="text-zinc-500 text-center py-20">No data available.</div>
  }

  const rows: {
    label: string
    key: keyof YearStats
    format: (v: number | null) => string
    unit: string
    higherIsGood: boolean
  }[] = [
    { label: 'Days Tracked', key: 'daysTracked', format: v => fmt(v), unit: '', higherIsGood: true },
    { label: 'Total Steps', key: 'totalSteps', format: v => fmt(v), unit: '', higherIsGood: true },
    { label: 'Avg Steps/Day', key: 'avgSteps', format: v => fmt(v), unit: '', higherIsGood: true },
    { label: 'Total Distance', key: 'totalDistance', format: v => fmt(v, 0), unit: 'km', higherIsGood: true },
    { label: 'Active Energy', key: 'totalActiveEnergy', format: v => fmt(v), unit: 'kcal', higherIsGood: true },
    { label: 'Avg Sleep', key: 'avgSleep', format: v => fmt(v, 1), unit: 'hrs', higherIsGood: true },
    { label: 'Avg Resting HR', key: 'avgRestingHR', format: v => fmt(v, 0), unit: 'bpm', higherIsGood: false },
    { label: 'Avg HRV', key: 'avgHRV', format: v => fmt(v, 0), unit: 'ms', higherIsGood: true },
    { label: 'Best VO2 Max', key: 'bestVO2', format: v => fmt(v, 1), unit: '', higherIsGood: true },
    { label: 'Workouts', key: 'workoutCount', format: v => fmt(v), unit: '', higherIsGood: true },
    { label: 'Workout Time', key: 'workoutMinutes', format: v => v !== null ? `${Math.round(v / 60)}` : '--', unit: 'hrs', higherIsGood: true },
    { label: 'Workout Calories', key: 'workoutCalories', format: v => fmt(v), unit: 'kcal', higherIsGood: true },
  ]

  return (
    <div className="overflow-x-auto">
      <TabHeader title="Year in Review" description="A yearly breakdown of your key health and fitness metrics." />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left py-3 pr-6 text-zinc-500 text-xs font-normal sticky left-0 bg-zinc-950 z-10">Metric</th>
            {years.map(y => (
              <th key={y.year} className="text-right py-3 px-4 text-zinc-200 font-semibold text-lg">{y.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.label} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
              <td className="py-2.5 pr-6 text-zinc-400 text-xs sticky left-0 bg-zinc-950 z-10">{row.label}</td>
              {years.map((y, i) => {
                const val = y[row.key] as number | null
                const prevYear = years[i + 1]
                const prevVal = prevYear ? prevYear[row.key] as number | null : null
                const change = pctChange(val, prevVal)

                return (
                  <td key={y.year} className="text-right py-2.5 px-4">
                    <div className="text-zinc-100">
                      {row.format(val)}
                      {row.unit && <span className="text-zinc-500 text-xs ml-1">{row.unit}</span>}
                    </div>
                    {change.text && (
                      <div className={`text-[10px] mt-0.5 ${
                        change.positive === null ? 'text-zinc-600' :
                        (change.positive === row.higherIsGood) ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {change.text}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
