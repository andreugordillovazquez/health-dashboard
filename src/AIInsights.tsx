import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { HealthData, DailyMetrics } from './types'
import { TabHeader } from './ui'
import { computeHealthScores, scoreLabel, type HealthScore } from './healthScore'
import { Sparkles, Key, Loader2, MessageCircle, Send, Download, Copy, Check } from 'lucide-react'

const CACHE_KEY = 'health_chat_cache'
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

const PREDEFINED_QUESTIONS = [
  { label: 'Overall health summary', question: 'Give me a comprehensive summary of my overall health based on all the data. What am I doing well? What needs improvement?' },
  { label: 'Sleep quality analysis', question: 'Analyze my sleep patterns in depth. How is my sleep quality, consistency, and stage breakdown? What is impacting my sleep and what can I do to improve it?' },
  { label: 'How does sleep affect my recovery?', question: 'Analyze the relationship between my sleep duration/quality and my next-day HRV, resting heart rate, and exercise performance. Show me the specific numbers.' },
  { label: 'Cardio fitness assessment', question: 'Assess my cardiovascular fitness based on VO2 Max, resting HR, HRV, and walking HR. How do I compare for my age? What should I focus on to improve?' },
  { label: 'Training optimization', question: 'Look at my workout patterns, types, frequency, and intensity. Am I training effectively? What changes would give me the most improvement?' },
  { label: 'What are my biggest health risks?', question: 'Based on my data trends, what are my biggest health risk factors? Are there any concerning patterns I should discuss with a doctor?' },
  { label: 'Week-over-week progress', question: 'Compare my last 7 days vs the previous 7 days across all metrics. What improved? What got worse? Am I trending in the right direction?' },
  { label: 'Exercise vs rest balance', question: 'Am I balancing exercise and recovery well? Look at my workout frequency, HRV trends, resting HR recovery, and sleep on training vs rest days.' },
]

