import { useMemo } from 'react'
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  CartesianGrid, ZAxis, AreaChart, Area,
} from 'recharts'
import type { DailyMetrics, SleepRecord, CaffeineRecord, DailyBreathing, CardioRecord } from './types'
import { tooltipStyle, ChartCard, shortDateCompact } from './ui'

interface CorrelationResult {
  label: string
  r: number
  n: number
  description: string
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 5) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? 0 : num / denom
}

function buildDailySleepHours(records: SleepRecord[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of records) {
    if (r.stage === 'inbed' || r.stage === 'awake') continue
    map.set(r.date, (map.get(r.date) || 0) + r.minutes / 60)
  }
  return map
}

function buildDailyCaffeine(records: CaffeineRecord[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of records) {
    map.set(r.date, (map.get(r.date) || 0) + r.mg)
  }
  return map
}

function nextDay(date: string): string {
  const d = new Date(date)
  d.setDate(d.getDate() + 1)
  return d.toISOString().substring(0, 10)
}


function CorrelationBadge({ result }: { result: CorrelationResult }) {
  const strength = Math.abs(result.r)
  const color = strength > 0.5 ? (result.r > 0 ? 'text-green-400' : 'text-red-400') :
    strength > 0.3 ? (result.r > 0 ? 'text-green-400/70' : 'text-red-400/70') : 'text-zinc-400'
  const strengthLabel = strength > 0.5 ? 'Strong' : strength > 0.3 ? 'Moderate' : 'Weak'

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-zinc-200">{result.label}</span>
        <span className={`text-sm font-mono font-medium ${color}`}>
          r = {result.r > 0 ? '+' : ''}{result.r.toFixed(2)}
        </span>
      </div>
      <div className="text-xs text-zinc-500">
        {strengthLabel} · {result.n} data points · {result.description}
      </div>
    </div>
  )
}

interface Props {
  metrics: DailyMetrics[]
  sleepRecords: SleepRecord[]
  caffeineRecords: CaffeineRecord[]
  dailyBreathing: DailyBreathing[]
  cardioRecords: CardioRecord[]
  dailyDaylight: { date: string; minutes: number }[]
}

