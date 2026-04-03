import { useMemo, useState } from 'react'
import type { HealthData, DailyMetrics } from './types'
import { TabHeader } from './ui'
import {
  Heart, Moon, Footprints, Scale, Activity, Wind, ThermometerSun,
} from 'lucide-react'
import type { ReactNode } from 'react'

interface Anomaly {
  date: string
  metric: string
  value: number
  unit: string
  direction: 'high' | 'low'
  severity: 'warning' | 'alert'
  deviation: number
  baseline: number
  icon: ReactNode
  message: string
  context: ContextItem[] // what else happened that day
}

interface ContextItem {
  label: string
  value: string
  note?: string // "above normal", "below normal", etc.
  noteColor?: string
}

function nextDay(date: string): string {
  const d = new Date(date)
  d.setDate(d.getDate() + 1)
  return d.toISOString().substring(0, 10)
}

function prevDay(date: string): string {
  const d = new Date(date)
  d.setDate(d.getDate() - 1)
  return d.toISOString().substring(0, 10)
}

function buildContext(date: string, metric: string, data: HealthData): ContextItem[] {
  const ctx: ContextItem[] = []
  const dm = data.dailyMetrics.get(date)
  const dmPrev = data.dailyMetrics.get(prevDay(date))
  const dmNext = data.dailyMetrics.get(nextDay(date))

  // === 1. Detail about the anomaly metric itself ===
  if (metric === 'Sleep') {
    // Show sleep breakdown: bedtime, stages, what happened the night before
    const sleepRecs = data.sleepRecords.filter(r => r.date === date && r.stage !== 'inbed' && r.stage !== 'awake')
    const hasStages = sleepRecs.some(r => r.stage === 'core' || r.stage === 'deep' || r.stage === 'rem')
    if (hasStages) {
      const deep = sleepRecs.filter(r => r.stage === 'deep').reduce((s, r) => s + r.minutes, 0)
      const rem = sleepRecs.filter(r => r.stage === 'rem').reduce((s, r) => s + r.minutes, 0)
      ctx.push({ label: 'Deep', value: `${Math.round(deep)}min` })
      ctx.push({ label: 'REM', value: `${Math.round(rem)}min` })
    }
    // Find bedtime from earliest record
    const allRecs = data.sleepRecords.filter(r => r.date === date).sort((a, b) => a.startDate.localeCompare(b.startDate))
    if (allRecs.length > 0) {
      const bedMatch = allRecs[0].startDate.match(/(\d{2}:\d{2})/)
      if (bedMatch) ctx.push({ label: 'Bedtime', value: bedMatch[1] })
      const wakeMatch = allRecs[allRecs.length - 1].endDate.match(/(\d{2}:\d{2})/)
      if (wakeMatch) ctx.push({ label: 'Wake', value: wakeMatch[1] })
    }
  }

  if (metric === 'Resting HR' && dm?.restingHeartRate) {
    // Show what might have caused elevated HR
    if (dm.sleepHours && dm.sleepHours > 0)
      ctx.push({ label: 'Sleep night before', value: `${dm.sleepHours.toFixed(1)}h`, note: dm.sleepHours < 6 ? 'short' : undefined, noteColor: dm.sleepHours < 6 ? '#f97316' : undefined })
    if (dm.hrv && dm.hrv > 0)
      ctx.push({ label: 'HRV', value: `${Math.round(dm.hrv)} ms` })
  }

  if (metric === 'HRV' && dm?.hrv) {
    if (dm.sleepHours && dm.sleepHours > 0)
      ctx.push({ label: 'Sleep', value: `${dm.sleepHours.toFixed(1)}h`, note: dm.sleepHours < 6 ? 'short' : undefined, noteColor: dm.sleepHours < 6 ? '#f97316' : undefined })
    if (dm.restingHeartRate && dm.restingHeartRate > 0)
      ctx.push({ label: 'Resting HR', value: `${Math.round(dm.restingHeartRate)} bpm` })
  }

  // === 2. Possible causes: what happened the day before / that day ===
  // Workouts (same day or day before)
  const workoutsToday = data.workouts.filter(w => w.date === date)
  const workoutsYesterday = data.workouts.filter(w => w.date === prevDay(date))
  if (workoutsToday.length > 0) {
    const w = workoutsToday[0]
    ctx.push({ label: 'Workout', value: `${w.type} ${w.duration}min${w.hrAvg ? ` (${w.hrAvg}bpm avg)` : ''}` })
  } else if (workoutsYesterday.length > 0 && (metric === 'Sleep' || metric === 'Resting HR' || metric === 'HRV')) {
    const w = workoutsYesterday[0]
    ctx.push({ label: 'Workout day before', value: `${w.type} ${w.duration}min` })
  }

  // Previous day's sleep (for activity/HR anomalies)
  if (metric !== 'Sleep' && dmPrev?.sleepHours && dmPrev.sleepHours > 0) {
    if (dmPrev.sleepHours < 6) {
      ctx.push({ label: 'Sleep night before', value: `${dmPrev.sleepHours.toFixed(1)}h`, note: 'short', noteColor: '#f97316' })
    }
  }

  // === 3. Impact: what happened after ===
  if (dmNext) {
    if (metric === 'Sleep') {
      if (dmNext.restingHeartRate && dmNext.restingHeartRate > 0)
        ctx.push({ label: 'Next-day HR', value: `${Math.round(dmNext.restingHeartRate)} bpm` })
      if (dmNext.hrv && dmNext.hrv > 0)
        ctx.push({ label: 'Next-day HRV', value: `${Math.round(dmNext.hrv)} ms` })
      if (dmNext.steps > 0)
        ctx.push({ label: 'Next-day steps', value: `${dmNext.steps.toLocaleString()}` })
    }
    if (metric === 'Resting HR' || metric === 'HRV') {
      if (dmNext.sleepHours && dmNext.sleepHours > 0)
        ctx.push({ label: 'Sleep that night', value: `${dmNext.sleepHours.toFixed(1)}h` })
    }
  }

  // === 4. Breathing context for sleep anomalies ===
  if (metric === 'Sleep' || metric === 'Resting HR') {
    const br = data.dailyBreathing.find(b => b.date === date)
    if (br && br.disturbances !== null && br.disturbances > 5)
      ctx.push({ label: 'Breathing disturbances', value: `${br.disturbances.toFixed(1)}/hr`, note: 'elevated', noteColor: '#f97316' })
  }

  return ctx.slice(0, 8)
}

