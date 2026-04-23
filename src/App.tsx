import { useState, useCallback, useRef, useEffect } from 'react'
import { Upload, FolderOpen, Lock, Watch, Apple, AlertCircle } from 'lucide-react'
import type { HealthData, WorkerMessage, DailyMetrics } from './types'
import Dashboard from './Dashboard'
import { parseGarminExport } from './garminParser'
import { ProgressBar } from './ui'

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

type SourceMode = 'apple' | 'garmin'

type AppState =
  | { phase: 'upload' }
  | { phase: 'loading-cache' }
  | { phase: 'parsing'; progress: number; currentDate: string; bytesRead: number; totalBytes: number; startedAt: number }
  | { phase: 'ready'; data: HealthData }
  | { phase: 'error'; message: string }

function classifyError(message: string): { title: string; hint: string; showExportSteps?: boolean } {
  const m = message.toLowerCase()
  if (m.includes('no apple health export') || m.includes('export.xml')) {
    return {
      title: "Couldn't find an Apple Health export in that folder.",
      hint: 'Make sure you unzipped the export and selected the folder that contains export.xml (not the zip itself).',
      showExportSteps: true,
    }
  }
  if (m.includes('no garmin')) {
    return {
      title: "Couldn't find Garmin data in that folder.",
      hint: 'Select the unzipped export folder — the one that contains the DI_CONNECT directory with .json files.',
      showExportSteps: true,
    }
  }
  if (m.includes('quota') || m.includes('exceeded')) {
    return {
      title: 'Your browser ran out of storage for the cached parse.',
      hint: 'Free up some space in this site’s storage and try again, or use a different browser.',
    }
  }
  if (m.includes('failed to parse garmin')) {
    return {
      title: "Couldn't parse the Garmin export.",
      hint: 'Some files in the export may be corrupted or in an unexpected format. Try re-downloading the export from Garmin.',
    }
  }
  return {
    title: 'Something went wrong while parsing your data.',
    hint: message,
  }
}