function buildDataContext(data: HealthData, scores: HealthScore[], metrics: DailyMetrics[]): string {
  const recent30 = metrics.slice(-30)
  const prev30 = metrics.slice(-60, -30)
  const recent7 = metrics.slice(-7)
  const prev7 = metrics.slice(-14, -7)

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null

  const r30 = {
    steps: avg(recent30.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(recent30.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(recent30.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(recent30.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
    exercise: avg(recent30.map(m => m.exerciseMinutes).filter(v => v > 0)),
    distance: avg(recent30.map(m => m.distance).filter(v => v > 0)),
  }
  const p30 = {
    steps: avg(prev30.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(prev30.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(prev30.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(prev30.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
    exercise: avg(prev30.map(m => m.exerciseMinutes).filter(v => v > 0)),
  }
  const r7 = {
    steps: avg(recent7.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(recent7.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(recent7.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(recent7.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
  }
  const p7 = {
    steps: avg(prev7.map(m => m.steps).filter(v => v > 0)),
    sleep: avg(prev7.filter(m => m.sleepHours && m.sleepHours > 0).map(m => m.sleepHours!)),
    rhr: avg(prev7.filter(m => m.restingHeartRate && m.restingHeartRate > 0).map(m => m.restingHeartRate!)),
    hrv: avg(prev7.filter(m => m.hrv && m.hrv > 0).map(m => m.hrv!)),
  }

  const sleepHrvPairs: { sleep: number; hrv: number }[] = []
  for (let i = 0; i < recent30.length - 1; i++) {
    const sleep = recent30[i].sleepHours
    const hrv = recent30[i + 1]?.hrv
    if (sleep && sleep > 0 && hrv && hrv > 0) sleepHrvPairs.push({ sleep, hrv })
  }
  const lowSleepHRV = sleepHrvPairs.filter(p => p.sleep < 7)
  const goodSleepHRV = sleepHrvPairs.filter(p => p.sleep >= 7)

  const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30)
  const recentWorkouts = data.workouts.filter(w => w.date >= cutoff30.toISOString().substring(0, 10))
  const workoutTypes = new Map<string, { count: number; avgDur: number; avgHR: number | null }>()
  for (const w of recentWorkouts) {
    const e = workoutTypes.get(w.type) || { count: 0, avgDur: 0, avgHR: null }
    e.count++
    e.avgDur += w.duration
    if (w.hrAvg) e.avgHR = ((e.avgHR || 0) * (e.count - 1) + w.hrAvg) / e.count
    workoutTypes.set(w.type, e)
  }

  const vo2 = data.cardioRecords.filter(r => r.type === 'vo2max').sort((a, b) => b.date.localeCompare(a.date))
  const latestWeight = data.bodyRecords.filter(r => r.weight !== null).sort((a, b) => b.date.localeCompare(a.date))[0]
  const recentScores = scores.slice(-30)
  const avgScore = recentScores.length > 0 ? Math.round(recentScores.reduce((s, r) => s + r.total, 0) / recentScores.length) : null
  const age = data.profile.dob ? new Date().getFullYear() - new Date(data.profile.dob).getFullYear() : null

  return `## Profile
Age: ${age || 'unknown'}, Sex: ${data.profile.sex?.includes('Male') ? 'Male' : 'Female'}

## Last 7 Days (vs previous 7)
Steps: ${r7.steps}/day (was ${p7.steps}), Sleep: ${r7.sleep}h (was ${p7.sleep}), RHR: ${r7.rhr} bpm (was ${p7.rhr}), HRV: ${r7.hrv} ms (was ${p7.hrv})

## Last 30 Days (vs previous 30)
Steps: ${r30.steps}/day (was ${p30.steps}), Sleep: ${r30.sleep}h (was ${p30.sleep}), RHR: ${r30.rhr} bpm (was ${p30.rhr}), HRV: ${r30.hrv} ms (was ${p30.hrv}), Exercise: ${r30.exercise} min/day (was ${p30.exercise}), Distance: ${r30.distance} km/day

## Health Score: ${avgScore}/100 (${avgScore ? scoreLabel(avgScore).label : 'N/A'})

## Cardio
VO2 Max: ${vo2.length > 0 ? vo2[0].value.toFixed(1) : 'N/A'} mL/kg/min, Weight: ${latestWeight?.weight ? latestWeight.weight.toFixed(1) + ' kg' : 'N/A'}

## Sleep-HRV Relationship
HRV after <7h sleep: ${lowSleepHRV.length > 3 ? avg(lowSleepHRV.map(p => p.hrv)) : 'N/A'} ms (${lowSleepHRV.length} nights)
HRV after ≥7h sleep: ${goodSleepHRV.length > 3 ? avg(goodSleepHRV.map(p => p.hrv)) : 'N/A'} ms (${goodSleepHRV.length} nights)

## Workouts (last 30d): ${recentWorkouts.length} total
${Array.from(workoutTypes.entries()).map(([t, e]) => `${t}: ${e.count}x, avg ${Math.round(e.avgDur / e.count)}min${e.avgHR ? `, avg HR ${Math.round(e.avgHR)}bpm` : ''}`).join('\n')}

## Dataset: ${metrics.length} days, ${data.workouts.length} workouts, ${data.sleepRecords.length} sleep records`
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  followUps?: string[]
}

// Cache helpers
function loadCache(): { messages: ChatMessage[]; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return parsed
  } catch { return null }
}

function saveCache(messages: ChatMessage[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ messages, timestamp: Date.now() }))
  } catch { /* quota exceeded */ }
}

interface Props {
  data: HealthData
  metrics: DailyMetrics[]
}

export default function AIInsights({ data, metrics }: Props) {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('openrouter_key') || '')
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadCache()?.messages || [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [customQ, setCustomQ] = useState('')
  const [streamText, setStreamText] = useState('')
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scores = useMemo(() => computeHealthScores(data), [data])
  const dataContext = useMemo(() => buildDataContext(data, scores, metrics), [data, scores, metrics])

  // Save to cache whenever messages change
  useEffect(() => {
    if (messages.length > 0) saveCache(messages)
  }, [messages])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  const saveKey = useCallback((key: string) => {
    setApiKey(key)
    if (key) sessionStorage.setItem('openrouter_key', key)
  }, [])

  const ask = useCallback(async (question: string) => {
    if (!apiKey || loading) return
    setLoading(true)
    setError('')
    setStreamText('')

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: question }]
    setMessages(newMessages)

    try {
      const systemPrompt = `You are a health data analyst. You have access to this person's Apple Health data summary:\n\n${dataContext}\n\nRules:\n- Be specific with numbers from the data\n- Keep responses concise (3-5 short paragraphs max)\n- No markdown formatting (no **, no ##, no bullet points, no dashes for lists)\n- Use plain text only with natural paragraph breaks\n- Be direct and actionable\n- If the data doesn't support an answer, say so\n\nAfter your response, on a new line write "FOLLOW_UPS:" followed by exactly 3 short follow-up questions the user might want to ask next, separated by "|". Make them specific to what you just discussed. Example:\nFOLLOW_UPS:How can I improve my deep sleep?|What's causing my HRV to drop?|Should I change my workout schedule?`

      const apiMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...newMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ]

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4.6',
          messages: apiMessages,
          max_tokens: 1500,
          stream: true,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`API error ${res.status}: ${body.substring(0, 200)}`)
      }

      // Stream the response
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

          for (const line of lines) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                fullText += delta
                // Show text without FOLLOW_UPS section while streaming
                const displayText = fullText.split('FOLLOW_UPS:')[0].trim()
                setStreamText(displayText)
              }
            } catch { /* skip malformed chunks */ }
          }
        }
      }

      // Parse follow-ups from response
      const parts = fullText.split('FOLLOW_UPS:')
      const responseText = parts[0].trim()
      const followUps = parts[1]
        ? parts[1].trim().split('|').map(f => f.trim()).filter(Boolean).slice(0, 3)
        : []

      setStreamText('')
      setMessages([...newMessages, { role: 'assistant', content: responseText, followUps }])
    } catch (err) {
      setError(String(err))
      setMessages(newMessages.slice(0, -1))
    } finally {
      setLoading(false)
      setStreamText('')
    }
  }, [apiKey, loading, messages, dataContext])

  const handleCustomSubmit = () => {
    if (customQ.trim()) {
      ask(customQ.trim())
      setCustomQ('')
    }
  }

  const exportChat = useCallback(() => {
    const text = messages.map(m =>
      m.role === 'user' ? `Q: ${m.content}` : `A: ${m.content}`
    ).join('\n\n---\n\n')
    const blob = new Blob([`Health Insights Chat\n${new Date().toLocaleDateString()}\n\n${text}`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `health-insights-${new Date().toISOString().substring(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [messages])

  const copyChat = useCallback(() => {
    const text = messages.map(m =>
      m.role === 'user' ? `Q: ${m.content}` : `A: ${m.content}`
    ).join('\n\n---\n\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [messages])

  const hasKey = apiKey.length > 10

  // Get last assistant message's follow-ups
  const lastFollowUps = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].followUps || []
    : []

  return (
    <div className="space-y-4">
      <TabHeader title="AI Insights" description="AI-powered analysis of your health data to surface trends and actionable recommendations." />
      {/* API Key */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Key size={16} className="text-zinc-400" />
            <h3 className="text-sm font-medium text-zinc-300">OpenRouter API Key</h3>
          </div>
          {messages.length > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={copyChat} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={exportChat} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                <Download size={12} />
                Export
              </button>
            </div>
          )}
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={e => saveKey(e.target.value)}
          placeholder="sk-or-..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <p className="text-[11px] text-zinc-600 mt-2">Stored in session memory only. Chat cached for 10 min.</p>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Predefined questions */}
      {hasKey && messages.length === 0 && !loading && (
        <div>
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Ask about your health data</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {PREDEFINED_QUESTIONS.map(q => (
              <button
                key={q.label}
                onClick={() => ask(q.question)}
                className="text-left bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700 transition-colors"
              >
                <MessageCircle size={14} className="text-purple-400 mb-1.5" />
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      {(messages.length > 0 || streamText) && (
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`rounded-xl px-4 py-3 ${
              m.role === 'user'
                ? 'bg-purple-500/10 border border-purple-500/20 ml-12'
                : 'bg-zinc-900 border border-zinc-800'
            }`}>
              {m.role === 'assistant' && (
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={12} className="text-purple-400" />
                  <span className="text-[11px] text-purple-400">Claude</span>
                </div>
              )}
              <div className={`text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'text-zinc-200' : 'text-zinc-300'
              }`}>
                {m.content}
              </div>
            </div>
          ))}

          {/* Streaming response */}
          {streamText && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} className="text-purple-400" />
                <span className="text-[11px] text-purple-400">Claude</span>
              </div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-300">
                {streamText}
                <span className="inline-block w-1.5 h-4 bg-purple-400 ml-0.5 animate-pulse" />
              </div>
            </div>
          )}

          {/* Loading without stream yet */}
          {loading && !streamText && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-purple-400" />
              <span className="text-sm text-zinc-500">Analyzing your data...</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Follow-ups + custom input */}
      {hasKey && messages.length > 0 && !loading && (
        <div className="space-y-3">
          {/* Contextual follow-ups */}
          {lastFollowUps.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {lastFollowUps.map(q => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Custom input */}
          <div className="flex gap-2">
            <input
              value={customQ}
              onChange={e => setCustomQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
              placeholder="Ask a follow-up question..."
              disabled={loading}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <button
              onClick={handleCustomSubmit}
              disabled={loading || !customQ.trim()}
              className={`px-3 py-2 rounded-lg transition-colors ${
                loading || !customQ.trim()
                  ? 'bg-zinc-800 text-zinc-600'
                  : 'bg-purple-600 text-white hover:bg-purple-500'
              }`}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* New conversation */}
      {messages.length > 0 && !loading && (
        <button
          onClick={() => { setMessages([]); localStorage.removeItem(CACHE_KEY) }}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Start new conversation
        </button>
      )}

      {/* Empty state */}
      {!hasKey && (
        <div className="text-center py-16">
          <Sparkles size={40} className="mx-auto mb-4 text-zinc-700" />
          <div className="text-zinc-400 text-sm">Enter your OpenRouter API key above to start</div>
          <div className="text-zinc-600 text-xs mt-1">Your health data summary will be sent to Claude Sonnet for analysis</div>
        </div>
      )}
    </div>
  )
}
