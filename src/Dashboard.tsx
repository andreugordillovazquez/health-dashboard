import { useMemo, useState, useEffect, useCallback, lazy, Suspense, Fragment, type ReactNode } from 'react'
import {
  XAxis, YAxis, Tooltip, BarChart, Bar,
  CartesianGrid, Area, AreaChart,
} from 'recharts'
import type { HealthData, DailyMetrics } from './types'
import {
  LayoutDashboard, Trophy, CalendarDays, CalendarRange, Heart, Activity,
  Scale, Moon, Sun, Headphones, GitCompareArrows, Dumbbell, Route, Map, Upload,
  Gauge, AlertTriangle, Sparkles, Droplets, PanelLeftClose, PanelLeftOpen,
  SunMedium, MoonStar, Footprints, Zap, TrendingUp,
} from 'lucide-react'
import { computeTrends, computeExtraTrends, groupedAverage, workoutSummary, monthlyWorkouts } from './analysis'
import type { ExtraTrendInput } from './analysis'
import { COLORS, chartMargin, StatBox, ChartCard, SectionHeader, TabHeader, ChartTooltip, shortDateCompact, shortMonth, fmt, humanizeWorkoutType, useChartTheme, TabSkeleton, EmptyState } from './ui'

const TrainingViewer = lazy(() => import('./TrainingViewer'))
const SleepAnalysis = lazy(() => import('./SleepAnalysis'))
const Correlations = lazy(() => import('./Correlations'))
const RouteHeatmap = lazy(() => import('./RouteHeatmap'))
const BodyComposition = lazy(() => import('./BodyComposition'))
const Cardio = lazy(() => import('./Cardio'))
const AudioExposure = lazy(() => import('./AudioExposure'))
const Daylight = lazy(() => import('./Daylight'))
const RouteComparison = lazy(() => import('./RouteComparison'))
const PersonalRecords = lazy(() => import('./PersonalRecords'))
const YearInReview = lazy(() => import('./YearInReview'))
const CalendarHeatmap = lazy(() => import('./CalendarHeatmap'))
const HealthScoreView = lazy(() => import('./HealthScoreView'))
const AnomalyDetection = lazy(() => import('./AnomalyDetection'))
const AIInsights = lazy(() => import('./AIInsights'))
const MenstrualCycle = lazy(() => import('./MenstrualCycle'))
const GarminTraining = lazy(() => import('./GarminTraining'))
const Mobility = lazy(() => import('./Mobility'))
const RunningDynamics = lazy(() => import('./RunningDynamics'))
const TrainingLoad = lazy(() => import('./TrainingLoad'))

type TimeRange = '1w' | '3m' | '6m' | '1y' | 'all'
type Granularity = 'daily' | 'weekly' | 'monthly'
type Tab = 'overview' | 'score' | 'anomalies' | 'insights' | 'records' | 'yearly' | 'calendar' | 'cardio' | 'body' | 'sleep' | 'menstrual' | 'daylight' | 'audio' | 'correlations' | 'trainings' | 'compare' | 'heatmap' | 'garmin-training' | 'mobility' | 'running' | 'load'

const Loading = <TabSkeleton />

const GROUP_LABELS: Record<number, string> = {
  1: 'Dashboard',
  2: 'History',
  3: 'Health',
  4: 'Analysis',
  5: 'Routes',
}

const VALID_TABS = new Set<Tab>(['overview', 'score', 'anomalies', 'insights', 'records', 'yearly', 'calendar', 'cardio', 'body', 'sleep', 'menstrual', 'daylight', 'audio', 'correlations', 'trainings', 'compare', 'heatmap', 'garmin-training', 'mobility', 'running', 'load'])
const VALID_RANGES = new Set<TimeRange>(['1w', '3m', '6m', '1y', 'all'])
const VALID_GRANULARITIES = new Set<Granularity>(['daily', 'weekly', 'monthly'])

function parseHash(): { tab?: Tab; range?: TimeRange; granularity?: Granularity } {
  const hash = window.location.hash.slice(1)
  if (!hash) return {}
  const params = new URLSearchParams(hash)
  const t = params.get('tab') as Tab | null
  const r = params.get('range') as TimeRange | null
  const g = params.get('granularity') as Granularity | null
  return {
    tab: t && VALID_TABS.has(t) ? t : undefined,
    range: r && VALID_RANGES.has(r) ? r : undefined,
    granularity: g && VALID_GRANULARITIES.has(g) ? g : undefined,
  }
}