function formatETA(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

function UploadSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6" aria-hidden>
      <div className="max-w-md w-full space-y-10">
        <div className="text-center space-y-3">
          <div className="h-7 w-52 mx-auto bg-zinc-900 rounded-md animate-pulse" />
          <div className="h-3 w-40 mx-auto bg-zinc-900 rounded-md animate-pulse opacity-70" />
          <div className="h-3 w-64 mx-auto bg-zinc-900 rounded-md animate-pulse opacity-50" />
        </div>
        <div className="flex gap-3 justify-center">
          <div className="h-11 w-36 bg-zinc-900 rounded-xl animate-pulse" />
          <div className="h-11 w-36 bg-zinc-900 rounded-xl animate-pulse opacity-70" />
        </div>
        <div className="rounded-2xl bg-zinc-900 h-52 animate-pulse" />
      </div>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'loading-cache' })
  const [dragging, setDragging] = useState(false)
  const [sourceMode, setSourceMode] = useState<SourceMode>('apple')
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
    const startedAt = performance.now()
    setState({ phase: 'parsing', progress: 0, currentDate: '', bytesRead: 0, totalBytes: file.size, startedAt })

    const worker = new Worker(new URL('./parseWorker.ts', import.meta.url), { type: 'module' })

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        setState({
          phase: 'parsing',
          progress: msg.recordsProcessed,
          currentDate: msg.currentDate,
          bytesRead: msg.bytesRead ?? 0,
          totalBytes: msg.totalBytes ?? file.size,
          startedAt,
        })
      } else if (msg.type === 'complete') {
        const dailyMetrics = new Map<string, DailyMetrics>(msg.data.dailyMetrics)
        const healthData: HealthData = {
            profile: msg.data.profile,
            dailyMetrics,
            workouts: msg.data.workouts,
            sleepRecords: msg.data.sleepRecords,
            wristTempRecords: msg.data.wristTempRecords,
            menstrualRecords: msg.data.menstrualRecords,
            caffeineRecords: msg.data.caffeineRecords,
            bodyRecords: msg.data.bodyRecords,
            cardioRecords: msg.data.cardioRecords,
            dailyHR: msg.data.dailyHR,
            hrTimeline: msg.data.hrTimeline,
            dailyAudio: msg.data.dailyAudio,
            dailyBreathing: msg.data.dailyBreathing,
            dailyDaylight: msg.data.dailyDaylight,
            dailyMobility: msg.data.dailyMobility,
            runningDynamics: msg.data.runningDynamics,
            gpxFiles: gpxFilesRef.current,
            ecgFiles: ecgFilesRef.current,
            exportDate: msg.data.exportDate,
            sourceMode: 'apple',
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

  const handleGarminFiles = useCallback(async (files: File[]) => {
    const jsonFiles = files.filter(f => f.name.endsWith('.json'))
    if (jsonFiles.length === 0) {
      setState({ phase: 'error', message: 'No Garmin JSON data files found. Make sure you selected the Garmin export folder containing DI_CONNECT.' })
      return
    }
    const startedAt = performance.now()
    setState({ phase: 'parsing', progress: 0, currentDate: 'Processing Garmin data...', bytesRead: 0, totalBytes: 0, startedAt })
    try {
      const data = await parseGarminExport(jsonFiles, (msg) => {
        setState({ phase: 'parsing', progress: 0, currentDate: msg, bytesRead: 0, totalBytes: 0, startedAt })
      })
      setState({ phase: 'ready', data })
      saveToCache(data)
    } catch (err) {
      setState({ phase: 'error', message: `Failed to parse Garmin data: ${err}` })
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (sourceMode === 'garmin') {
      collectAllFilesFromDrop(e.dataTransfer.items).then(files => handleGarminFiles(files))
      return
    }
    gpxFilesRef.current = new Map()
    ecgFilesRef.current = new Map()
    findXmlFile(e.dataTransfer.items, handleFile, gpxFilesRef.current, ecgFilesRef.current)
  }, [handleFile, sourceMode, handleGarminFiles])

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    if (sourceMode === 'garmin') {
      handleGarminFiles(Array.from(files))
      return
    }

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
  }, [handleFile, sourceMode, handleGarminFiles])

  if (state.phase === 'ready') {
    return <Dashboard data={state.data} onReset={() => { setState({ phase: 'upload' }); indexedDB.deleteDatabase(CACHE_DB) }} />
  }

  if (state.phase === 'loading-cache') {
    return <UploadSkeleton />
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-10">

        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Health Dashboard</h1>
          <p className="text-zinc-500 text-[13px] leading-relaxed">
            Visualize your health data.
          </p>
          <p className="inline-flex items-center gap-1.5 text-zinc-600 text-[12px]">
            <Lock size={11} />
            Everything runs in your browser — nothing is uploaded
          </p>
        </div>

        {/* Source mode selector */}
        {state.phase === 'upload' && (
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setSourceMode('apple')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-medium transition-all border ${
                sourceMode === 'apple'
                  ? 'bg-zinc-100 text-zinc-900 border-zinc-300 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              <Apple size={16} />
              Apple Health
            </button>
            <button
              onClick={() => setSourceMode('garmin')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-medium transition-all border ${
                sourceMode === 'garmin'
                  ? 'bg-zinc-100 text-zinc-900 border-zinc-300 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              <Watch size={16} />
              Garmin
            </button>
          </div>
        )}

        {state.phase === 'upload' && (
          <>
            {/* Drop zone */}
            <div
              onDrop={e => { setDragging(false); handleDrop(e) }}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              className={`rounded-2xl bg-zinc-900 border border-dashed p-10 text-center space-y-5 transition-colors ${
                dragging ? 'border-zinc-500 bg-zinc-900/80' : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <Upload size={28} className="mx-auto text-zinc-600" />
              <div>
                <p className="text-[15px] text-zinc-200 mb-1">Drop your export folder here</p>
                <p className="text-zinc-600 text-xs">or select it manually</p>
              </div>
              <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl text-[13px] font-medium cursor-pointer hover:bg-white transition-colors shadow-sm">
                <FolderOpen size={14} />
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
            </div>

            {/* Instructions */}
            <details className="group text-[13px]">
              <summary className="text-zinc-500 cursor-pointer select-none hover:text-zinc-400 transition-colors list-none flex items-center justify-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 12 12" className="transition-transform group-open:rotate-90" fill="none"><path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {sourceMode === 'apple' ? 'How to export from Apple Health' : 'How to export from Garmin Connect'}
              </summary>
              {sourceMode === 'apple' ? (
                <ol className="mt-4 space-y-3 text-zinc-500">
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">1.</span>
                    <span>Open the <span className="text-zinc-300">Health</span> app and tap your profile picture (top right)</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">2.</span>
                    <span>Scroll to the very bottom</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">3.</span>
                    <span>Tap <span className="text-zinc-300">"Export All Health Data"</span></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">4.</span>
                    <span>Save the .zip to iCloud or Files</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">5.</span>
                    <span>Unzip the file and upload the folder here</span>
                  </li>
                </ol>
              ) : (
                <ol className="mt-4 space-y-3 text-zinc-500">
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">1.</span>
                    <span>Go to <span className="text-zinc-300">garmin.com/account/datamanagement</span></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">2.</span>
                    <span>Click <span className="text-zinc-300">"Request Data Export"</span></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">3.</span>
                    <span>Wait for the email with the download link</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-zinc-600 tabular-nums shrink-0">4.</span>
                    <span>Unzip the file and upload the folder here</span>
                  </li>
                </ol>
              )}
            </details>
          </>
        )}

        {state.phase === 'parsing' && (() => {
          const pct = state.totalBytes > 0 ? state.bytesRead / state.totalBytes : 0
          const elapsed = performance.now() - state.startedAt
          const rate = state.bytesRead > 0 && elapsed > 0 ? state.bytesRead / elapsed : 0
          const remaining = rate > 0 && state.totalBytes > 0 ? (state.totalBytes - state.bytesRead) / rate : 0
          const hasProgress = state.totalBytes > 0
          return (
            <div className="rounded-2xl bg-zinc-900 p-8 space-y-5">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-[15px] text-zinc-200">Parsing your data</p>
                {hasProgress && (
                  <p className="text-xs text-zinc-500 tabular-nums">
                    {Math.round(pct * 100)}% · {formatETA(remaining)} left
                  </p>
                )}
              </div>
              {hasProgress ? (
                <ProgressBar value={pct} />
              ) : (
                <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-green-500 rounded-full animate-pulse" />
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 text-xs tabular-nums">
                <span className="text-zinc-500">
                  {state.progress > 0
                    ? `${(state.progress / 1000000).toFixed(1)}M records`
                    : 'Starting…'}
                </span>
                {state.currentDate && (
                  <span className="text-zinc-600">{state.currentDate}</span>
                )}
              </div>
            </div>
          )
        })()}

        {state.phase === 'error' && (() => {
          const err = classifyError(state.message)
          return (
            <div className="rounded-2xl bg-zinc-900 p-8 space-y-5">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center">
                  <AlertCircle size={16} />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-[14px] text-zinc-200">{err.title}</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">{err.hint}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setState({ phase: 'upload' })}
                  className="px-4 py-2 bg-zinc-100 text-zinc-900 rounded-lg text-xs font-medium hover:bg-white transition-colors"
                >
                  Try again
                </button>
                {err.showExportSteps && (
                  <span className="text-[11px] text-zinc-600">See export steps on the upload screen</span>
                )}
              </div>
            </div>
          )
        })()}
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

async function collectAllFilesFromDrop(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = []

  async function processEntry(entry: FileSystemEntry) {
    if (entry.isFile) {
      const file = await new Promise<File>(resolve => (entry as FileSystemFileEntry).file(resolve))
      files.push(file)
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader()
      const entries = await readAllEntries(dirReader)
      for (const e of entries) {
        await processEntry(e)
      }
    }
  }

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) await processEntry(entry)
  }
  return files
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
