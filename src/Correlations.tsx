import { useMemo } from 'react'
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  CartesianGrid, ZAxis, AreaChart, Area,
} from 'recharts'
import type { DailyMetrics, SleepRecord, CaffeineRecord, DailyBreathing, CardioRecord } from './types'
import { AISummaryButton, ChartTooltip, shortDateCompact, TabHeader, useChartTheme } from './ui'

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


interface ChartConfig {
  data: unknown[]
  xKey: string
  yKey: string
  xName: string
  yName: string
  xUnit: string
  yUnit: string
  color: string
  xDomain?: [string | number, string | number]
  yDomain?: [string | number, string | number]
  zRange?: [number, number]
}

function humanInterpretation(result: CorrelationResult): string {
  const strength = Math.abs(result.r)
  const [cause, effect] = result.label.split(' → ')
  if (strength > 0.5) return `In your data, more ${cause.toLowerCase()} is strongly linked to ${result.r > 0 ? 'higher' : 'lower'} ${effect.toLowerCase()}.`
  if (strength > 0.3) return `There's a moderate pattern: more ${cause.toLowerCase()} tends to come with ${result.r > 0 ? 'higher' : 'lower'} ${effect.toLowerCase()}.`
  if (strength > 0.15) return `There's a slight trend between ${cause.toLowerCase()} and ${effect.toLowerCase()}, but it's not very consistent.`
  return `No meaningful pattern found between ${cause.toLowerCase()} and ${effect.toLowerCase()} in your data.`
}

