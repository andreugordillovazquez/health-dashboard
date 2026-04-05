import { useMemo } from 'react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, BarChart, Bar,
  ScatterChart, Scatter, ZAxis, ReferenceLine, Cell,
} from 'recharts'
import type { MenstrualRecord, WristTempRecord } from './types'
import { StatBox, ChartCard, AISummaryButton, chartMargin, COLORS, shortDateCompact, fmt, TabHeader, useChartTheme } from './ui'

const CYCLE_COLORS = {
  flow: '#ef4444',
  flowLight: '#fca5a5',
  flowMedium: '#ef4444',
  flowHeavy: '#991b1b',
  fertile: '#a855f7',
  ovulation: '#22c55e',
  luteal: '#f97316',
}

const FLOW_INTENSITY: Record<string, number> = {
  none: 0,
  light: 1,
  medium: 2,
  heavy: 3,
  unspecified: 1.5,
}

interface Props {
  menstrualRecords: MenstrualRecord[]
  wristTempRecords: WristTempRecord[]
  cutoffDate: string
}

interface CycleInfo {
  startDate: string
  endDate: string
  length: number // days
  periodDays: number
}

function detectCycles(records: MenstrualRecord[]): CycleInfo[] {
  // Find period start days: days with flow that follow a gap of >= 3 days without flow
  const flowDays = records
    .filter(r => r.flow && r.flow !== 'none')
    .map(r => r.date)
    .sort()

  if (flowDays.length === 0) return []

  // Group consecutive flow days into periods
  const periods: string[][] = []
  let current: string[] = [flowDays[0]]

  for (let i = 1; i < flowDays.length; i++) {
    const prev = new Date(flowDays[i - 1])
    const curr = new Date(flowDays[i])
    const gap = (curr.getTime() - prev.getTime()) / 86400000
    if (gap <= 2) {
      current.push(flowDays[i])
    } else {
      periods.push(current)
      current = [flowDays[i]]
    }
  }
  periods.push(current)

  // Build cycles from consecutive period starts
  const cycles: CycleInfo[] = []
  for (let i = 0; i < periods.length - 1; i++) {
    const start = periods[i][0]
    const nextStart = periods[i + 1][0]
    const length = Math.round((new Date(nextStart).getTime() - new Date(start).getTime()) / 86400000)
    if (length >= 15 && length <= 60) {
      cycles.push({
        startDate: start,
        endDate: nextStart,
        length,
        periodDays: periods[i].length,
      })
    }
  }

  return cycles
}

