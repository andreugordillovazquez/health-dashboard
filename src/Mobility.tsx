import { useMemo } from 'react'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area, ScatterChart, Scatter, ZAxis, ReferenceArea,
} from 'recharts'
import type { DailyMobility } from './types'
import { StatBox, chartMargin, ChartTooltip, COLORS, shortDate, AISummaryButton, TabHeader, fmt, useChartTheme } from './ui'

interface Props {
  dailyMobility: DailyMobility[]
  cutoffDate: string
  granularity: 'daily' | 'weekly' | 'monthly'
}

function weeklyAvgMobility(data: DailyMobility[], key: keyof DailyMobility): { week: string; value: number }[] {
  const valid = data.filter(d => d[key] !== null && d[key] !== undefined && (d[key] as number) > 0)
  if (valid.length === 0) return []
  const result: { week: string; value: number }[] = []
  let weekStart = valid[0].date
  let vals: number[] = []
  for (const d of valid) {
    const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
    if (diff >= 7) {
      if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 })
      weekStart = d.date
      vals = []
    }
    vals.push(d[key] as number)
  }
  if (vals.length > 0) result.push({ week: weekStart, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 })
  return result
}

export default function Mobility({ dailyMobility, cutoffDate }: Props) {
  const filtered = useMemo(() => {
    if (!cutoffDate) return dailyMobility
    return dailyMobility.filter(d => d.date >= cutoffDate)
  }, [dailyMobility, cutoffDate])

  const weeklySpeed = useMemo(() => weeklyAvgMobility(filtered, 'walkingSpeed'), [filtered])
  const weeklyStepLen = useMemo(() => weeklyAvgMobility(filtered, 'stepLength'), [filtered])
  const weeklyDoubleSupport = useMemo(() => weeklyAvgMobility(filtered, 'doubleSupportPct'), [filtered])
  const weeklyAsymmetry = useMemo(() => weeklyAvgMobility(filtered, 'asymmetryPct'), [filtered])
  const weeklyStairAscent = useMemo(() => weeklyAvgMobility(filtered, 'stairAscentSpeed'), [filtered])
  const weeklyStairDescent = useMemo(() => weeklyAvgMobility(filtered, 'stairDescentSpeed'), [filtered])

  // Flights climbed (weekly sum)
  const weeklyFlights = useMemo(() => {
    const withFlights = filtered.filter(d => d.flightsClimbed > 0)
    if (withFlights.length === 0) return []
    const result: { week: string; value: number }[] = []
    let weekStart = withFlights[0].date
    let sum = 0
    for (const d of withFlights) {
      const diff = (new Date(d.date).getTime() - new Date(weekStart).getTime()) / 86400000
      if (diff >= 7) {
        result.push({ week: weekStart, value: sum })
        weekStart = d.date
        sum = 0
      }
      sum += d.flightsClimbed
    }
    if (sum > 0) result.push({ week: weekStart, value: sum })
    return result
  }, [filtered])

  // Walking steadiness (sparse, use scatter)
  const steadinessData = useMemo(() =>
    filtered.filter(d => d.walkingSteadiness !== null).map(d => ({ date: d.date, value: d.walkingSteadiness! })),
    [filtered]
  )

  // Six minute walk (sparse, scatter)
  const sixMinData = useMemo(() =>
    filtered.filter(d => d.sixMinWalkDistance !== null).map(d => ({ date: d.date, value: Math.round(d.sixMinWalkDistance!) })),
    [filtered]
  )

  // Summary stats (last 30 days)
  const recent30 = filtered.slice(-30)
  const avgOf = (arr: DailyMobility[], key: keyof DailyMobility) => {
    const vals = arr.map(d => d[key]).filter((v): v is number => typeof v === 'number' && v > 0)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : null
  }

  const avgSpeed = avgOf(recent30, 'walkingSpeed')
  const avgStepLen = avgOf(recent30, 'stepLength')
  const avgDoubleSupport = avgOf(recent30, 'doubleSupportPct')
  const avgAsymmetry = avgOf(recent30, 'asymmetryPct')
  const totalFlights = recent30.reduce((s, d) => s + d.flightsClimbed, 0)
  const latestSteadiness = steadinessData.length > 0 ? steadinessData[steadinessData.length - 1].value : null
  const latestSixMin = sixMinData.length > 0 ? sixMinData[sixMinData.length - 1].value : null

  const ct = useChartTheme()

  const hasData = filtered.length > 0

  if (!hasData) {
    return <div className="text-zinc-500 text-center py-20">No mobility data found.</div>
  }

  return (
    <div className="space-y-6">
      <TabHeader title="Mobility & Gait" description="Walking speed, step length, gait symmetry, stair climbing, and balance metrics — key indicators of functional fitness and aging." />

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {avgSpeed !== null && <StatBox label="Walking Speed" value={fmt(avgSpeed, 2)} unit="km/h" color={COLORS.blue} sub="30d avg" />}
        {avgStepLen !== null && <StatBox label="Step Length" value={fmt(avgStepLen, 1)} unit="cm" color={COLORS.green} sub="30d avg" />}
        {avgDoubleSupport !== null && <StatBox label="Double Support" value={fmt(avgDoubleSupport, 1)} unit="%" color={COLORS.orange} sub="30d avg" />}
        {avgAsymmetry !== null && <StatBox label="Asymmetry" value={fmt(avgAsymmetry, 1)} unit="%" color={avgAsymmetry < 10 ? COLORS.green : COLORS.red} sub={avgAsymmetry < 10 ? 'Normal' : 'Elevated'} />}
        {totalFlights > 0 && <StatBox label="Flights" value={`${totalFlights}`} sub="Last 30d" color={COLORS.cyan} />}
        {latestSteadiness !== null && <StatBox label="Steadiness" value={fmt(latestSteadiness, 0)} unit="%" color={latestSteadiness >= 80 ? COLORS.green : COLORS.orange} sub="Latest" />}
        {latestSixMin !== null && <StatBox label="6-Min Walk" value={`${latestSixMin}`} unit="m" color={COLORS.purple} sub="Latest" />}
      </div>

      {/* Walking Speed */}
      {weeklySpeed.length > 1 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">Walking Speed</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Weekly average. Higher walking speed is associated with better overall health and longevity.</p>
            </div>
            <AISummaryButton title="Walking Speed" description="Weekly average walking speed" chartData={weeklySpeed} />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={weeklySpeed}>
                <defs>
                  <linearGradient id="walkSpeedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip formatter={(v) => [`${v} km/h`, 'Walking Speed']} />} />
                <Area type="monotone" dataKey="value" stroke={COLORS.blue} fill="url(#walkSpeedGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Step Length */}
        {weeklyStepLen.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Step Length</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Longer strides indicate better mobility and leg strength.</p>
              </div>
              <AISummaryButton title="Step Length" description="Weekly average step length" chartData={weeklyStepLen} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyStepLen}>
                  <defs>
                    <linearGradient id="stepLenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} cm`, 'Step Length']} />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#stepLenGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Double Support % */}
        {weeklyDoubleSupport.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Double Support Time</h3>
                <p className="text-xs text-zinc-500 mt-0.5">% of walking time with both feet on ground. Lower = better balance and confidence.</p>
              </div>
              <AISummaryButton title="Double Support Time" description="% of walking with both feet down" chartData={weeklyDoubleSupport} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyDoubleSupport}>
                  <defs>
                    <linearGradient id="dblSupportGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceArea y1={20} y2={30} fill="#22c55e" fillOpacity={0.05} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v}%`, 'Double Support']} />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.orange} fill="url(#dblSupportGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Walking Asymmetry */}
        {weeklyAsymmetry.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Walking Asymmetry</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Left/right leg imbalance. Under 10% is normal; higher may indicate injury risk or compensation.</p>
              </div>
              <AISummaryButton title="Walking Asymmetry" description="Left/right leg imbalance %" chartData={weeklyAsymmetry} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyAsymmetry}>
                  <defs>
                    <linearGradient id="asymGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={[0, 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ReferenceArea y1={0} y2={10} fill="#22c55e" fillOpacity={0.05} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v}%`, 'Asymmetry']} />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.red} fill="url(#asymGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Flights Climbed */}
        {weeklyFlights.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Flights Climbed</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Weekly total floors. Stair climbing is excellent for lower body strength and cardio.</p>
              </div>
              <AISummaryButton title="Flights Climbed" description="Weekly total floors climbed" chartData={weeklyFlights} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyFlights}>
                  <defs>
                    <linearGradient id="flightsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} flights`, 'Flights']} />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.cyan} fill="url(#flightsGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Stair Speed */}
        {(weeklyStairAscent.length > 1 || weeklyStairDescent.length > 1) && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Stair Speed</h3>
                <p className="text-xs text-zinc-500 mt-0.5">How quickly you climb and descend stairs. An important functional mobility metric.</p>
              </div>
              <AISummaryButton title="Stair Speed" description="Ascent and descent speed" chartData={weeklyStairAscent.length > 0 ? weeklyStairAscent : weeklyStairDescent} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <AreaChart margin={chartMargin} data={weeklyStairAscent.length >= weeklyStairDescent.length ? weeklyStairAscent.map((d, i) => ({
                  week: d.week, ascent: d.value, descent: weeklyStairDescent[i]?.value ?? null
                })) : weeklyStairDescent.map((d, i) => ({
                  week: d.week, ascent: weeklyStairAscent[i]?.value ?? null, descent: d.value
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip formatter={(v, name) => [`${v} m/s`, name === 'ascent' ? 'Ascent' : 'Descent']} />} />
                  <Area type="monotone" dataKey="ascent" stroke={COLORS.green} fill="none" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="descent" stroke={COLORS.orange} fill="none" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Walking Steadiness */}
        {steadinessData.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Walking Steadiness</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Apple's fall-risk assessment. Higher is better. Below 60% is flagged as low.</p>
              </div>
              <AISummaryButton title="Walking Steadiness" description="Fall-risk assessment score" chartData={steadinessData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <ScatterChart margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <ReferenceArea y1={80} y2={100} fill="#22c55e" fillOpacity={0.05} />
                  <ReferenceArea y1={0} y2={60} fill="#ef4444" fillOpacity={0.05} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ZAxis range={[30, 50]} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v}%`, 'Steadiness']} />} />
                  <Scatter data={steadinessData} fill={COLORS.purple} opacity={0.7} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Six Minute Walk Test */}
        {sixMinData.length > 1 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-medium text-zinc-300">Six-Minute Walk Test</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Clinical fitness test. 400-700m is typical for healthy adults. Higher = better endurance.</p>
              </div>
              <AISummaryButton title="Six-Minute Walk Test" description="Distance walked in 6 minutes" chartData={sixMinData} />
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <ScatterChart margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <ReferenceArea y1={400} y2={700} fill="#22c55e" fillOpacity={0.05} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDate} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <ZAxis range={[40, 60]} />
                  <Tooltip content={<ChartTooltip formatter={(v) => [`${v} m`, 'Distance']} />} />
                  <Scatter data={sixMinData} fill={COLORS.green} opacity={0.7} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
