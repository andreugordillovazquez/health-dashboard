import { useMemo, useState, lazy, Suspense, useRef, useEffect, type ReactNode } from 'react'
import {
  XAxis, YAxis, Tooltip, BarChart, Bar,
  CartesianGrid, Area, AreaChart,
} from 'recharts'
import type { HealthData, DailyMetrics } from './types'
import {
  LayoutDashboard, Trophy, CalendarDays, CalendarRange, Heart, Activity,
  Scale, Moon, Sun, Headphones, GitCompareArrows, Dumbbell, Route, Map, Upload,
  Gauge, AlertTriangle, Sparkles,
} from 'lucide-react'
import { computeTrends, computeExtraTrends, groupedAverage, workoutSummary, monthlyWorkouts } from './analysis'
import type { ExtraTrendInput } from './analysis'
import { COLORS, tooltipStyle, chartMargin, StatBox, ChartCard, shortDateCompact, shortMonth, fmt } from './ui'

const TrainingViewer = lazy(() => import('./TrainingViewer'))
const SleepAnalysis = lazy(() => import('./SleepAnalysis'))
const Correlations = lazy(() => import('./Correlations'))
const RouteHeatmap = lazy(() => import('./RouteHeatmap'))
const BodyComposition = lazy(() => import('./BodyComposition'))
const Cardio = lazy(() => import('./Cardio'))
const AudioExposure = lazy(() => import('./AudioExposure'))
const Daylight = lazy(() => import('./Daylight'))
const ECGViewer = lazy(() => import('./ECGViewer'))
const RouteComparison = lazy(() => import('./RouteComparison'))
const PersonalRecords = lazy(() => import('./PersonalRecords'))
const YearInReview = lazy(() => import('./YearInReview'))
const CalendarHeatmap = lazy(() => import('./CalendarHeatmap'))
const HealthScoreView = lazy(() => import('./HealthScoreView'))
const AnomalyDetection = lazy(() => import('./AnomalyDetection'))
const AIInsights = lazy(() => import('./AIInsights'))

type TimeRange = '3m' | '6m' | '1y' | 'all'
type Granularity = 'daily' | 'weekly' | 'monthly'
type Tab = 'overview' | 'score' | 'anomalies' | 'insights' | 'records' | 'yearly' | 'calendar' | 'cardio' | 'ecg' | 'body' | 'sleep' | 'daylight' | 'audio' | 'correlations' | 'trainings' | 'compare' | 'heatmap'

const Loading = <div className="text-zinc-400 animate-pulse py-20 text-center">Loading...</div>