export default function MenstrualCycle({ menstrualRecords, wristTempRecords, cutoffDate }: Props) {
  const filtered = useMemo(() => {
    if (!cutoffDate) return menstrualRecords
    return menstrualRecords.filter(r => r.date >= cutoffDate)
  }, [menstrualRecords, cutoffDate])

  const cycles = useMemo(() => detectCycles(menstrualRecords), [menstrualRecords])
  const filteredCycles = useMemo(() => {
    if (!cutoffDate) return cycles
    return cycles.filter(c => c.startDate >= cutoffDate)
  }, [cycles, cutoffDate])

  // Cycle length over time
  const cycleLengthData = useMemo(() =>
    filteredCycles.map(c => ({ date: c.startDate, length: c.length })),
  [filteredCycles])

  // Period duration over time
  const periodDurationData = useMemo(() =>
    filteredCycles.map(c => ({ date: c.startDate, days: c.periodDays })),
  [filteredCycles])

  // Flow intensity timeline
  const flowTimeline = useMemo(() => {
    return filtered
      .filter(r => r.flow && r.flow !== 'none')
      .map(r => ({
        date: r.date,
        intensity: FLOW_INTENSITY[r.flow!] || 0,
        flow: r.flow,
      }))
  }, [filtered])

  // BBT data
  const bbtData = useMemo(() => {
    const bbt = filtered.filter(r => r.basalBodyTemp !== null)
    if (bbt.length > 0) {
      return bbt.map(r => ({
        date: r.date,
        temp: Math.round(r.basalBodyTemp! * 100) / 100,
      }))
    }
    // Fall back to wrist temperature if no BBT
    if (wristTempRecords.length === 0) return []
    const wrist = cutoffDate
      ? wristTempRecords.filter(r => r.date >= cutoffDate)
      : wristTempRecords
    return wrist.map(r => ({ date: r.date, temp: r.value }))
  }, [filtered, wristTempRecords, cutoffDate])

  // Flow distribution
  const flowDistribution = useMemo(() => {
    const counts: Record<string, number> = { light: 0, medium: 0, heavy: 0, unspecified: 0 }
    for (const r of filtered) {
      if (r.flow && r.flow !== 'none' && counts[r.flow] !== undefined) {
        counts[r.flow]++
      }
    }
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), value: v }))
  }, [filtered])

  // Summary stats
  const avgCycleLength = cycles.length > 0
    ? Math.round(cycles.reduce((s, c) => s + c.length, 0) / cycles.length)
    : null
  const avgPeriodDays = cycles.length > 0
    ? Math.round(cycles.reduce((s, c) => s + c.periodDays, 0) / cycles.length * 10) / 10
    : null
  const shortestCycle = cycles.length > 0 ? Math.min(...cycles.map(c => c.length)) : null
  const longestCycle = cycles.length > 0 ? Math.max(...cycles.map(c => c.length)) : null
  const regularity = cycles.length >= 3
    ? Math.round(Math.sqrt(cycles.reduce((s, c) => s + (c.length - avgCycleLength!) ** 2, 0) / cycles.length) * 10) / 10
    : null

  const totalFlowDays = filtered.filter(r => r.flow && r.flow !== 'none').length
  const lastPeriod = cycles.length > 0 ? cycles[cycles.length - 1] : null

  // Predicted next period
  const nextPeriodDate = lastPeriod && avgCycleLength
    ? new Date(new Date(lastPeriod.startDate).getTime() + avgCycleLength * 86400000).toISOString().substring(0, 10)
    : null

  // Cycle phase calendar (last 3 cycles)
  const cycleCalendar = useMemo(() => {
    const recent = cycles.slice(-6)
    return recent.map(c => {
      const estimatedOvulation = Math.round(c.length - 14)
      return {
        start: c.startDate,
        length: c.length,
        periodDays: c.periodDays,
        ovulationDay: estimatedOvulation,
      }
    })
  }, [cycles])

  const ct = useChartTheme()

  const hasData = filtered.length > 0

  if (!hasData) {
    return <div className="text-zinc-500 text-center py-20">No menstrual cycle data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Menstrual Cycle" description="Cycle length, period duration, flow patterns, and temperature tracking." />
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {avgCycleLength !== null && (
          <StatBox label="Cycle Length" value={`${avgCycleLength}`} unit="days" sub="Average" color={COLORS.purple} />
        )}
        {avgPeriodDays !== null && (
          <StatBox label="Period" value={fmt(avgPeriodDays, 1)} unit="days" sub="Average" color={CYCLE_COLORS.flow} />
        )}
        {shortestCycle !== null && longestCycle !== null && (
          <StatBox label="Range" value={`${shortestCycle}-${longestCycle}`} unit="days" sub="Min-Max cycle" />
        )}
        {regularity !== null && (
          <StatBox
            label="Regularity"
            value={regularity <= 2 ? 'Regular' : regularity <= 5 ? 'Moderate' : 'Irregular'}
            sub={`${regularity}d std dev`}
            color={regularity <= 2 ? COLORS.green : regularity <= 5 ? COLORS.orange : COLORS.red}
          />
        )}
        <StatBox label="Cycles" value={`${cycles.length}`} sub="Total detected" />
        <StatBox label="Flow Days" value={`${totalFlowDays}`} sub="Total tracked" color={CYCLE_COLORS.flow} />
        {nextPeriodDate && (
          <StatBox label="Next Period" value={nextPeriodDate.substring(5)} sub="Estimated" color={COLORS.pink} />
        )}
      </div>

      {/* Cycle Phases (recent cycles) */}
      {cycleCalendar.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-1">Recent Cycles</h3>
          <p className="text-xs text-zinc-500 mb-3">Period (red), estimated fertile window (purple), estimated ovulation (green)</p>
          <div className="space-y-2">
            {cycleCalendar.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 w-20 shrink-0">{c.start}</span>
                <div className="flex-1 flex h-5 rounded-md overflow-hidden bg-zinc-800">
                  {Array.from({ length: c.length }, (_, d) => {
                    let color = '#27272a'
                    if (d < c.periodDays) color = CYCLE_COLORS.flow
                    else if (d >= c.ovulationDay - 5 && d < c.ovulationDay) color = CYCLE_COLORS.fertile + '80'
                    else if (d === c.ovulationDay) color = CYCLE_COLORS.ovulation
                    return (
                      <div
                        key={d}
                        className="h-full"
                        style={{ flex: 1, backgroundColor: color, minWidth: 1 }}
                        title={`Day ${d + 1}`}
                      />
                    )
                  })}
                </div>
                <span className="text-xs text-zinc-500 w-16 text-right shrink-0">{c.length}d</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CYCLE_COLORS.flow }} /> Period</div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CYCLE_COLORS.fertile + '80' }} /> Fertile window</div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400"><div className="w-3 h-3 rounded-sm" style={{ backgroundColor: CYCLE_COLORS.ovulation }} /> Ovulation</div>
          </div>
        </div>
      )}

      {/* Cycle Length Over Time */}
      {cycleLengthData.length > 1 && (
        <ChartCard title="Cycle Length" description="Days between period starts. Normal range: 21-35 days." chartData={cycleLengthData}>
          <AreaChart margin={chartMargin} data={cycleLengthData}>
            <defs>
              <linearGradient id="cycleLenGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
            <ReferenceLine y={28} stroke="#71717a" strokeDasharray="3 3" label={{ value: '28d', position: 'right', fill: ct.tick, fontSize: 10 }} />
            <Tooltip {...ct.tooltip} formatter={(v) => [`${v} days`, 'Cycle Length']} />
            <Area type="monotone" dataKey="length" stroke={COLORS.purple} fill="url(#cycleLenGrad)" strokeWidth={1.5} dot={{ r: 3, fill: COLORS.purple }} />
          </AreaChart>
        </ChartCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Period Duration */}
        {periodDurationData.length > 1 && (
          <ChartCard title="Period Duration" description="Number of flow days per cycle" chartData={periodDurationData}>
            <BarChart margin={chartMargin} data={periodDurationData}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} />
              <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
              <Tooltip {...ct.tooltip} formatter={(v) => [`${v} days`, 'Period']} />
              <Bar dataKey="days" fill={CYCLE_COLORS.flow} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        )}

        {/* Flow Distribution */}
        {flowDistribution.length > 0 && (
          <ChartCard title="Flow Intensity Distribution" description="Days by flow level across all tracked data" chartData={flowDistribution}>
            <BarChart margin={chartMargin} data={flowDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: ct.tick }} />
              <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
              <Tooltip {...ct.tooltip} formatter={(v) => [`${v} days`, 'Count']} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {flowDistribution.map((entry, i) => {
                  const colorMap: Record<string, string> = {
                    Light: CYCLE_COLORS.flowLight,
                    Medium: CYCLE_COLORS.flowMedium,
                    Heavy: CYCLE_COLORS.flowHeavy,
                    Unspecified: COLORS.zinc,
                  }
                  return <Cell key={i} fill={colorMap[entry.name] || COLORS.zinc} />
                })}
              </Bar>
            </BarChart>
          </ChartCard>
        )}
      </div>

      {/* Temperature Tracking */}
      {bbtData.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Temperature Tracking</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
            {filtered.some(r => r.basalBodyTemp !== null)
              ? 'Basal body temperature. A sustained rise of ~0.2-0.5°C after ovulation is typical.'
              : 'Wrist temperature deviation during sleep. Shifts can correlate with cycle phases.'
            }
              </p>
            </div>
            <AISummaryButton title="Temperature Tracking" description="Basal body or wrist temperature over time" chartData={bbtData} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ScatterChart margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} />
                <YAxis dataKey="temp" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <ZAxis range={[15, 25]} />
                <Tooltip {...ct.tooltip} formatter={(v) => [`${v}°C`, 'Temperature']} />
                <Scatter data={bbtData} fill={COLORS.orange} opacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Flow Timeline */}
      {flowTimeline.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Flow Timeline</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Daily flow intensity over time</p>
            </div>
            <AISummaryButton title="Flow Timeline" description="Daily flow intensity over time" chartData={flowTimeline} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ScatterChart margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} />
                <YAxis
                  dataKey="intensity"
                  domain={[0, 3.5]}
                  ticks={[1, 2, 3]}
                  tickFormatter={(v) => ['', 'Light', 'Medium', 'Heavy'][v] || ''}
                  tick={{ fontSize: 10, fill: ct.tick }}
                />
                <ZAxis range={[30, 50]} />
                <Tooltip
                  {...ct.tooltip}
                  formatter={(_v, _name, props) => {
                    const flow = props.payload?.flow || ''
                    return [flow.charAt(0).toUpperCase() + flow.slice(1), 'Flow']
                  }}
                />
                <Scatter data={flowTimeline} fill={CYCLE_COLORS.flow} opacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