function useTheme() {
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('health-dashboard-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return 'dark'
  })

  const setTheme = useCallback((t: 'light' | 'dark') => {
    setThemeState(t)
    localStorage.setItem('health-dashboard-theme', t)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  return [theme, setTheme] as const
}

export default function Dashboard({ data, onReset }: { data: HealthData; onReset: () => void }) {
  const initial = parseHash()
  const [range, setRange] = useState<TimeRange>(initial.range ?? 'all')
  const [granularity, setGranularity] = useState<Granularity>(initial.granularity ?? 'weekly')
  const [tab, setTab] = useState<Tab>(initial.tab ?? 'overview')
  const [theme, setTheme] = useTheme()
  const ct = useChartTheme()

  // Sync state → URL hash
  useEffect(() => {
    const params = new URLSearchParams()
    if (tab !== 'overview') params.set('tab', tab)
    if (range !== 'all') params.set('range', range)
    if (granularity !== 'weekly') params.set('granularity', granularity)
    const hash = params.toString()
    const newUrl = hash ? `#${hash}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [tab, range, granularity])

  // Listen for browser back/forward
  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHash()
      if (parsed.tab) setTab(parsed.tab)
      if (parsed.range) setRange(parsed.range)
      if (parsed.granularity) setGranularity(parsed.granularity)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Idle-prefetch likely-next tab chunks so cold switches feel instant.
  useEffect(() => {
    const prefetch = () => {
      const loaders: Record<string, () => Promise<unknown>> = {
        score: () => import('./HealthScoreView'),
        cardio: () => import('./Cardio'),
        sleep: () => import('./SleepAnalysis'),
        body: () => import('./BodyComposition'),
        records: () => import('./PersonalRecords'),
        calendar: () => import('./CalendarHeatmap'),
        trainings: () => import('./TrainingViewer'),
      }
      // Map the current tab to its most likely neighbors.
      const neighbors: Record<string, string[]> = {
        overview: ['score', 'cardio'],
        score: ['cardio', 'sleep'],
        cardio: ['body', 'sleep'],
        body: ['cardio', 'sleep'],
        sleep: ['cardio', 'body'],
        records: ['calendar', 'cardio'],
      }
      const targets = neighbors[tab] ?? ['score', 'cardio']
      for (const key of targets) loaders[key]?.()
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number }).requestIdleCallback
    if (ric) ric(prefetch, { timeout: 2000 })
    else setTimeout(prefetch, 500)
  }, [tab])
  const hasGpx = data.gpxFiles.size > 0
  const hasSleep = data.sleepRecords.length > 0
  const hasBody = data.bodyRecords.length > 0
  const hasCardio = data.cardioRecords.length > 0
  const hasAudio = data.dailyAudio.length > 0
  const hasDaylight = data.dailyDaylight.length > 0
  const hasMenstrual = data.menstrualRecords.length > 0
  const hasMobility = data.dailyMobility.length > 0
  const hasRunning = data.runningDynamics.length > 0
  const hasGarmin = data.sourceMode === 'garmin' && !!data.garminMetrics

  const allMetrics = useMemo(() => {
    return Array.from(data.dailyMetrics.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const cutoffDate = useMemo(() => {
    if (range === 'all') return ''
    const now = new Date()
    if (range === '1w') {
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
      return cutoff.toISOString().substring(0, 10)
    }
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

  const trendFor = (metric: string) => {
    const t = trends.find(t => t.metric === metric)
    return t ? { direction: t.direction, positive: t.positive, changePercent: t.changePercent } : undefined
  }

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

  // Spark data for overview stat boxes
  const sparkFor = (key: keyof DailyMetrics) => recent30.map(m => m[key] as number).filter(v => v !== null && v > 0)

  // Highlights for overview
  const highlights = useMemo(() => {
    const items: { icon: string; text: string; color: string }[] = []

    // Best trend
    const bestTrend = trends.find(t => t.positive && t.changePercent > 0)
    if (bestTrend) items.push({ icon: '📈', text: `${bestTrend.metric} improved ${bestTrend.changePercent}% over the last 30 days`, color: 'text-green-400' })

    // Worst trend
    const worstTrend = [...trends].reverse().find(t => !t.positive && t.changePercent > 5)
    if (worstTrend) items.push({ icon: '📉', text: `${worstTrend.metric} declined ${worstTrend.changePercent}% — worth keeping an eye on`, color: 'text-red-400' })

    // Step streak
    const stepStreak = (() => {
      let streak = 0
      for (let i = allMetrics.length - 1; i >= 0; i--) {
        if (allMetrics[i].steps >= 10000) streak++
        else break
      }
      return streak
    })()
    if (stepStreak >= 3) items.push({ icon: '🔥', text: `${stepStreak}-day streak of 10,000+ steps`, color: 'text-orange-400' })

    // Sleep consistency
    if (avgSleep !== null && avgSleep >= 7.5) items.push({ icon: '😴', text: `Averaging ${avgSleep.toFixed(1)}h sleep — meeting the recommended 7-9h target`, color: 'text-cyan-400' })
    else if (avgSleep !== null && avgSleep < 6.5) items.push({ icon: '⚠️', text: `Only ${avgSleep.toFixed(1)}h avg sleep — below the recommended minimum of 7h`, color: 'text-red-400' })

    // Best workout week
    if (workoutsByMonth.length > 0) {
      const lastMonth = workoutsByMonth[workoutsByMonth.length - 1]
      const prevMonth = workoutsByMonth.length > 1 ? workoutsByMonth[workoutsByMonth.length - 2] : null
      if (prevMonth && lastMonth.count > prevMonth.count) {
        items.push({ icon: '💪', text: `${lastMonth.count} workouts this month — up from ${prevMonth.count} last month`, color: 'text-blue-400' })
      }
    }

    // Resting HR milestone
    if (avgHR !== null && avgHR <= 60) items.push({ icon: '❤️', text: `Resting HR at ${Math.round(avgHR)} bpm — athlete-level cardiovascular fitness`, color: 'text-green-400' })

    // VO2 Max
    if (latestVO2 !== null && latestVO2 >= 45) items.push({ icon: '🫁', text: `VO2 Max at ${latestVO2.toFixed(1)} — above average cardiorespiratory fitness`, color: 'text-green-400' })

    return items.slice(0, 5) // Max 5 highlights
  }, [trends, allMetrics, avgSleep, workoutsByMonth, avgHR, latestVO2])

  const [sidebarOpen, setSidebarOpen] = useState(true)

  const tabs: { key: Tab; label: string; icon: ReactNode; show: boolean; group: number }[] = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} />, show: true, group: 1 },
    { key: 'score', label: 'Score', icon: <Gauge size={16} />, show: true, group: 1 },
    { key: 'anomalies', label: 'Anomalies', icon: <AlertTriangle size={16} />, show: true, group: 1 },
    { key: 'insights', label: 'AI Insights', icon: <Sparkles size={16} />, show: true, group: 1 },
    { key: 'records', label: 'Records', icon: <Trophy size={16} />, show: true, group: 2 },
    { key: 'yearly', label: 'Yearly', icon: <CalendarDays size={16} />, show: true, group: 2 },
    { key: 'calendar', label: 'Calendar', icon: <CalendarRange size={16} />, show: true, group: 2 },
    { key: 'cardio', label: 'Cardio', icon: <Heart size={16} />, show: hasCardio, group: 3 },
    { key: 'body', label: 'Body', icon: <Scale size={16} />, show: hasBody, group: 3 },
    { key: 'sleep', label: 'Sleep', icon: <Moon size={16} />, show: hasSleep, group: 3 },
    { key: 'menstrual', label: 'Cycle', icon: <Droplets size={16} />, show: hasMenstrual || data.profile.sex === 'HKBiologicalSexFemale', group: 3 },
    { key: 'daylight', label: 'Daylight', icon: <Sun size={16} />, show: hasDaylight, group: 3 },
    { key: 'audio', label: 'Audio', icon: <Headphones size={16} />, show: hasAudio, group: 3 },
    { key: 'mobility', label: 'Mobility', icon: <Footprints size={16} />, show: hasMobility, group: 3 },
    { key: 'running', label: 'Running', icon: <Zap size={16} />, show: hasRunning, group: 3 },
    { key: 'load', label: 'Training Load', icon: <TrendingUp size={16} />, show: data.workouts.length >= 7, group: 4 },
    { key: 'correlations', label: 'Correlations', icon: <GitCompareArrows size={16} />, show: true, group: 4 },
    { key: 'trainings', label: 'Trainings', icon: <Dumbbell size={16} />, show: hasGpx, group: 5 },
    { key: 'compare', label: 'Compare', icon: <Route size={16} />, show: hasGpx, group: 5 },
    { key: 'heatmap', label: 'Heatmap', icon: <Map size={16} />, show: hasGpx, group: 5 },
    { key: 'garmin-training', label: 'Training', icon: <Activity size={16} />, show: hasGarmin, group: 3 },
  ]
  const visibleTabs = tabs.filter(t => t.show)

  const showControls = tab === 'overview' || tab === 'score' || tab === 'cardio' || tab === 'body' || tab === 'sleep' || tab === 'menstrual' || tab === 'daylight' || tab === 'audio' || tab === 'calendar' || tab === 'garmin-training' || tab === 'mobility' || tab === 'running' || tab === 'load'

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Desktop sidebar */}
      <aside
        style={{ width: sidebarOpen ? 176 : 48 }}
        className="hidden md:flex fixed top-0 left-0 h-screen border-r border-zinc-800 bg-zinc-950 flex-col z-[100] overflow-hidden transition-[width] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width]"
      >
        {/* Collapse toggle */}
        <div className="flex items-center px-2 py-3 min-h-[48px]">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <span className={`ml-1 text-[11px] font-semibold tracking-wider uppercase text-zinc-500 whitespace-nowrap transition-opacity duration-150 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}>Health</span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 space-y-0.5">
          {visibleTabs.map((t, i) => {
            const isNewGroup = i > 0 && t.group !== visibleTabs[i - 1].group
            const isFirstItem = i === 0
            return (
              <Fragment key={t.key}>
                {(isNewGroup || isFirstItem) && (
                  <div className={`overflow-hidden whitespace-nowrap transition-all duration-150 px-2 ${sidebarOpen ? 'opacity-100' : 'max-h-0 opacity-0'} ${isNewGroup ? 'pt-3 pb-1' : 'pb-1'}`}>
                    <span className="text-[10px] font-medium tracking-wider uppercase text-zinc-600">{GROUP_LABELS[isFirstItem ? visibleTabs[0].group : t.group]}</span>
                  </div>
                )}
                {isNewGroup && !sidebarOpen && (
                  <div className="h-px bg-zinc-800 my-2 mx-1" />
                )}
                <button
                  onClick={() => setTab(t.key)}
                  className={`group relative w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors duration-150 ${
                    tab === t.key
                      ? "text-white before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:bg-green-500 before:rounded-r"
                      : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <span className={`shrink-0 ${tab === t.key ? 'text-green-400' : ''}`}>{t.icon}</span>
                  <span className={`text-[13px] whitespace-nowrap transition-opacity duration-150 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}>{t.label}</span>
                  <span className={`absolute left-full ml-2 px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 whitespace-nowrap pointer-events-none shadow-lg z-50 transition-opacity duration-150 ${sidebarOpen ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
                    {t.label}
                  </span>
                </button>
              </Fragment>
            )
          })}
        </nav>

        {/* Bottom actions */}
        <div className="border-t border-zinc-800 dark:border-zinc-800 px-2 py-3 space-y-0.5">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="group relative w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors duration-150"
          >
            {theme === 'dark' ? <SunMedium size={16} className="shrink-0" /> : <MoonStar size={16} className="shrink-0" />}
            <span className={`text-[13px] whitespace-nowrap transition-opacity duration-150 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            <span className={`absolute left-full ml-2 px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 whitespace-nowrap pointer-events-none shadow-lg z-50 transition-opacity duration-150 ${sidebarOpen ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
          <button
            onClick={onReset}
            className="group relative w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors duration-150"
          >
            <Upload size={16} className="shrink-0" />
            <span className={`text-[13px] whitespace-nowrap transition-opacity duration-150 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}>New import</span>
            <span className={`absolute left-full ml-2 px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 whitespace-nowrap pointer-events-none shadow-lg z-50 transition-opacity duration-150 ${sidebarOpen ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
              New import
            </span>
          </button>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-[100] bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800">
        <div className="flex overflow-x-auto scrollbar-none">
          {visibleTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-col items-center gap-1 px-3 py-2.5 min-w-[56px] shrink-0 transition-colors ${
                tab === t.key ? 'text-white' : 'text-zinc-500'
              }`}
            >
              {t.icon}
              <span className="text-[9px] leading-none">{t.label}</span>
            </button>
          ))}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex flex-col items-center gap-1 px-3 py-2.5 min-w-[56px] shrink-0 text-zinc-500 transition-colors"
          >
            {theme === 'dark' ? <SunMedium size={16} /> : <MoonStar size={16} />}
            <span className="text-[9px] leading-none">Theme</span>
          </button>
          <button
            onClick={onReset}
            className="flex flex-col items-center gap-1 px-3 py-2.5 min-w-[56px] shrink-0 text-zinc-500 transition-colors"
          >
            <Upload size={16} />
            <span className="text-[9px] leading-none">New</span>
          </button>
        </div>
      </nav>

      {/* Main content — margin for desktop sidebar, padding-bottom for mobile bar */}
      <div style={{ marginLeft: sidebarOpen ? 176 : 48 }} className="min-w-0 max-md:!ml-0 pb-16 md:pb-0">
        {/* Top bar with controls */}
        {showControls && (
          <header className="sticky top-0 bg-zinc-950/90 backdrop-blur-sm z-50 border-b border-zinc-800 px-4 md:px-6 py-2.5 flex items-center gap-2 justify-end">
            <div className="flex bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
              {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors capitalize ${
                    granularity === g ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/25' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1, 3)}
                </button>
              ))}
            </div>
            <div className="flex bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
              {(['1w', '3m', '6m', '1y', 'all'] as TimeRange[]).map(r => (
                <button
                  key={r}
                  onClick={() => {
                    setRange(r)
                    if (r === '1w') setGranularity('daily')
                    else if (r === '3m') setGranularity('daily')
                    else if (r === '6m') setGranularity('weekly')
                    else if (r === '1y') setGranularity('weekly')
                    else setGranularity('weekly')
                  }}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    range === r ? 'bg-green-500/15 text-green-400 ring-1 ring-green-500/25' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </header>
        )}

      <main className="px-4 md:px-6 py-6 space-y-6">
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

        {tab === 'cardio' && (hasCardio ? (
          <Suspense fallback={Loading}>
            <Cardio cardioRecords={data.cardioRecords} dailyHR={data.dailyHR} metrics={allMetrics} dob={data.profile.dob} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Heart size={28} />} title="No cardio data" hint="Your import doesn't contain heart-rate, VO2 max, or other cardio records. Re-export from Apple Health to include them." />
        ))}


        {tab === 'body' && (hasBody ? (
          <Suspense fallback={Loading}>
            <BodyComposition bodyRecords={data.bodyRecords} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Scale size={28} />} title="No body composition data" hint="No weight, body fat, or BMI entries were found in this import." />
        ))}

        {tab === 'sleep' && (
          <Suspense fallback={Loading}>
            <SleepAnalysis sleepRecords={data.sleepRecords} wristTempRecords={data.wristTempRecords} dailyBreathing={data.dailyBreathing} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        )}

        {tab === 'menstrual' && (
          <Suspense fallback={Loading}>
            <MenstrualCycle menstrualRecords={data.menstrualRecords} wristTempRecords={data.wristTempRecords} cutoffDate={cutoffDate} />
          </Suspense>
        )}

        {tab === 'daylight' && (hasDaylight ? (
          <Suspense fallback={Loading}>
            <Daylight dailyDaylight={data.dailyDaylight} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Sun size={28} />} title="No daylight data" hint="Time-in-daylight is recorded by Apple Watch Series 6 and later. No entries were found in this import." />
        ))}

        {tab === 'audio' && (hasAudio ? (
          <Suspense fallback={Loading}>
            <AudioExposure dailyAudio={data.dailyAudio} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Headphones size={28} />} title="No audio exposure data" hint="Headphone and environmental audio levels weren't found in this import." />
        ))}

        {tab === 'mobility' && (hasMobility ? (
          <Suspense fallback={Loading}>
            <Mobility dailyMobility={data.dailyMobility} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Footprints size={28} />} title="No mobility data" hint="Walking speed, step length, and other gait metrics weren't found in this import." />
        ))}

        {tab === 'running' && (hasRunning ? (
          <Suspense fallback={Loading}>
            <RunningDynamics runningDynamics={data.runningDynamics} cutoffDate={cutoffDate} granularity={granularity} />
          </Suspense>
        ) : (
          <EmptyState icon={<Zap size={28} />} title="No running dynamics" hint="Running power, stride length, and similar metrics require a compatible Apple Watch. Nothing was found in this import." />
        ))}

        {tab === 'load' && (data.workouts.length >= 7 ? (
          <Suspense fallback={Loading}>
            <TrainingLoad workouts={data.workouts} cutoffDate={cutoffDate} />
          </Suspense>
        ) : (
          <EmptyState icon={<TrendingUp size={28} />} title="Not enough workout data" hint="Training load needs at least 7 workouts to compute acute-to-chronic ratios. Log a few more and try again." />
        ))}

        {tab === 'correlations' && (
          <Suspense fallback={Loading}>
            <Correlations metrics={allMetrics} sleepRecords={data.sleepRecords} caffeineRecords={data.caffeineRecords} dailyBreathing={data.dailyBreathing} cardioRecords={data.cardioRecords} dailyDaylight={data.dailyDaylight} />
          </Suspense>
        )}

        {tab === 'trainings' && (hasGpx ? (
          <Suspense fallback={Loading}>
            <TrainingViewer workouts={data.workouts} gpxFiles={data.gpxFiles} hrTimeline={data.hrTimeline} dob={data.profile.dob} />
          </Suspense>
        ) : (
          <EmptyState icon={<Dumbbell size={28} />} title="No GPX routes found" hint="Drag the export folder that includes your workout-routes/*.gpx files to see trainings on a map." />
        ))}

        {tab === 'compare' && (hasGpx ? (
          <Suspense fallback={Loading}>
            <RouteComparison gpxFiles={data.gpxFiles} />
          </Suspense>
        ) : (
          <EmptyState icon={<Route size={28} />} title="No routes to compare" hint="Comparison needs at least two GPX routes from your Apple Health export." />
        ))}

        {tab === 'heatmap' && (hasGpx ? (
          <Suspense fallback={Loading}>
            <RouteHeatmap gpxFiles={data.gpxFiles} />
          </Suspense>
        ) : (
          <EmptyState icon={<Map size={28} />} title="No routes for a heatmap" hint="The heatmap aggregates your GPX routes, none of which were found in this import." />
        ))}

        {tab === 'garmin-training' && (hasGarmin && data.garminMetrics ? (
          <Suspense fallback={Loading}>
            <GarminTraining garminMetrics={data.garminMetrics} granularity={granularity} dateRange={[cutoffDate || '2000-01-01', '2099-12-31']} />
          </Suspense>
        ) : (
          <EmptyState icon={<Activity size={28} />} title="No Garmin training data" hint="Switch the source to Garmin on the upload screen and select your Garmin export folder to see training metrics." />
        ))}

        {tab === 'overview' && <>
        {/* Key Metrics */}
        <TabHeader title="Overview" description="Your health at a glance — key metrics, recent highlights, and trends from the last 30 days." />
        <SectionHeader>At a Glance</SectionHeader>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <StatBox label="Steps" value={fmt(avgSteps)} unit="/day" trend={trendFor('Steps')} sub="30d avg" color={COLORS.blue} sparkData={sparkFor('steps')} />
          <StatBox label="Sleep" value={fmt(avgSleep, 1)} unit="hrs" trend={trendFor('Sleep')} sub="30d avg" color={COLORS.cyan} sparkData={sparkFor('sleepHours')} />
          <StatBox label="Resting HR" value={fmt(avgHR, 0)} unit="bpm" trend={trendFor('Resting Heart Rate')} sub="30d avg" color={COLORS.red} sparkData={sparkFor('restingHeartRate')} />
          <StatBox label="HRV" value={fmt(avgHRV, 0)} unit="ms" trend={trendFor('Heart Rate Variability')} sub="30d avg" color={COLORS.purple} sparkData={sparkFor('hrv')} />
          <StatBox label="Weight" value={fmt(latestWeight, 1)} unit="kg" trend={trendFor('Weight')} sub="Latest" color={COLORS.orange} sparkData={sparkFor('weight')} />
          <StatBox label="VO2 Max" value={fmt(latestVO2, 1)} unit="mL/kg/min" trend={trendFor('VO2 Max')} sub="Latest" color={COLORS.green} sparkData={sparkFor('vo2max')} />
          <StatBox label="Distance" value={fmt(avgMetric(recent30, 'distance'), 1)} unit="km/day" trend={trendFor('Distance')} sub="30d avg" color={COLORS.green} sparkData={sparkFor('distance')} />
          <StatBox label="Workouts" value={`${totalWorkouts}`} unit="total" sub={`${workoutsByMonth.length > 0 ? workoutsByMonth[workoutsByMonth.length - 1]?.count || 0 : 0} this month`} />
        </div>

        {/* Highlights */}
        {highlights.length > 0 && (
          <>
            <SectionHeader>Highlights</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {highlights.map((h, i) => (
                <div key={i} className="flex items-start gap-3 bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3">
                  <span className="text-lg shrink-0 mt-0.5">{h.icon}</span>
                  <p className={`text-xs leading-relaxed ${h.color}`}>{h.text}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Trends grid */}
        {trends.length > 0 && (
          <>
            <SectionHeader>30-Day Trends</SectionHeader>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
              {trends.map(t => (
                <div key={t.metric} className="flex items-center justify-between bg-zinc-900 rounded-lg border border-zinc-800 px-3 py-2">
                  <span className="text-xs text-zinc-400 truncate mr-2">{t.metric}</span>
                  <span className={`text-xs font-medium tabular-nums whitespace-nowrap ${t.positive ? 'text-green-400' : 'text-red-400'}`}>
                    {t.direction === 'up' ? '+' : '−'}{t.changePercent}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Key charts */}
        <SectionHeader>Charts</SectionHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {stepsData.length > 0 && (
              <ChartCard title="Steps" chartData={stepsData}>
                <AreaChart margin={chartMargin} data={stepsData}>
                  <defs>
                    <linearGradient id="stepsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.blue} fill="url(#stepsGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {sleepData.length > 0 && (
              <ChartCard title="Sleep" chartData={sleepData}>
                <AreaChart margin={chartMargin} data={sleepData}>
                  <defs>
                    <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.cyan} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.cyan} fill="url(#sleepGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {hrData.length > 0 && (
              <ChartCard title="Resting Heart Rate" chartData={hrData}>
                <AreaChart margin={chartMargin} data={hrData}>
                  <defs>
                    <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.red} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.red} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.red} fill="url(#hrGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}

            {hrvData.length > 0 && (
              <ChartCard title="Heart Rate Variability" chartData={hrvData}>
                <AreaChart margin={chartMargin} data={hrvData}>
                  <defs>
                    <linearGradient id="hrvGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="value" stroke={COLORS.purple} fill="url(#hrvGrad2)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ChartCard>
            )}
        </div>

        {/* Secondary charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {distanceData.length > 0 && (
            <ChartCard title="Distance (km)" chartData={distanceData}>
              <AreaChart margin={chartMargin} data={distanceData}>
                <defs>
                  <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="value" stroke={COLORS.green} fill="url(#distGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartCard>
          )}

          {weightData.length > 0 && (
            <ChartCard title="Weight (kg)" chartData={weightData}>
              <AreaChart margin={chartMargin} data={weightData}>
                <defs>
                  <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortDateCompact} interval="preserveStartEnd" minTickGap={40} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="value" stroke={COLORS.orange} fill="url(#weightGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ChartCard>
          )}

          {workoutsByMonth.length > 0 && (
            <ChartCard title="Monthly Workouts" chartData={workoutsByMonth}>
              <BarChart margin={chartMargin} data={workoutsByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: ct.tick }} tickFormatter={shortMonth} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill={COLORS.pink} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          )}
        </div>

        {/* Workout breakdown */}
        {topWorkouts.length > 0 && (
          <>
            <SectionHeader>Workouts</SectionHeader>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Workout Types ({totalWorkouts} total)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                {topWorkouts.map(w => (
                  <div key={w.type} className="bg-zinc-800/50 rounded-lg p-3 min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate" title={w.type}>{humanizeWorkoutType(w.type)}</div>
                    <div className="text-lg font-semibold text-zinc-100 mt-1">{w.count}<span className="text-xs text-zinc-500 ml-1">sessions</span></div>
                    <div className="text-xs text-zinc-500 mt-0.5 truncate">{Math.round(w.totalMinutes / 60)}h · {fmt(w.totalCalories)} kcal</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        </>}

        <footer className="text-center text-zinc-600 text-xs py-8">
          All data processed locally in your browser. Nothing is sent to any server.
        </footer>
      </main>
      </div>
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

