import { useState, useEffect } from 'react'
import { getStats, updateConfig, deleteModel, resetWorkspace, validateKey, getWorkspaces, deleteWorkspaceById, getKeyStatus, saveManualKey, clearManualKey, toggleKeyMode, testKeyConnection } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, Spinner } from '../components/ui'
import { Settings, Trash2, RefreshCw, RotateCcw, AlertTriangle, Zap, Clock, FolderX, AlertCircle, Key, Eye, EyeOff, Lock, CheckCircle2, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'

const LLM_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
]

export default function Config({ keyStatus, onRecheckGroqKey }) {
  const { activeWorkspaceId, switchWorkspace } = useAuth()
  const [stats, setStats] = useState(null)
  const [cfg, setCfg] = useState({
    chunk_size: 500, overlap: 50, top_k: 5,
    temperature: 0.1, llm_model: 'llama-3.1-8b-instant',
  })
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Workspace deletion
  const [workspaces, setWorkspaces] = useState([])
  const [wsToDelete, setWsToDelete] = useState('')
  const [deletingWs, setDeletingWs] = useState(false)

  // API Key Management State
  const [customKeyStatus, setCustomKeyStatus] = useState({
    env_key_set: false,
    has_custom_key: false,
    use_custom_key: false,
    masked_key: ""
  })
  const [manualKeyInput, setManualKeyInput] = useState('')
  const [showManualKey, setShowManualKey] = useState(false)
  const [testingEnv, setTestingEnv] = useState(false)
  const [testingManual, setTestingManual] = useState(false)
  const [savingKey, setSavingKey] = useState(false)

  const loadStats = () =>
    getStats().then(d => {
      setStats(d)
      if (d.config) setCfg(d.config)
    }).catch(() => toast.error('Could not load stats'))

  const loadKeyStatus = () => {
    if (activeWorkspaceId) {
      getKeyStatus().then(setCustomKeyStatus).catch(err => console.error("Failed to load key status", err))
    }
  }

  useEffect(() => { loadStats() }, [])
  useEffect(() => { getWorkspaces().then(setWorkspaces).catch(() => {}) }, [])
  useEffect(() => { loadKeyStatus() }, [activeWorkspaceId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateConfig(cfg)
      toast.success('Config saved!')
      loadStats()
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteModel = async () => {
    if (!confirm('Delete the fine-tuned model? You will revert to the base model. Indexed documents and chat history are preserved.')) return
    try {
      const res = await deleteModel()
      toast.success(res.message)
      loadStats()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleResetWorkspace = async () => {
    const ok = window.confirm(
      'Reset everything from this workspace?\n\n' +
        '• All indexed documents and the vector search index will be deleted\n' +
        '• Any fine-tuned embedding model will be removed (back to base model)\n' +
        '• All chat sessions will be cleared\n' +
        '• Training progress in the UI will be cleared\n\n' +
        'This cannot be undone.'
    )
    if (!ok) return
    setResetting(true)
    try {
      const res = await resetWorkspace()
      // Clear localStorage chat sessions
      localStorage.removeItem('rag_chat_sessions')
      localStorage.removeItem('rag_active_session')
      toast.success(res.message || 'Workspace reset.')
      loadStats()
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  const handleToggleKeyMode = async (use_custom) => {
    try {
      await toggleKeyMode(use_custom)
      toast.success(use_custom ? "Switched to Manual Key" : "Switched to Environment Key")
      loadKeyStatus()
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to toggle key mode")
    }
  }

  const handleTestConnection = async (isManual) => {
    const setTesting = isManual ? setTestingManual : setTestingEnv
    setTesting(true)
    try {
      const keyToTest = isManual ? (manualKeyInput || customKeyStatus.masked_key) : null
      if (isManual && !keyToTest) {
         toast.error("Please enter a manual key first")
         return
      }
      const res = await testKeyConnection(isManual ? manualKeyInput : null, !isManual)
      if (res.success) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleSaveManualKey = async () => {
    if (!manualKeyInput || manualKeyInput.length < 20) {
      toast.error("Please enter a valid API key")
      return
    }
    setSavingKey(true)
    try {
      await saveManualKey(manualKeyInput)
      toast.success("Manual API key saved and activated securely!")
      setManualKeyInput("")
      loadKeyStatus()
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save manual key")
    } finally {
      setSavingKey(false)
    }
  }

  const handleClearManualKey = async () => {
    if (!confirm("Are you sure you want to delete your custom API key? This will revert your workspace to the environment default key.")) return
    try {
      await clearManualKey()
      toast.success("Custom API key removed")
      setManualKeyInput("")
      loadKeyStatus()
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to clear key")
    }
  }

  const indexedChunks = stats?.index?.chunks ?? 0
  const hasFineTuned = stats?.fine_tuned_model === true

  const Field = ({ label, info, children }) => (
    <div>
      <label className="label">{label}</label>
      {children}
      {info && <p className="text-[11px] text-gray-600 mt-1">{info}</p>}
    </div>
  )

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="h-24 shrink-0" />
      <PageHeader title="Config & System" subtitle="Adjust pipeline parameters and manage the workspace">
        <button onClick={loadStats} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
          <RefreshCw size={12} /> Refresh
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Chunks Indexed" value={stats?.index?.chunks ?? '—'}
          sub={`${stats?.index?.vectors ?? 0} vectors`} accent="emerald" />
        <StatCard label="Embedding Dim"  value={stats?.index?.dimension ?? '—'} accent="blue" />
        <StatCard label="Model"
          value={stats?.fine_tuned_model ? 'Custom' : 'Base'}
          sub={stats?.model_name} accent={stats?.fine_tuned_model ? 'green' : 'purple'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* LLM Config */}
        <div className="card p-6 space-y-5">
          <p className="section-title">LLM Settings</p>
          <Field label="Model" info="All models available on Groq free tier">
            <select
              value={cfg.llm_model}
              onChange={e => setCfg(c => ({ ...c, llm_model: e.target.value }))}
              className="input"
            >
              {LLM_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label={`Temperature: ${cfg.temperature}`} info="Lower = more deterministic answers">
            <input type="range" min={0} max={1} step={0.05} value={cfg.temperature}
              onChange={e => setCfg(c => ({ ...c, temperature: +e.target.value }))}
              className="w-full accent-emerald-500 mt-1" />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>0.0 (precise)</span><span>1.0 (creative)</span>
            </div>
          </Field>
          <Field label={`Top-K Retrieval: ${cfg.top_k}`} info="Number of chunks passed to the LLM">
            <input type="range" min={1} max={15} step={1} value={cfg.top_k}
              onChange={e => setCfg(c => ({ ...c, top_k: +e.target.value }))}
              className="w-full accent-emerald-500 mt-1" />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>1 (fast)</span><span>15 (comprehensive)</span>
            </div>
          </Field>
        </div>

        {/* Chunking Config */}
        <div className="card p-6 space-y-5">
          <p className="section-title">Chunking Settings</p>
          <Field label={`Chunk Size: ${cfg.chunk_size} chars`}
                 info="Larger = more context per chunk, fewer chunks total">
            <input type="range" min={100} max={1500} step={50} value={cfg.chunk_size}
              onChange={e => setCfg(c => ({ ...c, chunk_size: +e.target.value }))}
              className="w-full accent-emerald-500 mt-1" />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>100</span><span>1500</span>
            </div>
          </Field>
          <Field label={`Overlap: ${cfg.overlap} chars`}
                 info="Characters shared between adjacent chunks to preserve context at boundaries">
            <input type="range" min={0} max={300} step={10} value={cfg.overlap}
              onChange={e => setCfg(c => ({ ...c, overlap: +e.target.value }))}
              className="w-full accent-emerald-500 mt-1" />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>0</span><span>300</span>
            </div>
          </Field>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end mb-8">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 px-8">
          {saving ? <Spinner size={14} /> : <Settings size={14} />}
          {saving ? 'Saving…' : 'Save Config'}
        </button>
      </div>

      {/* ═══ API Key Management ══════════════════════════════════════════ */}
      <div className="card p-6 mb-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="section-title mb-1">TEST API CONNECTION</p>
            <p className="text-sm font-medium">
              Current mode: <span className={!customKeyStatus.use_custom_key ? "text-emerald-400" : "text-emerald-400"}>
                {!customKeyStatus.use_custom_key ? "Environment (Default)" : "Manual"}
              </span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {!customKeyStatus.use_custom_key ? "Using API key from environment variables." : "Using custom manual API key."}
            </p>
          </div>
          <button
            onClick={() => handleToggleKeyMode(!customKeyStatus.use_custom_key)}
            className="btn-secondary text-xs py-2 px-4 flex items-center gap-2"
          >
            <Key size={14} />
            {customKeyStatus.use_custom_key ? "Switch to Environment Key" : "Switch to Manual Key"}
          </button>
        </div>

        <div className="space-y-4">
          {!customKeyStatus.use_custom_key ? (
            <div className="bg-[#000000] border border-[#1a1a1a] rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-gray-300">Using Environment Key</p>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/20">Default</span>
                </div>
                <p className="text-xs text-gray-600 max-w-md">API key is loaded from your environment variables and is used by default.</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button onClick={() => handleTestConnection(false)} disabled={testingEnv} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
                  <Zap size={13} className={testingEnv ? 'animate-pulse text-emerald-400' : ''} />
                  {testingEnv ? 'Testing…' : 'Test Connection'}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#000000] border border-[#1a1a1a] rounded-xl p-4">
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-gray-300">Use Manual API Key</p>
                  <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/20">Active</span>
                </div>
                <p className="text-xs text-gray-600">Enter your own API key to override the environment key.</p>
              </div>
              
              <div className="flex flex-col md:flex-row gap-3 items-center">
                <div className="relative flex-1 w-full">
                  <input
                    type={showManualKey && !customKeyStatus.has_custom_key ? "text" : "password"}
                    value={customKeyStatus.has_custom_key ? customKeyStatus.masked_key : manualKeyInput}
                    onChange={e => setManualKeyInput(e.target.value)}
                    disabled={customKeyStatus.has_custom_key}
                    placeholder="gsk_..."
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg pl-4 pr-10 py-2.5 text-xs text-gray-300 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {!customKeyStatus.has_custom_key && (
                    <button
                      onClick={() => setShowManualKey(!showManualKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {showManualKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                </div>
                
                <div className="flex items-center gap-2 w-full md:w-auto">
                  {customKeyStatus.has_custom_key && (
                    <button onClick={handleClearManualKey} className="btn-secondary text-red-500 hover:text-red-400 hover:border-red-900/50 px-3 py-2 text-xs flex items-center justify-center gap-1.5 shrink-0" title="Remove custom key">
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button onClick={() => handleTestConnection(true)} disabled={testingManual || (!customKeyStatus.has_custom_key && !manualKeyInput)} className="flex-1 md:flex-none btn-secondary text-xs py-2 px-4 flex items-center justify-center gap-1.5 whitespace-nowrap">
                    <Zap size={13} className={testingManual ? 'animate-pulse text-emerald-400' : ''} />
                    Test Connection
                  </button>
                  {!customKeyStatus.has_custom_key && (
                    <button onClick={handleSaveManualKey} disabled={savingKey || !manualKeyInput} className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50">
                      <Lock size={13} />
                      {savingKey ? 'Saving...' : 'Save Key'}
                    </button>
                  )}
                </div>
              </div>
              
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-gray-600">
                <ShieldCheck size={12} className="text-emerald-500/70" />
                Your API key is encrypted and stored securely.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Danger Zone ═════════════════════════════════════════════════ */}
      <div className="card p-6 border border-red-900/30">
        <p className="section-title text-red-500/70 mb-4">Danger Zone</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Reset Workspace */}
          <div className="bg-[#000000] rounded-xl p-4 border border-[#2a2a2a]">
            <p className="text-sm font-medium text-gray-300 mb-1">Reset Workspace</p>
            <p className="text-xs text-gray-600 mb-2">
              Clears the FAISS index, deletes any fine-tuned model, and clears all chat history.
              Complete reset to start fresh.
            </p>
            <div className="flex flex-wrap gap-2 text-[10px] text-gray-500 mb-3">
              <span className="rounded-md bg-[#141414] px-2 py-1 border border-[#2a2a2a]">
                Indexed chunks: <span className="text-gray-300">{indexedChunks}</span>
              </span>
              {hasFineTuned && (
                <span className="rounded-md bg-emerald-500/10 px-2 py-1 border border-emerald-500/25 text-emerald-400">
                  Fine-tuned model present
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleResetWorkspace}
              disabled={resetting}
              className="btn-danger flex items-center gap-2 text-xs w-full justify-center"
            >
              <RotateCcw size={13} className={resetting ? 'animate-spin' : ''} />
              {resetting ? 'Resetting…' : 'Reset Workspace'}
            </button>
          </div>

          {/* Delete Fine-Tuned Model only */}
          <div className="bg-[#000000] rounded-xl p-4 border border-[#2a2a2a]">
            <p className="text-sm font-medium text-gray-300 mb-1">Delete Fine-Tuned Model</p>
            <p className="text-xs text-gray-600 mb-2">
              Removes the custom embedding model and reverts to the base all-MiniLM-L6-v2 model.
              Indexed documents and chat history are preserved.
            </p>
            <div className="flex flex-wrap gap-2 text-[10px] text-gray-500 mb-3">
              <span className={`rounded-md px-2 py-1 border ${
                hasFineTuned
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-[#141414] border-[#2a2a2a] text-gray-500'
              }`}>
                {hasFineTuned ? 'Fine-tuned model active' : 'Using base model'}
              </span>
            </div>
            <button
              onClick={handleDeleteModel}
              disabled={!hasFineTuned}
              className="btn-danger flex items-center gap-2 text-xs w-full justify-center disabled:opacity-30"
            >
              <Trash2 size={13} /> Delete Model Only
            </button>
          </div>
        </div>

        {/* Delete Workspace */}
        <div className="mt-4 bg-[#000000] rounded-xl p-4 border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-1">
            <FolderX size={14} className="text-red-400" />
            <p className="text-sm font-medium text-gray-300">Delete Workspace</p>
          </div>
          <p className="text-xs text-gray-600 mb-3">
            Permanently delete a workspace and all its data including documents, chat history, and metrics. Cannot be undone.
          </p>
          <div className="flex gap-2">
            <select
              value={wsToDelete}
              onChange={e => setWsToDelete(e.target.value)}
              className="flex-1 bg-[#000000] border border-[#1a1a1a] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50"
            >
              <option value="">Select workspace to delete...</option>
              {workspaces.map(ws => (
                <option key={ws.id} value={ws.id}>{ws.name} {ws.id === activeWorkspaceId ? '(Active)' : ''}</option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (!wsToDelete || parseInt(wsToDelete) === activeWorkspaceId) return
                const ws = workspaces.find(w => w.id === parseInt(wsToDelete))
                if (!confirm(`Delete workspace "${ws?.name}"? ALL data will be permanently lost.`)) return
                setDeletingWs(true)
                try {
                  await deleteWorkspaceById(parseInt(wsToDelete))
                  setWorkspaces(prev => prev.filter(w => w.id !== parseInt(wsToDelete)))
                  setWsToDelete('')
                  toast.success('Workspace deleted')
                } catch (err) {
                  toast.error(err.response?.data?.detail || 'Failed to delete')
                } finally {
                  setDeletingWs(false)
                }
              }}
              disabled={!wsToDelete || deletingWs || parseInt(wsToDelete) === activeWorkspaceId}
              className="btn-danger px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
          
          {/* Conditional Messages */}
          {parseInt(wsToDelete) === activeWorkspaceId && (
            <div className="mt-3 flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-[11px] p-2.5 rounded-lg">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <p>Switch to another workspace to delete this workspace.</p>
            </div>
          )}
          
          {workspaces.length <= 1 && (
            <p className="text-[10px] text-gray-600 mt-2 italic">You cannot delete your only workspace. Create another first.</p>
          )}
        </div>
      </div>

      {/* Sources table */}
      {stats?.sources && Object.keys(stats.sources).length > 0 && (
        <div className="card overflow-hidden mt-4">
          <div className="px-5 py-4 border-b border-[#2a2a2a]">
            <p className="section-title mb-0">Indexed Sources</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1e1e1e]">
                {['File', 'Chunks'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold
                                          uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.sources).map(([name, count]) => (
                <tr key={name} className="border-b border-[#1a1a1a] hover:bg-[#141414]">
                  <td className="px-5 py-3 text-gray-300 font-mono">{name}</td>
                  <td className="px-5 py-3 text-emerald-400 font-semibold">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
