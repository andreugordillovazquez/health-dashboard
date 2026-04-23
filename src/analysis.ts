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

// === Projections ===

export const MIN_POINTS_FOR_PROJECTION = 14

export interface Regression {
  slope: number
  intercept: number
  r2: number
}

export function linearRegression(points: { x: number; y: number }[]): Regression | null {
  const n = points.length
  if (n < 2) return null
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
  for (const { x, y } of points) {
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
    sumY2 += y * y
  }
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const meanY = sumY / n
  let ssRes = 0, ssTot = 0
  for (const { x, y } of points) {
    const pred = slope * x + intercept
    ssRes += (y - pred) ** 2
    ssTot += (y - meanY) ** 2
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().substring(0, 10)
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().substring(0, 10)
}

export interface ProjectionOptions {
  /** Field in each datum holding the ISO date (or week/month start). Defaults to 'date'. */
  dateKey?: string
  /** Field in each datum holding the numeric value. Defaults to 'value'. */
  valueKey?: string
  /** Granularity of the input series. Defaults to 'daily'. */
  granularity?: Granularity
  /** Number of future points to project. Defaults to 25% of the input length, capped at 90. */
  steps?: number
  /** Optional lower clamp (e.g. 0 for counts). */
  min?: number
  /** Optional upper clamp (e.g. 100 for percentages). */
  max?: number
}

/**
 * Projects future values using linear regression on recent history.
 * Returns [] when there isn't enough data. Each future point has the same shape
 * as the input but with the value stored under `<valueKey>Projection`, plus the
 * original valueKey set to null so charts can share one data array.
 */
export function computeProjection<T extends Record<string, unknown>>(
  data: T[],
  options: ProjectionOptions = {},
): T[] {
  const {
    dateKey = 'date',
    valueKey = 'value',
    granularity = 'daily',
    min,
    max,
  } = options

  if (data.length < MIN_POINTS_FOR_PROJECTION) return []

  const points: { x: number; y: number }[] = []
  for (let i = 0; i < data.length; i++) {
    const v = data[i][valueKey] as number | null | undefined
    if (v === null || v === undefined || Number.isNaN(v)) continue
    points.push({ x: i, y: v })
  }
  if (points.length < MIN_POINTS_FOR_PROJECTION) return []

  // Fit on the most recent half (or last 60 points, whichever is less) for responsiveness
  const fitWindow = Math.max(MIN_POINTS_FOR_PROJECTION, Math.min(60, Math.floor(points.length / 2)))
  const fitPoints = points.slice(-fitWindow)
  const reg = linearRegression(fitPoints)
  if (!reg) return []

  const steps = options.steps ?? Math.min(90, Math.max(4, Math.floor(data.length * 0.25)))
  const lastDate = data[data.length - 1][dateKey] as string
  const result: T[] = []
  const lastX = data.length - 1

  for (let i = 1; i <= steps; i++) {
    const x = lastX + i
    let y = reg.slope * x + reg.intercept
    if (min !== undefined) y = Math.max(min, y)
    if (max !== undefined) y = Math.min(max, y)
    y = Math.round(y * 100) / 100

    let nextDate: string
    if (granularity === 'monthly') nextDate = addMonthsISO(lastDate, i)
    else if (granularity === 'weekly') nextDate = addDaysISO(lastDate, i * 7)
    else nextDate = addDaysISO(lastDate, i)

    const base = { [dateKey]: nextDate, [valueKey]: null, [`${valueKey}Projection`]: y } as Record<string, unknown>
    result.push(base as T)
  }
  return result
}

/**
 * Merges historical data with its projection so charts can render both in one pass.
 * The historical tail gets a duplicate `<valueKey>Projection` point equal to its value
 * so the dashed projection line visually connects to the solid historical line.
 */
export function withProjection<T extends Record<string, unknown>>(
  data: T[],
  options: ProjectionOptions = {},
): { data: T[]; canProject: boolean } {
  const projection = computeProjection(data, options)
  if (projection.length === 0) {
    return { data, canProject: false }
  }
  const valueKey = options.valueKey ?? 'value'
  const projectionKey = `${valueKey}Projection`
  const lastIdx = data.length - 1
  const last = data[lastIdx]
  const bridged = data.map((row, i) =>
    i === lastIdx ? ({ ...row, [projectionKey]: last[valueKey] } as T) : row,
  )
  return { data: [...bridged, ...projection], canProject: true }
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
