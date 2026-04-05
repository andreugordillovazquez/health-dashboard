import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { ResponsiveContainer } from 'recharts'

// === Colors ===
export const COLORS = {
  green: '#22c55e',
  red: '#ef4444',
  blue: '#3b82f6',
  purple: '#a855f7',
  orange: '#f97316',
  pink: '#ec4899',
  cyan: '#06b6d4',
  yellow: '#facc15',
  zinc: '#71717a',
}

// === Chart constants ===
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

export function getTooltipStyle() {
  const dark = isDarkMode()
  return {
    contentStyle: {
      background: dark ? '#101014' : '#ffffff',
      border: `1px solid ${dark ? '#27272a' : '#e4e4e7'}`,
      borderRadius: 8,
      fontSize: 12,
      color: dark ? '#e4e4e7' : '#27272a',
    },
    labelStyle: { color: dark ? '#a1a1aa' : '#71717a' },
  }
}

// Static default for backwards compat — components that import this still work
export const tooltipStyle = {
  contentStyle: { background: '#101014', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
}

export function useChartTheme() {
  // Re-reads CSS vars each render so theme toggle is reflected
  const dark = isDarkMode()
  return {
    grid: dark ? '#27272a' : '#e4e4e7',
    tick: '#71717a',
    bg: dark ? '#101014' : '#f4f4f5',
    tooltip: {
      contentStyle: {
        background: dark ? '#101014' : '#ffffff',
        border: `1px solid ${dark ? '#27272a' : '#e4e4e7'}`,
        borderRadius: 8,
        fontSize: 12,
        color: dark ? '#e4e4e7' : '#27272a',
      },
      labelStyle: { color: dark ? '#a1a1aa' : '#71717a' },
    },
  }
}

export const chartMargin = { top: 5, right: 5, bottom: 0, left: -15 }

// === Shared components ===
export function StatBox({ label, value, unit, sub, color, trend }: {
  label: string; value: string; unit?: string; sub?: string; color?: string
  trend?: { direction: 'up' | 'down'; positive: boolean; changePercent: number }
}) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <div className="text-zinc-500 text-xs mb-1">{label}</div>
      <div className="text-2xl font-semibold tracking-tight">
        <span style={{ color }}>{value}</span>
        {unit && <span className="text-sm text-zinc-500 ml-1">{unit}</span>}
      </div>
      {trend ? (
        <div className={`text-xs mt-1 font-medium tabular-nums ${trend.positive ? 'text-green-400' : 'text-red-400'}`}>
          {trend.direction === 'up' ? '+' : '−'}{trend.changePercent}%
          <span className="text-zinc-600 font-normal ml-1">30d</span>
        </div>
      ) : (
        sub && <div className="text-zinc-500 text-xs mt-1">{sub}</div>
      )}
    </div>
  )
}

const AI_KEY_STORAGE = 'health-dashboard-ai-key'

function getApiKey(): string | null {
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined
  if (envKey) return envKey
  return localStorage.getItem(AI_KEY_STORAGE)
}

function hasEnvKey(): boolean {
  return !!import.meta.env.VITE_OPENROUTER_API_KEY
}

function setApiKey(key: string) {
  localStorage.setItem(AI_KEY_STORAGE, key)
}

function sampleData(data: unknown[], maxPoints = 60): unknown[] {
  if (data.length <= maxPoints) return data
  const step = Math.ceil(data.length / maxPoints)
  return data.filter((_, i) => i % step === 0)
}

