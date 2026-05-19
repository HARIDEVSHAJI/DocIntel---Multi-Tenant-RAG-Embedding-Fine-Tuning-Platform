import { useState, useEffect } from 'react'
import { getAdminUsers, deleteAdminUser, updateGlobalKey, getGlobalKeyStatus, testKeyConnection, clearGlobalKey } from '../api/client'
import { PageHeader, Spinner } from '../components/ui'
import { Users, Key, Trash2, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Admin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [globalKey, setGlobalKey] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyTesting, setKeyTesting] = useState(false)
  const [globalKeyStatus, setGlobalKeyStatus] = useState({ is_set: false, source: null, masked_key: '' })

  const fetchUsers = async () => {
    try {
      const data = await getAdminUsers()
      setUsers(data)
    } catch (err) {
      toast.error('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const fetchKeyStatus = async () => {
    try {
      const status = await getGlobalKeyStatus()
      setGlobalKeyStatus(status)
    } catch (err) {
      console.error('Failed to fetch global key status', err)
    }
  }

  useEffect(() => {
    fetchUsers()
    fetchKeyStatus()
  }, [])

  const handleDeleteUser = async (userId, username) => {
    if (!window.confirm(`Are you sure you want to completely delete user '${username}' and all their workspaces/data?`)) return
    try {
      await deleteAdminUser(userId)
      toast.success('User deleted successfully')
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete user')
    }
  }

  const handleTestKey = async () => {
    if (!globalKey.trim()) return toast.error('Key cannot be empty')
    setKeyTesting(true)
    try {
      const res = await testKeyConnection(globalKey.trim(), false)
      if (res.success) {
        toast.success('API Key is valid and working!')
      } else {
        toast.error(res.message || 'API Key validation failed')
      }
    } catch (err) {
      toast.error('Failed to connect to API endpoint')
    } finally {
      setKeyTesting(false)
    }
  }

  const handleUpdateKey = async (e) => {
    e.preventDefault()
    if (!globalKey.trim()) return toast.error('Key cannot be empty')
    
    setKeySaving(true)
    try {
      await updateGlobalKey(globalKey.trim())
      toast.success('Global fallback Groq API Key updated!')
      setGlobalKey('')
      fetchKeyStatus()
    } catch (err) {
      toast.error('Failed to update global key')
    } finally {
      setKeySaving(false)
    }
  }

  const handleClearKey = async () => {
    if (!window.confirm('Are you sure you want to delete the dashboard fallback key override? This will revert the default fallback to the environment variable.')) return
    try {
      await clearGlobalKey()
      toast.success('Dashboard key override removed successfully')
      fetchKeyStatus()
    } catch (err) {
      toast.error('Failed to clear key override')
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-fadeIn">
      <div className="h-24 shrink-0" />
      <PageHeader 
        title="Admin Panel" 
        subtitle="Manage platform users and global fallback configurations"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Global Key Section */}
        <div className="md:col-span-1 space-y-6">
          <div className="card p-6">
            <h2 className="section-title text-base flex items-center gap-2 mb-4">
              <Key size={16} className="text-emerald-400" />
              Global API Key
            </h2>
            <p className="text-xs text-gray-500 mb-6">
              Configure a fallback GROQ API key. This will be used as the default for all users who don't set a manual key.
            </p>

            <div className="mb-4 p-3 bg-[#111111] rounded-lg border border-[#222222] space-y-3">
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 font-semibold">Current Fallback Key</div>
                <div className="text-xs font-mono font-semibold text-gray-300">
                  {globalKeyStatus.is_set ? (
                    <div className="space-y-1">
                      <span className="text-emerald-400/90 font-bold block">{globalKeyStatus.masked_key}</span>
                      <span className="text-[9px] uppercase tracking-wider text-gray-500 block">
                        Configured via {globalKeyStatus.source === 'env' ? 'Environment Variable (.env)' : 'Admin Dashboard (Database)'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-red-400/80">Not Configured (Unconfigured)</span>
                  )}
                </div>
              </div>

              {globalKeyStatus.source === 'database' && (
                <button
                  type="button"
                  onClick={handleClearKey}
                  className="w-full text-center py-1.5 px-3 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[10px] uppercase font-bold tracking-wider transition-colors"
                >
                  Clear Dashboard Override
                </button>
              )}
            </div>

            <form onSubmit={handleUpdateKey} className="space-y-4">
              <div>
                <label className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-2 block">New Groq Key</label>
                <input 
                  type="password" 
                  className="input-field w-full text-sm"
                  placeholder="gsk_..."
                  value={globalKey}
                  onChange={e => setGlobalKey(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button 
                  type="button" 
                  disabled={keyTesting || !globalKey.trim()} 
                  onClick={handleTestKey}
                  className="btn-secondary flex-1 flex justify-center py-2 text-xs"
                >
                  {keyTesting ? <Spinner size={16} /> : 'Test Key'}
                </button>
                <button 
                  type="submit" 
                  disabled={keySaving || !globalKey.trim()} 
                  className="btn-primary flex-1 flex justify-center py-2 text-xs"
                >
                  {keySaving ? <Spinner size={16} /> : 'Save Key'}
                </button>
              </div>
            </form>
          </div>

          <div className="card p-6 bg-red-500/5 border-red-500/20">
            <h2 className="section-title text-base flex items-center gap-2 mb-2 text-red-400">
              <ShieldAlert size={16} /> Admin Warning
            </h2>
            <p className="text-xs text-red-400/80 leading-relaxed">
              Deleting a user is immediate and irreversible. It will cascade-delete all their workspaces, documents, fine-tuned models, and evaluation metrics from the database.
            </p>
          </div>
        </div>

        {/* User Management Section */}
        <div className="md:col-span-2 card overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-[#1a1a1a]">
            <h2 className="section-title text-base flex items-center gap-2 mb-0">
              <Users size={16} className="text-emerald-400" />
              User Management
            </h2>
          </div>
          
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="h-48 flex items-center justify-center">
                <Spinner />
              </div>
            ) : users.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
                No users found.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#0a0a0a] sticky top-0 border-b border-[#1a1a1a]">
                  <tr>
                    <th className="px-6 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Username</th>
                    <th className="px-6 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="px-6 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider text-center">Workspaces</th>
                    <th className="px-6 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-[#141414] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold text-xs border border-emerald-500/20">
                            {u.username[0].toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-200 text-sm">{u.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400">{u.email}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded bg-[#1a1a1a] text-xs font-mono text-gray-400 border border-[#2a2a2a]">
                          {u.workspaces}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDeleteUser(u.id, u.username)}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                          title="Delete User"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
