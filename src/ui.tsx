import { memo } from 'react'
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
export const tooltipStyle = {
  contentStyle: { background: '#101014', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
}

export const chartMargin = { top: 5, right: 5, bottom: 0, left: -15 }

// === Shared components ===
export function StatBox({ label, value, unit, sub, color }: {
  label: string; value: string; unit?: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <div className="text-zinc-500 text-xs mb-1">{label}</div>
      <div className="text-2xl font-semibold tracking-tight">
        <span style={{ color }}>{value}</span>
        {unit && <span className="text-sm text-zinc-500 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-zinc-500 text-xs mt-1">{sub}</div>}
    </div>
  )
}

export const ChartCard = memo(function ChartCard({ title, description, tall, children }: {
  title: string; description?: string; tall?: boolean; children: React.ReactNode
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-1">{title}</h3>
      {description && <p className="text-xs text-zinc-500 mb-2">{description}</p>}
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
