import { useMemo } from 'react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, ReferenceArea, ComposedChart, Line,
} from 'recharts'
import type { RunningDynamicsRecord } from './types'
import { StatBox, chartMargin, COLORS, shortDate, AISummaryButton, TabHeader, Legend, fmt, useChartTheme } from './ui'

interface Props {
  runningDynamics: RunningDynamicsRecord[]
  cutoffDate: string
  granularity: 'daily' | 'weekly' | 'monthly'
}

function weeklyAvg(data: { date: string; value: number }[]): { week: string; value: number }[] {
  if (data.length === 0) return []
  const result: { week: string; value: number }[] = []
  let weekStart = data[0].date
  let vals: number[] = []
  for (const d of data) {
    const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
    if (diff >= 7) {
      if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 })
      weekStart = d.date
      vals = []
    }
    vals.push(d.value)
  }
  if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 })
  return result
}

// Convert m/s to min/km pace
function msToPace(ms: number): string {
  if (ms <= 0) return '--'
  const secPerKm = 1000 / ms
  const min = Math.floor(secPerKm / 60)
  const sec = Math.round(secPerKm % 60)
  return `${min}:${sec.toString().padStart(2, '0')}`
}

export default function RunningDynamics({ runningDynamics, cutoffDate }: Props) {
  const ct = useChartTheme()
  const filtered = useMemo(() => {
    if (!cutoffDate) return runningDynamics
    return runningDynamics.filter(d => d.date >= cutoffDate)
  }, [runningDynamics, cutoffDate])

  const extract = (key: keyof RunningDynamicsRecord) =>
    filtered.filter(d => d[key] !== null).map(d => ({ date: d.date, value: d[key] as number }))

  const powerData = useMemo(() => extract('power'), [filtered])
  const speedData = useMemo(() => extract('speed'), [filtered])
  const vertOscData = useMemo(() => extract('verticalOscillation'), [filtered])
  const gctData = useMemo(() => extract('groundContactTime'), [filtered])
  const strideLenData = useMemo(() => extract('strideLength'), [filtered])

  const weeklyPower = useMemo(() => weeklyAvg(powerData), [powerData])
  const weeklySpeed = useMemo(() => weeklyAvg(speedData), [speedData])
  const weeklyVertOsc = useMemo(() => weeklyAvg(vertOscData), [vertOscData])
  const weeklyGCT = useMemo(() => weeklyAvg(gctData), [gctData])
  const weeklyStride = useMemo(() => weeklyAvg(strideLenData), [strideLenData])

  // Running Efficiency: combined power + GCT + vert osc overlay
  const efficiencyOverlay = useMemo(() => {
    const powerMap = new Map(weeklyPower.map(d => [d.week, d.value]))
    const gctMap = new Map(weeklyGCT.map(d => [d.week, d.value]))
    const vertMap = new Map(weeklyVertOsc.map(d => [d.week, d.value]))
    const allWeeks = [...new Set([...powerMap.keys(), ...gctMap.keys(), ...vertMap.keys()])].sort()
    return allWeeks.map(w => ({
      week: w,
      power: powerMap.get(w) ?? null,
      gct: gctMap.get(w) ?? null,
      vertOsc: vertMap.get(w) ?? null,
    }))
  }, [weeklyPower, weeklyGCT, weeklyVertOsc])

  // Summary stats
  const recent30 = filtered.slice(-30)
  const avgOf = (key: keyof RunningDynamicsRecord) => {
    const vals = recent30.map(d => d[key]).filter((v): v is number => typeof v === 'number' && v > 0)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : null
  }

  const avgPower = avgOf('power')
  const avgSpeed = avgOf('speed')
  const avgVertOsc = avgOf('verticalOscillation')
  const avgGCT = avgOf('groundContactTime')
  const avgStride = avgOf('strideLength')

  const hasData = powerData.length > 0 || speedData.length > 0 || vertOscData.length > 0

  if (!hasData) {
    return <div className="text-zinc-500 text-center py-20">No running dynamics data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Running Dynamics" description="Power, pace, cadence efficiency, and form metrics captured during runs by your Apple Watch." />

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {avgPower !== null && <StatBox label="Avg Power" value={fmt(avgPower, 0)} unit="W" color={COLORS.orange} sub="30d avg" />}
        {avgSpeed !== null && <StatBox label="Avg Pace" value={msToPace(avgSpeed)} unit="min/km" color={COLORS.blue} sub="30d avg" />}
        {avgVertOsc !== null && <StatBox label="Vert. Oscillation" value={fmt(avgVertOsc, 1)} unit="cm" color={COLORS.purple} sub="30d avg" />}
        {avgGCT !== null && <StatBox label="Ground Contact" value={fmt(avgGCT, 0)} unit="ms" color={COLORS.green} sub="30d avg" />}
        {avgStride !== null && <StatBox label="Stride Length" value={fmt(avgStride, 2)} unit="m" color={COLORS.cyan} sub="30d avg" />}
      </div>

      {/* Running Power */}
      {weeklyPower.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Running Power</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Watts output during runs. Increasing power at the same pace indicates improving fitness.</p>
            </div>
            <AISummaryButton title="Running Power" description="Weekly average running power in watts" chartData={weeklyPower} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={weeklyPower}>
                <defs>
                  <linearGradient id="runPowerGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip {...ct.tooltip} formatter={(v) => [`${v} W`, 'Power']} />
                <Area type="monotone" dataKey="value" stroke={COLORS.orange} fill="url(#runPowerGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Running Speed / Pace */}
        {weeklySpeed.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Running Pace</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Weekly average speed. Higher speed = faster pace.</p>
              </div>
              <AISummaryButton title="Running Pace" description="Weekly avg running speed" chartData={weeklySpeed} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklySpeed}>
                  <defs>
                    <linearGradient id="runSpeedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip {...ct.tooltip} formatter={(v) => [`${v} m/s (${msToPace(v as number)}/km)`, 'Speed']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.blue} fill="url(#runSpeedGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Stride Length */}
        {weeklyStride.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Stride Length</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Average stride during runs. Longer strides at the same cadence = faster pace.</p>
              </div>
              <AISummaryButton title="Stride Length" description="Weekly average stride length" chartData={weeklyStride} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyStride}>
                  <defs>
                    <linearGradient id="strideGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip {...ct.tooltip} formatter={(v) => [`${v} m`, 'Stride']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.cyan} fill="url(#strideGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Vertical Oscillation */}
        {weeklyVertOsc.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Vertical Oscillation</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Bounce per stride. Less bounce = more efficient running form. Elite runners: 6-8 cm.</p>
              </div>
              <AISummaryButton title="Vertical Oscillation" description="Weekly avg bounce per stride" chartData={weeklyVertOsc} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyVertOsc}>
                  <defs>
                    <linearGradient id="vertOscGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceArea y1={6} y2={8} fill="#22c55e" fillOpacity={0.05} />
                  <Tooltip {...ct.tooltip} formatter={(v) => [`${v} cm`, 'Oscillation']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.purple} fill="url(#vertOscGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Ground Contact Time */}
        {weeklyGCT.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Ground Contact Time</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Time each foot spends on the ground. Shorter = more efficient. Elite: 160-200 ms.</p>
              </div>
              <AISummaryButton title="Ground Contact Time" description="Weekly avg foot strike duration" chartData={weeklyGCT} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyGCT}>
                  <defs>
                    <linearGradient id="gctGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceArea y1={160} y2={200} fill="#22c55e" fillOpacity={0.05} />
                  <Tooltip {...ct.tooltip} formatter={(v) => [`${v} ms`, 'GCT']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#gctGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Running Form Overview (multi-metric overlay) */}
      {efficiencyOverlay.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Running Form Overview</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Power, ground contact time, and vertical oscillation together — trends in form efficiency over time.</p>
            </div>
            <AISummaryButton title="Running Form Overview" description="Multi-metric form efficiency" chartData={efficiencyOverlay} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ComposedChart margin={chartMargin} data={efficiencyOverlay}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis yAxisId="power" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <YAxis yAxisId="gct" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip {...ct.tooltip} formatter={(v, name) => {
                  if (name === 'power') return [`${v} W`, 'Power']
                  if (name === 'gct') return [`${v} ms`, 'Ground Contact']
                  return [`${v} cm`, 'Vert. Oscillation']
                }} />
                <Line yAxisId="power" type="monotone" dataKey="power" stroke={COLORS.orange} strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="gct" type="monotone" dataKey="gct" stroke={COLORS.green} strokeWidth={1.5} dot={false} connectNulls />
                <Line yAxisId="gct" type="monotone" dataKey="vertOsc" stroke={COLORS.purple} strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2">
            <Legend color={COLORS.orange} label="Power (W)" />
            <Legend color={COLORS.green} label="Ground Contact (ms)" />
            <Legend color={COLORS.purple} label="Vert. Osc. (cm)" dashed />
          </div>
        </div>
      )}
    </div>
  )
}
