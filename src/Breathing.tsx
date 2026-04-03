import { useMemo } from 'react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip,
  CartesianGrid, AreaChart, Area, ReferenceLine, ScatterChart, Scatter, ZAxis,
} from 'recharts'
import type { DailyBreathing } from './types'
import { StatBox, AISummaryButton, TabHeader, tooltipStyle, chartMargin, COLORS, shortDate, avg } from './ui'

// Apple's thresholds for breathing disturbances
// < 5: not elevated, 5-14.9: mildly elevated, 15-29.9: moderately elevated, >= 30: severely elevated
function disturbanceCategory(val: number): { label: string; color: string } {
  if (val < 5) return { label: 'Normal', color: '#22c55e' }
  if (val < 15) return { label: 'Mildly Elevated', color: '#f97316' }
  if (val < 30) return { label: 'Moderately Elevated', color: '#ef4444' }
  return { label: 'Severely Elevated', color: '#dc2626' }
}

interface Props {
  dailyBreathing: DailyBreathing[]
  cutoffDate: string
}

export default function Breathing({ dailyBreathing, cutoffDate }: Props) {
  const filtered = useMemo(() => {
    if (!cutoffDate) return dailyBreathing
    return dailyBreathing.filter(d => d.date >= cutoffDate)
  }, [dailyBreathing, cutoffDate])

  // Weekly disturbances
  const weeklyDisturbances = useMemo(() => {
    const data = filtered.filter(d => d.disturbances !== null)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
        weekStart = d.date
        vals = []
      }
      vals.push(d.disturbances!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
    return result
  }, [filtered])

  // Weekly respiratory rate
  const weeklyRespRate = useMemo(() => {
    const data = filtered.filter(d => d.respiratoryRate !== null)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
        weekStart = d.date
        vals = []
      }
      vals.push(d.respiratoryRate!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
    return result
  }, [filtered])

  // Weekly SpO2
  const weeklySpo2 = useMemo(() => {
    const data = filtered.filter(d => d.spo2 !== null)
    if (data.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = data[0].date
    let vals: number[] = []
    for (const d of data) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
        weekStart = d.date
        vals = []
      }
      vals.push(d.spo2!)
    }
    if (vals.length > 0) result.push({ week: weekStart, value: Math.round(avg(vals) * 10) / 10 })
    return result
  }, [filtered])

  // Disturbance vs SpO2 correlation scatter
  const distVsSpo2 = useMemo(() => {
    return filtered
      .filter(d => d.disturbances !== null && d.spo2 !== null)
      .map(d => ({
        disturbances: d.disturbances!,
        spo2: d.spo2!,
      }))
  }, [filtered])

  // Summary stats (last 30 days)
  const recent = filtered.slice(-30)
  const recentDist = recent.filter(d => d.disturbances !== null).map(d => d.disturbances!)
  const avgDist = recentDist.length > 0 ? avg(recentDist) : null
  const distCategory = avgDist !== null ? disturbanceCategory(avgDist) : null

  const recentRR = recent.filter(d => d.respiratoryRate !== null).map(d => d.respiratoryRate!)
  const avgRR = recentRR.length > 0 ? avg(recentRR) : null

  const recentSpo2 = recent.filter(d => d.spo2 !== null).map(d => d.spo2!)
  const avgSpo2Val = recentSpo2.length > 0 ? avg(recentSpo2) : null
  const minSpo2 = recentSpo2.length > 0 ? Math.min(...recentSpo2) : null

  const elevatedNights = recentDist.filter(v => v >= 5).length

  const hasData = weeklyDisturbances.length > 0 || weeklyRespRate.length > 0 || weeklySpo2.length > 0

  if (!hasData) {
    return <div className="text-zinc-500 text-center py-20">No breathing data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Breathing" description="Blood oxygen levels, respiratory rate, and breathing disturbances tracked during sleep." />
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {avgDist !== null && (
          <StatBox
            label="Disturbances"
            value={`${avgDist.toFixed(1)}`}
            unit="/hr"
            color={distCategory?.color}
            sub={distCategory?.label}
          />
        )}
        {elevatedNights > 0 && (
          <StatBox
            label="Elevated Nights"
            value={`${elevatedNights}`}
            sub={`of last ${recentDist.length} nights`}
            color={elevatedNights > 5 ? COLORS.red : '#f97316'}
          />
        )}
        {avgRR !== null && (
          <StatBox
            label="Respiratory Rate"
            value={`${avgRR.toFixed(1)}`}
            unit="br/min"
            color={COLORS.blue}
            sub="Avg last 30 days"
          />
        )}
        {avgSpo2Val !== null && (
          <StatBox
            label="SpO2"
            value={`${avgSpo2Val.toFixed(1)}`}
            unit="%"
            color={avgSpo2Val >= 95 ? COLORS.green : COLORS.red}
            sub="Avg last 30 days"
          />
        )}
        {minSpo2 !== null && (
          <StatBox
            label="Min SpO2"
            value={`${minSpo2.toFixed(1)}`}
            unit="%"
            color={minSpo2 >= 90 ? COLORS.green : COLORS.red}
            sub={minSpo2 < 90 ? 'Below normal' : 'Normal'}
          />
        )}
        <StatBox label="Data Points" value={`${filtered.length}`} sub="nights tracked" />
      </div>

      {/* Breathing disturbances */}
      {weeklyDisturbances.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Breathing Disturbances (weekly avg)</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Events per hour during sleep. Under 5/hr is normal. Elevated may indicate sleep apnea.</p>
            </div>
            <AISummaryButton title="Breathing Disturbances (weekly avg)" description="Events per hour during sleep. Under 5/hr is normal. Elevated may indicate sleep apnea." chartData={weeklyDisturbances} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={weeklyDisturbances}>
                <defs>
                  <linearGradient id="distGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                <YAxis domain={[0, 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                <ReferenceLine y={5} stroke="#f97316" strokeDasharray="3 3" label={{ value: 'Mild', position: 'right', fill: '#71717a', fontSize: 10 }} />
                <ReferenceLine y={15} stroke={COLORS.red} strokeDasharray="3 3" label={{ value: 'Moderate', position: 'right', fill: '#71717a', fontSize: 10 }} />
                <Tooltip {...tooltipStyle} formatter={(v) => [`${v}/hr`, 'Disturbances']} />
                <Area type="monotone" dataKey="value" stroke={COLORS.red} fill="url(#distGrad2)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Respiratory rate */}
        {weeklyRespRate.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Respiratory Rate (weekly avg)</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Normal adult: 12-20 breaths/min at rest</p>
              </div>
              <AISummaryButton title="Respiratory Rate (weekly avg)" description="Normal adult: 12-20 breaths/min at rest" chartData={weeklyRespRate} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyRespRate}>
                  <defs>
                    <linearGradient id="respRateGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <ReferenceLine y={12} stroke="#71717a" strokeDasharray="3 3" />
                  <ReferenceLine y={20} stroke="#71717a" strokeDasharray="3 3" />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} br/min`, 'Respiratory Rate']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.blue} fill="url(#respRateGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* SpO2 */}
        {weeklySpo2.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Blood Oxygen (weekly avg)</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Normal: 95-100%. Below 90% is concerning.</p>
              </div>
              <AISummaryButton title="Blood Oxygen (weekly avg)" description="Normal: 95-100%. Below 90% is concerning." chartData={weeklySpo2} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklySpo2}>
                  <defs>
                    <linearGradient id="spo2Grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 100]} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <ReferenceLine y={95} stroke="#71717a" strokeDasharray="3 3" />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, 'SpO2']} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#spo2Grad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Disturbances vs SpO2 scatter */}
      {distVsSpo2.length > 10 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Disturbances vs Blood Oxygen</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Higher disturbances often correlate with lower SpO2 — a hallmark of sleep apnea.</p>
            </div>
            <AISummaryButton title="Disturbances vs Blood Oxygen" description="Higher disturbances often correlate with lower SpO2 — a hallmark of sleep apnea." chartData={distVsSpo2} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <ScatterChart margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="disturbances" name="Disturbances" unit="/hr" tick={{ fontSize: 10, fill: '#71717a' }} />
                <YAxis dataKey="spo2" name="SpO2" unit="%" domain={['auto', 100]} tick={{ fontSize: 10, fill: '#71717a' }} />
                <ZAxis range={[20, 40]} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v, name) => [
                    name === 'Disturbances' ? `${v}/hr` : `${v}%`,
                    name as string,
                  ]}
                />
                <Scatter data={distVsSpo2} fill={COLORS.red} opacity={0.5} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
