import { useState, useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { StatBox, TabHeader } from './ui'

interface ParsedRoute {
  filename: string
  points: [number, number][]
  date: string
  distance: number // km
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseGpxForHeatmap(text: string, filename: string): ParsedRoute | null {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'text/xml')
  const trkpts = doc.querySelectorAll('trkpt')
  if (trkpts.length < 2) return null

  const points: [number, number][] = []
  let totalDist = 0

  // Downsample for performance — keep every Nth point
  const step = Math.max(1, Math.floor(trkpts.length / 300))

  let prevLat = 0, prevLon = 0
  trkpts.forEach((pt, i) => {
    const lat = parseFloat(pt.getAttribute('lat') || '0')
    const lon = parseFloat(pt.getAttribute('lon') || '0')
    if (i > 0) totalDist += haversine(prevLat, prevLon, lat, lon)
    prevLat = lat
    prevLon = lon
    if (i % step === 0) points.push([lat, lon])
  })

  // Extract date from filename: route_2025-10-09_2.50pm.gpx
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/)
  const date = dateMatch ? dateMatch[1] : ''

  return { filename, points, date, distance: totalDist / 1000 }
}

function FitAllBounds({ routes }: { routes: ParsedRoute[] }) {
  const map = useMap()
  const fitted = useRef(false)

  useEffect(() => {
    if (fitted.current || routes.length === 0) return
    fitted.current = true

    const allPoints: [number, number][] = []
    for (const r of routes) {
      // Sample a few points per route for bounds
      for (let i = 0; i < r.points.length; i += Math.max(1, Math.floor(r.points.length / 10))) {
        allPoints.push(r.points[i])
      }
    }
    if (allPoints.length > 0) {
      map.fitBounds(allPoints, { padding: [30, 30] })
    }
  }, [routes, map])

  return null
}

export default function RouteHeatmap({ gpxFiles }: { gpxFiles: Map<string, File> }) {
  const [routes, setRoutes] = useState<ParsedRoute[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
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
            return parseGpxForHeatmap(text, filename)
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

  // Stats
  const stats = useMemo(() => {
    if (routes.length === 0) return null
    const totalDist = routes.reduce((sum, r) => sum + r.distance, 0)
    const years = new Set(routes.map(r => r.date.substring(0, 4)))
    const avgPerRoute = totalDist / routes.length
    return { totalRoutes: routes.length, totalDist, avgPerRoute, years: years.size }
  }, [routes])

  // Frequency: count how many routes pass through each approximate area
  // Use this to assign opacity — more frequently visited = brighter
  const routeOpacities = useMemo(() => {
    // Grid-based frequency counting
    const grid = new Map<string, number>()
    for (const route of routes) {
      const visited = new Set<string>()
      for (const [lat, lon] of route.points) {
        // ~200m grid cells
        const key = `${Math.round(lat * 500)},${Math.round(lon * 500)}`
        if (!visited.has(key)) {
          visited.add(key)
          grid.set(key, (grid.get(key) || 0) + 1)
        }
      }
    }

    // For each route, compute average frequency of its cells
    return routes.map(route => {
      let totalFreq = 0
      let count = 0
      for (const [lat, lon] of route.points) {
        const key = `${Math.round(lat * 500)},${Math.round(lon * 500)}`
        totalFreq += grid.get(key) || 1
        count++
      }
      const avgFreq = count > 0 ? totalFreq / count : 1
      const maxFreq = Math.max(...Array.from(grid.values()))
      return Math.max(0.15, Math.min(0.9, avgFreq / maxFreq))
    })
  }, [routes])

  if (loading) {
    return <div className="text-zinc-400 animate-pulse text-center py-20">Loading routes...</div>
  }

  if (routes.length === 0) {
    return <div className="text-zinc-500 text-center py-20">No GPX route files found.</div>
  }

  return (
    <div className="space-y-4">
      <TabHeader title="Route Heatmap" description="All your GPS activity overlaid on a map to see your most-traveled routes." />
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="Total Routes" value={`${stats.totalRoutes}`} />
          <StatBox label="Total Distance" value={`${stats.totalDist.toFixed(0)} km`} />
          <StatBox label="Avg per Route" value={`${stats.avgPerRoute.toFixed(1)} km`} />
          <StatBox label="Years of Data" value={`${stats.years}`} />
        </div>
      )}

      {/* Map */}
      <div className="rounded-xl overflow-hidden border border-zinc-800" style={{ height: 'calc(100vh - 300px)', minHeight: 400 }}>
        <MapContainer
          center={routes[0]?.points[0] || [41.39, 2.17]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {routes.map((route, idx) => (
            <Polyline
              key={route.filename}
              positions={route.points}
              pathOptions={{
                color: hoveredIdx === idx ? '#f97316' : '#3b82f6',
                weight: hoveredIdx === idx ? 3 : 1.5,
                opacity: hoveredIdx === idx ? 1 : routeOpacities[idx],
              }}
              eventHandlers={{
                mouseover: () => setHoveredIdx(idx),
                mouseout: () => setHoveredIdx(null),
              }}
            />
          ))}
          <FitAllBounds routes={routes} />
        </MapContainer>
      </div>

      {/* Hovered route info */}
      {hoveredIdx !== null && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 px-4 py-2 text-sm">
          <span className="text-zinc-300">{routes[hoveredIdx].date}</span>
          <span className="text-zinc-500 ml-3">{routes[hoveredIdx].distance.toFixed(1)} km</span>
        </div>
      )}

      <p className="text-zinc-600 text-xs text-center">
        Brighter routes = more frequently visited areas. Hover a route to highlight it.
      </p>
    </div>
  )
}
