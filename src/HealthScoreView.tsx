import { useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts'
import type { HealthData } from './types'
import { tooltipStyle, chartMargin, COLORS, shortDate } from './ui'
import { computeHealthScores, rollingAvg, scoreLabel } from './healthScore'

function ScoreRing({ score, size = 160, label }: { score: number; size?: number; label: string }) {
  const { color } = scoreLabel(score)
  const radius = (size - 16) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#27272a" strokeWidth={8} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={8} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <div className="text-4xl font-bold" style={{ color }}>{score}</div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    </div>
  )
}

interface Props {
  data: HealthData
  cutoffDate: string
}

export default function HealthScoreView({ data, cutoffDate }: Props) {
  const allScores = useMemo(() => computeHealthScores(data), [data])

  const filtered = useMemo(() => {
    if (!cutoffDate) return allScores
    return allScores.filter(s => s.date >= cutoffDate)
  }, [allScores, cutoffDate])

  const rolling = useMemo(() => rollingAvg(filtered), [filtered])

  // Current score (latest 7-day avg)
  const current = rolling.length > 0 ? rolling[rolling.length - 1] : null
  const currentLabel = current ? scoreLabel(current.total) : null

  // Radar data for sub-scores
  const radarData = current ? [
    { category: 'Cardio', score: current.cardio },
    { category: 'Sleep', score: current.sleep },
    { category: 'Activity', score: current.activity },
    { category: 'Body', score: current.body },
  ] : []

  // Latest daily score for detail
  const latestDaily = filtered.length > 0 ? filtered[filtered.length - 1] : null

  if (!current) {
    return <div className="text-zinc-500 text-center py-20">Not enough data to compute a health score.</div>
  }

  return (
    <div className="space-y-6">
      {/* Score ring + sub-scores */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <ScoreRing score={current.total} size={180} label="Health Score" />
          </div>
          <div className="text-sm font-medium" style={{ color: currentLabel?.color }}>{currentLabel?.label}</div>
          <div className="text-xs text-zinc-500">7-day average</div>
        </div>

        <div className="space-y-4">
          {/* Sub-score cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Cardio', score: current.cardio, icon: '❤️' },
              { label: 'Sleep', score: current.sleep, icon: '🌙' },
              { label: 'Activity', score: current.activity, icon: '🏃' },
              { label: 'Body', score: current.body, icon: '⚖️' },
            ].map(s => {
              const sl = scoreLabel(s.score)
              return (
                <div key={s.label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span>{s.icon}</span>
                    <span className="text-zinc-400 text-xs">{s.label}</span>
                  </div>
                  <div className="text-3xl font-bold" style={{ color: sl.color }}>{s.score}</div>
                  <div className="text-xs mt-1" style={{ color: sl.color }}>{sl.label}</div>
                </div>
              )
            })}
          </div>

          {/* Radar */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                  <PolarGrid stroke="#27272a" />
                  <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                  <Radar dataKey="score" stroke={COLORS.green} fill={COLORS.green} fillOpacity={0.15} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Data confidence */}
      {latestDaily && (
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-zinc-600" style={{ width: `${latestDaily.confidence * 100}%` }} />
          </div>
          <span>{latestDaily.metricsUsed}/{latestDaily.metricsTotal} metrics available</span>
        </div>
      )}

      {/* Score over time */}
      {rolling.length > 7 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-1">Health Score Over Time</h3>
          <p className="text-xs text-zinc-500 mb-2">7-day rolling average</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
              <AreaChart margin={chartMargin} data={rolling}>
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v, name) => [`${v}`, name === 'total' ? 'Total' : String(name)]}
                />
                <Area type="monotone" dataKey="total" stroke={COLORS.green} fill="url(#scoreGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Sub-score breakdown over time */}
      {rolling.length > 7 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[
            { key: 'cardio', label: 'Cardio Score', color: COLORS.red },
            { key: 'sleep', label: 'Sleep Score', color: COLORS.purple },
            { key: 'activity', label: 'Activity Score', color: COLORS.blue },
            { key: 'body', label: 'Body Score', color: COLORS.orange },
          ].map(({ key, label, color }) => (
            <div key={key} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <h3 className="text-sm font-medium text-zinc-300 mb-2">{label}</h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                  <AreaChart margin={chartMargin} data={rolling}>
                    <defs>
                      <linearGradient id={`${key}ScoreGrad`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDate} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#71717a' }} />
                    <Tooltip {...tooltipStyle} formatter={(v) => [`${v}`, label]} />
                    <Area type="monotone" dataKey={key} stroke={color} fill={`url(#${key}ScoreGrad)`} strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-600 text-center">
        Score based on clinical thresholds from ACSM, WHO, and mortality meta-analyses. Not a diagnostic tool.
      </p>
    </div>
  )
}
