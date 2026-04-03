import { useState, useEffect, useRef, useCallback } from 'react'
import { StatBox, TabHeader } from './ui'

interface EcgRecord {
  filename: string
  date: string
  classification: string
  device: string
  sampleRate: number
  samples: number[]
  bpm: number | null
}

// Classification translations (Spanish -> English)
const CLASSIFICATION_MAP: Record<string, string> = {
  'Ritmo sinusal': 'Sinus Rhythm',
  'Sinus Rhythm': 'Sinus Rhythm',
  'Fibrilación auricular': 'Atrial Fibrillation',
  'Atrial Fibrillation': 'Atrial Fibrillation',
  'No concluyente': 'Inconclusive',
  'Inconclusive': 'Inconclusive',
  'Alta frecuencia cardíaca': 'High Heart Rate',
  'Baja frecuencia cardíaca': 'Low Heart Rate',
}

function parseEcgCsv(text: string, filename: string): EcgRecord | null {
  const lines = text.split('\n')
  let classification = ''
  let date = ''
  let device = ''
  let sampleRate = 512
  let dataStart = -1

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i].trim()
    if (line.startsWith('Clasificación,') || line.startsWith('Classification,')) {
      classification = line.split(',').slice(1).join(',').trim()
    } else if (line.startsWith('Fecha de registro,') || line.startsWith('Recording Date,')) {
      date = line.split(',').slice(1).join(',').trim()
    } else if (line.startsWith('Dispositivo,') || line.startsWith('Device,')) {
      device = line.split(',').slice(1).join(',').replace(/"/g, '').trim()
    } else if (line.startsWith('Frecuencia de muestreo,') || line.startsWith('Sample Rate,')) {
      // Parse "512 hercios" or "512,922 hercios" or "512.922 Hz"
      const match = line.match(/(\d+)[,.]?(\d*)\s/)
      if (match) {
        sampleRate = parseFloat(`${match[1]}.${match[2] || '0'}`)
      }
    } else if (line === '' && i > 5 && dataStart === -1) {
      // Empty line after metadata = data starts next
    } else if (line.startsWith('Derivación') || line.startsWith('Lead')) {
      // Skip header
    } else if (line.startsWith('Unidad') || line.startsWith('Unit')) {
      // Skip header, data starts after next empty line
    } else if (dataStart === -1 && /^-?\d/.test(line) && i > 5) {
      dataStart = i
    }
  }

  if (dataStart === -1) {
    // Find first data line
    for (let i = 10; i < lines.length; i++) {
      if (/^-?\d/.test(lines[i].trim())) {
        dataStart = i
        break
      }
    }
  }

  if (dataStart === -1) return null

  const samples: number[] = []
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Handle comma as decimal separator: "-33,719" -> -33.719
    const val = parseFloat(line.replace(',', '.'))
    if (!isNaN(val)) samples.push(val)
  }

  if (samples.length < 100) return null

  // Estimate BPM from R-R intervals
  const bpm = estimateBpm(samples, sampleRate)

  return {
    filename,
    date,
    classification: CLASSIFICATION_MAP[classification] || classification,
    device,
    sampleRate,
    samples,
    bpm,
  }
}

function estimateBpm(samples: number[], sampleRate: number): number | null {
  // Simple R-peak detection: find peaks above 70th percentile with minimum distance
  const sorted = [...samples].sort((a, b) => a - b)
  const threshold = sorted[Math.floor(sorted.length * 0.7)]
  const minDistance = Math.floor(sampleRate * 0.4) // Min 0.4s between beats

  const peaks: number[] = []
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i] > threshold && samples[i] > samples[i - 1] && samples[i] > samples[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] > minDistance) {
        peaks.push(i)
      }
    }
  }

  if (peaks.length < 2) return null

  const intervals = []
  for (let i = 1; i < peaks.length; i++) {
    intervals.push((peaks[i] - peaks[i - 1]) / sampleRate)
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
  return Math.round(60 / avgInterval)
}