async function fetchAISummary(title: string, description: string | undefined, data: unknown[], apiKey: string): Promise<string> {
  const sampled = sampleData(data)
  const prompt = `You are a health data analyst. Analyze this chart data and provide a brief, insightful summary (3-5 sentences). Focus on trends, notable patterns, and health implications. Be specific with numbers.

Chart: "${title}"${description ? `\nDescription: ${description}` : ''}
Data (${data.length} points${data.length > 60 ? ', sampled' : ''}):
${JSON.stringify(sampled, null, 0)}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 401) {
      if (!hasEnvKey()) localStorage.removeItem(AI_KEY_STORAGE)
      throw new Error('Invalid API key. Please try again.')
    }
    throw new Error((err as { error?: { message?: string } }).error?.message || `API error ${res.status}`)
  }

  const body = await res.json() as { choices: { message: { content: string } }[] }
  return body.choices[0].message.content
}

export function AISummaryButton({ title, description, chartData }: {
  title: string; description?: string; chartData: unknown[]
}) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askingKey, setAskingKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setSummary(null)
    setError(null)
    setAskingKey(false)
    setKeyInput('')
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  const requestSummary = useCallback(async (key: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAISummary(title, description, chartData, key)
      setSummary(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [title, description, chartData])

  const handleClick = useCallback(() => {
    if (open) { close(); return }
    setOpen(true)
    const key = getApiKey()
    if (key) {
      requestSummary(key)
    } else {
      setAskingKey(true)
    }
  }, [open, close, requestSummary])

  const handleKeySubmit = useCallback(() => {
    const key = keyInput.trim()
    if (!key) return
    setApiKey(key)
    setAskingKey(false)
    requestSummary(key)
  }, [keyInput, requestSummary])

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        title="AI Summary"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
        </svg>
      </button>
      {open && (
        <div ref={panelRef} className="absolute right-0 top-8 z-50 w-72 sm:w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4">
          {askingKey ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">Enter your Anthropic API key to enable AI summaries:</p>
              <input
                type="password"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleKeySubmit()}
                placeholder="sk-ant-..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={handleKeySubmit} className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-200 rounded-lg transition-colors">Save & Go</button>
                <button onClick={close} className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
              </div>
              <p className="text-[10px] text-zinc-600">Key is stored locally in your browser only.</p>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Analyzing...
            </div>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-xs text-red-400">{error}</p>
              <button onClick={() => { const k = getApiKey(); if (k) requestSummary(k); else setAskingKey(true); }} className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Retry</button>
            </div>
          ) : summary ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{summary}</p>
              <button onClick={close} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Close</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export const ChartCard = memo(function ChartCard({ title, description, tall, chartData, children }: {
  title: string; description?: string; tall?: boolean; chartData?: unknown[]; children: React.ReactNode
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-sm font-medium text-zinc-300">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        {chartData && chartData.length > 0 && (
          <AISummaryButton title={title} description={description} chartData={chartData} />
        )}
      </div>
      <div className={tall ? 'h-64' : 'h-56'}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  )
})

export function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
      <div className="w-4 h-0.5" style={{
        background: dashed ? 'transparent' : color,
        borderTop: dashed ? `2px dashed ${color}` : undefined,
      }} />
      {label}
    </div>
  )
}

export function SectionHeader({ children }: { children: string }) {
  return (
    <h2 className="text-[11px] font-medium tracking-wider uppercase text-zinc-600">
      {children}
    </h2>
  )
}

export function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-lg font-semibold text-zinc-100 tracking-tight">{title}</h1>
      <p className="text-xs text-zinc-500 mt-1 leading-relaxed max-w-2xl">{description}</p>
    </div>
  )
}

const WORKOUT_NAME_MAP: Record<string, string> = {
  TraditionalStrengthTraining: 'Strength',
  HighIntensityIntervalTraining: 'HIIT',
  FunctionalStrengthTraining: 'Functional',
  MindAndBody: 'Mind & Body',
  PreparationAndRecovery: 'Recovery',
  CoreTraining: 'Core',
  FlexibilityTraining: 'Flexibility',
  MixedCardio: 'Mixed Cardio',
  StairClimbing: 'Stair Climbing',
  SocialDance: 'Dance',
  CrossTraining: 'Cross Training',
  JumpRope: 'Jump Rope',
  TableTennis: 'Table Tennis',
}

export function humanizeWorkoutType(raw: string): string {
  return WORKOUT_NAME_MAP[raw] || raw.replace(/([a-z])([A-Z])/g, '$1 $2')
}

// === Utility functions ===

// "Jan '25" format
export function shortDate(d: string): string {
  if (!d) return ''
  const parts = d.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(parts[1]) - 1]} '${parts[0].substring(2)}`
}

// "01/15" format
export function shortDateCompact(d: string): string {
  if (!d) return ''
  const parts = d.split('-')
  return `${parts[1]}/${parts[2]?.substring(0, 2)}`
}

export function shortMonth(d: string): string {
  if (!d) return ''
  const parts = d.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(parts[1]) - 1]} '${parts[0].substring(2)}`
}

export function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

export function fmt(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined) return '--'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return n.toFixed(decimals)
}