function stdDev(arr: number[]): { mean: number; std: number } {
  const n = arr.length
  if (n < 5) return { mean: 0, std: 0 }
  const mean = arr.reduce((a, b) => a + b, 0) / n
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
  return { mean, std: Math.sqrt(variance) }
}

interface MetricConfig {
  key: keyof DailyMetrics
  label: string
  unit: string
  icon: ReactNode
  lowerIsBetter?: boolean // for HR, breathing disturbances
  minDataPoints?: number
}

const METRIC_CONFIGS: MetricConfig[] = [
  { key: 'restingHeartRate', label: 'Resting HR', unit: 'bpm', icon: <Heart size={14} />, lowerIsBetter: true },
  { key: 'hrv', label: 'HRV', unit: 'ms', icon: <Activity size={14} /> },
  { key: 'sleepHours', label: 'Sleep', unit: 'hrs', icon: <Moon size={14} /> },
  { key: 'steps', label: 'Steps', unit: 'steps', icon: <Footprints size={14} /> },
  { key: 'activeEnergy', label: 'Active Energy', unit: 'kcal', icon: <ThermometerSun size={14} /> },
  { key: 'distance', label: 'Distance', unit: 'km', icon: <Footprints size={14} /> },
  { key: 'exerciseMinutes', label: 'Exercise', unit: 'min', icon: <Activity size={14} /> },
]