export default function Correlations({ metrics, sleepRecords, caffeineRecords, dailyBreathing, cardioRecords, dailyDaylight }: Props) {
  const sleepByDate = useMemo(() => buildDailySleepHours(sleepRecords), [sleepRecords])
  const caffeineByDate = useMemo(() => buildDailyCaffeine(caffeineRecords), [caffeineRecords])

  const metricsMap = useMemo(() => {
    const m = new Map<string, DailyMetrics>()
    for (const d of metrics) m.set(d.date, d)
    return m
  }, [metrics])

  // 1. Sleep vs next-day HRV
  const sleepHrvData = useMemo(() => {
    const points: { sleep: number; hrv: number }[] = []
    for (const [date, hours] of sleepByDate) {
      if (hours < 1) continue
      const next = metricsMap.get(nextDay(date))
      if (next?.hrv && next.hrv > 0) {
        points.push({ sleep: Math.round(hours * 10) / 10, hrv: Math.round(next.hrv) })
      }
    }
    return points
  }, [sleepByDate, metricsMap])

  // 2. Exercise minutes vs resting HR
  const exerciseHrData = useMemo(() => {
    const points: { exercise: number; hr: number }[] = []
    // Use weekly averages for smoother correlation
    const weeks: { exercise: number[]; hr: number[] }[] = []
    let weekBucket = { exercise: [] as number[], hr: [] as number[] }
    let weekStart = metrics[0]?.date || ''

    for (const m of metrics) {
      const daysDiff = (new Date(m.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (daysDiff >= 7) {
        if (weekBucket.exercise.length > 0 && weekBucket.hr.length > 0) {
          weeks.push(weekBucket)
        }
        weekStart = m.date
        weekBucket = { exercise: [], hr: [] }
      }
      if (m.exerciseMinutes > 0) weekBucket.exercise.push(m.exerciseMinutes)
      if (m.restingHeartRate && m.restingHeartRate > 0) weekBucket.hr.push(m.restingHeartRate)
    }
    if (weekBucket.exercise.length > 0 && weekBucket.hr.length > 0) weeks.push(weekBucket)

    for (const w of weeks) {
      const avgEx = w.exercise.reduce((a, b) => a + b, 0) / w.exercise.length
      const avgHr = w.hr.reduce((a, b) => a + b, 0) / w.hr.length
      points.push({ exercise: Math.round(avgEx), hr: Math.round(avgHr * 10) / 10 })
    }
    return points
  }, [metrics])

  // 3. Caffeine vs sleep duration that night
  const caffeineSleepData = useMemo(() => {
    const points: { caffeine: number; sleep: number }[] = []
    for (const [date, mg] of caffeineByDate) {
      // Sleep is assigned to the next day (you wake up)
      const sleepHours = sleepByDate.get(nextDay(date))
      if (sleepHours && sleepHours > 1) {
        points.push({ caffeine: Math.round(mg), sleep: Math.round(sleepHours * 10) / 10 })
      }
    }
    return points
  }, [caffeineByDate, sleepByDate])

  // 4. Steps vs sleep that night
  const stepsSleepData = useMemo(() => {
    const points: { steps: number; sleep: number }[] = []
    for (const m of metrics) {
      if (m.steps < 100) continue
      const sleepHours = sleepByDate.get(nextDay(m.date))
      if (sleepHours && sleepHours > 1) {
        points.push({ steps: m.steps, sleep: Math.round(sleepHours * 10) / 10 })
      }
    }
    return points
  }, [metrics, sleepByDate])

  // 5. Sleep → Next-day Resting HR
  const sleepHrData = useMemo(() => {
    const points: { sleep: number; hr: number }[] = []
    for (const [date, hours] of sleepByDate) {
      if (hours < 1) continue
      const next = metricsMap.get(nextDay(date))
      if (next?.restingHeartRate && next.restingHeartRate > 0) {
        points.push({ sleep: Math.round(hours * 10) / 10, hr: Math.round(next.restingHeartRate) })
      }
    }
    return points
  }, [sleepByDate, metricsMap])

  // 6. Exercise → Next-day HRV
  const exerciseHrvData = useMemo(() => {
    const points: { exercise: number; hrv: number }[] = []
    for (const m of metrics) {
      if (m.exerciseMinutes < 1) continue
      const next = metricsMap.get(nextDay(m.date))
      if (next?.hrv && next.hrv > 0) {
        points.push({ exercise: Math.round(m.exerciseMinutes), hrv: Math.round(next.hrv) })
      }
    }
    return points
  }, [metrics, metricsMap])

  // 7. Daylight → Sleep quality (sleep that night)
  const daylightSleepData = useMemo(() => {
    const daylightMap = new Map(dailyDaylight.map(d => [d.date, d.minutes]))
    const points: { daylight: number; sleep: number }[] = []
    for (const [date, mins] of daylightMap) {
      if (mins < 1) continue
      const sleepHours = sleepByDate.get(nextDay(date))
      if (sleepHours && sleepHours > 1) {
        points.push({ daylight: mins, sleep: Math.round(sleepHours * 10) / 10 })
      }
    }
    return points
  }, [dailyDaylight, sleepByDate])

  // 8. Daylight → Next-day HRV
  const daylightHrvData = useMemo(() => {
    const daylightMap = new Map(dailyDaylight.map(d => [d.date, d.minutes]))
    const points: { daylight: number; hrv: number }[] = []
    for (const [date, mins] of daylightMap) {
      if (mins < 1) continue
      const next = metricsMap.get(nextDay(date))
      if (next?.hrv && next.hrv > 0) {
        points.push({ daylight: mins, hrv: Math.round(next.hrv) })
      }
    }
    return points
  }, [dailyDaylight, metricsMap])

  // 9. Steps → Resting HR (same day)
  const stepsHrData = useMemo(() => {
    const points: { steps: number; hr: number }[] = []
    for (const m of metrics) {
      if (m.steps < 100 || !m.restingHeartRate || m.restingHeartRate <= 0) continue
      points.push({ steps: m.steps, hr: Math.round(m.restingHeartRate) })
    }
    // Downsample to weekly for smoother correlation
    const weekly: { steps: number; hr: number }[] = []
    for (let i = 0; i < points.length; i += 7) {
      const chunk = points.slice(i, i + 7)
      weekly.push({
        steps: Math.round(chunk.reduce((s, p) => s + p.steps, 0) / chunk.length),
        hr: Math.round(chunk.reduce((s, p) => s + p.hr, 0) / chunk.length),
      })
    }
    return weekly
  }, [metrics])

  // 10. Sleep → Breathing disturbances
  const sleepDisturbanceData = useMemo(() => {
    const distMap = new Map(dailyBreathing.filter(d => d.disturbances !== null).map(d => [d.date, d.disturbances!]))
    const points: { sleep: number; disturbances: number }[] = []
    for (const [date, hours] of sleepByDate) {
      if (hours < 1) continue
      const dist = distMap.get(date)
      if (dist !== undefined) {
        points.push({ sleep: Math.round(hours * 10) / 10, disturbances: Math.round(dist * 10) / 10 })
      }
    }
    return points
  }, [sleepByDate, dailyBreathing])

  // 11. Exercise → Sleep quality
  const exerciseSleepData = useMemo(() => {
    const points: { exercise: number; sleep: number }[] = []
    for (const m of metrics) {
      if (m.exerciseMinutes < 1) continue
      const sleepHours = sleepByDate.get(nextDay(m.date))
      if (sleepHours && sleepHours > 1) {
        points.push({ exercise: Math.round(m.exerciseMinutes), sleep: Math.round(sleepHours * 10) / 10 })
      }
    }
    return points
  }, [metrics, sleepByDate])

  // 12. VO2 Max → Resting HR (over time)
  const vo2HrData = useMemo(() => {
    const vo2 = cardioRecords.filter(r => r.type === 'vo2max')
    const points: { vo2: number; hr: number }[] = []
    for (const r of vo2) {
      const m = metricsMap.get(r.date)
      if (m?.restingHeartRate && m.restingHeartRate > 0) {
        points.push({ vo2: Math.round(r.value * 10) / 10, hr: Math.round(m.restingHeartRate) })
      }
    }
    return points
  }, [cardioRecords, metricsMap])

  // Compute all correlations
  const correlations = useMemo(() => {
    const results: CorrelationResult[] = []

    const add = (data: { x: number[]; y: number[] }, label: string, description: string) => {
      if (data.x.length >= 10) {
        results.push({ label, r: pearson(data.x, data.y), n: data.x.length, description })
      }
    }

    add({ x: sleepHrvData.map(d => d.sleep), y: sleepHrvData.map(d => d.hrv) },
      'Sleep → Next-day HRV', 'More sleep typically increases HRV the next day')

    add({ x: sleepHrData.map(d => d.sleep), y: sleepHrData.map(d => d.hr) },
      'Sleep → Next-day Resting HR', 'Better sleep is associated with lower resting HR')

    add({ x: exerciseHrData.map(d => d.exercise), y: exerciseHrData.map(d => d.hr) },
      'Weekly Exercise → Resting HR', 'More exercise is associated with lower resting HR')

    add({ x: exerciseHrvData.map(d => d.exercise), y: exerciseHrvData.map(d => d.hrv) },
      'Exercise → Next-day HRV', 'Exercise may improve next-day autonomic recovery')

    add({ x: exerciseSleepData.map(d => d.exercise), y: exerciseSleepData.map(d => d.sleep) },
      'Exercise → Sleep Duration', 'Active days may lead to longer sleep')

    add({ x: stepsSleepData.map(d => d.steps), y: stepsSleepData.map(d => d.sleep) },
      'Steps → Sleep Duration', 'More active days may lead to longer sleep')

    add({ x: stepsHrData.map(d => d.steps), y: stepsHrData.map(d => d.hr) },
      'Weekly Steps → Resting HR', 'Higher step count associated with lower resting HR')

    add({ x: daylightSleepData.map(d => d.daylight), y: daylightSleepData.map(d => d.sleep) },
      'Daylight → Sleep Duration', 'More daylight exposure may improve sleep')

    add({ x: daylightHrvData.map(d => d.daylight), y: daylightHrvData.map(d => d.hrv) },
      'Daylight → Next-day HRV', 'Sunlight exposure may improve autonomic health')

    add({ x: sleepDisturbanceData.map(d => d.sleep), y: sleepDisturbanceData.map(d => d.disturbances) },
      'Sleep Duration → Breathing Disturbances', 'Relationship between sleep time and breathing events')

    add({ x: vo2HrData.map(d => d.vo2), y: vo2HrData.map(d => d.hr) },
      'VO2 Max → Resting HR', 'Higher fitness level is associated with lower resting HR')

    return results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
  }, [sleepHrvData, sleepHrData, exerciseHrData, exerciseHrvData, exerciseSleepData, caffeineSleepData, stepsSleepData, stepsHrData, daylightSleepData, daylightHrvData, sleepDisturbanceData, vo2HrData])

  // Rolling correlation: sleep vs HRV over time (30-day window)
  const rollingCorr = useMemo(() => {
    const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date))
    const result: { date: string; r: number }[] = []
    const window = 30

    for (let i = window; i < sorted.length; i++) {
      const chunk = sorted.slice(i - window, i)
      const xs: number[] = []
      const ys: number[] = []
      for (const m of chunk) {
        const sleepH = sleepByDate.get(m.date)
        if (sleepH && sleepH > 1 && m.hrv && m.hrv > 0) {
          xs.push(sleepH)
          ys.push(m.hrv)
        }
      }
      if (xs.length >= 10) {
        result.push({ date: sorted[i].date, r: Math.round(pearson(xs, ys) * 100) / 100 })
      }
    }
    return result
  }, [metrics, sleepByDate])

  const hasData = correlations.length > 0

  if (!hasData) {
    return <div className="text-zinc-500 text-center py-20">Not enough overlapping data to compute correlations.</div>
  }

  return (
    <div className="space-y-6">
      {/* Correlation coefficients */}
      <div>
        <h2 className="text-sm font-medium text-zinc-300 mb-3">Correlation Strength</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {correlations.map(c => <CorrelationBadge key={c.label} result={c} />)}
        </div>
      </div>

      {/* Scatter plots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {sleepHrvData.length >= 10 && (
          <ChartCard title="Sleep → Next-day HRV" description="Sleep hours vs next morning's HRV">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="sleep" name="Sleep" unit="h" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="hrv" name="HRV" unit=" ms" tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Sleep' ? `${v}h` : `${v} ms`, name]} />
              <Scatter data={sleepHrvData} fill="#8b5cf6" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        )}

        {sleepHrData.length >= 10 && (
          <ChartCard title="Sleep → Next-day Resting HR" description="Sleep hours vs next day's resting heart rate">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="sleep" name="Sleep" unit="h" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="hr" name="Resting HR" unit=" bpm" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Sleep' ? `${v}h` : `${v} bpm`, name]} />
              <Scatter data={sleepHrData} fill="#ef4444" opacity={0.4} />
            </ScatterChart>
          </ChartCard>
        )}

        {exerciseHrData.length >= 10 && (
          <ChartCard title="Exercise → Resting HR" description="Weekly avg exercise vs resting HR">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="exercise" name="Exercise" unit=" min" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="hr" name="Resting HR" unit=" bpm" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[25, 50]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Exercise' ? `${v} min` : `${v} bpm`, name]} />
              <Scatter data={exerciseHrData} fill="#22c55e" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        )}

        {exerciseHrvData.length >= 10 && (
          <ChartCard title="Exercise → Next-day HRV" description="Exercise minutes vs next day's HRV">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="exercise" name="Exercise" unit=" min" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="hrv" name="HRV" unit=" ms" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Exercise' ? `${v} min` : `${v} ms`, name]} />
              <Scatter data={exerciseHrvData} fill="#a855f7" opacity={0.4} />
            </ScatterChart>
          </ChartCard>
        )}

        {exerciseSleepData.length >= 10 && (
          <ChartCard title="Exercise → Sleep" description="Exercise minutes vs sleep duration that night">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="exercise" name="Exercise" unit=" min" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="sleep" name="Sleep" unit="h" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Exercise' ? `${v} min` : `${v}h`, name]} />
              <Scatter data={exerciseSleepData} fill="#06b6d4" opacity={0.4} />
            </ScatterChart>
          </ChartCard>
        )}

        {stepsSleepData.length >= 10 && (
          <ChartCard title="Steps → Sleep" description="Daily steps vs sleep that night">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="steps" name="Steps" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="sleep" name="Sleep" unit="h" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Steps' ? `${v}` : `${v}h`, name]} />
              <Scatter data={stepsSleepData} fill="#3b82f6" opacity={0.4} />
            </ScatterChart>
          </ChartCard>
        )}

        {stepsHrData.length >= 10 && (
          <ChartCard title="Steps → Resting HR" description="Weekly avg steps vs resting HR">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="steps" name="Steps" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="hr" name="Resting HR" unit=" bpm" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[25, 50]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Steps' ? `${v}` : `${v} bpm`, name]} />
              <Scatter data={stepsHrData} fill="#f97316" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        )}

        {daylightSleepData.length >= 10 && (
          <ChartCard title="Daylight → Sleep" description="Daylight minutes vs sleep that night">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="daylight" name="Daylight" unit=" min" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="sleep" name="Sleep" unit="h" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Daylight' ? `${v} min` : `${v}h`, name]} />
              <Scatter data={daylightSleepData} fill="#facc15" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        )}

        {daylightHrvData.length >= 10 && (
          <ChartCard title="Daylight → HRV" description="Daylight minutes vs next day's HRV">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="daylight" name="Daylight" unit=" min" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="hrv" name="HRV" unit=" ms" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Daylight' ? `${v} min` : `${v} ms`, name]} />
              <Scatter data={daylightHrvData} fill="#facc15" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        )}

        {sleepDisturbanceData.length >= 10 && (
          <ChartCard title="Sleep → Breathing Disturbances" description="Sleep hours vs breathing events/hr">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="sleep" name="Sleep" unit="h" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="disturbances" name="Disturbances" unit="/hr" domain={[0, 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[20, 40]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'Sleep' ? `${v}h` : `${v}/hr`, name]} />
              <Scatter data={sleepDisturbanceData} fill="#ef4444" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        )}

        {vo2HrData.length >= 10 && (
          <ChartCard title="VO2 Max → Resting HR" description="Fitness level vs resting heart rate">
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="vo2" name="VO2 Max" unit=" mL/kg/min" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="hr" name="Resting HR" unit=" bpm" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
              <ZAxis range={[25, 50]} />
              <Tooltip {...tooltipStyle} formatter={(v, name) => [name === 'VO2 Max' ? `${v} mL/kg/min` : `${v} bpm`, name]} />
              <Scatter data={vo2HrData} fill="#22c55e" opacity={0.5} />
            </ScatterChart>
          </ChartCard>
        )}
      </div>

      {/* Rolling correlation over time */}
      {rollingCorr.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-1">Sleep-HRV Correlation Over Time</h3>
          <p className="text-xs text-zinc-500 mb-3">30-day rolling Pearson r — shows how the sleep/HRV relationship evolves</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }} data={rollingCorr}>
                <defs>
                  <linearGradient id="rollingCorrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDateCompact} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip {...tooltipStyle} formatter={(v) => [`r = ${v}`, 'Correlation']} />
                <Area type="monotone" dataKey="r" stroke="#8b5cf6" fill="url(#rollingCorrGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
