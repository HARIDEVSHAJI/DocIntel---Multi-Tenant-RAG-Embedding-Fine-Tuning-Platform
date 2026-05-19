import { useState, useEffect, useCallback } from 'react'
import { getStats, getMetrics, getHealth, validateKey } from '../api/client'
import { StatCard, PageHeader } from '../components/ui'
import {
  FileText, Database, Cpu, Key, Activity, AlertCircle,
  BarChart2, Clock, MessageSquare, Shield, Wifi, WifiOff,
  RefreshCw, TrendingUp, TrendingDown, Search,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts'
import clsx from 'clsx'

/* ── Stat card with optional sparkline / trend ─────────────────────────── */
function MetricCard({ label, value, sub, accent = 'emerald', icon: Icon, trend, children }) {
  const accents = {
    emerald: 'border-t-emerald-500 text-emerald-400',
    green:  'border-t-green-500  text-green-400',
    red:    'border-t-red-500    text-red-400',
    blue:   'border-t-blue-500   text-blue-400',
    purple: 'border-t-purple-500 text-purple-400',
    yellow: 'border-t-yellow-500 text-yellow-400',
  }
  return (
    <div className={clsx(
      'card p-5 border-t-2 transition-all duration-300 hover:border-opacity-80',
      accents[accent] || accents.emerald
    )}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-2">
            {label}
          </p>
          <div className="flex items-baseline gap-2">
            <p className={clsx('text-2xl font-bold leading-none', accents[accent]?.split(' ')[1] || 'text-emerald-400')}>
              {value}
            </p>
            {trend && (
              <span className={clsx('flex items-center gap-0.5 text-[10px] font-medium',
                trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-gray-500'
              )}>
                {trend === 'up' ? <TrendingUp size={10} /> : trend === 'down' ? <TrendingDown size={10} /> : null}
              </span>
            )}
          </div>
          {sub && <p className="text-xs text-gray-500 mt-2">{sub}</p>}
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/5 shrink-0">
            <Icon size={18} className={accents[accent]?.split(' ')[1] || 'text-emerald-400'} />
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

/* ── Pulse dot (live indicator) ────────────────────────────────────────── */
function PulseDot({ ok }) {
  return (
    <div className="relative flex items-center justify-center w-3 h-3 shrink-0">
      {ok && (
        <span className="absolute w-3 h-3 rounded-full bg-green-400/40 animate-ping" />
      )}
      <span className={clsx('w-2 h-2 rounded-full', ok ? 'bg-green-400' : 'bg-gray-600')} />
    </div>
  )
}

/* ── Custom chart tooltip ──────────────────────────────────────────────── */
const ChartTooltip = ({ active, payload, label, suffix = '' }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs">
      <p className="text-gray-400 mb-0.5">{label}</p>
      <p className="text-emerald-400 font-semibold">{payload[0].value}{suffix}</p>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   OVERVIEW DASHBOARD — Full metrics & system monitoring
   ══════════════════════════════════════════════════════════════════════ */
export default function Dashboard({ health, keyStatus }) {
  const [stats, setStats] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [diagRunning, setDiagRunning] = useState(false)
  const [diagResults, setDiagResults] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.all([
      getStats().catch(() => null),
      getMetrics().catch(() => null),
    ]).then(([s, m]) => {
      setStats(s)
      setMetrics(m)
      setLastRefresh(new Date())
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(refresh, 30000)
    return () => clearInterval(id)
  }, [refresh])

  /* ── Derived values ──────────────────────────────────────────────────── */
  const sources = stats?.sources ? Object.entries(stats.sources) : []
  const totalQueries = metrics?.total_queries ?? 0
  const avgFaith = metrics?.avg_faithfulness ?? 0
  const avgTime = metrics?.avg_response_time_ms ?? 0
  const docCount = sources.length
  const chunkCount = stats?.index?.chunks ?? 0
  const embDim = stats?.index?.dimension ?? 0
  const indexSize = chunkCount && embDim ? `${(chunkCount * embDim).toLocaleString()} vectors` : '—'

  // Faithfulness color
  const faithColor = avgFaith >= 0.65 ? 'green' : avgFaith >= 0.35 ? 'yellow' : totalQueries > 0 ? 'red' : 'emerald'

  // Response time trend
  const recentTimes = metrics?.query_log?.slice(-5).map(q => q.response_time_ms) || []
  const olderTimes = metrics?.query_log?.slice(-10, -5).map(q => q.response_time_ms) || []
  const avgRecent = recentTimes.length ? recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length : 0
  const avgOlder = olderTimes.length ? olderTimes.reduce((a, b) => a + b, 0) / olderTimes.length : 0
  const timeTrend = avgRecent && avgOlder ? (avgRecent < avgOlder ? 'up' : avgRecent > avgOlder ? 'down' : null) : null

  // Query volume chart data (24h)
  const volumeData = metrics?.query_volume_24h
    ? Object.entries(metrics.query_volume_24h)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([hour, count]) => ({ hour, queries: count }))
    : []

  // Faithfulness distribution
  const faithDist = metrics?.faithfulness_distribution ?? { high: 0, medium: 0, low: 0 }
  const faithDistData = [
    { label: 'High (≥65%)', value: faithDist.high, fill: '#22c55e' },
    { label: 'Medium', value: faithDist.medium, fill: '#eab308' },
    { label: 'Low (<35%)', value: faithDist.low, fill: '#ef4444' },
  ]

  // Source frequency chart
  const sourceFreqData = metrics?.source_frequency
    ? Object.entries(metrics.source_frequency).slice(0, 5).map(([name, count]) => ({
        name: name.length > 15 ? name.slice(0, 13) + '…' : name,
        count,
      }))
    : []

  /* ── Diagnostics ─────────────────────────────────────────────────────── */
  const runDiagnostics = async () => {
    setDiagRunning(true)
    setDiagResults(null)
    const results = {}
    try {
      const h = await getHealth()
      results.backend = { ok: h?.status === 'ok', label: 'Backend API' }
      results.index = { ok: h?.index_loaded, label: 'FAISS Index' }
      results.fineTuned = { ok: h?.fine_tuned_model, label: 'Fine-tuned Model' }
    } catch {
      results.backend = { ok: false, label: 'Backend API' }
    }
    try {
      const k = await validateKey()
      results.groq = { ok: k?.valid, label: 'Groq API' }
    } catch {
      results.groq = { ok: false, label: 'Groq API' }
    }
    results.embeddings = { ok: true, label: 'Embedding Model' } // If backend is up, model is loaded
    setDiagResults(results)
    setDiagRunning(false)
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="h-24 shrink-0" />
      <PageHeader
        title="System Overview"
        subtitle="Document Intelligence Platform — Real-time RAG Metrics"
      >
        <span className="text-[10px] text-gray-600">
          Updated {lastRefresh.toLocaleTimeString()}
        </span>
        <button onClick={refresh} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </PageHeader>

      {/* ═══ ROW 1 — 5 Stat Cards ════════════════════════════════════════ */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <MetricCard
          label="Total Queries"
          value={totalQueries}
          sub={totalQueries > 0 ? `Last: ${metrics?.query_log?.at(-1)?.timestamp?.slice(11, 16) ?? ''}` : 'No queries yet'}
          accent="emerald"
          icon={MessageSquare}
        />
        <MetricCard
          label="Avg Faithfulness"
          value={totalQueries > 0 ? `${(avgFaith * 100).toFixed(0)}%` : '—'}
          sub={totalQueries > 0 ? `${faithDist.high} high, ${faithDist.low} low` : 'Start chatting'}
          accent={faithColor}
          icon={Shield}
        />
        <MetricCard
          label="Avg Response Time"
          value={totalQueries > 0 ? `${avgTime.toFixed(0)}ms` : '—'}
          sub={totalQueries > 0 ? `${recentTimes.length} recent queries` : 'No data'}
          accent="blue"
          icon={Clock}
          trend={timeTrend}
        />
        <MetricCard
          label="Documents Indexed"
          value={docCount || '—'}
          sub={chunkCount ? `${chunkCount} total chunks` : 'Upload files to begin'}
          accent="purple"
          icon={FileText}
        />
        <MetricCard
          label="Index Size"
          value={chunkCount ? indexSize : '—'}
          sub={embDim ? `${embDim}d embeddings` : 'No index'}
          accent="green"
          icon={Database}
        />
      </div>

      {/* ═══ ROW 2 — Two large charts ════════════════════════════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        {/* Query Volume (24h) */}
        <div className="card p-5">
          <p className="section-title">Query Volume (Last 24h)</p>
          {volumeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={volumeData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                <defs>
                  <linearGradient id="queryGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip suffix=" queries" />} />
                <Area
                  type="monotone" dataKey="queries"
                  stroke="#f97316" strokeWidth={2}
                  fill="url(#queryGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center">
              <Activity size={28} className="text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">No queries yet — start chatting</p>
            </div>
          )}
        </div>

        {/* Faithfulness Distribution */}
        <div className="card p-5">
          <p className="section-title">Faithfulness Distribution</p>
          {totalQueries > 0 ? (
            <div className="space-y-6 pt-4">
              {faithDistData.map(d => {
                const pct = totalQueries > 0 ? ((d.value / totalQueries) * 100) : 0
                return (
                  <div key={d.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-400">{d.label}</span>
                      <span className="text-xs font-mono font-semibold" style={{ color: d.fill }}>
                        {d.value} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: d.fill }}
                      />
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center justify-center gap-6 pt-2 border-t border-[#1e1e1e]">
                {faithDistData.map(d => (
                  <div key={d.label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                    <span className="text-[10px] text-gray-500">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center text-center">
              <Shield size={28} className="text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">No queries yet — start chatting</p>
            </div>
          )}
        </div>
      </div>

      {/* ═══ ROW 3 — Three panels ════════════════════════════════════════ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        {/* Retrieval Performance */}
        <div className="card p-5">
          <p className="section-title">Retrieval Performance</p>
          <div className="space-y-3 mb-4">
            <div className="flex justify-between items-center py-2 border-b border-[#1e1e1e]">
              <span className="text-xs text-gray-500">Avg Chunks/Query</span>
              <span className="text-xs font-mono text-emerald-400">
                {metrics?.avg_chunks_per_query?.toFixed(1) ?? '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#1e1e1e]">
              <span className="text-xs text-gray-500">Total Sources</span>
              <span className="text-xs font-mono text-emerald-400">{docCount}</span>
            </div>
          </div>
          {sourceFreqData.length > 0 && (
            <>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Top Retrieved Sources</p>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={sourceFreqData} layout="vertical" margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={80} />
                  <Bar dataKey="count" fill="#f97316" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
          {sourceFreqData.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">No retrieval data yet</p>
          )}
        </div>

        {/* System Health Monitor */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="section-title mb-0">System Health Monitor</p>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Backend API',     ok: health?.status === 'ok' },
              { label: 'Groq API',        ok: keyStatus?.valid },
              { label: 'FAISS Index',     ok: health?.index_loaded },
              { label: 'Embedding Model', ok: health?.status === 'ok' },
              { label: 'Fine-tuned Model',ok: health?.fine_tuned_model },
            ].map(({ label, ok }) => (
              <div key={label} className="flex items-center gap-3 bg-[#0d0d0d] rounded-lg px-3 py-2.5">
                <PulseDot ok={ok} />
                <span className="text-xs text-gray-400 flex-1">{label}</span>
                <span className={clsx('text-[10px] font-medium',
                  ok ? 'text-green-400' : 'text-gray-600'
                )}>
                  {ok ? 'Online' : 'Offline'}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={runDiagnostics}
            disabled={diagRunning}
            className="btn-secondary w-full text-xs mt-4 flex items-center justify-center gap-1.5"
          >
            <RefreshCw size={12} className={diagRunning ? 'animate-spin' : ''} />
            {diagRunning ? 'Running…' : 'Run Diagnostics'}
          </button>
          {diagResults && (
            <div className="mt-3 space-y-1.5">
              {Object.values(diagResults).map(r => (
                <div key={r.label} className="flex items-center gap-2 text-xs">
                  <span className={r.ok ? 'text-green-400' : 'text-red-400'}>{r.ok ? '✓' : '✗'}</span>
                  <span className="text-gray-400">{r.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Model Information */}
        <div className="card p-5">
          <p className="section-title">Model Information</p>
          <div className="space-y-3">
            {[
              { k: 'Embedding Model', v: stats?.model_name ?? 'all-MiniLM-L6-v2' },
              { k: 'Embedding Dim',   v: embDim || '—' },
              { k: 'Fine-tuned',      v: stats?.fine_tuned_model ? 'Yes (active)' : 'No (base)' },
              { k: 'Index Type',      v: chunkCount > 0 ? 'FAISS Flat IP' : '—' },
              { k: 'Chunk Count',     v: chunkCount || '—' },
              { k: 'Overlap',         v: stats?.config?.overlap ?? '—' },
              { k: 'LLM Model',       v: stats?.config?.llm_model ?? '—' },
              { k: 'LLM Provider',    v: 'Groq' },
              { k: 'Last Indexed',    v: metrics?.last_index_timestamp
                  ? new Date(metrics.last_index_timestamp).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })
                  : 'Never' },
            ].map(({ k, v }) => (
              <div key={k} className="flex items-center justify-between py-1.5
                                       border-b border-[#1e1e1e] last:border-0">
                <span className="text-xs text-gray-500">{k}</span>
                <span className="text-xs font-mono text-emerald-400">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ ROW 4 — Recent Query Log ════════════════════════════════════ */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-[#2a2a2a] flex items-center justify-between">
          <p className="section-title mb-0">Recent Query Log</p>
          <span className="text-[10px] text-gray-600">{metrics?.query_log?.length ?? 0} entries</span>
        </div>
        {metrics?.query_log?.length > 0 ? (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e1e] sticky top-0 bg-[#141414]">
                  {['Time', 'Question', 'Response (ms)', 'Faithfulness', 'Sources'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold
                                           uppercase tracking-wider text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...metrics.query_log].reverse().map((q, i) => {
                  const faithPct = (q.faithfulness_score * 100).toFixed(0)
                  const faithCol = q.faithfulness_score >= 0.65 ? 'text-green-400'
                    : q.faithfulness_score >= 0.35 ? 'text-yellow-400' : 'text-red-400'
                  return (
                    <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#161616] transition-colors group">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(q.timestamp).toLocaleTimeString(undefined, {
                          hour: '2-digit', minute: '2-digit', second: '2-digit'
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-300 max-w-[300px]">
                        <p className="truncate group-hover:whitespace-normal group-hover:break-words transition-all"
                           title={q.question}>
                          {q.question.slice(0, 60)}{q.question.length > 60 ? '…' : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-mono">{q.response_time_ms.toFixed(0)}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('font-mono font-semibold', faithCol)}>
                          {faithPct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-mono">{q.source_count}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center">
            <Search size={24} className="text-gray-700 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No queries recorded yet</p>
            <p className="text-xs text-gray-700 mt-1">Ask questions in the Chat tab to see metrics here</p>
          </div>
        )}
      </div>
    </div>
  )
}