function TabDropdown({ tabs, value, onChange }: { tabs: { key: string; label: string; icon: ReactNode }[]; value: string; onChange: (v: Tab) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = tabs.find(t => t.key === value)

  return (
    <div ref={ref} className="relative 2xl:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800 transition-colors"
      >
        {current?.icon}
        {current?.label || value}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1 1L5 5L9 1" stroke="#71717a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-lg py-1 shadow-xl z-[100] min-w-[140px]">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { onChange(t.key as Tab); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                t.key === value ? 'text-white bg-zinc-800' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ data, onReset }: { data: HealthData; onReset: () => void }) {
  const [range, setRange] = useState<TimeRange>('all')
  const [granularity, setGranularity] = useState<Granularity>('weekly')
  const [tab, setTab] = useState<Tab>('overview')
  const hasGpx = data.gpxFiles.size > 0
  const hasSleep = data.sleepRecords.length > 0
  const hasBody = data.bodyRecords.length > 0
  const hasCardio = data.cardioRecords.length > 0
  const hasEcg = data.ecgFiles.size > 0
  const hasAudio = data.dailyAudio.length > 0
  const hasDaylight = data.dailyDaylight.length > 0

  const allMetrics = useMemo(() => {
    return Array.from(data.dailyMetrics.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const cutoffDate = useMemo(() => {
    if (range === 'all') return ''
    const now = new Date()
    const months = range === '3m' ? 3 : range === '6m' ? 6 : 12
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
    return cutoff.toISOString().substring(0, 10)
  }, [range])

  const filteredMetrics = useMemo(() => {
    if (!cutoffDate) return allMetrics
    return allMetrics.filter(m => m.date >= cutoffDate)
  }, [allMetrics, cutoffDate])

  const trends = useMemo(() => {
    const base = computeTrends(allMetrics, 30)

    const extras: ExtraTrendInput[] = []

    // VO2 Max
    const vo2 = data.cardioRecords.filter(r => r.type === 'vo2max')
    if (vo2.length > 0) extras.push({ metric: 'VO2 Max', unit: 'mL/kg/min', higherIsGood: true, data: vo2.map(r => ({ date: r.date, value: r.value })) })

    // Walking HR
    const whr = data.cardioRecords.filter(r => r.type === 'walkingHR')
    if (whr.length > 0) extras.push({ metric: 'Walking HR', unit: 'bpm', higherIsGood: false, data: whr.map(r => ({ date: r.date, value: r.value })) })

    // SpO2
    const spo2 = data.dailyBreathing.filter(d => d.spo2 !== null)
    if (spo2.length > 0) extras.push({ metric: 'Blood Oxygen', unit: '%', higherIsGood: true, data: spo2.map(d => ({ date: d.date, value: d.spo2 })) })

    // Breathing disturbances
    const dist = data.dailyBreathing.filter(d => d.disturbances !== null)
    if (dist.length > 0) extras.push({ metric: 'Breathing Disturbances', unit: '/hr', higherIsGood: false, data: dist.map(d => ({ date: d.date, value: d.disturbances })) })

    // Respiratory rate
    const rr = data.dailyBreathing.filter(d => d.respiratoryRate !== null)
    if (rr.length > 0) extras.push({ metric: 'Respiratory Rate', unit: 'br/min', higherIsGood: false, data: rr.map(d => ({ date: d.date, value: d.respiratoryRate })) })

    // Daylight
    if (data.dailyDaylight.length > 0) extras.push({ metric: 'Daylight', unit: 'min', higherIsGood: true, data: data.dailyDaylight.map(d => ({ date: d.date, value: d.minutes })) })

    // Headphone exposure
    const hp = data.dailyAudio.filter(d => d.headphoneAvg !== null)
    if (hp.length > 0) extras.push({ metric: 'Headphone Level', unit: 'dB', higherIsGood: false, data: hp.map(d => ({ date: d.date, value: d.headphoneAvg })) })

    // Weight
    const wt = data.bodyRecords.filter(r => r.weight !== null)
    if (wt.length > 0) extras.push({ metric: 'Weight', unit: 'kg', higherIsGood: false, data: wt.map(r => ({ date: r.date, value: r.weight })) })

    const extra = computeExtraTrends(extras, 30)
    return [...base, ...extra].sort((a, b) => b.changePercent - a.changePercent)
  }, [allMetrics, data])

  const stepsData = useMemo(() => groupedAverage(filteredMetrics, 'steps', granularity), [filteredMetrics, granularity])
  const hrData = useMemo(() => groupedAverage(filteredMetrics, 'restingHeartRate', granularity), [filteredMetrics, granularity])
  const hrvData = useMemo(() => groupedAverage(filteredMetrics, 'hrv', granularity), [filteredMetrics, granularity])
  const sleepData = useMemo(() => groupedAverage(filteredMetrics, 'sleepHours', granularity), [filteredMetrics, granularity])
  const distanceData = useMemo(() => groupedAverage(filteredMetrics, 'distance', granularity), [filteredMetrics, granularity])
  const weightData = useMemo(() => groupedAverage(filteredMetrics, 'weight', granularity), [filteredMetrics, granularity])
  const workoutsByMonth = useMemo(() => monthlyWorkouts(data.workouts), [data.workouts])
  const topWorkouts = useMemo(() => workoutSummary(data.workouts).slice(0, 8), [data.workouts])

  // Summary stats (last 30 days)
  const recent30 = allMetrics.slice(-30)
  const avgSteps = avgMetric(recent30, 'steps')
  const avgSleep = avgMetric(recent30, 'sleepHours')
  const avgHR = avgMetric(recent30, 'restingHeartRate')
  const avgHRV = avgMetric(recent30, 'hrv')
  const latestWeight = findLatest(allMetrics, 'weight')
  const latestVO2 = findLatest(allMetrics, 'vo2max')
  const totalWorkouts = data.workouts.length

  const tabs: { key: Tab; label: string; icon: ReactNode; show: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={13} />, show: true },
    { key: 'score', label: 'Score', icon: <Gauge size={13} />, show: true },
    { key: 'anomalies', label: 'Anomalies', icon: <AlertTriangle size={13} />, show: true },
    { key: 'insights', label: 'AI Insights', icon: <Sparkles size={13} />, show: true },
    { key: 'records', label: 'Records', icon: <Trophy size={13} />, show: true },
    { key: 'yearly', label: 'Yearly', icon: <CalendarDays size={13} />, show: true },
    { key: 'calendar', label: 'Calendar', icon: <CalendarRange size={13} />, show: true },
    { key: 'cardio', label: 'Cardio', icon: <Heart size={13} />, show: hasCardio },
    { key: 'ecg', label: 'ECG', icon: <Activity size={13} />, show: hasEcg },
    { key: 'body', label: 'Body', icon: <Scale size={13} />, show: hasBody },
    { key: 'sleep', label: 'Sleep', icon: <Moon size={13} />, show: hasSleep },
    { key: 'daylight', label: 'Daylight', icon: <Sun size={13} />, show: hasDaylight },
    { key: 'audio', label: 'Audio', icon: <Headphones size={13} />, show: hasAudio },
    { key: 'correlations', label: 'Correlations', icon: <GitCompareArrows size={13} />, show: true },
    { key: 'trainings', label: 'Trainings', icon: <Dumbbell size={13} />, show: hasGpx },
    { key: 'compare', label: 'Compare', icon: <Route size={13} />, show: hasGpx },
    { key: 'heatmap', label: 'Heatmap', icon: <Map size={13} />, show: hasGpx },
  ]

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-3 flex flex-wrap items-center gap-3 sticky top-0 bg-zinc-950/90 backdrop-blur-sm z-[100]">
        {/* Custom dropdown on smaller screens */}
        <TabDropdown tabs={tabs.filter(t => t.show)} value={tab} onChange={setTab} />
        {/* Button bar on wide screens */}
        <nav className="hidden 2xl:flex gap-1 bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
          {tabs.filter(t => t.show).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 text-xs rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {(tab === 'overview' || tab === 'score' || tab === 'cardio' || tab === 'body' || tab === 'sleep' || tab === 'daylight' || tab === 'audio' || tab === 'calendar') && (
            <>
              <div className="flex bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
                {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors capitalize ${
                      granularity === g ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1, 3)}
                  </button>
                ))}
              </div>
              <div className="flex bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
                {(['3m', '6m', '1y', 'all'] as TimeRange[]).map(r => (
                  <button
                    key={r}
                    onClick={() => {
                    setRange(r)
                    if (r === '3m') setGranularity('daily')
                    else if (r === '6m') setGranularity('weekly')
                    else if (r === '1y') setGranularity('weekly')
                    else setGranularity('weekly')
                  }}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      range === r ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </>
          )}
          <button onClick={onReset} className="text-zinc-500 hover:text-zinc-300 text-xs whitespace-nowrap flex items-center gap-1.5">
            <Upload size={12} />
            New
          </button>
        </div>
      </header>

      <main className="px-6 py-6 space-y-4">
        {tab === 'score' && (
          <Suspense fallback={Loading}>
            <HealthScoreView data={data} cutoffDate={cutoffDate} />
          </Suspense>
        )}

        {tab === 'anomalies' && (
          <Suspense fallback={Loading}>
            <AnomalyDetection data={data} metrics={allMetrics} />
          </Suspense>
        )}

        {tab === 'insights' && (
          <Suspense fallback={Loading}>
            <AIInsights data={data} metrics={allMetrics} />
          </Suspense>
        )}

        {tab === 'records' && (
          <Suspense fallback={Loading}>
            <PersonalRecords metrics={allMetrics} workouts={data.workouts} gpxFiles={data.gpxFiles} />
          </Suspense>
        )}

        {tab === 'yearly' && (
          <Suspense fallback={Loading}>
            <YearInReview metrics={allMetrics} workouts={data.workouts} />
          </Suspense>
        )}

        {tab === 'calendar' && (
          <Suspense fallback={Loading}>
            <CalendarHeatmap metrics={allMetrics} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'cardio' && hasCardio && (
          <Suspense fallback={Loading}>
            <Cardio cardioRecords={data.cardioRecords} dailyHR={data.dailyHR} metrics={allMetrics} dob={data.profile.dob} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'ecg' && hasEcg && (
          <Suspense fallback={Loading}>
            <ECGViewer ecgFiles={data.ecgFiles} />
          </Suspense>
        )}

        {tab === 'body' && hasBody && (
          <Suspense fallback={Loading}>
            <BodyComposition bodyRecords={data.bodyRecords} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'sleep' && (
          <Suspense fallback={Loading}>
            <SleepAnalysis sleepRecords={data.sleepRecords} wristTempRecords={data.wristTempRecords} dailyBreathing={data.dailyBreathing} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'daylight' && hasDaylight && (
          <Suspense fallback={Loading}>
            <Daylight dailyDaylight={data.dailyDaylight} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'audio' && hasAudio && (
          <Suspense fallback={Loading}>
            <AudioExposure dailyAudio={data.dailyAudio} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'correlations' && (
          <Suspense fallback={Loading}>
            <Correlations metrics={allMetrics} sleepRecords={data.sleepRecords} caffeineRecords={data.caffeineRecords} dailyBreathing={data.dailyBreathing} cardioRecords={data.cardioRecords} dailyDaylight={data.dailyDaylight} />
          </Suspense>
        )}

        {tab === 'trainings' && hasGpx && (
          <Suspense fallback={Loading}>
            <TrainingViewer workouts={data.workouts} gpxFiles={data.gpxFiles} hrTimeline={data.hrTimeline} dob={data.profile.dob} />
          </Suspense>
        )}

        {tab === 'compare' && hasGpx && (
          <Suspense fallback={Loading}>
            <RouteComparison gpxFiles={data.gpxFiles} />
          </Suspense>
        )}

        {tab === 'heatmap' && hasGpx && (
          <Suspense fallback={Loading}>
            <RouteHeatmap gpxFiles={data.gpxFiles} />
          </Suspense>
        )}

        {tab === 'overview' && <>
        {/* Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <StatBox label="Steps" value={fmt(avgSteps)} unit="/day" sub="30d avg" />
          <StatBox label="Sleep" value={fmt(avgSleep, 1)} unit="hrs" sub="30d avg" />
          <StatBox label="Resting HR" value={fmt(avgHR, 0)} unit="bpm" sub="30d avg" />
          <StatBox label="HRV" value={fmt(avgHRV, 0)} unit="ms" sub="30d avg" />
          <StatBox label="Weight" value={fmt(latestWeight, 1)} unit="kg" sub="Latest" />
          <StatBox label="VO2 Max" value={fmt(latestVO2, 1)} unit="mL/kg/min" sub="Latest" />
          <StatBox label="Distance" value={fmt(avgMetric(recent30, 'distance'), 1)} unit="km/day" sub="30d avg" />
          <StatBox label="Workouts" value={`${totalWorkouts}`} unit="total" sub={`${workoutsByMonth.length > 0 ? workoutsByMonth[workoutsByMonth.length - 1]?.count || 0 : 0} this month`} />
        </div>

        {/* Trends bars */}
        {trends.length > 0 && (
          <div className="space-y-2">
            {trends.some(t => t.positive) && (
              <div className="flex flex-wrap border border-zinc-800 rounded-lg bg-zinc-900/50 divide-x divide-zinc-800/50">
                {trends.filter(t => t.positive).map(t => (
                  <div key={t.metric} className="flex items-center gap-1.5 px-4 py-2.5 shrink-0">
                    <span className="text-sm text-zinc-200">{t.metric}</span>
                    <span className="text-sm font-mono font-medium text-green-400">
                      {t.direction === 'up' ? '▲' : '▼'} {t.changePercent}%
                    </span>
                    <span className="text-xs text-zinc-500">{fmt(t.recentAvg, 1)} {t.unit}</span>
                  </div>
                ))}
              </div>
            )}
            {trends.some(t => !t.positive) && (
              <div className="flex flex-wrap border border-zinc-800 rounded-lg bg-zinc-900/50 divide-x divide-zinc-800/50">
                {trends.filter(t => !t.positive).map(t => (
                  <div key={t.metric} className="flex items-center gap-1.5 px-4 py-2.5 shrink-0">
                    <span className="text-sm text-zinc-200">{t.metric}</span>
                    <span className="text-sm font-mono font-medium text-red-400">
                      {t.direction === 'up' ? '▲' : '▼'} {t.changePercent}%
                    </span>
                    <span className="text-xs text-zinc-500">{fmt(t.recentAvg, 1)} {t.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Key charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {stepsData.length > 0 && (
              <ChartCard title="Steps">
                <AreaChart margin={chartMargin} data={stepsData}>
                  <defs>
                    <linearGradient id="stepsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDateCompact} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.blue} fill="url(#stepsGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {sleepData.length > 0 && (
              <ChartCard title="Sleep">
                <AreaChart margin={chartMargin} data={sleepData}>
                  <defs>
                    <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDateCompact} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.cyan} fill="url(#sleepGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {hrData.length > 0 && (
              <ChartCard title="Resting Heart Rate">
                <AreaChart margin={chartMargin} data={hrData}>
                  <defs>
                    <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDateCompact} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.red} fill="url(#hrGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {hrvData.length > 0 && (
              <ChartCard title="Heart Rate Variability">
                <AreaChart margin={chartMargin} data={hrvData}>
                  <defs>
                    <linearGradient id="hrvGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDateCompact} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                  <Tooltip {...tooltipStyle} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.purple} fill="url(#hrvGrad2)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}
        </div>

        {/* Secondary charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {distanceData.length > 0 && (
            <ChartCard title="Distance (km)">
              <AreaChart margin={chartMargin} data={distanceData}>
                <defs>
                  <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDateCompact} />
                <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#distGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartCard>
          )}

          {weightData.length > 0 && (
            <ChartCard title="Weight (kg)">
              <AreaChart margin={chartMargin} data={weightData}>
                <defs>
                  <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortDateCompact} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="value" stroke={COLORS.orange} fill="url(#weightGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartCard>
          )}

          {workoutsByMonth.length > 0 && (
            <ChartCard title="Monthly Workouts">
              <BarChart margin={chartMargin} data={workoutsByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={shortMonth} />
                <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" fill={COLORS.pink} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          )}
        </div>

        {/* Workout breakdown */}
        {topWorkouts.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Workout Types ({totalWorkouts} total)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
              {topWorkouts.map(w => (
                <div key={w.type} className="bg-zinc-800/50 rounded-lg p-3 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate" title={w.type}>{w.type}</div>
                  <div className="text-lg font-semibold text-zinc-100 mt-1">{w.count}<span className="text-xs text-zinc-500 ml-1">sessions</span></div>
                  <div className="text-xs text-zinc-500 mt-0.5 truncate">{Math.round(w.totalMinutes / 60)}h · {fmt(w.totalCalories)} kcal</div>
                </div>
              ))}
            </div>
          </div>
        )}

        </>}

        <footer className="text-center text-zinc-600 text-xs py-8">
          All data processed locally in your browser. Nothing is sent to any server.
        </footer>
      </main>
    </div>
  )
}

function avgMetric(metrics: DailyMetrics[], key: keyof DailyMetrics): number | null {
  const vals = metrics.map(m => m[key] as number | null).filter((v): v is number => v !== null && v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function findLatest(metrics: DailyMetrics[], key: keyof DailyMetrics): number | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    const v = metrics[i][key]
    if (v !== null && v !== undefined && (v as number) > 0) return v as number
  }
  return null
}

