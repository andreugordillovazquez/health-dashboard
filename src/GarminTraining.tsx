import { useMemo } from 'react'
import {
  XAxis, YAxis, Tooltip, CartesianGrid,
  Area, AreaChart, Line, LineChart, Bar, BarChart, ComposedChart,
  ReferenceLine,
} from 'recharts'
import type { GarminMetrics } from './types'
import {
  COLORS, chartMargin, ChartCard, StatBox, SectionHeader, TabHeader,
  shortDateCompact, tooltipStyle,
} from './ui'

const READINESS_COLORS: Record<string, string> = {
  PRIME: COLORS.green,
  HIGH: '#4ade80',
  MODERATE: COLORS.orange,
  LOW: COLORS.red,
  POOR: '#dc2626',
}

function formatRaceTime(seconds: number): string {
  if (!seconds) return '--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function GarminTraining({
  garminMetrics: g,
  granularity,
  dateRange,
}: {
  garminMetrics: GarminMetrics
  granularity: 'daily' | 'weekly' | 'monthly'
  dateRange: [string, string]
}) {
  const [startDate, endDate] = dateRange

  const filterByRange = <T extends { date: string }>(arr: T[]) =>
    arr.filter(d => d.date >= startDate && d.date <= endDate)

  const readiness = useMemo(() => filterByRange(g.trainingReadiness), [g.trainingReadiness, startDate, endDate])
  const vo2max = useMemo(() => filterByRange(g.vo2max), [g.vo2max, startDate, endDate])
  const endurance = useMemo(() => filterByRange(g.enduranceScore), [g.enduranceScore, startDate, endDate])
  const hill = useMemo(() => filterByRange(g.hillScore), [g.hillScore, startDate, endDate])
  const atl = useMemo(() => filterByRange(g.acuteTrainingLoad), [g.acuteTrainingLoad, startDate, endDate])
  const race = useMemo(() => filterByRange(g.racePredictions), [g.racePredictions, startDate, endDate])
  const heat = useMemo(() => filterByRange(g.heatAltitude), [g.heatAltitude, startDate, endDate])
  const fitness = useMemo(() => filterByRange(g.fitnessAge), [g.fitnessAge, startDate, endDate])
  const stress = useMemo(() => filterByRange(g.stressDaily), [g.stressDaily, startDate, endDate])
  const hydration = useMemo(() => filterByRange(g.hydration), [g.hydration, startDate, endDate])
  const sleepScores = useMemo(() => filterByRange(g.sleepScores), [g.sleepScores, startDate, endDate])

  const latestReadiness = readiness[readiness.length - 1]
  const latestVO2 = vo2max[vo2max.length - 1]
  const latestEndurance = endurance[endurance.length - 1]
  const latestHill = hill[hill.length - 1]
  const latestATL = atl[atl.length - 1]
  const latestRace = race[race.length - 1]
  const latestFitness = fitness[fitness.length - 1]

  const groupData = <T extends { date: string }>(data: T[], valueKey: keyof T): T[] => {
    if (granularity === 'daily') return data
    const grouped = new Map<string, { items: T[]; sum: number; count: number }>()
    for (const item of data) {
      const key = granularity === 'monthly' ? item.date.slice(0, 7) : (() => {
        const d = new Date(item.date)
        d.setDate(d.getDate() - d.getDay())
        return d.toISOString().slice(0, 10)
      })()
      const existing = grouped.get(key) || { items: [], sum: 0, count: 0 }
      existing.items.push(item)
      existing.sum += (item[valueKey] as number) || 0
      existing.count++
      grouped.set(key, existing)
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { items, sum, count }]) => ({ ...items[0], date, [valueKey]: Math.round(sum / count) } as T))
  }

  const readinessGrouped = useMemo(() => groupData(readiness, 'score'), [readiness, granularity])
  const stressGrouped = useMemo(() => groupData(stress, 'avgStress'), [stress, granularity])

  return (
    <div className="space-y-6">
      <TabHeader title="Garmin Training" description="Training metrics, readiness, and performance scores from your Garmin device" />

      {/* Key Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {latestReadiness && (
          <StatBox
            label="Training Readiness"
            value={String(latestReadiness.score)}
            sub={latestReadiness.level.replace(/_/g, ' ').toLowerCase()}
            color={READINESS_COLORS[latestReadiness.level] || COLORS.zinc}
          />
        )}
        {latestVO2 && (
          <StatBox label="VO2 Max" value={latestVO2.value.toFixed(1)} unit="ml/kg/min" sub={latestVO2.sport.toLowerCase()} color={COLORS.cyan} />
        )}
        {latestEndurance && (
          <StatBox label="Endurance Score" value={String(Math.round(latestEndurance.score / 100))} color={COLORS.blue} />
        )}
        {latestHill && (
          <StatBox label="Hill Score" value={String(latestHill.overall)} sub={`Str ${latestHill.strength} / End ${latestHill.endurance}`} color={COLORS.orange} />
        )}
        {latestATL && (
          <StatBox
            label="ACWR"
            value={latestATL.ratio.toFixed(2)}
            sub={latestATL.status.toLowerCase()}
            color={latestATL.status === 'OPTIMAL' ? COLORS.green : latestATL.status === 'HIGH' ? COLORS.red : COLORS.orange}
          />
        )}
        {latestRace && (
          <StatBox label="Predicted 5K" value={formatRaceTime(latestRace.time5k)} color={COLORS.purple} />
        )}
        {latestFitness && (
          <StatBox label="Fitness Age" value={String(Math.round(latestFitness.fitnessAge))} unit="yrs" sub={`Chrono: ${latestFitness.chronologicalAge}`} color={COLORS.green} />
        )}
        {stress.length > 0 && (
          <StatBox label="Avg Stress" value={String(Math.round(stress.reduce((s, d) => s + d.avgStress, 0) / stress.length))} color={COLORS.yellow} />
        )}
      </div>

      {/* Training Readiness */}
      {readiness.length > 0 && (
        <>
          <SectionHeader>Training Readiness</SectionHeader>
          <ChartCard title="Readiness Score">
            <AreaChart data={readinessGrouped} margin={chartMargin}>
              <defs>
                <linearGradient id="readinessGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.green} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} />
              <Area type="monotone" dataKey="score" stroke={COLORS.green} fill="url(#readinessGrad)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ChartCard>
        </>
      )}

      {/* VO2 Max */}
      {vo2max.length > 0 && (
        <>
          <SectionHeader>VO2 Max</SectionHeader>
          <ChartCard title="VO2 Max Progression">
            <LineChart data={vo2max} margin={chartMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" domain={['auto', 'auto']} />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="value" stroke={COLORS.cyan} strokeWidth={2} dot={{ r: 3, fill: COLORS.cyan }} name="VO2 Max" />
            </LineChart>
          </ChartCard>
        </>
      )}

      {/* Endurance & Hill Score */}
      {(endurance.length > 0 || hill.length > 0) && (
        <>
          <SectionHeader>Performance Scores</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {endurance.length > 0 && (
              <ChartCard title="Endurance Score">
                <LineChart data={endurance.map(e => ({ ...e, scoreDisplay: Math.round(e.score / 100) }))} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="scoreDisplay" stroke={COLORS.blue} strokeWidth={2} dot={false} name="Score" />
                </LineChart>
              </ChartCard>
            )}
            {hill.length > 0 && (
              <ChartCard title="Hill Score">
                <LineChart data={hill} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="overall" stroke={COLORS.orange} strokeWidth={2} dot={false} name="Overall" />
                  <Line type="monotone" dataKey="strength" stroke={COLORS.red} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Strength" />
                  <Line type="monotone" dataKey="endurance" stroke={COLORS.blue} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Endurance" />
                </LineChart>
              </ChartCard>
            )}
          </div>
        </>
      )}

      {/* Training Load (ACWR) */}
      {atl.length > 0 && (
        <>
          <SectionHeader>Training Load</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard title="Acute vs Chronic Load">
              <LineChart data={atl} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
                <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="acute" stroke={COLORS.red} strokeWidth={2} dot={false} name="Acute" />
                <Line type="monotone" dataKey="chronic" stroke={COLORS.blue} strokeWidth={2} dot={false} name="Chronic" />
              </LineChart>
            </ChartCard>
            <ChartCard title="ACWR Ratio">
              <ComposedChart data={atl} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
                <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" domain={[0, 'auto']} />
                <Tooltip {...tooltipStyle} />
                <ReferenceLine y={0.8} stroke={COLORS.green} strokeDasharray="3 3" label={{ value: '0.8', fill: '#71717a', fontSize: 10 }} />
                <ReferenceLine y={1.3} stroke={COLORS.red} strokeDasharray="3 3" label={{ value: '1.3', fill: '#71717a', fontSize: 10 }} />
                <Area type="monotone" dataKey="ratio" stroke={COLORS.purple} fill={COLORS.purple} fillOpacity={0.15} strokeWidth={2} dot={false} name="ACWR" />
              </ComposedChart>
            </ChartCard>
          </div>
        </>
      )}

      {/* Race Predictions */}
      {race.length > 0 && (
        <>
          <SectionHeader>Race Predictions</SectionHeader>
          <ChartCard title="Predicted Race Times" tall>
            <LineChart data={race} margin={chartMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis tickFormatter={(v: number) => formatRaceTime(v)} tick={{ fontSize: 10 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} formatter={(v) => [formatRaceTime(v as number), '']} />
              <Line type="monotone" dataKey="time5k" stroke={COLORS.green} strokeWidth={2} dot={false} name="5K" />
              <Line type="monotone" dataKey="time10k" stroke={COLORS.blue} strokeWidth={2} dot={false} name="10K" />
              <Line type="monotone" dataKey="timeHalf" stroke={COLORS.purple} strokeWidth={2} dot={false} name="Half" />
              <Line type="monotone" dataKey="timeMarathon" stroke={COLORS.orange} strokeWidth={2} dot={false} name="Marathon" />
            </LineChart>
          </ChartCard>
          {latestRace && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox label="5K" value={formatRaceTime(latestRace.time5k)} color={COLORS.green} />
              <StatBox label="10K" value={formatRaceTime(latestRace.time10k)} color={COLORS.blue} />
              <StatBox label="Half Marathon" value={formatRaceTime(latestRace.timeHalf)} color={COLORS.purple} />
              <StatBox label="Marathon" value={formatRaceTime(latestRace.timeMarathon)} color={COLORS.orange} />
            </div>
          )}
        </>
      )}

      {/* Stress */}
      {stress.length > 0 && (
        <>
          <SectionHeader>Stress</SectionHeader>
          <ChartCard title="Daily Average Stress">
            <AreaChart data={stressGrouped} margin={chartMargin}>
              <defs>
                <linearGradient id="stressGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.yellow} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.yellow} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} />
              <Area type="monotone" dataKey="avgStress" stroke={COLORS.yellow} fill="url(#stressGrad)" strokeWidth={1.5} dot={false} name="Avg Stress" />
            </AreaChart>
          </ChartCard>
        </>
      )}

      {/* Sleep Scores */}
      {sleepScores.length > 0 && (
        <>
          <SectionHeader>Sleep Scores</SectionHeader>
          <ChartCard title="Sleep Score Components" tall>
            <LineChart data={sleepScores} margin={chartMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="overall" stroke={COLORS.blue} strokeWidth={2} dot={false} name="Overall" />
              <Line type="monotone" dataKey="deep" stroke={COLORS.purple} strokeWidth={1.5} dot={false} name="Deep" />
              <Line type="monotone" dataKey="rem" stroke={COLORS.cyan} strokeWidth={1.5} dot={false} name="REM" />
              <Line type="monotone" dataKey="recovery" stroke={COLORS.green} strokeWidth={1.5} dot={false} name="Recovery" />
            </LineChart>
          </ChartCard>
        </>
      )}

      {/* Fitness Age */}
      {fitness.length > 0 && (
        <>
          <SectionHeader>Fitness Age</SectionHeader>
          <ChartCard title="Fitness Age vs Chronological Age">
            <LineChart data={fitness} margin={chartMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="fitnessAge" stroke={COLORS.green} strokeWidth={2} dot={false} name="Fitness Age" />
              <Line type="monotone" dataKey="chronologicalAge" stroke={COLORS.zinc} strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Chrono Age" />
            </LineChart>
          </ChartCard>
        </>
      )}

      {/* Heat & Altitude */}
      {heat.length > 0 && (
        <>
          <SectionHeader>Heat & Altitude Acclimatization</SectionHeader>
          <ChartCard title="Acclimatization">
            <LineChart data={heat} margin={chartMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} />
              <Line type="monotone" dataKey="heatPercent" stroke={COLORS.red} strokeWidth={2} dot={false} name="Heat %" />
              <Line type="monotone" dataKey="altitudeAcclimation" stroke={COLORS.blue} strokeWidth={2} dot={false} name="Altitude" />
            </LineChart>
          </ChartCard>
        </>
      )}

      {/* Hydration */}
      {hydration.length > 0 && (
        <>
          <SectionHeader>Hydration</SectionHeader>
          <ChartCard title="Sweat Loss During Activities">
            <BarChart data={hydration} margin={chartMargin}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={shortDateCompact} tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <YAxis tick={{ fontSize: 11 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${Math.round(v as number)} ml`, '']} />
              <Bar dataKey="sweatLossMl" fill={COLORS.cyan} opacity={0.8} name="Sweat Loss (ml)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartCard>
        </>
      )}
    </div>
  )
}
