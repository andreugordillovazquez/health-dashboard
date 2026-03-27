import { useState, useCallback, useRef, useEffect } from 'react'
import { Upload, FolderOpen } from 'lucide-react'
import type { HealthData, WorkerMessage, DailyMetrics } from './types'
import Dashboard from './Dashboard'

const CACHE_DB = 'health-dashboard-cache'
const CACHE_STORE = 'data'
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

interface CachedData {
  id: 'health'
  timestamp: number
  data: Omit<HealthData, 'gpxFiles' | 'ecgFiles' | 'dailyMetrics'> & {
    dailyMetrics: [string, DailyMetrics][]
    gpxFileContents: [string, string][] // [filename, text content]
    ecgFileContents: [string, string][]
  }
}

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(CACHE_STORE, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveToCache(data: HealthData) {
  try {
    const db = await openCacheDB()
    const { gpxFiles, ecgFiles, dailyMetrics, ...rest } = data

    // Read File objects into strings for storage
    const gpxFileContents: [string, string][] = []
    for (const [name, file] of gpxFiles) {
      gpxFileContents.push([name, await file.text()])
    }
    const ecgFileContents: [string, string][] = []
    for (const [name, file] of ecgFiles) {
      ecgFileContents.push([name, await file.text()])
    }

    const serializable: CachedData = {
      id: 'health',
      timestamp: Date.now(),
      data: { ...rest, dailyMetrics: Array.from(dailyMetrics.entries()), gpxFileContents, ecgFileContents },
    }
    const tx = db.transaction(CACHE_STORE, 'readwrite')
    tx.objectStore(CACHE_STORE).put(serializable)
    db.close()
  } catch { /* silently fail */ }
}

async function loadFromCache(): Promise<HealthData | null> {
  try {
    const db = await openCacheDB()
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly')
      const req = tx.objectStore(CACHE_STORE).get('health')
      req.onsuccess = () => {
        db.close()
        const cached = req.result as CachedData | undefined
        if (!cached || Date.now() - cached.timestamp > CACHE_TTL) {
          resolve(null)
          return
        }
        // Reconstruct File objects from cached strings
        const gpxFiles = new Map<string, File>()
        for (const [name, content] of cached.data.gpxFileContents || []) {
          gpxFiles.set(name, new File([content], name, { type: 'application/gpx+xml' }))
        }
        const ecgFiles = new Map<string, File>()
        for (const [name, content] of cached.data.ecgFileContents || []) {
          ecgFiles.set(name, new File([content], name, { type: 'text/csv' }))
        }

        const { gpxFileContents: _g, ecgFileContents: _e, dailyMetrics: dm, ...rest } = cached.data
        resolve({
          ...rest,
          dailyMetrics: new Map(dm),
          gpxFiles,
          ecgFiles,
        })
      }
      req.onerror = () => { db.close(); resolve(null) }
    })
  } catch { return null }
}

