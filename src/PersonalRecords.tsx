import { useState, useEffect, useMemo, useRef } from 'react'
import type { DailyMetrics, Workout, GpxPoint } from './types'

interface ParsedRoute {
  filename: string
  date: string
  points: GpxPoint[]
  totalDistance: number
  totalTime: number
  avgSpeed: number
  maxSpeed: number
  elevationGain: number
  fastestKm: number | null // pace in min/km
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeFastestKm(points: GpxPoint[]): number | null {
  if (points.length < 10) return null

  // Build cumulative distance and time arrays
  const cumDist: number[] = [0]
  const cumTime: number[] = [0]
  const startMs = new Date(points[0].time).getTime()

  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1] + haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon))
    cumTime.push((new Date(points[i].time).getTime() - startMs) / 1000)
  }

  const totalDist = cumDist[cumDist.length - 1]
  if (totalDist < 1000) return null

  // Sliding window: find the fastest 1km segment
  let bestTime = Infinity
  let j = 0

  for (let i = 0; i < points.length; i++) {
    while (j < points.length - 1 && cumDist[j] - cumDist[i] < 1000) j++
    if (cumDist[j] - cumDist[i] >= 1000) {
      const segTime = cumTime[j] - cumTime[i]
      if (segTime > 0 && segTime < bestTime) bestTime = segTime
    }
  }

  return bestTime < Infinity ? bestTime / 60 : null // min/km
}

function parseRouteForPR(text: string, filename: string): ParsedRoute | null {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'text/xml')
  const trkpts = doc.querySelectorAll('trkpt')
  if (trkpts.length < 10) return null

  const points: GpxPoint[] = []
  trkpts.forEach(pt => {
    points.push({
      lat: parseFloat(pt.getAttribute('lat') || '0'),
      lon: parseFloat(pt.getAttribute('lon') || '0'),
      ele: parseFloat(pt.querySelector('ele')?.textContent || '0'),
      time: pt.querySelector('time')?.textContent || '',
      speed: parseFloat(pt.querySelector('speed')?.textContent || '0'),
    })
  })

  let totalDist = 0, elevGain = 0, maxSpd = 0
  for (let i = 1; i < points.length; i++) {
    totalDist += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)
    const d = points[i].ele - points[i - 1].ele
    if (d > 0) elevGain += d
    if (points[i].speed > maxSpd) maxSpd = points[i].speed
  }

  const startTime = points[0]?.time || ''
  const endTime = points[points.length - 1]?.time || ''
  const totalTime = startTime && endTime ? (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000 : 0
  const distKm = totalDist / 1000
  const avgSpeed = totalTime > 0 ? distKm / (totalTime / 3600) : 0

  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/)
  const fastestKm = computeFastestKm(points)

  return {
    filename, date: dateMatch?.[1] || startTime.substring(0, 10),
    points, totalDistance: distKm, totalTime, avgSpeed,
    maxSpeed: maxSpd * 3.6, elevationGain: Math.round(elevGain), fastestKm,
  }
}

function formatPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm)
  const secs = Math.round((minPerKm - mins) * 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

function formatDate(d: string): string {
  try {
    const date = new Date(d)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

interface PR {
  label: string
  value: string
  sub: string
  date: string
  icon: string
  color: string
}

interface Props {
  metrics: DailyMetrics[]
  workouts: Workout[]
  gpxFiles: Map<string, File>
}

export default function PersonalRecords({ metrics, workouts, gpxFiles }: Props) {
  const [routes, setRoutes] = useState<ParsedRoute[]>([])
  const [loading, setLoading] = useState(true)
  const parsedRef = useRef(false)

  useEffect(() => {
    if (parsedRef.current) return
    parsedRef.current = true
    async function load() {
      const parsed: ParsedRoute[] = []
      const entries = Array.from(gpxFiles.entries())
      const results = await Promise.all(
        entries.map(async ([filename, file]) => {
          try {
            const text = await file.text()
            return parseRouteForPR(text, filename)
          } catch { return null }
        })
      )
      for (const route of results) {
        if (route) parsed.push(route)
      }
      setRoutes(parsed)
      setLoading(false)
    }
    load()
  }, [gpxFiles])

  const records = useMemo(() => {
    const prs: PR[] = []

    // === From GPX routes ===

    // Fastest km
    const routesWithKm = routes.filter(r => r.fastestKm !== null)
    if (routesWithKm.length > 0) {
      const best = routesWithKm.reduce((a, b) => (a.fastestKm! < b.fastestKm! ? a : b))
      prs.push({
        label: 'Fastest Kilometer',
        value: formatPace(best.fastestKm!),
        sub: `/km on a ${best.totalDistance.toFixed(1)} km run`,
        date: best.date,
        icon: '⚡', color: '#facc15',
      })
    }

    // Fastest avg speed (routes > 1km)
    const longRoutes = routes.filter(r => r.totalDistance > 1)
    if (longRoutes.length > 0) {
      const best = longRoutes.reduce((a, b) => (a.avgSpeed > b.avgSpeed ? a : b))
      prs.push({
        label: 'Fastest Avg Speed',
        value: `${best.avgSpeed.toFixed(1)} km/h`,
        sub: `${best.totalDistance.toFixed(1)} km in ${formatDuration(best.totalTime)}`,
        date: best.date,
        icon: '🏃', color: '#3b82f6',
      })
    }

    // Top speed
    if (routes.length > 0) {
      const best = routes.reduce((a, b) => (a.maxSpeed > b.maxSpeed ? a : b))
      if (best.maxSpeed > 0) {
        prs.push({
          label: 'Top Speed',
          value: `${best.maxSpeed.toFixed(1)} km/h`,
          sub: `During a ${best.totalDistance.toFixed(1)} km activity`,
          date: best.date,
          icon: '💨', color: '#06b6d4',
        })
      }
    }

    // Longest route by distance
    if (routes.length > 0) {
      const best = routes.reduce((a, b) => (a.totalDistance > b.totalDistance ? a : b))
      prs.push({
        label: 'Longest Route',
        value: `${best.totalDistance.toFixed(2)} km`,
        sub: formatDuration(best.totalTime),
        date: best.date,
        icon: '📏', color: '#22c55e',
      })
    }

    // Longest duration route
    if (routes.length > 0) {
      const best = routes.reduce((a, b) => (a.totalTime > b.totalTime ? a : b))
      prs.push({
        label: 'Longest Duration',
        value: formatDuration(best.totalTime),
        sub: `${best.totalDistance.toFixed(1)} km`,
        date: best.date,
        icon: '⏱', color: '#a855f7',
      })
    }

    // Most elevation gain
    if (routes.length > 0) {
      const best = routes.reduce((a, b) => (a.elevationGain > b.elevationGain ? a : b))
      if (best.elevationGain > 0) {
        prs.push({
          label: 'Most Elevation Gain',
          value: `${best.elevationGain} m`,
          sub: `${best.totalDistance.toFixed(1)} km route`,
          date: best.date,
          icon: '⛰', color: '#f97316',
        })
      }
    }

    // === From DailyMetrics ===

    // Most steps in a day
    if (metrics.length > 0) {
      const best = metrics.reduce((a, b) => (a.steps > b.steps ? a : b))
      if (best.steps > 0) {
        prs.push({
          label: 'Most Steps (Day)',
          value: best.steps.toLocaleString(),
          sub: 'steps in a single day',
          date: best.date,
          icon: '👟', color: '#ec4899',
        })
      }
    }

    // Most distance in a day
    if (metrics.length > 0) {
      const best = metrics.reduce((a, b) => (a.distance > b.distance ? a : b))
      if (best.distance > 0) {
        prs.push({
          label: 'Most Distance (Day)',
          value: `${best.distance.toFixed(1)} km`,
          sub: 'walking + running in one day',
          date: best.date,
          icon: '🗺', color: '#22c55e',
        })
      }
    }

    // Most active energy
    if (metrics.length > 0) {
      const best = metrics.reduce((a, b) => (a.activeEnergy > b.activeEnergy ? a : b))
      if (best.activeEnergy > 0) {
        prs.push({
          label: 'Most Calories Burned',
          value: `${best.activeEnergy.toLocaleString()} kcal`,
          sub: 'active energy in one day',
          date: best.date,
          icon: '🔥', color: '#ef4444',
        })
      }
    }

    // Longest sleep
    const sleepDays = metrics.filter(m => m.sleepHours && m.sleepHours > 0)
    if (sleepDays.length > 0) {
      const best = sleepDays.reduce((a, b) => (a.sleepHours! > b.sleepHours! ? a : b))
      prs.push({
        label: 'Longest Sleep',
        value: `${best.sleepHours!.toFixed(1)} hrs`,
        sub: 'in a single night',
        date: best.date,
        icon: '😴', color: '#6366f1',
      })
    }

    // Best HRV
    const hrvDays = metrics.filter(m => m.hrv && m.hrv > 0)
    if (hrvDays.length > 0) {
      const best = hrvDays.reduce((a, b) => (a.hrv! > b.hrv! ? a : b))
      prs.push({
        label: 'Highest HRV',
        value: `${Math.round(best.hrv!)} ms`,
        sub: 'best autonomic recovery',
        date: best.date,
        icon: '💓', color: '#a855f7',
      })
    }

    // Lowest resting HR
    const hrDays = metrics.filter(m => m.restingHeartRate && m.restingHeartRate > 30)
    if (hrDays.length > 0) {
      const best = hrDays.reduce((a, b) => (a.restingHeartRate! < b.restingHeartRate! ? a : b))
      prs.push({
        label: 'Lowest Resting HR',
        value: `${Math.round(best.restingHeartRate!)} bpm`,
        sub: 'peak cardiovascular fitness',
        date: best.date,
        icon: '❤️', color: '#ef4444',
      })
    }

    // === From Workouts ===

    // Most calories in a workout
    if (workouts.length > 0) {
      const best = workouts.reduce((a, b) => (a.calories > b.calories ? a : b))
      if (best.calories > 0) {
        prs.push({
          label: 'Most Workout Calories',
          value: `${best.calories.toLocaleString()} kcal`,
          sub: `${best.type} · ${best.duration} min`,
          date: best.date,
          icon: '💪', color: '#f97316',
        })
      }
    }

    // Longest workout
    if (workouts.length > 0) {
      const best = workouts.reduce((a, b) => (a.duration > b.duration ? a : b))
      if (best.duration > 0) {
        prs.push({
          label: 'Longest Workout',
          value: formatDuration(best.duration * 60),
          sub: best.type,
          date: best.date,
          icon: '🏋️', color: '#3b82f6',
        })
      }
    }

    // Most exercise minutes in a day
    const exDays = metrics.filter(m => m.exerciseMinutes > 0)
    if (exDays.length > 0) {
      const best = exDays.reduce((a, b) => (a.exerciseMinutes > b.exerciseMinutes ? a : b))
      prs.push({
        label: 'Most Exercise (Day)',
        value: `${Math.round(best.exerciseMinutes)} min`,
        sub: 'exercise ring in one day',
        date: best.date,
        icon: '🎯', color: '#22c55e',
      })
    }

    return prs
  }, [routes, metrics, workouts])

  if (loading) return <div className="text-zinc-400 animate-pulse text-center py-12">Computing personal records...</div>

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {records.map(pr => (
        <div key={pr.label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex gap-3">
          <div className="text-2xl">{pr.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-zinc-500">{pr.label}</div>
            <div className="text-xl font-semibold tracking-tight mt-0.5" style={{ color: pr.color }}>{pr.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{pr.sub}</div>
            <div className="text-xs text-zinc-600 mt-1">{formatDate(pr.date)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