function detectAnomalies(
  metrics: DailyMetrics[],
  data: HealthData,
  windowDays = 30,
  warningThreshold = 2,
  alertThreshold = 3,
): Anomaly[] {
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date))
  const anomalies: Anomaly[] = []

  // DailyMetrics anomalies
  for (const config of METRIC_CONFIGS) {
    for (let i = windowDays; i < sorted.length; i++) {
      const current = sorted[i][config.key] as number | null
      if (current === null || current <= 0) continue

      // Build rolling window
      const window: number[] = []
      for (let j = i - windowDays; j < i; j++) {
        const v = sorted[j][config.key] as number | null
        if (v !== null && v > 0) window.push(v)
      }

      if (window.length < 10) continue

      const { mean, std } = stdDev(window)
      if (std === 0) continue

      const dev = (current - mean) / std
      const absDev = Math.abs(dev)

      if (absDev >= warningThreshold) {
        const direction = dev > 0 ? 'high' as const : 'low' as const
        const isGood = config.lowerIsBetter ? direction === 'low' : direction === 'high'

        // Skip "good" anomalies (e.g. unusually high steps is good, not an anomaly to flag)
        // Only flag concerning direction
        if (isGood && config.key !== 'restingHeartRate') continue
        // For HR: flag high (bad), for others: flag low (bad)
        // Actually, flag both directions for sleep (too little AND too much)
        // For steps/exercise/energy: only flag unusually low
        if (!config.lowerIsBetter && direction === 'high' && config.key !== 'sleepHours') continue

        const severity = absDev >= alertThreshold ? 'alert' as const : 'warning' as const
        const roundedVal = config.key === 'sleepHours' || config.key === 'distance'
          ? Math.round(current * 10) / 10
          : Math.round(current)

        let message: string
        if (direction === 'high' && config.lowerIsBetter) {
          message = `${config.label} spiked to ${roundedVal} ${config.unit} (normally ~${Math.round(mean)})`
        } else if (direction === 'low' && !config.lowerIsBetter) {
          message = `${config.label} dropped to ${roundedVal} ${config.unit} (normally ~${Math.round(mean)})`
        } else if (direction === 'high') {
          message = `${config.label} unusually high at ${roundedVal} ${config.unit} (normally ~${Math.round(mean)})`
        } else {
          message = `${config.label} unusually low at ${roundedVal} ${config.unit} (normally ~${Math.round(mean)})`
        }

        anomalies.push({
          date: sorted[i].date,
          metric: config.label,
          value: roundedVal,
          unit: config.unit,
          direction,
          severity,
          deviation: Math.round(absDev * 10) / 10,
          baseline: Math.round(mean * 10) / 10,
          icon: config.icon,
          message,
          context: buildContext(sorted[i].date, config.label, data),
        })
      }
    }
  }

  // Breathing anomalies
  const breathingSorted = [...data.dailyBreathing]
    .filter(d => d.disturbances !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  for (let i = windowDays; i < breathingSorted.length; i++) {
    const current = breathingSorted[i].disturbances!
    const window = breathingSorted.slice(i - windowDays, i)
      .filter(d => d.disturbances !== null)
      .map(d => d.disturbances!)
    if (window.length < 10) continue

    const { mean, std } = stdDev(window)
    if (std === 0) continue
    const dev = (current - mean) / std
    if (dev >= warningThreshold) {
      anomalies.push({
        date: breathingSorted[i].date,
        metric: 'Breathing Disturbances',
        value: Math.round(current * 10) / 10,
        unit: '/hr',
        direction: 'high',
        severity: dev >= alertThreshold ? 'alert' : 'warning',
        deviation: Math.round(dev * 10) / 10,
        baseline: Math.round(mean * 10) / 10,
        icon: <Wind size={14} />,
        message: `Breathing disturbances spiked to ${Math.round(current * 10) / 10}/hr (normally ~${Math.round(mean * 10) / 10})`,
        context: buildContext(breathingSorted[i].date, 'Breathing Disturbances', data),
      })
    }
  }

  // SpO2 anomalies (low is bad)
  const spo2Sorted = [...data.dailyBreathing]
    .filter(d => d.spo2 !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  for (let i = windowDays; i < spo2Sorted.length; i++) {
    const current = spo2Sorted[i].spo2!
    const window = spo2Sorted.slice(i - windowDays, i)
      .filter(d => d.spo2 !== null)
      .map(d => d.spo2!)
    if (window.length < 10) continue

    const { mean, std } = stdDev(window)
    if (std === 0) continue
    const dev = (current - mean) / std
    if (dev <= -warningThreshold) {
      anomalies.push({
        date: spo2Sorted[i].date,
        metric: 'Blood Oxygen',
        value: Math.round(current * 10) / 10,
        unit: '%',
        direction: 'low',
        severity: Math.abs(dev) >= alertThreshold ? 'alert' : 'warning',
        deviation: Math.round(Math.abs(dev) * 10) / 10,
        baseline: Math.round(mean * 10) / 10,
        icon: <Wind size={14} />,
        message: `SpO2 dropped to ${Math.round(current * 10) / 10}% (normally ~${Math.round(mean * 10) / 10}%)`,
        context: buildContext(spo2Sorted[i].date, 'Blood Oxygen', data),
      })
    }
  }

  // Weight anomalies (sudden jumps)
  const weightSorted = [...data.bodyRecords]
    .filter(r => r.weight !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  for (let i = 5; i < weightSorted.length; i++) {
    const current = weightSorted[i].weight!
    const window = weightSorted.slice(Math.max(0, i - 10), i)
      .filter(r => r.weight !== null)
      .map(r => r.weight!)
    if (window.length < 3) continue

    const { mean, std } = stdDev(window)
    if (std === 0) continue
    const dev = (current - mean) / std
    if (Math.abs(dev) >= warningThreshold) {
      anomalies.push({
        date: weightSorted[i].date,
        metric: 'Weight',
        value: Math.round(current * 10) / 10,
        unit: 'kg',
        direction: dev > 0 ? 'high' : 'low',
        severity: Math.abs(dev) >= alertThreshold ? 'alert' : 'warning',
        deviation: Math.round(Math.abs(dev) * 10) / 10,
        baseline: Math.round(mean * 10) / 10,
        icon: <Scale size={14} />,
        message: `Weight ${dev > 0 ? 'jumped to' : 'dropped to'} ${Math.round(current * 10) / 10} kg (normally ~${Math.round(mean * 10) / 10})`,
        context: buildContext(weightSorted[i].date, 'Weight', data),
      })
    }
  }

  // Sort by date descending (most recent first)
  return anomalies.sort((a, b) => b.date.localeCompare(a.date))
}

interface Props {
  data: HealthData
  metrics: DailyMetrics[]
}

export default function AnomalyDetection({ data, metrics }: Props) {
  const anomalies = useMemo(() => detectAnomalies(metrics, data), [metrics, data])
  const [metricFilter, setMetricFilter] = useState<string | null>(null)

  const filtered = metricFilter ? anomalies.filter(a => a.metric === metricFilter) : anomalies
  const alerts = filtered.filter(a => a.severity === 'alert')
  const warnings = filtered.filter(a => a.severity === 'warning')

  // Group by month for timeline view
  const byMonth = useMemo(() => {
    const map = new Map<string, Anomaly[]>()
    for (const a of filtered) {
      const month = a.date.substring(0, 7)
      const arr = map.get(month) || []
      arr.push(a)
      map.set(month, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  // Most affected metrics (always from full set for the chips)
  const metricCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of anomalies) map.set(a.metric, (map.get(a.metric) || 0) + 1)
    return Array.from(map.entries()).sort(([, a], [, b]) => b - a)
  }, [anomalies])

  if (anomalies.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">&#10003;</div>
        <div className="text-zinc-300 text-lg font-medium">No anomalies detected</div>
        <div className="text-zinc-500 text-sm mt-1">All metrics are within normal ranges</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Anomalies" description="Unusual readings and outliers detected across your health data." />
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-500 text-xs mb-1">Total Anomalies</div>
          <div className="text-2xl font-semibold">{anomalies.length}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-red-900/30">
          <div className="text-zinc-500 text-xs mb-1">Alerts (3+ std dev)</div>
          <div className="text-2xl font-semibold text-red-400">{alerts.length}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-orange-900/30">
          <div className="text-zinc-500 text-xs mb-1">Warnings (2+ std dev)</div>
          <div className="text-2xl font-semibold text-orange-400">{warnings.length}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-zinc-500 text-xs mb-1">Metrics Affected</div>
          <div className="text-2xl font-semibold">{metricCounts.length}</div>
        </div>
      </div>

      {/* Filter by metric */}
      {metricCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMetricFilter(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-colors ${
              metricFilter === null ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All <span className="text-zinc-500">{anomalies.length}</span>
          </button>
          {metricCounts.map(([metric, count]) => (
            <button
              key={metric}
              onClick={() => setMetricFilter(metricFilter === metric ? null : metric)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-colors ${
                metricFilter === metric ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>{metric}</span>
              <span className="text-zinc-500">{count}x</span>
            </button>
          ))}
        </div>
      )}

      {/* Timeline */}
      {byMonth.map(([month, monthAnomalies]) => (
        <div key={month}>
          <h3 className="text-sm font-medium text-zinc-400 mb-2">
            {new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            <span className="text-zinc-600 ml-2">{monthAnomalies.length} events</span>
          </h3>
          <div className="space-y-1.5">
            {monthAnomalies.map((a, i) => (
              <div
                key={`${a.date}-${a.metric}-${i}`}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border border-zinc-800/50 bg-zinc-900/50 relative overflow-hidden`}
              >
                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${a.severity === 'alert' ? 'bg-red-500' : 'bg-orange-500'}`} />
                <div className={`shrink-0 ${a.severity === 'alert' ? 'text-red-400' : 'text-orange-400'}`}>
                  {a.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200">{a.message}</div>
                  {a.context.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {a.context.map((c, ci) => (
                        <span key={ci} className="text-[11px] text-zinc-500">
                          {c.label}: <span className="text-zinc-400">{c.value}</span>
                          {c.note && <span className="ml-1" style={{ color: c.noteColor || '#52525b' }}>{c.note}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm text-zinc-300">{a.date}</div>
                  <div className={`text-[10px] font-mono ${a.severity === 'alert' ? 'text-red-400/70' : 'text-zinc-500'}`}>
                    {a.deviation}σ from baseline
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-zinc-600 text-center">
        Anomalies detected using rolling 30-day baselines. Warnings at 2+ standard deviations, alerts at 3+.
      </p>
    </div>
  )
}
