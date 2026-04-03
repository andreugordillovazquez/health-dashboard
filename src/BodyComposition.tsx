import { useMemo } from 'react'
import {
  ResponsiveContainer, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, AreaChart, Area,
} from 'recharts'
import type { BodyRecord } from './types'
import type { Granularity } from './analysis'
import { StatBox, tooltipStyle, chartMargin, COLORS, shortDate, Legend, AISummaryButton, TabHeader } from './ui'

export default function BodyComposition({ bodyRecords, cutoffDate, granularity: _granularity }: { bodyRecords: BodyRecord[]; cutoffDate: string; granularity: Granularity }) {
  const filtered = useMemo(() => {
    if (!cutoffDate) return bodyRecords
    return bodyRecords.filter(r => r.date >= cutoffDate)
  }, [bodyRecords, cutoffDate])

  const hasWeight = filtered.some(r => r.weight !== null)
  const hasBodyFat = filtered.some(r => r.bodyFat !== null)
  const hasLeanMass = filtered.some(r => r.leanMass !== null)
  const hasBmi = filtered.some(r => r.bmi !== null)

  // Chart data: only include records that have at least one measurement
  const weightData = useMemo(() =>
    filtered.filter(r => r.weight !== null).map(r => ({
      date: r.date,
      weight: Math.round(r.weight! * 10) / 10,
    })),
    [filtered]
  )

  const bodyFatData = useMemo(() =>
    filtered.filter(r => r.bodyFat !== null).map(r => ({
      date: r.date,
      bodyFat: Math.round(r.bodyFat! * 10) / 10,
    })),
    [filtered]
  )

  const leanMassData = useMemo(() =>
    filtered.filter(r => r.leanMass !== null).map(r => ({
      date: r.date,
      leanMass: Math.round(r.leanMass! * 10) / 10,
    })),
    [filtered]
  )

  const bmiData = useMemo(() =>
    filtered.filter(r => r.bmi !== null).map(r => ({
      date: r.date,
      bmi: Math.round(r.bmi! * 10) / 10,
    })),
    [filtered]
  )

  // Combined chart: weight + lean mass on same axis
  const compositionData = useMemo(() => {
    const dateSet = new Set<string>()
    filtered.forEach(r => dateSet.add(r.date))
    const dates = Array.from(dateSet).sort()
    const byDate = new Map(filtered.map(r => [r.date, r]))

    return dates.map(date => {
      const r = byDate.get(date)!
      return {
        date,
        weight: r.weight ? Math.round(r.weight * 10) / 10 : null,
        leanMass: r.leanMass ? Math.round(r.leanMass * 10) / 10 : null,
        fatMass: r.weight && r.bodyFat ? Math.round((r.weight * r.bodyFat / 100) * 10) / 10 : null,
      }
    }).filter(d => d.weight || d.leanMass)
  }, [filtered])

  // Summary stats
  const latest = filtered[filtered.length - 1]
  const earliest = filtered[0]

  const weightChange = latest?.weight && earliest?.weight
    ? Math.round((latest.weight - earliest.weight) * 10) / 10
    : null

  const leanChange = hasLeanMass
    ? (() => {
      const first = filtered.find(r => r.leanMass !== null)
      const last = [...filtered].reverse().find(r => r.leanMass !== null)
      return first?.leanMass && last?.leanMass
        ? Math.round((last.leanMass - first.leanMass) * 10) / 10
        : null
    })()
    : null

  if (!hasWeight && !hasBodyFat && !hasLeanMass && !hasBmi) {
    return <div className="text-zinc-500 text-center py-20">No body composition data found in your export.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Body Composition" description="Weight, body fat percentage, BMI, and lean mass trends over time." />
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {latest?.weight && (
          <StatBox
            label="Current Weight"
            value={`${latest.weight.toFixed(1)}`}
            unit="kg"
            color={COLORS.orange}
            sub={weightChange !== null ? `${weightChange > 0 ? '+' : ''}${weightChange} kg total` : undefined}
          />
        )}
        {latest?.bodyFat && (
          <StatBox label="Body Fat" value={`${latest.bodyFat.toFixed(1)}`} unit="%" color={COLORS.red} sub="Latest" />
        )}
        {latest?.leanMass && (
          <StatBox
            label="Lean Mass"
            value={`${latest.leanMass.toFixed(1)}`}
            unit="kg"
            color={COLORS.green}
            sub={leanChange !== null ? `${leanChange > 0 ? '+' : ''}${leanChange} kg total` : undefined}
          />
        )}
        {latest?.bmi && (
          <StatBox label="BMI" value={`${latest.bmi.toFixed(1)}`} color={COLORS.purple} sub={bmiCategory(latest.bmi)} />
        )}
        <StatBox label="Data Points" value={`${filtered.length}`} sub={`${earliest?.date} — ${latest?.date}`} />
      </div>

      {/* Weight + Lean Mass combined */}
      {compositionData.length > 1 && hasLeanMass && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-300">Weight vs Lean Mass</h3>
            <AISummaryButton title="Weight vs Lean Mass" chartData={compositionData} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={compositionData}>
                <defs>
                  <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, name) => {
                    const label = name === 'weight' ? 'Weight' : name === 'leanMass' ? 'Lean Mass' : 'Fat Mass'
                    return [`${value} kg`, label]
                  }}
                />
                <Area type="monotone" dataKey="weight" stroke={COLORS.orange} fill="url(#weightGrad)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line type="monotone" dataKey="leanMass" stroke={COLORS.green} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                {compositionData.some(d => d.fatMass) && (
                  <Line type="monotone" dataKey="fatMass" stroke={COLORS.red} strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 1.5 }} connectNulls />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2">
            <Legend color={COLORS.orange} label="Weight" />
            <Legend color={COLORS.green} label="Lean Mass" />
            {compositionData.some(d => d.fatMass) && <Legend color={COLORS.red} label="Fat Mass" dashed />}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Weight trend (if no lean mass, show standalone) */}
        {weightData.length > 1 && !hasLeanMass && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-300">Weight</h3>
              <AISummaryButton title="Weight" chartData={weightData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weightData}>
                  <defs>
                    <linearGradient id="weightStandaloneGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} kg`, 'Weight']} />
                  <Area type="monotone" dataKey="weight" stroke={COLORS.orange} fill="url(#weightStandaloneGrad)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Body Fat % */}
        {bodyFatData.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-300">Body Fat %</h3>
              <AISummaryButton title="Body Fat %" chartData={bodyFatData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={bodyFatData}>
                  <defs>
                    <linearGradient id="bodyFatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, 'Body Fat']} />
                  <Area type="monotone" dataKey="bodyFat" stroke={COLORS.red} fill="url(#bodyFatGrad)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* BMI */}
        {bmiData.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-300">BMI</h3>
              <AISummaryButton title="BMI" chartData={bmiData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={bmiData}>
                  <defs>
                    <linearGradient id="bmiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v}`, 'BMI']} />
                  <ReferenceLine y={18.5} stroke="#71717a" strokeDasharray="3 3" label={{ value: '18.5', position: 'left', fill: '#71717a', fontSize: 10 }} />
                  <ReferenceLine y={25} stroke="#71717a" strokeDasharray="3 3" label={{ value: '25', position: 'left', fill: '#71717a', fontSize: 10 }} />
                  <Area type="monotone" dataKey="bmi" stroke={COLORS.purple} fill="url(#bmiGrad)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Lean Mass standalone (if weight not available) */}
        {leanMassData.length > 1 && !hasWeight && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-300">Lean Body Mass</h3>
              <AISummaryButton title="Lean Body Mass" chartData={leanMassData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={leanMassData}>
                  <defs>
                    <linearGradient id="leanMassGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} kg`, 'Lean Mass']} />
                  <Area type="monotone" dataKey="leanMass" stroke={COLORS.green} fill="url(#leanMassGrad)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function bmiCategory(bmi: number): string {
  if (bmi < 18.5) return 'Underweight'
  if (bmi < 25) return 'Normal'
  if (bmi < 30) return 'Overweight'
  return 'Obese'
}