function CorrelationCard({ result, chart }: { result: CorrelationResult; chart?: ChartConfig }) {
  const ct = useChartTheme()
  const strength = Math.abs(result.r)
  const barColor = strength > 0.5 ? (result.r > 0 ? '#22c55e' : '#ef4444') :
    strength > 0.3 ? (result.r > 0 ? '#4ade80' : '#f87171') :
    strength > 0.15 ? '#a1a1aa' : '#52525b'
  const strengthLabel = strength > 0.5 ? 'Strong link' : strength > 0.3 ? 'Moderate link' : strength > 0.15 ? 'Weak link' : 'No link'
  const strengthColor = strength > 0.5 ? 'text-green-400' : strength > 0.3 ? 'text-blue-400' : 'text-zinc-500'

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-200">{result.label}</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 shrink-0 ${strengthColor}`}>{strengthLabel}</span>
          </div>
          {/* Strength bar */}
          <div className="flex items-center gap-2.5">
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(strength * 100 / 0.7, 100)}%`, backgroundColor: barColor }}
              />
            </div>
            <span className="text-[10px] font-mono text-zinc-600 shrink-0 tabular-nums w-10 text-right">{result.r > 0 ? '+' : ''}{result.r.toFixed(2)}</span>
          </div>
        </div>
        {chart && chart.data.length > 0 && (
          <div className="ml-2 shrink-0">
            <AISummaryButton title={result.label} description={result.description} chartData={chart.data} />
          </div>
        )}
      </div>

      {/* Human explanation */}
      <p className="text-xs text-zinc-400 leading-relaxed">{humanInterpretation(result)}</p>

      {/* Embedded scatter chart */}
      {chart && chart.data.length >= 10 && (
        <div className="h-44 -mx-1">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
            <ScatterChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
              <XAxis dataKey={chart.xKey} name={chart.xName} unit={chart.xUnit} tick={{ fontSize: 10, fill: ct.tick }} />
              <YAxis dataKey={chart.yKey} name={chart.yName} unit={chart.yUnit} domain={chart.yDomain || ['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
              <ZAxis range={chart.zRange || [20, 40]} />
              <Tooltip content={<ChartTooltip />} />
              <Scatter data={chart.data as Record<string, unknown>[]} fill={chart.color} opacity={0.5} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="text-[10px] text-zinc-600">{result.n.toLocaleString()} data points</div>
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

  const ct = useChartTheme()

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

  // Build chart configs keyed by label
  const chartConfigs = useMemo(() => {
    const configs: Record<string, ChartConfig> = {}
    if (sleepHrvData.length >= 10) configs['Sleep → Next-day HRV'] = { data: sleepHrvData, xKey: 'sleep', yKey: 'hrv', xName: 'Sleep', yName: 'HRV', xUnit: 'h', yUnit: ' ms', color: '#8b5cf6' }
    if (sleepHrData.length >= 10) configs['Sleep → Next-day Resting HR'] = { data: sleepHrData, xKey: 'sleep', yKey: 'hr', xName: 'Sleep', yName: 'Resting HR', xUnit: 'h', yUnit: ' bpm', color: '#ef4444' }
    if (exerciseHrData.length >= 10) configs['Weekly Exercise → Resting HR'] = { data: exerciseHrData, xKey: 'exercise', yKey: 'hr', xName: 'Exercise', yName: 'Resting HR', xUnit: ' min', yUnit: ' bpm', color: '#22c55e', zRange: [25, 50] }
    if (exerciseHrvData.length >= 10) configs['Exercise → Next-day HRV'] = { data: exerciseHrvData, xKey: 'exercise', yKey: 'hrv', xName: 'Exercise', yName: 'HRV', xUnit: ' min', yUnit: ' ms', color: '#a855f7' }
    if (exerciseSleepData.length >= 10) configs['Exercise → Sleep Duration'] = { data: exerciseSleepData, xKey: 'exercise', yKey: 'sleep', xName: 'Exercise', yName: 'Sleep', xUnit: ' min', yUnit: 'h', color: '#06b6d4' }
    if (stepsSleepData.length >= 10) configs['Steps → Sleep Duration'] = { data: stepsSleepData, xKey: 'steps', yKey: 'sleep', xName: 'Steps', yName: 'Sleep', xUnit: '', yUnit: 'h', color: '#3b82f6' }
    if (stepsHrData.length >= 10) configs['Weekly Steps → Resting HR'] = { data: stepsHrData, xKey: 'steps', yKey: 'hr', xName: 'Steps', yName: 'Resting HR', xUnit: '', yUnit: ' bpm', color: '#f97316', zRange: [25, 50] }
    if (daylightSleepData.length >= 10) configs['Daylight → Sleep Duration'] = { data: daylightSleepData, xKey: 'daylight', yKey: 'sleep', xName: 'Daylight', yName: 'Sleep', xUnit: ' min', yUnit: 'h', color: '#facc15' }
    if (daylightHrvData.length >= 10) configs['Daylight → Next-day HRV'] = { data: daylightHrvData, xKey: 'daylight', yKey: 'hrv', xName: 'Daylight', yName: 'HRV', xUnit: ' min', yUnit: ' ms', color: '#facc15' }
    if (sleepDisturbanceData.length >= 10) configs['Sleep Duration → Breathing Disturbances'] = { data: sleepDisturbanceData, xKey: 'sleep', yKey: 'disturbances', xName: 'Sleep', yName: 'Disturbances', xUnit: 'h', yUnit: '/hr', color: '#ef4444', yDomain: [0, 'auto'] }
    if (vo2HrData.length >= 10) configs['VO2 Max → Resting HR'] = { data: vo2HrData, xKey: 'vo2', yKey: 'hr', xName: 'VO2 Max', yName: 'Resting HR', xUnit: ' mL/kg/min', yUnit: ' bpm', color: '#22c55e', zRange: [25, 50] }
    return configs
  }, [sleepHrvData, sleepHrData, exerciseHrData, exerciseHrvData, exerciseSleepData, stepsSleepData, stepsHrData, daylightSleepData, daylightHrvData, sleepDisturbanceData, vo2HrData])

  // Separate meaningful from weak
  const meaningful = correlations.filter(c => Math.abs(c.r) > 0.15)
  const weak = correlations.filter(c => Math.abs(c.r) <= 0.15)

  return (
    <div className="space-y-6">
      <TabHeader title="Correlations" description="Discover how your health metrics relate to each other — which habits actually move the needle." />
      {/* Explainer */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-1.5">How your habits connect</h2>
        <p className="text-xs text-zinc-500 leading-relaxed">
          This page looks at pairs of health metrics to find patterns — for example, whether sleeping more is linked to a better heart rate the next day. A <strong className="text-zinc-300">strong link</strong> means the pattern is very consistent, while a <strong className="text-zinc-300">weak link</strong> means it barely shows up. Each dot in the charts is one data point from your history. A link doesn't prove one thing <em>causes</em> the other — it just means they tend to move together.
        </p>
      </div>

      {/* Meaningful correlations — each card has its chart embedded */}
      {meaningful.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-zinc-300 mb-3">Patterns found in your data</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {meaningful.map(c => <CorrelationCard key={c.label} result={c} chart={chartConfigs[c.label]} />)}
          </div>
        </div>
      )}

      {/* Weak / no link — compact, no chart */}
      {weak.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-zinc-500 mb-3">No clear pattern</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {weak.map(c => <CorrelationCard key={c.label} result={c} />)}
          </div>
        </div>
      )}

      {/* Rolling correlation over time */}
      {rollingCorr.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">How consistent is the sleep-HRV link?</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Tracks whether sleeping more reliably improves your HRV over 30-day windows. Higher = stronger link, near zero = no pattern.</p>
            </div>
            <AISummaryButton title="Sleep-HRV link over time" description="How consistently sleep predicts HRV in 30-day windows" chartData={rollingCorr} />
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={{ top: 5, right: 5, bottom: 0, left: -15 }} data={rollingCorr}>
                <defs>
                  <linearGradient id="rollingCorrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(v) => [`r = ${v}`, 'Correlation']} />} />
                <Area type="monotone" dataKey="r" stroke="#8b5cf6" fill="url(#rollingCorrGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
