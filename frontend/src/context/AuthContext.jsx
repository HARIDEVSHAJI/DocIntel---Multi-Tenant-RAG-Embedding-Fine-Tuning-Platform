import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

const TOKEN_KEY = 'docintel_token'
const USER_KEY = 'docintel_user'
const WORKSPACE_KEY = 'docintel_active_workspace'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null }
  })
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => {
    const saved = localStorage.getItem(WORKSPACE_KEY)
    return saved ? parseInt(saved, 10) : null
  })
  const [loading, setLoading] = useState(true)

  // NOTE: JWT interceptor is now at module-level in client.js (always active)
  // No useEffect interceptor needed here.

  // Validate token on mount
  useEffect(() => {
    if (!token) { setLoading(false); return }
    api.get('/auth/me')
      .then(res => {
        setUser(res.data)
        localStorage.setItem(USER_KEY, JSON.stringify(res.data))
        if (!activeWorkspaceId && res.data.active_workspace_id) {
          setActiveWorkspaceId(res.data.active_workspace_id)
          localStorage.setItem(WORKSPACE_KEY, String(res.data.active_workspace_id))
        }
      })
      .catch(() => { logout() })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password })
    const { access_token, user: u } = res.data
    localStorage.setItem(TOKEN_KEY, access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(access_token)
    setUser(u)
    if (u.active_workspace_id) {
      setActiveWorkspaceId(u.active_workspace_id)
      localStorage.setItem(WORKSPACE_KEY, String(u.active_workspace_id))
    }
    return u
  }, [])

  const register = useCallback(async (username, email, password) => {
    const res = await api.post('/auth/register', { username, email, password })
    const { access_token, user: u } = res.data
    localStorage.setItem(TOKEN_KEY, access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(access_token)
    setUser(u)
    if (u.active_workspace_id) {
      setActiveWorkspaceId(u.active_workspace_id)
      localStorage.setItem(WORKSPACE_KEY, String(u.active_workspace_id))
    }
    return u
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(WORKSPACE_KEY)
    setToken(null)
    setUser(null)
    setActiveWorkspaceId(null)
  }, [])
  const switchWorkspace = useCallback((wsId) => {
    setActiveWorkspaceId(wsId)
    if (wsId) {
      localStorage.setItem(WORKSPACE_KEY, String(wsId))
    } else {
      localStorage.removeItem(WORKSPACE_KEY)
    }
  }, [])

  const isAuthenticated = !!token && !!user

  return (
    <AuthContext.Provider value={{
      token, user, loading, isAuthenticated,
      activeWorkspaceId, switchWorkspace,
      login, register, logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
