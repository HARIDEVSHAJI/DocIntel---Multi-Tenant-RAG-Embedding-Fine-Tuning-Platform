import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 120000,
})

// ── Global JWT & Workspace interceptor (module-level, always active) ─────────
// This MUST be at module level, NOT inside a React effect, to avoid
// race conditions with React 18 Strict Mode double-mounting.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('docintel_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  
  const wsId = localStorage.getItem('docintel_active_workspace')
  if (wsId) {
    // Add to query params for GET/DELETE or generic params
    config.params = { ...config.params, workspace_id: wsId }
    
    // Add to body for POST/PATCH/PUT if not FormData
    if (config.data && !(config.data instanceof FormData)) {
      if (typeof config.data === 'object' && !Array.isArray(config.data)) {
        config.data = { ...config.data, workspace_id: wsId }
      }
    }
    // Add to FormData
    if (config.data instanceof FormData) {
      if (!config.data.has('workspace_id')) {
        config.data.append('workspace_id', wsId)
      }
    }
  }
  return config
})

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginUser    = (username, password) => api.post('/auth/login', { username, password }).then(r => r.data)
export const registerUser = (username, email, password) => api.post('/auth/register', { username, email, password }).then(r => r.data)
export const getCurrentUser = () => api.get('/auth/me').then(r => r.data)

// ── Health / Config ──────────────────────────────────────────────────────────
export const getHealth  = () => api.get('/health').then(r => r.data)
export const getStats   = () => api.get('/stats').then(r => r.data)
export const getConfig  = () => api.get('/config').then(r => r.data)
export const validateKey = () => api.get('/validate-key').then(r => r.data)
export const updateConfig = (cfg) => api.post('/config', cfg).then(r => r.data)

// ── Workspaces ───────────────────────────────────────────────────────────────
export const getWorkspaces    = () => api.get('/workspaces').then(r => r.data)
export const createWorkspace  = (name) => api.post('/workspaces', { name }).then(r => r.data)
export const deleteWorkspaceById = (id) => api.delete(`/workspaces/${id}`).then(r => r.data)

// ── Sessions ─────────────────────────────────────────────────────────────────
export const getSessions       = (workspaceId) => api.get(`/sessions?workspace_id=${workspaceId}`).then(r => r.data)
export const createSession     = (workspaceId, title, sessionId) =>
  api.post('/sessions', { workspace_id: workspaceId, title, session_id: sessionId }).then(r => r.data)
export const updateSession     = (sessionId, data) => api.patch(`/sessions/${sessionId}`, data).then(r => r.data)
export const deleteSessionById = (sessionId) => api.delete(`/sessions/${sessionId}`).then(r => r.data)
export const getSessionMessages = (sessionId) => api.get(`/sessions/${sessionId}/messages`).then(r => r.data)
export const saveMessage       = (sessionId, role, content, extra = {}) =>
  api.post(`/sessions/${sessionId}/messages`, { session_id: sessionId, role, content, ...extra }).then(r => r.data)

// ── Upload / Documents ───────────────────────────────────────────────────────
export const uploadDocs = (files, chunkSize, overlap) => {
  const form = new FormData()
  files.forEach(f => form.append('files', f))
  form.append('chunk_size', chunkSize)
  form.append('overlap', overlap)
  return api.post('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export const deleteDocument = (filename) =>
  api.delete(`/document/${encodeURIComponent(filename)}`).then(r => r.data)

// ── Chat ─────────────────────────────────────────────────────────────────────
export const sendChat = (message, history, sessionId, workspaceId) =>
  api.post('/chat', { message, history, session_id: sessionId, workspace_id: workspaceId }).then(r => r.data)

// ── Suggestions ──────────────────────────────────────────────────────────────
export const getInitialSuggestions = () =>
  api.get('/suggestions', { timeout: 20000 }).then(r => r.data)

export const getSuggestions = (history) =>
  api.post('/suggestions', { history }, { timeout: 20000 }).then(r => r.data)

// ── Training ─────────────────────────────────────────────────────────────────
export const startTraining = (file, epochs) => {
  const form = new FormData()
  form.append('file', file)
  form.append('epochs', epochs)
  return api.post('/train/start', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}

export const getTrainStatus = () => api.get('/train/status').then(r => r.data)

export const autoGenerateTraining = () =>
  api.post('/train/auto-generate', {}, { timeout: 120000 }).then(r => r.data)

export const startTrainingAuto = (epochs = 3) =>
  api.post(`/train/start-auto?epochs=${epochs}`).then(r => r.data)

// ── Evaluation ───────────────────────────────────────────────────────────────
export const runEvaluation = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/evaluate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  }).then(r => r.data)
}

export const runAutoEvaluation = () =>
  api.post('/evaluate/auto', {}, { timeout: 300000 }).then(r => r.data)

// ── Index / Model / Workspace management ─────────────────────────────────────
export const clearIndex  = () => api.delete('/index').then(r => r.data)
export const deleteModel = () => api.delete('/model').then(r => r.data)
export const resetWorkspace = () => api.delete('/reset-workspace').then(r => r.data)
export const deleteWorkspace = () => api.delete('/workspace').then(r => r.data)

// ── API Key Management ───────────────────────────────────────────────────────
export const getKeyStatus = () => api.get('/config/key-status').then(r => r.data)
export const saveManualKey = (api_key) => api.post('/config/key-save', { api_key }).then(r => r.data)
export const toggleKeyMode = (use_custom_key) => api.post('/config/key-toggle', { use_custom_key }).then(r => r.data)
export const testKeyConnection = (api_key, use_env) => api.post('/config/key-test', { api_key, use_env }).then(r => r.data)
export const clearManualKey = () => api.delete('/config/key-clear').then(r => r.data)

// ── Sample CSV Downloads ─────────────────────────────────────────────────────
export const downloadSampleTraining = () => {
  const base = import.meta.env.VITE_API_URL || ''
  window.open(`${base}/api/samples/training`, '_blank')
}
export const downloadSampleEval = () => {
  const base = import.meta.env.VITE_API_URL || ''
  window.open(`${base}/api/samples/evaluation`, '_blank')
}

// ── Metrics ──────────────────────────────────────────────────────────────────
export const getMetrics = () => api.get('/metrics').then(r => r.data)

// ── Admin ────────────────────────────────────────────────────────────────────
export const getAdminUsers = () => api.get('/admin/users').then(r => r.data)
export const deleteAdminUser = (userId) => api.delete(`/admin/users/${userId}`).then(r => r.data)
export const updateGlobalKey = (apiKey) => api.post('/admin/global-key', { api_key: apiKey }).then(r => r.data)
export const getGlobalKeyStatus = () => api.get('/admin/global-key-status').then(r => r.data)
export const clearGlobalKey = () => api.delete('/admin/global-key').then(r => r.data)

export default api
