import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStats, deleteDocument } from '../api/client'
import { PageHeader } from '../components/ui'
import { Database, FileText, File, Trash2, Search, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function DataSources({ onIndexChange }) {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleting, setDeleting] = useState(null) // filename being deleted

  const refresh = useCallback(() => {
    setLoading(true)
    getStats().then(setStats).catch(() => setStats(null)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = async (filename) => {
    if (!confirm(`Remove "${filename}" from the index? This will rebuild the index from remaining documents.`)) return
    setDeleting(filename)
    try {
      const res = await deleteDocument(filename)
      toast.success(res.message)
      refresh()
      onIndexChange?.()
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message)
    } finally {
      setDeleting(null)
    }
  }

  const sourcesDetail = stats?.sources_detail || {}
  const documents = Object.entries(sourcesDetail)
    .filter(([name]) => name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b))

  const totalDocs = Object.keys(sourcesDetail).length
  const totalChunks = stats?.index?.chunks ?? 0
  const totalChars = Object.values(sourcesDetail).reduce((sum, d) => sum + (d.total_chars || 0), 0)
  const lastUpdated = stats?.sources_detail
    ? Object.values(sourcesDetail).map(d => d.indexed_at).filter(Boolean).sort().pop()
    : null

  const isPdf = (name) => name.toLowerCase().endsWith('.pdf')

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="h-24 shrink-0" />
      <PageHeader title="Data Sources" subtitle="Manage your indexed document library">
        <button onClick={refresh} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </PageHeader>

      {totalDocs > 0 ? (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fadeIn">
            <div className="card p-4 border-t-2 border-t-emerald-500">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Documents</p>
              <p className="text-2xl font-bold text-emerald-400">{totalDocs}</p>
            </div>
            <div className="card p-4 border-t-2 border-t-blue-500">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Chunks</p>
              <p className="text-2xl font-bold text-blue-400">{totalChunks}</p>
            </div>
            <div className="card p-4 border-t-2 border-t-purple-500">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Characters</p>
              <p className="text-2xl font-bold text-purple-400">{totalChars.toLocaleString()}</p>
            </div>
            <div className="card p-4 border-t-2 border-t-orange-500">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Last Updated</p>
              <p className="text-sm font-bold text-orange-400">
                {lastUpdated ? new Date(lastUpdated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </p>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative animate-fadeIn" style={{ animationDelay: '100ms' }}>
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text" placeholder="Search documents…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/60"
            />
          </div>

          {/* Document grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fadeIn" style={{ animationDelay: '200ms' }}>
            {documents.map(([filename, detail]) => {
              const approxPages = Math.max(1, Math.round((detail.total_chars || 0) / 2000))
              return (
                <div key={filename} className="card p-5 group hover:border-emerald-500/30 transition-all">
                  <div className="flex items-start gap-3">
                    <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', isPdf(filename) ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400')}>
                      {isPdf(filename) ? <FileText size={20} /> : <File size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate" title={filename}>{filename}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                        <span>{detail.chunks} chunks</span>
                        <span>~{approxPages} page{approxPages !== 1 ? 's' : ''}</span>
                        <span>{((detail.total_chars || 0) / 1000).toFixed(1)}k chars</span>
                      </div>
                      {detail.indexed_at && (
                        <p className="text-[10px] text-gray-600 mt-1">
                          Indexed {new Date(detail.indexed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[#1a1a1a] flex justify-end">
                    <button
                      onClick={() => handleDelete(filename)}
                      disabled={deleting === filename}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1.5 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                      {deleting === filename ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {documents.length === 0 && searchQuery && (
            <div className="card p-10 text-center">
              <Search size={24} className="text-gray-700 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No documents matching "{searchQuery}"</p>
            </div>
          )}
        </>
      ) : (
        <div className="card p-16 text-center animate-fadeIn">
          <Database size={40} className="text-gray-700 mx-auto mb-4" />
          <p className="text-lg text-gray-400 mb-2">No documents indexed</p>
          <p className="text-sm text-gray-600 mb-6">Upload documents in the Workspace to see them here.</p>
          <button onClick={() => navigate('/workspace')} className="btn-primary mx-auto">Go to Workspace</button>
        </div>
      )}
    </div>
  )
}
