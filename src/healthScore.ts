import type { DailyMetrics, HealthData, SleepRecord, BodyRecord } from './types'

export interface HealthScore {
  date: string
  total: number
  cardio: number | null
  sleep: number | null
  activity: number | null
  body: number | null
  confidence: number // 0-1
  metricsUsed: number
  metricsTotal: number
}

// === Piecewise linear interpolation ===
function lerp(points: [number, number][], value: number): number {
  if (value <= points[0][0]) return points[0][1]
  if (value >= points[points.length - 1][0]) return points[points.length - 1][1]
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    if (value >= x0 && value <= x1) {
      const t = (value - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  return points[points.length - 1][1]
}

function clamp(v: number): number { return Math.max(0, Math.min(100, v)) }

// === Individual metric scoring ===

const VO2_TABLE_MALE: [number, number[]][] = [
  // [age, [veryPoor, poor, fair, good, excellent, superior]]
  [25, [33, 36.4, 42.4, 46.4, 52.4, 56]],
  [35, [31.5, 35.4, 40.9, 44.9, 49.4, 53]],
  [45, [30.2, 33.5, 38.9, 43.7, 48.0, 52]],
  [55, [26.1, 30.9, 35.7, 40.9, 45.3, 49]],
  [65, [20.5, 26.0, 32.2, 36.4, 44.2, 48]],
]

const VO2_TABLE_FEMALE: [number, number[]][] = [
  [25, [23.6, 28.9, 32.9, 36.9, 41.0, 45]],
  [35, [22.8, 26.9, 31.4, 35.6, 40.0, 44]],
  [45, [21.0, 24.4, 28.9, 32.8, 36.9, 41]],
  [55, [20.2, 22.7, 26.9, 31.4, 35.7, 40]],
  [65, [17.5, 20.1, 24.4, 30.2, 31.4, 36]],
]

function scoreVO2(vo2: number | null, age: number, isMale: boolean): number | null {
  if (vo2 === null) return null
  const table = isMale ? VO2_TABLE_MALE : VO2_TABLE_FEMALE
  // Find closest age bracket
  const row = table.reduce((prev, curr) => Math.abs(curr[0] - age) < Math.abs(prev[0] - age) ? curr : prev)
  const [vp, p, f, g, e, s] = row[1]
  return clamp(lerp([[vp - 5, 0], [vp, 10], [p, 30], [f, 50], [g, 70], [e, 85], [s, 100]], vo2))
}

function scoreRHR(rhr: number | null): number | null {
  if (rhr === null) return null
  return clamp(lerp([[40, 70], [50, 95], [55, 100], [60, 90], [65, 80], [70, 70], [75, 55], [80, 40], [85, 25], [90, 15], [100, 5]], rhr))
}

function scoreHRV(hrv: number | null, age: number): number | null {
  if (hrv === null) return null
  // Age adjustment factor
  const ageFactor = age < 30 ? 1.0 : age < 40 ? 0.95 : age < 50 ? 0.88 : age < 60 ? 0.80 : age < 70 ? 0.72 : 0.65
  const adjusted = hrv / ageFactor // Normalize to 20-year-old equivalent
  return clamp(lerp([[10, 0], [20, 15], [30, 30], [50, 50], [70, 70], [100, 85], [130, 95], [150, 100]], adjusted))
}

function scoreWalkingHR(whr: number | null, age: number): number | null {
  if (whr === null) return null
  const maxHR = 220 - age
  const pct = (whr / maxHR) * 100
  return clamp(lerp([[35, 100], [40, 95], [45, 85], [50, 75], [55, 65], [60, 50], [65, 35], [70, 20], [80, 5]], pct))
}

function scoreSleepDuration(totalMinutes: number | null): number | null {
  if (totalMinutes === null) return null
  const hours = totalMinutes / 60
  return clamp(lerp([[3, 0], [4, 5], [4.5, 15], [5, 30], [5.5, 45], [6, 65], [6.5, 80], [7, 100], [7.5, 95], [8, 85], [8.5, 70], [9, 55], [9.5, 35], [10, 15]], hours))
}

function scoreDeepSleep(deepMin: number | null, totalMin: number | null, age: number): number | null {
  if (deepMin === null || totalMin === null || totalMin === 0) return null
  const pct = (deepMin / totalMin) * 100
  // Age adjustment: thresholds scale down with age
  const ageFactor = age < 30 ? 1.0 : age < 40 ? 0.92 : age < 50 ? 0.84 : age < 60 ? 0.76 : age < 70 ? 0.70 : 0.64
  const adjusted = pct / ageFactor
  return clamp(lerp([[2, 0], [5, 10], [10, 50], [15, 75], [20, 90], [25, 100], [30, 100]], adjusted))
}

function scoreREMSleep(remMin: number | null, totalMin: number | null): number | null {
  if (remMin === null || totalMin === null || totalMin === 0) return null
  const pct = (remMin / totalMin) * 100
  return clamp(lerp([[2, 0], [5, 10], [10, 35], [15, 60], [20, 85], [25, 100], [30, 90], [35, 75]], pct))
}

function scoreSleepConsistency(bedtimeStdMin: number | null): number | null {
  if (bedtimeStdMin === null) return null
  return clamp(lerp([[15, 100], [30, 85], [45, 70], [60, 50], [90, 30], [120, 10]], bedtimeStdMin))
}

function scoreBreathingQuality(disturbances: number | null, spo2: number | null, respRate: number | null): number | null {
  const scores: { s: number; w: number }[] = []
  if (disturbances !== null) {
    scores.push({ s: lerp([[0, 100], [4, 85], [5, 70], [14, 55], [15, 35], [29, 25], [30, 5]], disturbances), w: 0.4 })
  }
  if (spo2 !== null) {
    scores.push({ s: lerp([[88, 0], [90, 5], [92, 25], [93, 40], [94, 60], [95, 80], [96, 90], [97, 100]], spo2), w: 0.4 })
  }
  if (respRate !== null) {
    // Optimal 12-16, acceptable 10-20
    let s: number
    if (respRate >= 12 && respRate <= 16) s = 100
    else if (respRate < 12) s = lerp([[6, 10], [8, 40], [10, 75], [12, 100]], respRate)
    else s = lerp([[16, 100], [18, 80], [20, 60], [22, 35], [25, 10]], respRate)
    scores.push({ s, w: 0.2 })
  }
  if (scores.length === 0) return null
  const totalW = scores.reduce((sum, s) => sum + s.w, 0)
  return clamp(scores.reduce((sum, s) => sum + s.s * (s.w / totalW), 0))
}

function scoreSteps(steps: number | null, age: number): number | null {
  if (steps === null) return null
  if (age >= 60) {
    return clamp(lerp([[0, 0], [2000, 10], [3000, 30], [4000, 45], [6000, 70], [8000, 90], [10000, 100]], steps))
  }
  return clamp(lerp([[0, 0], [2000, 10], [3000, 25], [5000, 45], [7000, 65], [8000, 75], [10000, 90], [12000, 100]], steps))
}

function scoreExerciseMinutes(weeklyMin: number | null): number | null {
  if (weeklyMin === null) return null
  return clamp(lerp([[0, 5], [30, 20], [75, 40], [150, 70], [300, 90], [450, 97], [600, 100]], weeklyMin))
}

function scoreActiveEnergy(kcal: number | null): number | null {
  if (kcal === null) return null
  return clamp(lerp([[0, 0], [50, 5], [100, 20], [200, 40], [400, 70], [600, 85], [800, 95], [1000, 100]], kcal))
}

function scoreDaylight(minutes: number | null): number | null {
  if (minutes === null) return null
  return clamp(lerp([[0, 5], [5, 20], [10, 40], [20, 60], [30, 75], [60, 90], [90, 100]], minutes))
}

function scoreBMI(bmi: number | null, age: number): number | null {
  if (bmi === null) return null
  const shift = age >= 65 ? 1.5 : 0
  return clamp(lerp([
    [14, 0], [16, 5], [17, 30], [18.5 + shift, 55], [20 + shift, 75],
    [22 + shift, 95], [24.5 + shift, 100], [25 + shift, 95],
    [27 + shift, 75], [30 + shift, 50], [32 + shift, 35], [35 + shift, 20], [40 + shift, 5],
  ], bmi))
}

function scoreWeightTrend(pctChange: number | null, bmi: number | null): number | null {
  if (pctChange === null) return 70 // neutral if no data
  if (bmi === null) return 70

  if (bmi > 27) { // overweight
    return clamp(lerp([[-3, 50], [-2, 85], [-0.5, 100], [0, 85], [1, 60], [2, 30]], pctChange))
  }
  if (bmi < 18.5) { // underweight
    return clamp(lerp([[-1, 15], [-0.5, 40], [0, 60], [0.5, 85], [2, 100], [3, 70]], pctChange))
  }
  // normal range
  return clamp(lerp([[-2, 35], [-1.5, 50], [-0.5, 85], [0, 100], [0.5, 85], [1.5, 50], [2, 35]], pctChange))
}

// === Weighted average with missing data handling ===
function weightedAvg(items: { score: number | null; weight: number }[]): number | null {
  const present = items.filter(i => i.score !== null) as { score: number; weight: number }[]
  if (present.length === 0) return null
  const totalW = present.reduce((sum, i) => sum + i.weight, 0)
  return present.reduce((sum, i) => sum + i.score * (i.weight / totalW), 0)
}

// === Helper: build sleep data for a specific date ===
function getDailySleep(sleepRecords: SleepRecord[], date: string): { total: number; deep: number; rem: number } | null {
  const recs = sleepRecords.filter(r => r.date === date && r.stage !== 'inbed' && r.stage !== 'awake')
  const hasStages = recs.some(r => r.stage === 'core' || r.stage === 'deep' || r.stage === 'rem')
  let total = 0, deep = 0, rem = 0
  for (const r of recs) {
    if (r.stage === 'unspecified' && hasStages) continue
    total += r.minutes
    if (r.stage === 'deep') deep += r.minutes
    if (r.stage === 'rem') rem += r.minutes
  }
  return total > 30 ? { total, deep, rem } : null
}

function getBedtimeStd(sleepRecords: SleepRecord[], date: string): number | null {
  // Get bedtimes for 14 days ending on `date`
  const cutoff = new Date(date)
  cutoff.setDate(cutoff.getDate() - 14)
  const cutoffStr = cutoff.toISOString().substring(0, 10)

  const bedtimes: number[] = []
  const seen = new Set<string>()
  for (const r of sleepRecords) {
    if (r.date < cutoffStr || r.date > date) continue
    if (r.stage === 'inbed' || r.stage === 'awake' || seen.has(r.date)) continue
    seen.add(r.date)
    const match = r.startDate.match(/(\d{2}):(\d{2})/)
    if (match) {
      let mins = parseInt(match[1]) * 60 + parseInt(match[2])
      if (mins < 720) mins += 1440 // normalize past-midnight
      bedtimes.push(mins)
    }
  }
  if (bedtimes.length < 5) return null
  const mean = bedtimes.reduce((a, b) => a + b, 0) / bedtimes.length
  return Math.sqrt(bedtimes.reduce((sum, b) => sum + (b - mean) ** 2, 0) / bedtimes.length)
}

function getMostRecent<T extends { date: string }>(records: T[], date: string, maxDays: number): T | null {
  const cutoff = new Date(date)
  cutoff.setDate(cutoff.getDate() - maxDays)
  const cutoffStr = cutoff.toISOString().substring(0, 10)
  let best: T | null = null
  for (const r of records) {
    if (r.date > date || r.date < cutoffStr) continue
    if (!best || r.date > best.date) best = r
  }
  return best
}

function sumPast7Days(metrics: Map<string, DailyMetrics>, date: string, key: 'exerciseMinutes'): number | null {
  let sum = 0, count = 0
  const d = new Date(date)
  for (let i = 0; i < 7; i++) {
    const ds = d.toISOString().substring(0, 10)
    const m = metrics.get(ds)
    if (m && m[key] > 0) { sum += m[key]; count++ }
    d.setDate(d.getDate() - 1)
  }
  return count > 0 ? sum : null
}

function computeWeightTrend(bodyRecords: BodyRecord[], date: string): { pctChange: number; currentBMI: number | null } | null {
  const now = bodyRecords.filter(r => r.date <= date && r.weight !== null).sort((a, b) => b.date.localeCompare(a.date))
  if (now.length === 0) return null
  const current = now[0]
  const cutoff = new Date(date)
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().substring(0, 10)
  const past = bodyRecords.filter(r => r.date <= cutoffStr && r.weight !== null).sort((a, b) => b.date.localeCompare(a.date))
  if (past.length === 0 || !current.weight) return null
  const oldWeight = past[0].weight!
  if (oldWeight === 0) return null
  return { pctChange: ((current.weight - oldWeight) / oldWeight) * 100, currentBMI: current.bmi }
}

// === Main computation ===
export function computeDailyHealthScore(
  date: string,
  data: HealthData,
): HealthScore {
  const age = data.profile.dob ? new Date(date).getFullYear() - new Date(data.profile.dob).getFullYear() : 30
  const isMale = !data.profile.sex || data.profile.sex.includes('Male')

  const dm = data.dailyMetrics.get(date)

  // Cardio
  const vo2Rec = getMostRecent(data.cardioRecords.filter(r => r.type === 'vo2max'), date, 30)
  const walkHRRec = data.cardioRecords.filter(r => r.type === 'walkingHR' && r.date === date)
  const walkHR = walkHRRec.length > 0 ? walkHRRec.reduce((s, r) => s + r.value, 0) / walkHRRec.length : null

  const cardio = weightedAvg([
    { score: scoreVO2(vo2Rec?.value ?? dm?.vo2max ?? null, age, isMale), weight: 0.40 },
    { score: scoreRHR(dm?.restingHeartRate ?? null), weight: 0.25 },
    { score: scoreHRV(dm?.hrv ?? null, age), weight: 0.25 },
    { score: scoreWalkingHR(walkHR, age), weight: 0.10 },
  ])

  // Sleep
  const sleep = getDailySleep(data.sleepRecords, date)
  const bedtimeStd = getBedtimeStd(data.sleepRecords, date)
  const br = data.dailyBreathing.find(b => b.date === date)

  const sleepScore = weightedAvg([
    { score: scoreSleepDuration(sleep?.total ?? null), weight: 0.30 },
    { score: scoreDeepSleep(sleep?.deep ?? null, sleep?.total ?? null, age), weight: 0.20 },
    { score: scoreREMSleep(sleep?.rem ?? null, sleep?.total ?? null), weight: 0.20 },
    { score: scoreSleepConsistency(bedtimeStd), weight: 0.15 },
    { score: scoreBreathingQuality(br?.disturbances ?? null, br?.spo2 ?? null, br?.respiratoryRate ?? null), weight: 0.15 },
  ])

  // Activity
  const weeklyExercise = sumPast7Days(data.dailyMetrics, date, 'exerciseMinutes')
  const daylight = data.dailyDaylight.find(d => d.date === date)

  const activity = weightedAvg([
    { score: scoreSteps(dm?.steps ?? null, age), weight: 0.35 },
    { score: scoreExerciseMinutes(weeklyExercise), weight: 0.35 },
    { score: scoreActiveEnergy(dm?.activeEnergy ?? null), weight: 0.15 },
    { score: scoreDaylight(daylight?.minutes ?? null), weight: 0.15 },
  ])

  // Body
  const bodyRec = getMostRecent(data.bodyRecords, date, 14)
  const trend = computeWeightTrend(data.bodyRecords, date)

  const bodyScore = weightedAvg([
    { score: scoreBMI(bodyRec?.bmi ?? null, age), weight: 0.50 },
    { score: scoreWeightTrend(trend?.pctChange ?? null, trend?.currentBMI ?? bodyRec?.bmi ?? null), weight: 0.50 },
  ])

  // Total
  const total = weightedAvg([
    { score: cardio, weight: 0.35 },
    { score: sleepScore, weight: 0.25 },
    { score: activity, weight: 0.25 },
    { score: bodyScore, weight: 0.15 },
  ])

  // Count metrics used
  const allScores = [
    scoreVO2(vo2Rec?.value ?? dm?.vo2max ?? null, age, isMale),
    scoreRHR(dm?.restingHeartRate ?? null),
    scoreHRV(dm?.hrv ?? null, age),
    scoreWalkingHR(walkHR, age),
    scoreSleepDuration(sleep?.total ?? null),
    scoreDeepSleep(sleep?.deep ?? null, sleep?.total ?? null, age),
    scoreREMSleep(sleep?.rem ?? null, sleep?.total ?? null),
    scoreSleepConsistency(bedtimeStd),
    scoreBreathingQuality(br?.disturbances ?? null, br?.spo2 ?? null, br?.respiratoryRate ?? null),
    scoreSteps(dm?.steps ?? null, age),
    scoreExerciseMinutes(weeklyExercise),
    scoreActiveEnergy(dm?.activeEnergy ?? null),
    scoreDaylight(daylight?.minutes ?? null),
    scoreBMI(bodyRec?.bmi ?? null, age),
    scoreWeightTrend(trend?.pctChange ?? null, trend?.currentBMI ?? null),
  ]
  const metricsUsed = allScores.filter(s => s !== null).length

  return {
    date,
    total: total !== null ? Math.round(total) : 0,
    cardio: cardio !== null ? Math.round(cardio) : null,
    sleep: sleepScore !== null ? Math.round(sleepScore) : null,
    activity: activity !== null ? Math.round(activity) : null,
    body: bodyScore !== null ? Math.round(bodyScore) : null,
    confidence: metricsUsed / 15,
    metricsUsed,
    metricsTotal: 15,
  }
}

// Compute scores for a date range
export function computeHealthScores(data: HealthData): HealthScore[] {
  const dates = Array.from(data.dailyMetrics.keys()).sort()
  return dates.map(date => computeDailyHealthScore(date, data))
}

// 7-day rolling average
export function rollingAvg(scores: HealthScore[], window = 7): { date: string; total: number; cardio: number; sleep: number; activity: number; body: number }[] {
  const result: { date: string; total: number; cardio: number; sleep: number; activity: number; body: number }[] = []
  for (let i = window - 1; i < scores.length; i++) {
    const chunk = scores.slice(i - window + 1, i + 1)
    const avg = (key: keyof HealthScore) => {
      const vals = chunk.map(s => s[key] as number | null).filter((v): v is number => v !== null)
      return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
    }
    result.push({ date: scores[i].date, total: avg('total'), cardio: avg('cardio'), sleep: avg('sleep'), activity: avg('activity'), body: avg('body') })
  }
  return result
}

export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Excellent', color: '#22c55e' }
  if (score >= 80) return { label: 'Very Good', color: '#4ade80' }
  if (score >= 70) return { label: 'Good', color: '#86efac' }
  if (score >= 60) return { label: 'Fair', color: '#fbbf24' }
  if (score >= 50) return { label: 'Needs Work', color: '#f97316' }
  if (score >= 40) return { label: 'Poor', color: '#ef4444' }
  return { label: 'Critical', color: '#dc2626' }
}