function EcgTrace({ record }: { record: EcgRecord }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [scrollX, setScrollX] = useState(0)

  // How many samples to show in view (3 seconds worth)
  const viewSamples = Math.floor(record.sampleRate * 3)
  const maxScroll = Math.max(0, record.samples.length - viewSamples)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = wrapper.clientWidth
    if (width <= 0) return
    const dpr = window.devicePixelRatio || 1
    const h = 250
    canvas.width = width * dpr
    canvas.height = h * dpr
    canvas.style.width = '100%'
    canvas.style.height = `${h}px`
    ctx.scale(dpr, dpr)

    // Background
    ctx.fillStyle = '#101014'
    ctx.fillRect(0, 0, width, h)

    // Grid (ECG paper style)
    ctx.strokeStyle = '#27272a'
    ctx.lineWidth = 0.5
    const gridSpacing = 20
    for (let x = 0; x < width; x += gridSpacing) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let y = 0; y < h; y += gridSpacing) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
    // Major grid
    ctx.strokeStyle = '#3f3f46'
    ctx.lineWidth = 0.8
    for (let x = 0; x < width; x += gridSpacing * 5) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let y = 0; y < h; y += gridSpacing * 5) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Draw waveform
    const startIdx = scrollX
    const endIdx = Math.min(startIdx + viewSamples, record.samples.length)
    const slice = record.samples.slice(startIdx, endIdx)

    if (slice.length < 2) return

    const min = Math.min(...slice)
    const max = Math.max(...slice)
    const range = max - min || 1
    const padding = 20

    ctx.beginPath()
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 1.5

    for (let i = 0; i < slice.length; i++) {
      const x = (i / (slice.length - 1)) * width
      const y = padding + ((max - slice[i]) / range) * (h - padding * 2)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Time labels
    ctx.fillStyle = '#71717a'
    ctx.font = '10px system-ui'
    const startTime = startIdx / record.sampleRate
    for (let s = 0; s <= 3; s++) {
      const x = (s / 3) * width
      ctx.fillText(`${(startTime + s).toFixed(1)}s`, x + 2, h - 4)
    }
  }, [record, scrollX, viewSamples])

  useEffect(() => { draw() }, [draw])

  // Redraw on resize
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const obs = new ResizeObserver(() => draw())
    obs.observe(wrapper)
    return () => obs.disconnect()
  }, [draw])

  // Scroll with wheel
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = Math.sign(e.deltaX || e.deltaY) * Math.floor(record.sampleRate * 0.5)
      setScrollX(prev => Math.max(0, Math.min(maxScroll, prev + delta)))
    }
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
  }, [maxScroll, record.sampleRate])

  // Drag to scroll
  const dragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartScroll = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper) return

    const onDown = (e: PointerEvent) => {
      dragging.current = true
      dragStartX.current = e.clientX
      dragStartScroll.current = scrollX
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      const dx = dragStartX.current - e.clientX
      const samplesPerPx = viewSamples / wrapper.clientWidth
      const newScroll = Math.max(0, Math.min(maxScroll, dragStartScroll.current + Math.round(dx * samplesPerPx)))
      setScrollX(newScroll)
    }
    const onUp = () => {
      dragging.current = false
      canvas.style.cursor = 'grab'
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [scrollX, maxScroll, viewSamples])

  return (
    <div className="relative" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        className="rounded-lg cursor-grab w-full select-none touch-none"
      />
      {/* Scroll indicator */}
      <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-zinc-600 rounded-full"
          style={{
            width: `${Math.max(5, (viewSamples / record.samples.length) * 100)}%`,
            marginLeft: `${(scrollX / record.samples.length) * 100}%`,
          }}
        />
      </div>
      <p className="text-xs text-zinc-600 mt-1">Scroll horizontally to navigate the trace</p>
    </div>
  )
}

export default function ECGViewer({ ecgFiles }: { ecgFiles: Map<string, File> }) {
  const [records, setRecords] = useState<EcgRecord[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const parsedRef = useRef(false)

  useEffect(() => {
    if (parsedRef.current) return
    parsedRef.current = true

    async function load() {
      const parsed: EcgRecord[] = []
      for (const [filename, file] of ecgFiles) {
        try {
          const text = await file.text()
          const record = parseEcgCsv(text, filename)
          if (record) parsed.push(record)
        } catch { /* skip */ }
      }
      parsed.sort((a, b) => b.date.localeCompare(a.date)) // newest first
      setRecords(parsed)
      setLoading(false)
      if (parsed.length > 0) setSelectedIdx(0)
    }
    load()
  }, [ecgFiles])

  const selected = selectedIdx !== null ? records[selectedIdx] : null

  if (loading) {
    return <div className="text-zinc-400 animate-pulse text-center py-20">Loading ECG recordings...</div>
  }

  if (records.length === 0) {
    return <div className="text-zinc-500 text-center py-20">No ECG recordings found.</div>
  }

  return (
    <div className="space-y-4">
      <TabHeader title="ECG" description="Electrocardiogram recordings captured by your Apple Watch." />
      {/* Recording list */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {records.map((rec, idx) => {
          const isActive = idx === selectedIdx
          const dateStr = formatDate(rec.date)
          return (
            <button
              key={rec.filename}
              onClick={() => setSelectedIdx(idx)}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm border transition-colors ${
                isActive
                  ? 'bg-zinc-800 border-zinc-700 text-white'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="font-medium">{dateStr}</div>
              <div className={`text-xs mt-0.5 ${
                rec.classification === 'Sinus Rhythm' ? 'text-green-400' :
                rec.classification === 'Atrial Fibrillation' ? 'text-red-400' : 'text-zinc-500'
              }`}>
                {rec.classification}
              </div>
            </button>
          )
        })}
      </div>

      {/* Selected recording */}
      {selected && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatBox
              label="Classification"
              value={selected.classification}
              color={selected.classification === 'Sinus Rhythm' ? '#22c55e' : selected.classification === 'Atrial Fibrillation' ? '#ef4444' : '#f97316'}
            />
            {selected.bpm && (
              <StatBox label="Heart Rate" value={`${selected.bpm} bpm`} color="#ef4444" />
            )}
            <StatBox label="Duration" value={`${(selected.samples.length / selected.sampleRate).toFixed(1)}s`} />
            <StatBox label="Sample Rate" value={`${Math.round(selected.sampleRate)} Hz`} />
            <StatBox label="Samples" value={`${selected.samples.length.toLocaleString()}`} />
            <StatBox label="Device" value={selected.device} />
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">ECG Trace — Lead I</h3>
            <EcgTrace record={selected} />
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(d: string): string {
  if (!d) return 'Unknown'
  // Parse "2026-01-22 21:32:36 +0100"
  try {
    const date = new Date(d)
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return d.substring(0, 10)
  }
}
