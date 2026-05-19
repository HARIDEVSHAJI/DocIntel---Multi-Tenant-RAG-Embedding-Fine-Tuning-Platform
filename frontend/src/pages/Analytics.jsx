import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getMetrics, runAutoEvaluation, getStats } from '../api/client'
import { PageHeader, Spinner } from '../components/ui'
import { BarChart2, Activity, Shield, Clock, Search, RefreshCw, Zap, FileWarning } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, LineChart, Line } from 'recharts'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const METRIC_COLORS = { faithfulness: '#f97316', answer_relevancy: '#22c55e', context_precision: '#3b82f6', answer_similarity: '#a855f7' }
const METRIC_LABELS = { faithfulness: 'Faithfulness', answer_relevancy: 'Answer Relevancy', context_precision: 'Context Precision', answer_similarity: 'Answer Similarity' }

const ChartTooltip = ({ active, payload, label, suffix = '' }) => {
  if (!active || !payload?.length) return null
  return (<div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs"><p className="text-gray-400 mb-0.5">{label}</p><p className="text-emerald-400 font-semibold">{payload[0].value}{suffix}</p></div>)
}

function AnimatedCounter({ value, label, accent = 'emerald' }) {
  const colors = { emerald: 'text-emerald-400', blue: 'text-blue-400', purple: 'text-purple-400', orange: 'text-orange-400' }
  return (
    <div className="card p-5 text-center animate-fadeIn">
      <p className={clsx('text-3xl font-bold', colors[accent])}>{value}</p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-2">{label}</p>
    </div>
  )
}

export default function Analytics() {
  const [metrics, setMetrics] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [evalRunning, setEvalRunning] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.all([
      getMetrics().catch(() => null),
      getStats().catch(() => null)
    ]).then(([metricsData, statsData]) => {
      setMetrics(metricsData)
      setStats(statsData)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { const id = setInterval(refresh, 30000); return () => clearInterval(id) }, [refresh])

  const handleRunEval = async () => {
    setEvalRunning(true)
    try { await runAutoEvaluation(); refresh(); toast.success('Evaluation complete!') }
    catch (err) { toast.error(err.response?.data?.detail || err.message) }
    finally { setEvalRunning(false) }
  }

  const totalQueries = metrics?.total_queries ?? 0
  const avgFaith = metrics?.avg_faithfulness ?? 0
  const avgTime = metrics?.avg_response_time_ms ?? 0
  const avgChunks = metrics?.avg_chunks_per_query ?? 0
  const evalResults = metrics?.eval_results
  const faithDist = metrics?.faithfulness_distribution ?? { high: 0, medium: 0, low: 0 }

  const volumeData = metrics?.query_volume_24h ? Object.entries(metrics.query_volume_24h).sort(([a],[b]) => a.localeCompare(b)).map(([hour, count]) => ({ hour, queries: count })) : []
  const sourceFreqData = metrics?.source_frequency ? Object.entries(metrics.source_frequency).slice(0, 6).map(([name, count]) => ({ name: name.length > 18 ? name.slice(0, 16) + '…' : name, count })) : []
  const responseTimeData = metrics?.query_log?.map((q, i) => ({ idx: i + 1, time: q.response_time_ms })) || []

  const radarData = evalResults?.aggregated ? Object.entries(evalResults.aggregated).map(([key, val]) => ({ metric: METRIC_LABELS[key] || key, value: Math.round(val * 100), fullMark: 100 })) : []
  const barData = evalResults?.aggregated ? Object.entries(evalResults.aggregated).map(([key, val]) => ({ metric: METRIC_LABELS[key] || key, value: Math.round(val * 100), fill: METRIC_COLORS[key] })) : []
  const overallHealth = evalResults?.aggregated ? Math.round(Object.values(evalResults.aggregated).reduce((a, b) => a + b, 0) / Object.values(evalResults.aggregated).length * 100) : null

  const faithDistData = [
    { label: 'High (≥65%)', value: faithDist.high, fill: '#22c55e' },
    { label: 'Medium', value: faithDist.medium, fill: '#eab308' },
    { label: 'Low (<35%)', value: faithDist.low, fill: '#ef4444' },
  ]

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="h-24 shrink-0" />
      <PageHeader title="Analytics" subtitle="Historical performance data and pipeline evaluation results">
        <button onClick={refresh} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </PageHeader>

      {/* ═══ SECTION 1: Pipeline Performance ═══ */}
      <section className="space-y-4 animate-fadeIn">
        <div className="flex items-center justify-between">
          <h2 className="section-title text-base flex items-center gap-2 mb-0"><BarChart2 size={16} className="text-emerald-400" /> RAG Pipeline Performance</h2>
          {evalResults && (
            <button onClick={handleRunEval} disabled={evalRunning} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
              {evalRunning ? <><Spinner size={12} /> Running…</> : '▶ Re-run Evaluation'}
            </button>
          )}
        </div>

        {evalResults ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Radar chart */}
              <div className="card p-5">
                <p className="section-title">Metrics Radar</p>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData}><PolarGrid stroke="#1a1a1a" /><PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#9ca3af' }} /><PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: '#6b7280' }} tickCount={5} /><Radar dataKey="value" stroke="#f97316" fill="#f97316" fillOpacity={0.15} strokeWidth={2} /><Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #1a1a1a', borderRadius: 8, fontSize: 12 }} formatter={v => [`${v}%`, 'Score']} /></RadarChart>
                </ResponsiveContainer>
              </div>
              {/* Bar chart */}
              <div className="card p-5">
                <p className="section-title">Metric Comparison</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="metric" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, fontSize: 12 }} formatter={v => [`${v}%`]} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>{barData.map((d, i) => (<rect key={i} fill={d.fill} />))}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Health gauge */}
              <div className="card p-5 flex flex-col items-center justify-center">
                <p className="section-title mb-4">Pipeline Health</p>
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#1a1a1a" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke={overallHealth >= 70 ? '#22c55e' : overallHealth >= 40 ? '#eab308' : '#ef4444'} strokeWidth="8" strokeDasharray={`${(overallHealth / 100) * 264} 264`} strokeLinecap="round" className="transition-all duration-1000" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center"><span className="text-2xl font-bold text-white">{overallHealth}%</span></div>
                </div>
                <p className="text-xs text-gray-500 mt-3">Avg of all 4 metrics</p>
                <p className="text-[10px] text-gray-600 mt-1">Evaluated {evalResults.total} questions • {evalResults.timestamp ? new Date(evalResults.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</p>
              </div>
            </div>
          </div>
        ) : stats?.index?.chunks === 0 ? (
          <div className="card p-10 text-center border-dashed border-amber-500/20">
            <FileWarning size={32} className="text-amber-500 mx-auto mb-3" />
            <p className="text-sm text-gray-200 mb-1 font-semibold">No documents indexed in this workspace</p>
            <p className="text-xs text-gray-500 mb-5 max-w-md mx-auto">You must upload and index documents in the Workspace tab first before you can run automated evaluations.</p>
            <Link to="/workspace" className="btn-primary mx-auto flex items-center gap-2 max-w-max text-xs">
              Go to Workspace Tab
            </Link>
          </div>
        ) : (
          <div className="card p-10 text-center">
            <BarChart2 size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-400 mb-1">No evaluation results yet</p>
            <p className="text-xs text-gray-600 mb-4">Run a pipeline evaluation to see performance metrics here.</p>
            <button onClick={handleRunEval} disabled={evalRunning} className="btn-primary mx-auto flex items-center gap-2">
              {evalRunning ? <><Spinner size={14} /> Running…</> : '▶ Run Pipeline Evaluation'}
            </button>
          </div>
        )}
      </section>

      {/* ═══ QUERY & RETRIEVAL ANALYTICS ═══ */}
      {totalQueries > 0 ? (
        <>
          {/* ═══ SECTION 2: Query Analytics ═══ */}
          <section className="space-y-4 animate-fadeIn" style={{ animationDelay: '100ms' }}>
            <h2 className="section-title text-base flex items-center gap-2"><Activity size={16} className="text-emerald-400" /> Query Analytics</h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Query volume */}
              <div className="card p-5">
                <p className="section-title">Query Volume (Last 24h)</p>
                {volumeData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={volumeData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                      <defs><linearGradient id="qGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.02} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" /><XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip content={<ChartTooltip suffix=" queries" />} /><Area type="monotone" dataKey="queries" stroke="#10b981" strokeWidth={2} fill="url(#qGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (<p className="text-xs text-gray-600 text-center py-10">No queries in the last 24 hours</p>)}
              </div>
              {/* Faithfulness distribution */}
              <div className="card p-5">
                <p className="section-title">Faithfulness Distribution</p>
                <div className="space-y-4 pt-2">
                  {faithDistData.map(d => {
                    const pct = totalQueries > 0 ? ((d.value / totalQueries) * 100) : 0
                    return (<div key={d.label}><div className="flex items-center justify-between mb-1"><span className="text-xs text-gray-400">{d.label}</span><span className="text-xs font-mono font-semibold" style={{ color: d.fill }}>{d.value} ({pct.toFixed(0)}%)</span></div><div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: d.fill }} /></div></div>)
                  })}
                </div>
              </div>
              {/* Response time trend */}
              <div className="card p-5">
                <p className="section-title">Response Time Trend</p>
                {responseTimeData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={responseTimeData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" /><XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip suffix="ms" />} /><Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (<p className="text-xs text-gray-600 text-center py-10">No response time data yet</p>)}
              </div>
              {/* Source frequency */}
              <div className="card p-5">
                <p className="section-title">Most Retrieved Sources</p>
                {sourceFreqData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={sourceFreqData} layout="vertical" margin={{ left: 10, right: 8 }}>
                      <XAxis type="number" tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={100} /><Bar dataKey="count" fill="#f97316" radius={[0, 4, 4, 0]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (<p className="text-xs text-gray-600 text-center py-10">No retrieval data yet</p>)}
              </div>
            </div>
          </section>

          {/* ═══ SECTION 3: Retrieval Deep Dive ═══ */}
          <section className="space-y-4 animate-fadeIn" style={{ animationDelay: '200ms' }}>
            <h2 className="section-title text-base flex items-center gap-2"><Zap size={16} className="text-emerald-400" /> Retrieval Deep Dive</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <AnimatedCounter value={totalQueries} label="Total Queries Processed" accent="emerald" />
              <AnimatedCounter value={`${(avgFaith * 100).toFixed(0)}%`} label="Average Faithfulness" accent="orange" />
              <AnimatedCounter value={`${avgTime.toFixed(0)}ms`} label="Average Response Time" accent="blue" />
            </div>

            <div className="card p-5">
              <p className="section-title mb-3">Avg chunks per query: <span className="text-emerald-400 font-mono">{avgChunks.toFixed(1)}</span></p>
            </div>

            {metrics?.query_log?.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
                  <p className="section-title mb-0">Last {metrics.query_log.length} Queries</p>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-xs"><thead><tr className="border-b border-[#1e1e1e] sticky top-0 bg-[#0a0a0a]">
                    {['Time','Question','Response (ms)','Faithfulness','Sources'].map(h => (<th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>))}
                  </tr></thead><tbody>
                    {[...metrics.query_log].reverse().map((q, i) => {
                      const fp = (q.faithfulness_score * 100).toFixed(0)
                      const fc = q.faithfulness_score >= 0.65 ? 'text-green-400' : q.faithfulness_score >= 0.35 ? 'text-yellow-400' : 'text-red-400'
                      return (
                        <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(q.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                          <td className="px-4 py-3 text-gray-300 max-w-[300px]"><p className="truncate" title={q.question}>{q.question}</p></td>
                          <td className="px-4 py-3 text-gray-400 font-mono">{q.response_time_ms.toFixed(0)}</td>
                          <td className="px-4 py-3"><span className={clsx('font-mono font-semibold', fc)}>{fp}%</span></td>
                          <td className="px-4 py-3 text-gray-400 font-mono">{q.source_count}</td>
                        </tr>
                      )
                    })}
                  </tbody></table>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="space-y-4 animate-fadeIn" style={{ animationDelay: '100ms' }}>
          <h2 className="section-title text-base flex items-center gap-2"><Activity size={16} className="text-emerald-400" /> Query Analytics & Logs</h2>
          <div className="card p-10 text-center border-dashed border-emerald-500/20">
            <Search size={32} className="text-emerald-500/80 mx-auto mb-3" />
            <p className="text-sm text-gray-200 mb-1 font-semibold">No query logs recorded in this workspace yet</p>
            <p className="text-xs text-gray-500 mb-5 max-w-md mx-auto">Real-time charts, faithfulness metrics, response time trends, and retrieval logs are generated as you chat. Start a conversation with your documents to see metrics here!</p>
            <Link to="/chat" className="btn-primary mx-auto flex items-center gap-2 max-w-max text-xs">
              💬 Start Chatting
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
