import { useState, useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
} from 'recharts'
import type { GpxPoint } from './types'
import 'leaflet/dist/leaflet.css'
import { chartMargin, AISummaryButton, TabHeader, useChartTheme, ChartTooltip } from './ui'

interface ParsedRoute {
  filename: string
  date: string
  points: GpxPoint[]
  totalDistance: number // km
  totalTime: number // seconds
  avgSpeed: number // km/h
  avgPace: number // min/km
  elevationGain: number
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseRoute(text: string, filename: string): ParsedRoute | null {
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

  let totalDist = 0, elevGain = 0
  for (let i = 1; i < points.length; i++) {
    totalDist += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)
    const d = points[i].ele - points[i - 1].ele
    if (d > 0) elevGain += d
  }

  const startTime = points[0]?.time || ''
  const endTime = points[points.length - 1]?.time || ''
  const totalTime = startTime && endTime ? (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000 : 0
  const distKm = totalDist / 1000
  const avgSpeed = totalTime > 0 ? distKm / (totalTime / 3600) : 0
  const avgPace = avgSpeed > 0 ? 60 / avgSpeed : 0

  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/)

  return {
    filename, date: dateMatch?.[1] || startTime.substring(0, 10),
    points, totalDistance: distKm, totalTime, avgSpeed, avgPace,
    elevationGain: Math.round(elevGain),
  }
}

interface RouteGroup {
  name: string
  centerLat: number
  centerLon: number
  routes: ParsedRoute[]
}

// Sample N evenly-spaced points along a route for shape comparison
function sampleRoute(route: ParsedRoute, n = 20): [number, number][] {
  const pts = route.points
  if (pts.length <= n) return pts.map(p => [p.lat, p.lon])
  const step = (pts.length - 1) / (n - 1)
  const result: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * step)
    result.push([pts[idx].lat, pts[idx].lon])
  }
  return result
}

// Compare two routes by shape similarity: what % of sampled points from A
// have a nearby point in B (within threshold meters)
function routeOverlap(samplesA: [number, number][], samplesB: [number, number][], thresholdM = 100): number {
  let matches = 0
  for (const [latA, lonA] of samplesA) {
    for (const [latB, lonB] of samplesB) {
      if (haversine(latA, lonA, latB, lonB) < thresholdM) {
        matches++
        break
      }
    }
  }
  return matches / samplesA.length
}

function groupRoutes(routes: ParsedRoute[]): RouteGroup[] {
  const groups: RouteGroup[] = []
  const used = new Set<number>()

  // Pre-compute sampled shapes
  const samples = routes.map(r => sampleRoute(r, 20))

  for (let i = 0; i < routes.length; i++) {
    if (used.has(i)) continue
    const group: ParsedRoute[] = [routes[i]]
    used.add(i)

    for (let j = i + 1; j < routes.length; j++) {
      if (used.has(j)) continue

      // Quick filter: distance must be within 15%
      const distRatio = Math.min(routes[i].totalDistance, routes[j].totalDistance) /
        Math.max(routes[i].totalDistance, routes[j].totalDistance)
      if (distRatio < 0.85) continue

      // Shape comparison: both directions must overlap 70%+
      const overlapAB = routeOverlap(samples[i], samples[j])
      const overlapBA = routeOverlap(samples[j], samples[i])

      if (overlapAB > 0.7 && overlapBA > 0.7) {
        group.push(routes[j])
        used.add(j)
      }
    }

    if (group.length >= 2) {
      group.sort((a, b) => a.date.localeCompare(b.date))
      groups.push({
        name: `${group[0].totalDistance.toFixed(1)} km route`,
        centerLat: group[0].points[0].lat,
        centerLon: group[0].points[0].lon,
        routes: group,
      })
    }
  }

  return groups.sort((a, b) => b.routes.length - a.routes.length)
}

function FitBounds({ routes }: { routes: ParsedRoute[] }) {
  const map = useMap()
  useEffect(() => {
    if (routes.length === 0) return
    const allPts: [number, number][] = []
    for (const r of routes) {
      for (let i = 0; i < r.points.length; i += Math.max(1, Math.floor(r.points.length / 20))) {
        allPts.push([r.points[i].lat, r.points[i].lon])
      }
    }
    if (allPts.length > 0) map.fitBounds(allPts, { padding: [30, 30] })
  }, [routes, map])
  return null
}

function formatPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm)
  const secs = Math.round((minPerKm - mins) * 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDate(d: string): string {
  try {
    const date = new Date(d)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  } catch { return d }
}

const ROUTE_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#facc15']

export default function RouteComparison({ gpxFiles }: { gpxFiles: Map<string, File> }) {
  const ct = useChartTheme()
  const [routes, setRoutes] = useState<ParsedRoute[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<number>(0)
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
            return parseRoute(text, filename)
          } catch { return null }
        })
      )
      for (const route of results) {
        if (route) parsed.push(route)
      }
      parsed.sort((a, b) => a.date.localeCompare(b.date))
      setRoutes(parsed)
      setLoading(false)
    }
    load()
  }, [gpxFiles])

  const groups = useMemo(() => groupRoutes(routes), [routes])

  const group = groups[selectedGroup] || null

  // Pace progression chart data
  const paceData = useMemo(() => {
    if (!group) return []
    return group.routes.map((r, i) => ({
      date: r.date,
      pace: Math.round(r.avgPace * 100) / 100,
      speed: Math.round(r.avgSpeed * 10) / 10,
      distance: Math.round(r.totalDistance * 100) / 100,
      elevation: r.elevationGain,
      label: formatDate(r.date),
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
    }))
  }, [group])

  if (loading) return <div className="text-zinc-400 animate-pulse text-center py-12">Analyzing routes...</div>

  if (groups.length === 0) {
    return <div className="text-zinc-500 text-center py-12">No repeated routes found. Routes need similar start points and distances to match.</div>
  }

  return (
    <div className="space-y-4">
      <TabHeader title="Route Comparison" description="Compare GPS routes side by side — pace, elevation, and speed profiles." />
      {/* Group selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {groups.map((g, i) => (
          <button
            key={i}
            onClick={() => setSelectedGroup(i)}
            className={`shrink-0 px-4 py-2 rounded-lg text-sm border transition-colors ${
              i === selectedGroup
                ? 'bg-zinc-800 border-zinc-700 text-white'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="font-medium">{g.routes.length} runs</div>
            <div className="text-xs text-zinc-500">{g.routes[0].totalDistance.toFixed(1)} km avg</div>
          </button>
        ))}
      </div>

      {group && (
        <>
          {/* Map overlay */}
          <div className="rounded-xl overflow-hidden border border-zinc-800 h-72">
            <MapContainer
              key={selectedGroup}
              center={[group.centerLat, group.centerLon]}
              zoom={14}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              {group.routes.map((r, i) => {
                const positions = r.points
                  .filter((_, j) => j % Math.max(1, Math.floor(r.points.length / 300)) === 0)
                  .map(p => [p.lat, p.lon] as [number, number])
                return (
                  <Polyline
                    key={r.filename}
                    positions={positions}
                    pathOptions={{
                      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
                      weight: 2.5,
                      opacity: 0.7,
                    }}
                  />
                )
              })}
              <FitBounds routes={group.routes} />
            </MapContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3">
            {group.routes.map((r, i) => (
              <div key={r.filename} className="flex items-center gap-1.5 text-xs">
                <div className="w-3 h-1 rounded" style={{ background: ROUTE_COLORS[i % ROUTE_COLORS.length] }} />
                <span className="text-zinc-400">{formatDate(r.date)}</span>
                <span className="text-zinc-500">{formatPace(r.avgPace)} /km</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Pace progression */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="text-sm font-medium text-zinc-300">Pace Over Time</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Lower pace = faster. Shows improvement over repeated runs.</p>
                </div>
                <AISummaryButton title="Pace Over Time" description="Lower pace = faster. Shows improvement over repeated runs." chartData={paceData} />
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                  <AreaChart margin={chartMargin} data={paceData}>
                    <defs>
                      <linearGradient id="paceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: ct.tick }} />
                    <YAxis
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 10, fill: ct.tick }}
                      tickFormatter={v => formatPace(v)}
                      reversed
                    />
                    <Tooltip content={<ChartTooltip formatter={(v) => [formatPace(v as number) + ' /km', 'Pace']} />} />
                    <Area type="monotone" dataKey="pace" stroke="#3b82f6" fill="url(#paceGrad)" strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Speed progression */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="text-sm font-medium text-zinc-300">Speed Over Time</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Average speed for each run of this route.</p>
                </div>
                <AISummaryButton title="Speed Over Time" description="Average speed for each run of this route." chartData={paceData} />
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                  <BarChart margin={chartMargin} data={paceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: ct.tick }} />
                    <YAxis tick={{ fontSize: 10, fill: ct.tick }} />
                    <Tooltip content={<ChartTooltip formatter={(v) => [`${v} km/h`, 'Speed']} />} />
                    <Bar dataKey="speed" radius={[4, 4, 0, 0]}>
                      {paceData.map((d, i) => (
                        <rect key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Run details table */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">Run Comparison</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                    <th className="text-left py-2 pr-4">Date</th>
                    <th className="text-right py-2 px-3">Distance</th>
                    <th className="text-right py-2 px-3">Time</th>
                    <th className="text-right py-2 px-3">Pace</th>
                    <th className="text-right py-2 px-3">Speed</th>
                    <th className="text-right py-2 pl-3">Elevation</th>
                  </tr>
                </thead>
                <tbody>
                  {group.routes.map((r, i) => {
                    const isBest = r.avgPace === Math.min(...group.routes.map(x => x.avgPace))
                    return (
                      <tr key={r.filename} className="border-b border-zinc-800/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: ROUTE_COLORS[i % ROUTE_COLORS.length] }} />
                            <span className="text-zinc-200">{formatDate(r.date)}</span>
                            {isBest && <span className="text-xs text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">PR</span>}
                          </div>
                        </td>
                        <td className="text-right py-2 px-3 text-zinc-300">{r.totalDistance.toFixed(2)} km</td>
                        <td className="text-right py-2 px-3 text-zinc-300">{Math.floor(r.totalTime / 60)}:{Math.round(r.totalTime % 60).toString().padStart(2, '0')}</td>
                        <td className={`text-right py-2 px-3 font-mono ${isBest ? 'text-green-400' : 'text-zinc-300'}`}>{formatPace(r.avgPace)}</td>
                        <td className="text-right py-2 px-3 text-zinc-300">{r.avgSpeed.toFixed(1)} km/h</td>
                        <td className="text-right py-2 pl-3 text-zinc-300">{r.elevationGain}m</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
