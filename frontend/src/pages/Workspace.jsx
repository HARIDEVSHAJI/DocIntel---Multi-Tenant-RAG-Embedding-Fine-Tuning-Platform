import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { startTraining, uploadDocs, getConfig, getHealth, getStats, runEvaluation, autoGenerateTraining, startTrainingAuto, runAutoEvaluation, getWorkspaces, createWorkspace, downloadSampleTraining, downloadSampleEval } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { PageHeader, DropZone, ProgressBar, StatCard, Spinner } from '../components/ui'
import { Brain, FileText, Database, Zap, BarChart2, Info, X, ChevronDown, ChevronUp, FolderOpen, Plus, Check, Settings2, Lock, ShieldAlert, Download } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const LossTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (<div className="bg-[#1a1a1a] border border-[#1a1a1a] rounded-lg px-3 py-2 text-xs"><p className="text-gray-400">Step {payload[0].payload.step}</p><p className="text-emerald-400 font-semibold">Loss: {payload[0].value?.toFixed(5)}</p></div>)
}

const METRIC_COLORS = { faithfulness: '#f97316', answer_relevancy: '#22c55e', context_precision: '#3b82f6', answer_similarity: '#a855f7' }
const METRIC_LABELS = { faithfulness: 'Faithfulness', answer_relevancy: 'Answer Relevancy', context_precision: 'Context Precision', answer_similarity: 'Answer Similarity' }

function ScoreCell({ value }) {
  const pct = Math.round((value || 0) * 100)
  const color = pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400'
  return <span className={clsx('font-mono font-semibold text-xs', color)}>{pct}%</span>
}

function InfoPopover({ title, content }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => { if (!open) return; const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [open])
  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="text-gray-500 hover:text-emerald-400 transition-colors p-1 rounded-full hover:bg-emerald-400/10" title="More info" type="button"><Info size={14} /></button>
      {open && (
        <div className="absolute bottom-8 left-0 z-50 bg-[#000000] border border-[#1a1a1a] rounded-xl p-4 w-[280px] sm:w-[340px] shadow-2xl text-xs space-y-3 animate-in fade-in">
          <div className="flex justify-between items-center mb-1 border-b border-[#1a1a1a] pb-2"><span className="font-semibold text-emerald-400">{title}</span><button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white p-1"><X size={12}/></button></div>
          <div className="text-gray-300 space-y-2 leading-relaxed">{content}</div>
        </div>
      )}
    </div>
  )
}

const indexingInfo = (<><p><strong>What to upload:</strong> Any PDF or TXT documents.</p><p><strong>Why:</strong> These form the "brain" of the RAG system.</p><p><strong>Format:</strong> <code>.pdf</code> or <code>.txt</code></p></>)

const trainingInfoNew = (<>
  <p><strong>Training CSV Format</strong></p>
  <p>Question-answer pairs used to teach the embedding model which chunks are relevant to which questions.</p>
  <p><strong>Why:</strong> Improves retrieval accuracy for your specific domain.</p>
  <p><strong>Format:</strong> <code>.csv</code> with columns: <code>query</code> and <code>positive_passage</code></p>
  <p><strong>Easiest way:</strong> Use "Auto-generate from documents" button above.</p>
  <p><strong>Manual creation:</strong> Write 20-50 question/answer pairs about your documents.</p>
</>)

const SUB_TABS = [
  { key: 'index', label: '📄 Index Documents' },
  { key: 'train', label: '🧠 Fine-Tune Model' },
  { key: 'eval',  label: '📊 Evaluate Pipeline' },
]

