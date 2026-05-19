import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { startTraining, uploadDocs, getConfig, getHealth, getStats } from '../api/client'
import { PageHeader, DropZone, ProgressBar, StatCard } from '../components/ui'
import { Brain, TrendingDown, FileText, Database, Zap } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import toast from 'react-hot-toast'

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs">
      <p className="text-gray-400">Step {payload[0].payload.step}</p>
      <p className="text-emerald-400 font-semibold">Loss: {payload[0].value?.toFixed(5)}</p>
    </div>
  )
}

export default function Training() {
  const [trainCsv, setTrainCsv] = useState(null)
  const [epochs, setEpochs] = useState(3)
  const [state, setState] = useState({
    running: false, progress: 0, message: 'Idle',
    losses: [], done: false, success: null, result_message: '',
  })
  const esRef = useRef(null)

  const [ragFiles, setRagFiles] = useState([])
  const [ragLoading, setRagLoading] = useState(false)
  const [ragResult, setRagResult] = useState(null)
  const [health, setHealth] = useState(null)
  const [stats, setStats] = useState(null)

  const refreshStatus = () => {
    getHealth().then(setHealth).catch(() => setHealth(null))
    getStats().then(setStats).catch(() => setStats(null))
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  useEffect(() => () => esRef.current?.close(), [])

  const onTrainCsv = (f) => setTrainCsv(f[0])

  const onRagFiles = (f) => {
    setRagFiles(f)
    setRagResult(null)
  }

  const handleIndexDocuments = async () => {
    if (!ragFiles.length) return toast.error('Select at least one PDF or TXT file.')
    setRagLoading(true)
    try {
      const cfg = await getConfig()
      const data = await uploadDocs(ragFiles, cfg.chunk_size, cfg.overlap)
      setRagResult(data)
      toast.success(`Indexed ${data.chunk_count} chunks from ${Object.keys(data.sources).length} file(s)!`)
      refreshStatus()
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message)
    } finally {
      setRagLoading(false)
    }
  }

  const startStream = () => {
    if (esRef.current) esRef.current.close()
    const base = import.meta.env.VITE_API_URL || ''
    const token = localStorage.getItem('docintel_token') || ''
    const wsId = localStorage.getItem('docintel_active_workspace') || ''
    const es = new EventSource(`${base}/api/train/stream?token=${encodeURIComponent(token)}&workspace_id=${wsId}`)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        setState(data)
        if (data.done) {
          es.close()
          if (data.success) toast.success('Fine-tuning complete!')
          else toast.error('Training failed — check result message.')
        }
      } catch (_) {}
    }
    es.onerror = () => es.close()
  }

  const handleTrain = async () => {
    if (!trainCsv) return toast.error('Upload a training CSV first.')
    try {
      await startTraining(trainCsv, epochs)
      startStream()
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message)
    }
  }

  const lossData = state.losses.map((l, i) => ({ step: i + 1, loss: l }))
  const minLoss = lossData.length ? Math.min(...state.losses) : 0
  const maxLoss = lossData.length ? Math.max(...state.losses) : 1

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Training & indexing"
        subtitle="Index PDFs/TXT for RAG chat, or fine-tune the embedding model with a Q&A CSV — live loss tracking"
      />

      {/* RAG document indexing */}
      <div className="card p-6 mb-6 space-y-4">
        <p className="section-title mb-0">Index documents (RAG)</p>
        <p className="text-xs text-gray-600">
          Chunk size and overlap are taken from{' '}
          <Link to="/config" className="text-emerald-400 hover:underline">Config</Link>
          {' '}(saved values on the server). Save there first if you change them.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <DropZone
              onFiles={onRagFiles}
              accept=".pdf,.txt"
              label="Drop PDFs or TXT files here"
              sublabel="Multiple files supported"
            />
            {ragFiles.length > 0 && (
              <div className="bg-[#0f0f0f] rounded-lg p-3 border border-[#222] space-y-1.5">
                {ragFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                    <FileText size={12} className="text-emerald-400 shrink-0" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-gray-600 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-end">
            <button
              type="button"
              onClick={handleIndexDocuments}
              disabled={ragLoading || !ragFiles.length}
              className="btn-primary w-full"
            >
              {ragLoading ? 'Indexing…' : 'Index documents'}
            </button>
            <p className="text-[10px] text-gray-600 mt-2">
              Indexed chunks:{' '}
              <span className="text-gray-400">{health?.chunk_count ?? stats?.index?.chunks ?? 0}</span>
            </p>
          </div>
        </div>
      </div>

      {ragResult && (
        <div className="space-y-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Chunks Created" value={ragResult.chunk_count} accent="emerald" icon={Database} />
            <StatCard label="Embedding Dim" value={ragResult.embedding_dim} accent="blue" icon={Zap} />
            <StatCard label="Embed Time" value={`${ragResult.embed_time_s}s`} accent="green" icon={Zap} />
          </div>
          <div className="card p-5">
            <p className="section-title mb-3">Chunk previews</p>
            <div className="space-y-3">
              {ragResult.preview?.map((p, i) => (
                <div key={i} className="bg-[#0f0f0f] rounded-lg p-3 border border-[#222]">
                  <div className="flex gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold text-emerald-400">Chunk {p.chunk_id + 1}</span>
                    <span className="text-[10px] text-gray-500">{p.source}</span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed font-mono">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Fine-tune controls */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div>
              <p className="label">Training CSV</p>
              <DropZone
                onFiles={onTrainCsv}
                accept=".csv"
                multiple={false}
                label={trainCsv ? trainCsv.name : 'Drop CSV here'}
                sublabel="Columns: query, positive_passage"
              />
            </div>
            <div>
              <label className="label">Epochs: {epochs}</label>
              <input type="range" min={1} max={10} step={1} value={epochs}
                onChange={e => setEpochs(+e.target.value)}
                className="w-full accent-emerald-500" />
              <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                <span>1 (fast)</span><span>10 (slow)</span>
              </div>
            </div>
            <button
              onClick={handleTrain}
              disabled={state.running || !trainCsv}
              className="btn-primary w-full"
            >
              {state.running ? '⏳ Training…' : '🚀 Start fine-tuning'}
            </button>
          </div>

          <div className="card p-4 space-y-2">
            <p className="section-title">How fine-tuning works</p>
            {[
              'Uses MultipleNegativesRankingLoss',
              'Trains on (query, passage) pairs',
              'Live loss streamed via SSE',
              'Model saved to models/fine_tuned/',
              'Auto-loaded for future retrievals',
            ].map(t => (
              <div key={t} className="flex items-start gap-2 text-xs text-gray-500">
                <span className="text-emerald-400 shrink-0">▸</span>{t}
              </div>
            ))}
          </div>
        </div>

        {/* Loss chart */}
        <div className="md:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="section-title mb-0">Live training loss</p>
            {state.running && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-400">Live</span>
              </div>
            )}
          </div>

          {lossData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={lossData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                <XAxis dataKey="step" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={[Math.max(0, minLoss - 0.05), maxLoss + 0.05]}
                  tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                  tickFormatter={v => v.toFixed(3)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone" dataKey="loss"
                  stroke="#f97316" strokeWidth={2}
                  dot={false} activeDot={{ r: 4, fill: '#f97316' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex flex-col items-center justify-center text-center">
              <Brain size={32} className="text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Loss curve appears here during training</p>
              <p className="text-xs text-gray-700 mt-1">Upload a CSV and click Start fine-tuning</p>
            </div>
          )}

          {(state.running || state.done) && (
            <div className="mt-4 space-y-2">
              <ProgressBar value={state.progress} label={state.message} />
            </div>
          )}

          {lossData.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-[#0f0f0f] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-600 mb-1">Steps</p>
                <p className="text-lg font-bold text-emerald-400">{lossData.length}</p>
              </div>
              <div className="bg-[#0f0f0f] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-600 mb-1">Min loss</p>
                <p className="text-lg font-bold text-green-400">{minLoss.toFixed(4)}</p>
              </div>
              <div className="bg-[#0f0f0f] rounded-lg p-3 text-center">
                <p className="text-[10px] text-gray-600 mb-1">Latest</p>
                <p className="text-lg font-bold text-blue-400">
                  {state.losses.at(-1)?.toFixed(4) ?? '—'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {state.done && state.result_message && (
        <div className={`card p-5 border-l-2 ${state.success ? 'border-l-green-500' : 'border-l-red-500'}`}>
          <p className="text-sm text-gray-300 whitespace-pre-line">{state.result_message}</p>
        </div>
      )}
    </div>
  )
}