type AppState =
  | { phase: 'upload' }
  | { phase: 'loading-cache' }
  | { phase: 'parsing'; progress: number; currentDate: string }
  | { phase: 'ready'; data: HealthData }
  | { phase: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'loading-cache' })
  const gpxFilesRef = useRef<Map<string, File>>(new Map())
  const ecgFilesRef = useRef<Map<string, File>>(new Map())

  // Try loading from cache on mount
  useEffect(() => {
    loadFromCache().then(cached => {
      if (cached) {
        setState({ phase: 'ready', data: cached })
      } else {
        setState({ phase: 'upload' })
      }
    })
  }, [])

  const handleFile = useCallback((file: File) => {
    setState({ phase: 'parsing', progress: 0, currentDate: '' })

    const worker = new Worker(new URL('./parseWorker.ts', import.meta.url), { type: 'module' })

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        setState({ phase: 'parsing', progress: msg.recordsProcessed, currentDate: msg.currentDate })
      } else if (msg.type === 'complete') {
        const dailyMetrics = new Map<string, DailyMetrics>(msg.data.dailyMetrics)
        const healthData: HealthData = {
            profile: msg.data.profile,
            dailyMetrics,
            workouts: msg.data.workouts,
            sleepRecords: msg.data.sleepRecords,
            wristTempRecords: msg.data.wristTempRecords,
            caffeineRecords: msg.data.caffeineRecords,
            bodyRecords: msg.data.bodyRecords,
            cardioRecords: msg.data.cardioRecords,
            dailyHR: msg.data.dailyHR,
            hrTimeline: msg.data.hrTimeline,
            dailyAudio: msg.data.dailyAudio,
            dailyBreathing: msg.data.dailyBreathing,
            dailyDaylight: msg.data.dailyDaylight,
            gpxFiles: gpxFilesRef.current,
            ecgFiles: ecgFilesRef.current,
            exportDate: msg.data.exportDate,
          }
        setState({ phase: 'ready', data: healthData })
        saveToCache(healthData)
        worker.terminate()
      } else if (msg.type === 'error') {
        setState({ phase: 'error', message: msg.message })
        worker.terminate()
      }
    }

    worker.onerror = (err) => {
      setState({ phase: 'error', message: err.message })
      worker.terminate()
    }

    worker.postMessage({ file })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    gpxFilesRef.current = new Map()
    ecgFilesRef.current = new Map()
    findXmlFile(e.dataTransfer.items, handleFile, gpxFilesRef.current, ecgFilesRef.current)
  }, [handleFile])

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    // Collect GPX and ECG files
    gpxFilesRef.current = new Map()
    ecgFilesRef.current = new Map()
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f.name.endsWith('.gpx')) {
        gpxFilesRef.current.set(f.name, f)
      } else if (f.name.startsWith('ecg_') && f.name.endsWith('.csv')) {
        ecgFilesRef.current.set(f.name, f)
      }
    }

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f.name.endsWith('.xml') && f.name !== 'export_cda.xml' && f.size > 1000000) {
        handleFile(f)
        return
      }
    }
    // fallback: try any xml
    for (let i = 0; i < files.length; i++) {
      if (files[i].name.endsWith('.xml') && files[i].name !== 'export_cda.xml') {
        handleFile(files[i])
        return
      }
    }
    setState({ phase: 'error', message: 'No Apple Health export XML file found in the selected folder.' })
  }, [handleFile])

  if (state.phase === 'ready') {
    return <Dashboard data={state.data} onReset={() => { setState({ phase: 'upload' }); indexedDB.deleteDatabase(CACHE_DB) }} />
  }

  if (state.phase === 'loading-cache') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-zinc-500 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Health Dashboard</h1>
        <p className="text-zinc-400 mb-8 text-sm">
          Upload your Apple Health export folder to visualize your data.
        </p>

        {state.phase === 'upload' && (
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className="border border-dashed border-zinc-700 rounded-xl p-12 text-center hover:border-zinc-500 transition-colors cursor-pointer"
          >
            <Upload size={40} className="mx-auto mb-4 text-zinc-500" />
            <p className="text-zinc-300 mb-4">Drop your export folder here</p>
            <p className="text-zinc-500 text-sm mb-6">or</p>
            <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-700 text-zinc-100 rounded-lg text-sm font-medium cursor-pointer hover:bg-zinc-600 transition-colors">
              <FolderOpen size={16} />
              Select folder
              <input
                type="file"
                // @ts-expect-error webkitdirectory is non-standard
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderSelect}
                className="hidden"
              />
            </label>
            <p className="text-zinc-600 text-xs mt-6">
              Everything is processed locally in your browser. No data leaves your device.
            </p>
          </div>
        )}

        {state.phase === 'parsing' && (
          <div className="border border-zinc-800 rounded-xl p-12 text-center">
            <div className="animate-pulse text-xl mb-4">Parsing...</div>
            <p className="text-zinc-400 text-sm">
              {state.progress > 0
                ? `${(state.progress / 1000000).toFixed(1)}M records processed`
                : 'Starting...'}
            </p>
            {state.currentDate && (
              <p className="text-zinc-500 text-xs mt-2">Processing {state.currentDate}</p>
            )}
            <div className="mt-4 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-zinc-400 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="border border-red-900/50 rounded-xl p-8 text-center">
            <p className="text-red-400 mb-4">{state.message}</p>
            <button
              onClick={() => setState({ phase: 'upload' })}
              className="px-4 py-2 bg-zinc-800 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

async function readAllEntries(dirReader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = []
  let batch: FileSystemEntry[]
  do {
    batch = await new Promise<FileSystemEntry[]>(resolve => dirReader.readEntries(resolve))
    all.push(...batch)
  } while (batch.length > 0)
  return all
}

async function findXmlFile(items: DataTransferItemList, onFile: (f: File) => void, gpxFiles: Map<string, File>, ecgFiles: Map<string, File>) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader()
      const entries = await readAllEntries(dirReader)

      // Also check subdirectories for GPX files (workout-routes/)
      for (const e of entries) {
        if (e.isDirectory) {
          const subReader = (e as FileSystemDirectoryEntry).createReader()
          const subEntries = await readAllEntries(subReader)
          for (const se of subEntries) {
            if (se.isFile && se.name.endsWith('.gpx')) {
              const file = await new Promise<File>(resolve => (se as FileSystemFileEntry).file(resolve))
              gpxFiles.set(se.name, file)
            } else if (se.isFile && se.name.startsWith('ecg_') && se.name.endsWith('.csv')) {
              const file = await new Promise<File>(resolve => (se as FileSystemFileEntry).file(resolve))
              ecgFiles.set(se.name, file)
            }
          }
        }
      }

      for (const e of entries) {
        if (e.isFile && e.name.endsWith('.xml') && e.name !== 'export_cda.xml') {
          const file = await new Promise<File>((resolve) => {
            ;(e as FileSystemFileEntry).file(resolve)
          })
          if (file.size > 1000000) {
            onFile(file)
            return
          }
        }
      }
    } else if (entry?.isFile && entry.name.endsWith('.xml')) {
      const file = await new Promise<File>((resolve) => {
        ;(entry as FileSystemFileEntry).file(resolve)
      })
      onFile(file)
      return
    }
  }
}