export default function Workspace({ onIndexChange }) {
  const { activeWorkspaceId, switchWorkspace } = useAuth()
  const [workspaces, setWorkspaces] = useState([])
  const [newWsName, setNewWsName] = useState('')
  const [creatingWs, setCreatingWs] = useState(false)

  const [activeTab, setActiveTab] = useState('index')
  const [ragFiles, setRagFiles] = useState([])
  const [ragLoading, setRagLoading] = useState(false)
  const [ragResult, setRagResult] = useState(null)
  const [health, setHealth] = useState(null)
  const [stats, setStats] = useState(null)

  // Fine-tuning
  const [trainCsv, setTrainCsv] = useState(null)
  const [epochs, setEpochs] = useState(3)
  const [trainState, setTrainState] = useState({ running: false, progress: 0, message: 'Idle', losses: [], done: false, success: null, result_message: '' })
  const esRef = useRef(null)
  const [autoGenLoading, setAutoGenLoading] = useState(false)
  const [autoGenResult, setAutoGenResult] = useState(null)
  const [showManualTrain, setShowManualTrain] = useState(false)
  const [trainMode, setTrainMode] = useState('auto')

  // Evaluation
  const [evalFile, setEvalFile] = useState(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [evalResult, setEvalResult] = useState(null)
  const [autoEvalLoading, setAutoEvalLoading] = useState(false)
  const [showManualEval, setShowManualEval] = useState(false)
  const [evalMode, setEvalMode] = useState('auto')

  // Load workspaces
  useEffect(() => {
    getWorkspaces().then(setWorkspaces).catch(() => {})
  }, [activeWorkspaceId])

  const handleCreateWs = async () => {
    const name = newWsName.trim()
    if (!name) return
    setCreatingWs(true)
    try {
      const ws = await createWorkspace(name)
      setWorkspaces(prev => [...prev, ws])
      switchWorkspace(ws.id)
      setNewWsName('')
      toast.success(`Workspace "${ws.name}" created`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create workspace')
    } finally {
      setCreatingWs(false)
    }
  }

  const refreshStatus = () => { getHealth().then(setHealth).catch(() => setHealth(null)); getStats().then(setStats).catch(() => setStats(null)) }
  useEffect(() => { refreshStatus() }, [activeWorkspaceId])
  useEffect(() => () => esRef.current?.close(), [])

  const onRagFiles = (f) => { setRagFiles(f); setRagResult(null) }
  const handleIndexDocuments = async () => {
    if (!ragFiles.length) return toast.error('Select at least one PDF or TXT file.')
    setRagLoading(true)
    try {
      const cfg = await getConfig()
      const data = await uploadDocs(ragFiles, cfg.chunk_size, cfg.overlap)
      setRagResult(data)
      toast.success(`Indexed ${data.chunk_count} chunks from ${Object.keys(data.sources).length} file(s)!`)
      refreshStatus()
      onIndexChange?.()
    } catch (err) { toast.error(err.response?.data?.detail || err.message) }
    finally { setRagLoading(false) }
  }

  // Auto-generate training pairs
  const handleAutoGenerate = async () => {
    setAutoGenLoading(true)
    try {
      const data = await autoGenerateTraining()
      setAutoGenResult(data)
      toast.success(`Auto-generated ${data.count} training pairs!`)
    } catch (err) { toast.error(err.response?.data?.detail || err.message) }
    finally { setAutoGenLoading(false) }
  }

  // Training
  const startStream = () => {
    if (esRef.current) esRef.current.close()
    const base = import.meta.env.VITE_API_URL || ''
    const token = localStorage.getItem('docintel_token') || ''
    const wsId = localStorage.getItem('docintel_active_workspace') || ''
    const es = new EventSource(`${base}/api/train/stream?token=${encodeURIComponent(token)}&workspace_id=${wsId}`)
    esRef.current = es
    es.onmessage = (e) => { try { const data = JSON.parse(e.data); setTrainState(data); if (data.done) { es.close(); if (data.success) toast.success('Fine-tuning complete!'); else toast.error('Training failed.') } } catch {} }
    es.onerror = () => es.close()
  }

  const handleTrain = async () => {
    if (!trainCsv) return toast.error('Upload a training CSV first.')
    try { await startTraining(trainCsv, epochs); startStream() } catch (err) { toast.error(err.response?.data?.detail || err.message) }
  }

  const handleTrainAuto = async () => {
    try { await startTrainingAuto(epochs); startStream() } catch (err) { toast.error(err.response?.data?.detail || err.message) }
  }

  const lossData = trainState.losses.map((l, i) => ({ step: i + 1, loss: l }))
  const minLoss = lossData.length ? Math.min(...trainState.losses) : 0
  const maxLoss = lossData.length ? Math.max(...trainState.losses) : 1

  // Evaluation
  const handleAutoEval = async () => {
    setAutoEvalLoading(true)
    try {
      const data = await runAutoEvaluation()
      setEvalResult(data)
      toast.success(`Evaluated ${data.total} questions!`)
    } catch (err) { toast.error(err.response?.data?.detail || err.message) }
    finally { setAutoEvalLoading(false) }
  }

  const handleEval = async () => {
    if (!evalFile) return toast.error('Upload an evaluation CSV first.')
    setEvalLoading(true)
    try { const data = await runEvaluation(evalFile); setEvalResult(data); toast.success(`Evaluated ${data.total} questions!`) }
    catch (err) { toast.error(err.response?.data?.detail || err.message) }
    finally { setEvalLoading(false) }
  }

  const radarData = evalResult?.aggregated ? Object.entries(evalResult.aggregated).map(([key, val]) => ({ metric: METRIC_LABELS[key] || key, value: Math.round(val * 100), fullMark: 100 })) : []

  const [showCreateInput, setShowCreateInput] = useState(false)

  // ... rest of the existing logic preserved below via the unchanged lines

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 pb-24">
      <div className="h-24 shrink-0" />
      <PageHeader title="Workspace" subtitle="Manage workspaces, index documents, fine-tune embeddings, and evaluate your RAG pipeline" />

      {/* ═══ Workspace Selection Card ═══ */}
      <div className="card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-emerald-400" />
            <span className="text-sm font-semibold text-gray-200">Workspace Selection</span>
          </div>
          <p className="text-xs text-gray-500 mb-4 mt-1">Choose a workspace to get started</p>
          
          <div className="flex flex-wrap items-center gap-3">
            {!showCreateInput ? (
              <>
                <div className="relative w-64">
                  <select
                    className="w-full appearance-none bg-[#000000] border border-[#1a1a1a] rounded-xl pl-4 pr-10 py-2.5 text-xs text-gray-300 focus:outline-none focus:border-emerald-500/50 cursor-pointer transition-colors hover:border-gray-700"
                    value={activeWorkspaceId || ''}
                    onChange={(e) => switchWorkspace(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Select a workspace...</option>
                    {workspaces.map(ws => (
                      <option key={ws.id} value={ws.id}>{ws.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
                
                <button
                  onClick={() => setShowCreateInput(true)}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium bg-[#0a0a0a] text-emerald-400/90 border border-emerald-500/20 hover:bg-emerald-500/10 hover:text-emerald-400 transition-all flex items-center gap-1.5"
                >
                  <Plus size={14} /> Create Workspace
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 w-full max-w-md animate-fadeIn">
                <input
                  type="text"
                  autoFocus
                  value={newWsName}
                  onChange={e => setNewWsName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateWs()}
                  placeholder="New workspace name..."
                  className="flex-1 bg-[#000000] border border-[#1a1a1a] rounded-xl px-4 py-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50"
                />
                <button
                  onClick={() => { handleCreateWs(); setShowCreateInput(false); }}
                  disabled={!newWsName.trim() || creatingWs}
                  className="btn-primary px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                >
                  <Plus size={14} /> Create
                </button>
                <button
                  onClick={() => setShowCreateInput(false)}
                  className="px-3 py-2.5 rounded-xl text-xs text-gray-500 hover:text-white transition-colors shrink-0"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right side status illustration */}
        <div className="hidden md:flex items-center gap-4 text-right opacity-80">
          {activeWorkspaceId ? (
             <div className="flex items-center justify-end gap-4 w-64">
               <div>
                 <p className="text-sm font-semibold text-emerald-400">Workspace Active</p>
                 <p className="text-xs text-gray-500 mt-1">Ready to manage documents and run tasks.</p>
               </div>
               <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20 shrink-0">
                 <Check size={20} className="text-emerald-400" />
               </div>
             </div>
          ) : (
            <div className="flex items-center justify-end gap-4 w-64">
              <div className="w-12 h-12 bg-[#0a0a0a] rounded-xl flex items-center justify-center border border-[#1a1a1a] shrink-0 order-2">
                <FolderOpen size={20} className="text-gray-600" />
              </div>
              <div className="order-1 text-right">
                <p className="text-sm font-semibold text-gray-300">No workspace selected</p>
                <p className="text-xs text-gray-500 mt-1">Select or create a workspace to<br/>enable all actions and features.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Workspace Actions Section ═══ */}
      <div className="card p-6">
        {/* Actions Header */}
        <div className="flex items-start md:items-center justify-between mb-6 pb-6 border-b border-[#1a1a1a]">
          <div>
            <div className="flex items-center gap-2">
              <Settings2 size={16} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-200">Workspace Actions</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">All actions below will be enabled after selecting a workspace</p>
          </div>
          
          {!activeWorkspaceId && (
            <div className="flex items-center gap-2 text-gray-500 text-xs bg-[#0a0a0a] px-3 py-1.5 rounded-lg border border-[#1a1a1a]">
              <Lock size={12} />
              <span>Select a workspace to enable</span>
            </div>
          )}
        </div>

        {/* The rest of the UI uses a disabled state wrapper if no workspace is active */}
        <div className={clsx("transition-all duration-300", !activeWorkspaceId && "opacity-40 pointer-events-none grayscale")}>
          {/* Sub-tabs */}
          <div className="flex gap-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-1 mb-6">
            {SUB_TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={clsx('flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2',
                  activeTab === t.key ? 'bg-[#141414] text-gray-200 border border-[#2a2a2a] shadow-sm' : 'text-gray-500 hover:text-gray-300 hover:bg-[#141414] border border-transparent')}>
                {t.key === 'index' && <FileText size={14} className={activeTab === t.key ? 'text-emerald-400' : 'text-gray-500'} />}
                {t.key === 'train' && <Settings2 size={14} className={activeTab === t.key ? 'text-purple-400' : 'text-gray-500'} />}
                {t.key === 'evaluate' && <Check size={14} className={activeTab === t.key ? 'text-blue-400' : 'text-gray-500'} />}
                {t.label}
              </button>
            ))}
          </div>

      {/* ═══ TAB: Index Documents ═══ */}
      {activeTab === 'index' && (
        <section className="space-y-4 animate-fadeIn">
          {ragResult && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-green-400">
              <span>✅</span><span>Successfully indexed <strong>{ragResult.chunk_count}</strong> chunks from <strong>{Object.keys(ragResult.sources).length}</strong> file(s) — Last indexed: {new Date().toLocaleTimeString()}</span>
            </div>
          )}
          <div className="card p-6 space-y-4">
            <p className="text-xs text-gray-600">Chunk size and overlap from <Link to="/config" className="text-emerald-400 hover:underline">Config</Link>.</p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center gap-2 mb-1"><p className="label mb-0">Source Documents</p><InfoPopover title="Document Indexing" content={indexingInfo} /></div>
                <DropZone onFiles={onRagFiles} accept=".pdf,.txt" label="Drop PDFs or TXT files here" sublabel="Multiple files supported" />
                {ragFiles.length > 0 && (
                  <div className="bg-[#000000] rounded-lg p-3 border border-[#141414] space-y-1.5">
                    {ragFiles.map((f, i) => (<div key={i} className="flex items-center gap-2 text-xs text-gray-400"><FileText size={12} className="text-emerald-400 shrink-0" /><span className="truncate">{f.name}</span><span className="text-gray-600 shrink-0">{(f.size/1024).toFixed(0)} KB</span></div>))}
                  </div>
                )}
              </div>
              <div className="flex flex-col justify-end">
                <button type="button" onClick={handleIndexDocuments} disabled={ragLoading || !ragFiles.length} className="btn-primary w-full">{ragLoading ? 'Indexing…' : 'Index documents'}</button>
                <p className="text-[10px] text-gray-600 mt-2">Indexed chunks: <span className="text-gray-400">{health?.chunk_count ?? stats?.index?.chunks ?? 0}</span></p>
              </div>
            </div>
          </div>
          {ragResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard label="Chunks Created" value={ragResult.chunk_count} accent="emerald" icon={Database} />
                <StatCard label="Embedding Dim" value={ragResult.embedding_dim} accent="blue" icon={Zap} />
                <StatCard label="Embed Time" value={`${ragResult.embed_time_s}s`} accent="green" icon={Zap} />
              </div>
              <div className="card p-5">
                <p className="section-title mb-3">Chunk previews</p>
                <div className="space-y-3">
                  {ragResult.preview?.map((p, i) => (<div key={i} className="bg-[#000000] rounded-lg p-3 border border-[#141414]"><div className="flex gap-2 mb-1.5"><span className="text-[10px] font-semibold text-emerald-400">Chunk {p.chunk_id + 1}</span><span className="text-[10px] text-gray-500">{p.source}</span></div><p className="text-xs text-gray-400 leading-relaxed font-mono">{p.text}</p></div>))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══ TAB: Fine-Tune Model ═══ */}
      {activeTab === 'train' && (
        <section className="space-y-4 animate-fadeIn">
          <p className="text-xs text-gray-500">Fine-tuning is optional. The base model works well for most documents.</p>

          {/* Segmented training mode control */}
          <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-xl border border-[#1e1e1e] max-w-max">
            <button
              onClick={() => setTrainMode('auto')}
              className={clsx(
                'px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5',
                trainMode === 'auto'
                  ? 'bg-emerald-500 text-white shadow-sm font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a]'
              )}
            >
              ⚡ Auto-Generate Pairs
            </button>
            <button
              onClick={() => setTrainMode('manual')}
              className={clsx(
                'px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5',
                trainMode === 'manual'
                  ? 'bg-emerald-500 text-white shadow-sm font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a]'
              )}
            >
              📁 Manual CSV Upload
            </button>
          </div>

          {/* Auto-generate section */}
          {trainMode === 'auto' && (
            <>
              {!health?.index_loaded && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-400">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-gray-200">No documents indexed in this workspace</p>
                    <p className="text-gray-500 mt-1">Please upload and index some PDF or TXT documents under the <strong>Index Documents</strong> tab above first to auto-generate training pairs.</p>
                  </div>
                </div>
              )}

              <div className="card p-5 space-y-4">
                <h3 className="text-sm font-medium text-white">Auto-generate training pairs from your documents</h3>
                <p className="text-xs text-gray-500">We'll sample chunks from your indexed documents and use the LLM to create question-answer pairs automatically.</p>
                {health?.index_loaded && (
                  <div className="text-[10px] text-emerald-400/80 bg-emerald-500/5 px-3 py-2 rounded-lg border border-emerald-500/10 flex items-center gap-1.5 max-w-max">
                    <span>💡</span><span><strong>No chat history required:</strong> Pairs will be generated directly from your indexed document chunks.</span>
                  </div>
                )}
                <button onClick={handleAutoGenerate} disabled={autoGenLoading || !(health?.index_loaded)} className="btn-primary disabled:opacity-30">
                  {autoGenLoading ? <><Spinner size={14} /> Generating…</> : '⚡ Auto-generate training pairs from my documents'}
                </button>
                {autoGenResult && (
                  <div className="space-y-3">
                    <p className="text-sm text-green-400">✅ Auto-generated {autoGenResult.count} training pairs from your documents. Review below then click Start Fine-Tuning.</p>
                    <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-[#1a1a1a]"><th className="text-left px-3 py-2 text-gray-500">Query</th><th className="text-left px-3 py-2 text-gray-500">Positive Passage</th></tr></thead><tbody>
                      {autoGenResult.preview?.map((p, i) => (<tr key={i} className="border-b border-[#1a1a1a]"><td className="px-3 py-2 text-gray-300">{p.query}</td><td className="px-3 py-2 text-gray-400">{p.positive_passage}</td></tr>))}
                    </tbody></table></div>
                    <div className="flex items-center gap-3">
                      <div><label className="label">Epochs: {epochs}</label><input type="range" min={1} max={10} step={1} value={epochs} onChange={e => setEpochs(+e.target.value)} className="w-40 accent-emerald-500" /></div>
                      <button onClick={handleTrainAuto} disabled={trainState.running} className="btn-primary">🚀 Start Fine-Tuning</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Manual CSV section */}
          {trainMode === 'manual' && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-white flex items-center gap-2">
                    Upload your own training pairs
                    <InfoPopover title="Fine-Tuning" content={trainingInfoNew} />
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Upload a custom CSV containing training pairs to run manual fine-tuning.</p>
                </div>
                <button onClick={downloadSampleTraining} className="px-3 py-2 rounded-lg text-[11px] font-medium text-gray-400 border border-[#1a1a1a] hover:border-emerald-500/30 hover:text-emerald-400 transition-all flex items-center gap-1.5 shrink-0" type="button">
                  <Download size={13} /> Download Sample CSV
                </button>
              </div>
              
              <div className="border-t border-[#1a1a1a] pt-4 space-y-4">
                <DropZone onFiles={(f) => setTrainCsv(f[0])} accept=".csv" multiple={false} label={trainCsv ? trainCsv.name : 'Drop CSV here'} sublabel="Columns: query, positive_passage" />
                <div>
                  <label className="label">Epochs: {epochs}</label>
                  <input type="range" min={1} max={10} step={1} value={epochs} onChange={e => setEpochs(+e.target.value)} className="w-full accent-emerald-500" />
                  <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                    <span>1 (fast)</span>
                    <span>10 (slow)</span>
                  </div>
                </div>
                <button onClick={handleTrain} disabled={trainState.running || !trainCsv} className="btn-primary w-full">
                  {trainState.running ? '⏳ Training…' : '🚀 Start Fine-Tuning'}
                </button>
              </div>
            </div>
          )}

          {/* Loss chart */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="section-title mb-0">Live training loss</p>
              {trainState.running && (<div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /><span className="text-xs text-emerald-400">Live</span></div>)}
            </div>
            {lossData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={lossData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#141414" />
                  <XAxis dataKey="step" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[Math.max(0, minLoss - 0.05), maxLoss + 0.05]} tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={v => v.toFixed(3)} />
                  <Tooltip content={<LossTooltip />} />
                  <Line type="monotone" dataKey="loss" stroke="#f97316" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#f97316' }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-60 flex flex-col items-center justify-center text-center"><Brain size={32} className="text-gray-700 mb-3" /><p className="text-sm text-gray-500">Loss curve appears here during training</p></div>
            )}
            {(trainState.running || trainState.done) && <div className="mt-4"><ProgressBar value={trainState.progress} label={trainState.message} /></div>}
            {trainState.done && trainState.result_message && (
              <div className={`card p-4 mt-4 border-l-2 ${trainState.success ? 'border-l-green-500' : 'border-l-red-500'}`}><p className="text-sm text-gray-300 whitespace-pre-line">{trainState.result_message}</p></div>
            )}
          </div>
        </section>
      )}

      {/* ═══ TAB: Evaluate Pipeline ═══ */}
      {activeTab === 'eval' && (
        <section className="space-y-4 animate-fadeIn">
          <p className="text-xs text-gray-500">Evaluate your RAG pipeline's retrieval and generation quality.</p>

          {/* Segmented evaluation mode control */}
          <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-xl border border-[#1e1e1e] max-w-max">
            <button
              onClick={() => setEvalMode('auto')}
              className={clsx(
                'px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5',
                evalMode === 'auto'
                  ? 'bg-emerald-500 text-white shadow-sm font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a]'
              )}
            >
              ⚡ Automated Evaluation
            </button>
            <button
              onClick={() => setEvalMode('manual')}
              className={clsx(
                'px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5',
                evalMode === 'manual'
                  ? 'bg-emerald-500 text-white shadow-sm font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a]'
              )}
            >
              📁 Custom CSV Evaluation
            </button>
          </div>

          {/* Auto evaluation section */}
          {evalMode === 'auto' && (
            <>
              {!health?.index_loaded && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-400">
                  <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-gray-200">No documents indexed in this workspace</p>
                    <p className="text-gray-500 mt-1">Please upload and index some PDF or TXT documents under the <strong>Index Documents</strong> tab above first to run automated evaluations.</p>
                  </div>
                </div>
              )}

              <div className="card p-5 space-y-4">
                <h3 className="text-sm font-medium text-white">Run Automated Evaluation</h3>
                <p className="text-xs text-gray-500">Automatically generates test questions from your indexed documents, runs the full RAG pipeline, and computes all 4 metrics.</p>
                {health?.index_loaded && (
                  <div className="text-[10px] text-emerald-400/80 bg-emerald-500/5 px-3 py-2 rounded-lg border border-emerald-500/10 flex items-center gap-1.5 max-w-max">
                    <span>💡</span><span><strong>No chat history required:</strong> Questions are auto-generated directly from your indexed documents to test the pipeline.</span>
                  </div>
                )}
                <button onClick={handleAutoEval} disabled={autoEvalLoading || !(health?.index_loaded)} className="btn-primary flex items-center gap-2 disabled:opacity-30">
                  {autoEvalLoading ? <><Spinner size={14} /> Evaluating…</> : '▶ Run Automated Evaluation'}
                </button>
              </div>
            </>
          )}

          {/* Manual CSV evaluation section */}
          {evalMode === 'manual' && (
            <div className="card p-5 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-white">Evaluate with custom test questions</h3>
                <p className="text-xs text-gray-500 mt-1">Upload a CSV containing your custom test questions to evaluate the RAG pipeline.</p>
              </div>
              <button onClick={downloadSampleEval} className="px-3 py-2 rounded-lg text-[11px] font-medium text-gray-400 border border-[#1a1a1a] hover:border-emerald-500/30 hover:text-emerald-400 transition-all flex items-center gap-1.5 shrink-0" type="button">
                <Download size={13} /> Download Sample CSV
              </button>
              <div className="border-t border-[#1a1a1a] pt-4 space-y-4">
                <DropZone onFiles={(f) => { setEvalFile(f[0]); setEvalResult(null) }} accept=".csv" multiple={false} label={evalFile ? evalFile.name : 'Drop CSV here'} sublabel="Columns: question, ground_truth" />
                <button onClick={handleEval} disabled={evalLoading || !evalFile} className="btn-primary w-full flex items-center justify-center gap-2">
                  {evalLoading ? <><Spinner size={14} />Evaluating…</> : '▶ Run Evaluation'}
                </button>
              </div>
            </div>
          )}

          {/* Results */}
          {evalResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card p-5">
                  <p className="section-title">RAG Metrics Radar</p>
                  {radarData.length > 0 && (
                    <ResponsiveContainer width="100%" height={280}>
                      <RadarChart data={radarData}><PolarGrid stroke="#1a1a1a" /><PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#9ca3af' }} /><PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: '#6b7280' }} tickCount={5} /><Radar dataKey="value" stroke="#f97316" fill="#f97316" fillOpacity={0.15} strokeWidth={2} /><Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #1a1a1a', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v}%`, 'Score']} /></RadarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="card p-5 space-y-3">
                  <p className="section-title">Metric Scores</p>
                  {Object.entries(evalResult.aggregated).map(([key, val]) => (
                    <div key={key} className="bg-[#000000] rounded-lg p-3 flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: METRIC_COLORS[key] }} />
                      <div className="flex-1 min-w-0"><p className="text-[10px] text-gray-500 truncate">{METRIC_LABELS[key]}</p></div>
                      <p className="text-sm font-bold font-mono" style={{ color: METRIC_COLORS[key] }}>{(val * 100).toFixed(1)}%</p>
                    </div>
                  ))}
                </div>
              </div>

              {evalResult.per_sample?.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#1a1a1a]"><p className="section-title mb-0">Per-Question Results ({evalResult.total} questions)</p></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs"><thead><tr className="border-b border-[#141414]">
                      {['#','Question','Generated Answer','Faith.','Relevancy','Precision','Similarity'].map(h => (<th key={h} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>))}
                    </tr></thead><tbody>
                      {evalResult.per_sample.map((row, i) => (
                        <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                          <td className="px-4 py-3 text-gray-600">{i+1}</td>
                          <td className="px-4 py-3 text-gray-300 max-w-[200px]"><p className="truncate" title={row.question}>{row.question}</p></td>
                          <td className="px-4 py-3 text-gray-400 max-w-[220px]"><p className="truncate" title={row.generated_answer}>{row.generated_answer}</p></td>
                          <td className="px-4 py-3"><ScoreCell value={row.faithfulness} /></td>
                          <td className="px-4 py-3"><ScoreCell value={row.answer_relevancy} /></td>
                          <td className="px-4 py-3"><ScoreCell value={row.context_precision} /></td>
                          <td className="px-4 py-3"><ScoreCell value={row.answer_similarity} /></td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      </div>
    </div>
    
    {!activeWorkspaceId && (
      <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 flex items-start gap-3 mt-4">
        <Info size={18} className="text-gray-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-gray-200">Select or create a workspace to activate all features</p>
          <p className="text-xs text-gray-500 mt-1">Once you select a workspace, you'll be able to index documents, fine-tune models, and evaluate your pipeline.</p>
        </div>
      </div>
    )}
  </div>
  )
}
