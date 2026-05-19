import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { getHealth, validateKey, getInitialSuggestions } from './api/client'
import { useAuth } from './context/AuthContext'
import Navbar     from './components/Navbar'
import Dashboard  from './pages/Dashboard'
import Chat       from './pages/Chat'
import Workspace  from './pages/Workspace'
import Analytics  from './pages/Analytics'
import DataSources from './pages/DataSources'
import Config     from './pages/Config'
import Login      from './pages/Login'
import Admin      from './pages/Admin'

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-[#000000] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  )
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [health, setHealth] = useState(null)
  const [keyStatus, setKeyStatus] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [initialSuggestions, setInitialSuggestions] = useState([])

  useEffect(() => {
    if (!isAuthenticated) return
    const poll = () => getHealth().then(setHealth).catch(() => setHealth({ status: 'error' }))
    poll()
    const id = setInterval(poll, 10000)
    return () => clearInterval(id)
  }, [isAuthenticated])

  const recheckGroqKey = useCallback(
    () =>
      validateKey()
        .then((data) => { setKeyStatus(data); return data })
        .catch(() => {
          const fail = { valid: false, error: 'Backend unreachable' }
          setKeyStatus(fail)
          return fail
        }),
    []
  )

  useEffect(() => {
    if (!isAuthenticated) return
    recheckGroqKey()
    const id = setInterval(recheckGroqKey, 120000)
    return () => clearInterval(id)
  }, [recheckGroqKey, isAuthenticated])

  const refreshSuggestions = useCallback(() => {
    getInitialSuggestions()
      .then(data => setInitialSuggestions(data.suggestions || []))
      .catch(() => setInitialSuggestions([]))
  }, [])

  useEffect(() => {
    if (isAuthenticated) refreshSuggestions()
  }, [refreshSuggestions, isAuthenticated])

  const handleMainScroll = (e) => {
    window.dispatchEvent(new CustomEvent('app-scroll', { detail: { scrollTop: e.target.scrollTop } }))
  }

  // Show loading while auth is checking
  if (authLoading) return (
    <div className="min-h-screen bg-[#000000] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#000000]">
      <Routes>
        {/* Public route */}
        <Route path="/login" element={
          isAuthenticated ? <Navigate to="/" replace /> : <Login />
        } />

        {/* Protected routes */}
        <Route path="/*" element={
          <ProtectedRoute>
            <Navbar />
            <main className="flex-1 overflow-y-auto" onScroll={handleMainScroll}>
              <Routes>
                <Route path="/" element={<Dashboard health={health} keyStatus={keyStatus} />} />
                <Route path="/chat" element={
                  <Chat
                    messages={chatMessages}
                    setMessages={setChatMessages}
                    initialSuggestions={initialSuggestions}
                  />
                } />
                <Route path="/workspace" element={<Workspace onIndexChange={refreshSuggestions} />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/datasources" element={<DataSources onIndexChange={refreshSuggestions} />} />
                <Route path="/config" element={<Config keyStatus={keyStatus} onRecheckGroqKey={recheckGroqKey} />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/upload" element={<Navigate to="/workspace" replace />} />
                <Route path="/training" element={<Navigate to="/workspace" replace />} />
                <Route path="/evaluate" element={<Navigate to="/workspace" replace />} />
              </Routes>
            </main>
          </ProtectedRoute>
        } />
      </Routes>
    </div>
  )
}
