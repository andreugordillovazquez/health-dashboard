import type { DailyMetrics, TrendInsight, Workout } from './types'

export function computeTrends(metrics: DailyMetrics[], days = 30): TrendInsight[] {
  if (metrics.length < days * 2) return []

  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date))
  const recent = sorted.slice(-days)
  const previous = sorted.slice(-days * 2, -days)

  const insights: TrendInsight[] = []

  const checks: {
    metric: string
    key: keyof DailyMetrics
    unit: string
    higherIsGood: boolean
  }[] = [
    { metric: 'Steps', key: 'steps', unit: 'steps', higherIsGood: true },
    { metric: 'Active Energy', key: 'activeEnergy', unit: 'kcal', higherIsGood: true },
    { metric: 'Resting Heart Rate', key: 'restingHeartRate', unit: 'bpm', higherIsGood: false },
    { metric: 'Heart Rate Variability', key: 'hrv', unit: 'ms', higherIsGood: true },
    { metric: 'Sleep', key: 'sleepHours', unit: 'hrs', higherIsGood: true },
    { metric: 'Distance', key: 'distance', unit: 'km', higherIsGood: true },
    { metric: 'Exercise', key: 'exerciseMinutes', unit: 'min', higherIsGood: true },
  ]

  for (const { metric, key, unit, higherIsGood } of checks) {
    const recentVals = recent.map(m => m[key] as number | null).filter((v): v is number => v !== null && v > 0)
    const prevVals = previous.map(m => m[key] as number | null).filter((v): v is number => v !== null && v > 0)

    if (recentVals.length < 5 || prevVals.length < 5) continue

    const recentAvg = recentVals.reduce((a, b) => a + b, 0) / recentVals.length
    const previousAvg = prevVals.reduce((a, b) => a + b, 0) / prevVals.length

    if (previousAvg === 0) continue
    const changePercent = ((recentAvg - previousAvg) / previousAvg) * 100

    if (Math.abs(changePercent) < 2) continue // Skip trivial changes

    const direction = changePercent > 0 ? 'up' as const : 'down' as const
    const positive = higherIsGood ? changePercent > 0 : changePercent < 0

    insights.push({
      metric,
      direction,
      positive,
      recentAvg: Math.round(recentAvg * 10) / 10,
      previousAvg: Math.round(previousAvg * 10) / 10,
      changePercent: Math.round(Math.abs(changePercent) * 10) / 10,
      unit,
    })
  }

  return insights.sort((a, b) => b.changePercent - a.changePercent)
}

export interface ExtraTrendInput {
  metric: string
  unit: string
  higherIsGood: boolean
  data: { date: string; value: number | null }[]
}

export function computeExtraTrends(inputs: ExtraTrendInput[], days = 30): TrendInsight[] {
  const insights: TrendInsight[] = []

  for (const { metric, unit, higherIsGood, data } of inputs) {
    const sorted = [...data].filter(d => d.value !== null && d.value > 0).sort((a, b) => a.date.localeCompare(b.date))
    if (sorted.length < days) continue

    const recent = sorted.slice(-days)
    const previous = sorted.slice(-days * 2, -days)

    const recentVals = recent.map(d => d.value!)
    const prevVals = previous.map(d => d.value!)

    if (recentVals.length < 5 || prevVals.length < 5) continue

    const recentAvg = recentVals.reduce((a, b) => a + b, 0) / recentVals.length
    const previousAvg = prevVals.reduce((a, b) => a + b, 0) / prevVals.length

    if (previousAvg === 0) continue
    const changePercent = ((recentAvg - previousAvg) / previousAvg) * 100
    if (Math.abs(changePercent) < 2) continue

    const direction = changePercent > 0 ? 'up' as const : 'down' as const
    const positive = higherIsGood ? changePercent > 0 : changePercent < 0

    insights.push({
      metric, direction, positive,
      recentAvg: Math.round(recentAvg * 10) / 10,
      previousAvg: Math.round(previousAvg * 10) / 10,
      changePercent: Math.round(Math.abs(changePercent) * 10) / 10,
      unit,
    })
  }

  return insights.sort((a, b) => b.changePercent - a.changePercent)
}

export type Granularity = 'daily' | 'weekly' | 'monthly'

export function groupedAverage(
  metrics: DailyMetrics[],
  key: keyof DailyMetrics,
  granularity: Granularity = 'weekly',
): { week: string; value: number }[] {
  const sorted = [...metrics]
    .filter(m => m[key] !== null && (m[key] as number) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (sorted.length === 0) return []

  if (granularity === 'daily') {
    return sorted.map(m => ({ week: m.date, value: Math.round((m[key] as number) * 10) / 10 }))
  }

  if (granularity === 'monthly') {
    const byMonth = new Map<string, number[]>()
    for (const m of sorted) {
      const month = m.date.substring(0, 7)
      const arr = byMonth.get(month) || []
      arr.push(m[key] as number)
      byMonth.set(month, arr)
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, vals]) => ({
        week: month + '-01',
        value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10,
      }))
  }

  // weekly
  const result: { week: string; value: number }[] = []
  let weekStart = sorted[0].date
  let weekVals: number[] = []

  for (const m of sorted) {
    const daysDiff = (new Date(m.date).getTime() - new Date(weekStart).getTime()) / 86400000
    if (daysDiff >= 7) {
      if (weekVals.length > 0) {
        result.push({ week: weekStart, value: Math.round(weekVals.reduce((a, b) => a + b, 0) / weekVals.length * 10) / 10 })
      }
      weekStart = m.date
      weekVals = []
    }
    weekVals.push(m[key] as number)
  }
  if (weekVals.length > 0) {
    result.push({ week: weekStart, value: Math.round(weekVals.reduce((a, b) => a + b, 0) / weekVals.length * 10) / 10 })
  }

  return result
}

// Backward compat alias
export function weeklyAverage(metrics: DailyMetrics[], key: keyof DailyMetrics, _weeks = Infinity): { week: string; value: number }[] {
  return groupedAverage(metrics, key, 'weekly')
}

export function workoutSummary(workouts: Workout[]): { type: string; count: number; totalMinutes: number; totalCalories: number }[] {
  const map = new Map<string, { count: number; totalMinutes: number; totalCalories: number }>()

  for (const w of workouts) {
    const existing = map.get(w.type) || { count: 0, totalMinutes: 0, totalCalories: 0 }
    existing.count++
    existing.totalMinutes += w.duration
    existing.totalCalories += w.calories
    map.set(w.type, existing)
  }

  return Array.from(map.entries())
    .map(([type, data]) => ({ type, ...data }))
    .sort((a, b) => b.count - a.count)
}

export function monthlyWorkouts(workouts: Workout[]): { month: string; count: number; minutes: number }[] {
  const map = new Map<string, { count: number; minutes: number }>()

  for (const w of workouts) {
    const month = w.date.substring(0, 7)
    const existing = map.get(month) || { count: 0, minutes: 0 }
    existing.count++
    existing.minutes += w.duration
    map.set(month, existing)
  }

  return Array.from(map.entries())
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => a.month.localeCompare(b.month))
}
