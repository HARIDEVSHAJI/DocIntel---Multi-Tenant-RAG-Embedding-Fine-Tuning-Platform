import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendChat, getHealth, getSuggestions, getSessions, createSession, updateSession, deleteSessionById, getSessionMessages, saveMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Spinner } from '../components/ui'
import {
  Send, MessageSquare, User, Bot, Plus, Trash2,
  Info, Copy, RefreshCw, AlertTriangle, Check,
  PanelLeftClose, PanelLeftOpen, Search, Sparkles, ArrowRight, X, Mic
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const SIDEBAR_W_KEY = 'rag_sidebar_width'
const ACTIVE_KEY = 'rag_active_session'

function generateId() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) }

function InfoPopover({ msg }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  const scoreColor = (msg.faithfulness_score ?? 0) >= 0.65 ? 'text-emerald-400' : (msg.faithfulness_score ?? 0) >= 0.35 ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="text-gray-600 hover:text-gray-400 transition-colors p-0.5" title="View retrieval info"><Info size={14} /></button>
      {open && (
        <div className="absolute bottom-7 left-0 z-50 bg-[#000000] border border-[#1a1a1a] rounded-lg p-3 w-56 shadow-xl text-xs space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between"><span className="text-gray-500">Faithfulness</span><span className={clsx('font-semibold font-mono', scoreColor)}>{((msg.faithfulness_score ?? 0) * 100).toFixed(0)}%</span></div>
          <div className="flex items-center justify-between"><span className="text-gray-500">Sources retrieved</span><span className="text-gray-300 font-mono">{msg.source_count ?? 0}</span></div>
          {msg.source_files?.length > 0 && (
            <div className="border-t border-[#1a1a1a] pt-2 space-y-1">
              <span className="text-gray-600 text-[10px] uppercase tracking-wider">Files</span>
              {msg.source_files.map((f, i) => (<p key={i} className="text-gray-400 truncate">{f}</p>))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Message({ msg, isLast, onRegenerate }) {
  const isUser = msg.role === 'user'
  const [copied, setCopied] = useState(false)
  const handleCopy = () => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div className={clsx('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (<div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-1"><Bot size={13} className="text-emerald-400" /></div>)}
      <div className={clsx('max-w-[78%]', isUser ? 'items-end' : 'items-start')}>
        <div className={clsx('px-4 py-3 rounded-2xl text-sm leading-relaxed', isUser ? 'bg-emerald-500/20 border border-emerald-500/30 text-white rounded-tr-sm' : 'bg-[#000000] border border-[#1a1a1a] text-gray-200 rounded-tl-sm')}>
          {isUser ? msg.content : (
            <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-headings:text-gray-200 prose-code:text-emerald-300 prose-code:bg-[#000000] prose-code:px-1 prose-code:rounded prose-pre:bg-[#000000] prose-pre:border prose-pre:border-[#1a1a1a] prose-a:text-emerald-400 prose-strong:text-white">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          )}
        </div>
        {!isUser && (
          <div className="flex items-center gap-1 mt-1 pl-1">
            <button onClick={handleCopy} className="text-gray-600 hover:text-gray-400 transition-colors p-1 rounded" title="Copy response">{copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}</button>
            {isLast && onRegenerate && (<button onClick={onRegenerate} className="text-gray-600 hover:text-gray-400 transition-colors p-1 rounded" title="Regenerate response"><RefreshCw size={13} /></button>)}
            {msg.faithfulness_score != null && <InfoPopover msg={msg} />}
          </div>
        )}
      </div>
      {isUser && (<div className="w-7 h-7 rounded-full bg-[#000000] border border-[#1a1a1a] flex items-center justify-center shrink-0 mt-1"><User size={13} className="text-gray-400" /></div>)}
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0"><Bot size={13} className="text-emerald-400" /></div>
      <div className="bg-[#000000] border border-[#1a1a1a] px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
        {[0, 1, 2].map(i => (<span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: `${i * 150}ms`, animationDuration: '0.8s' }} />))}
      </div>
    </div>
  )
}

function SuggestionSkeleton() {
  return (
    <div className="mt-5">
      <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2.5 ml-10">Suggestions</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 ml-10">
        {[0,1,2,3].map(i => (<div key={i} className="bg-[#000000] border border-[#1a1a1a] rounded-xl p-3 h-[72px] overflow-hidden"><div className="shimmer h-3 w-5/6 rounded bg-[#1a1a1a] mb-2" /><div className="shimmer h-3 w-3/5 rounded bg-[#1a1a1a]" style={{ animationDelay: `${i*100}ms` }} /></div>))}
      </div>
    </div>
  )
}

const SUGGESTION_ICONS = [
  <Search size={14} className="text-emerald-400" />,
  <MessageSquare size={14} className="text-emerald-400" />,
  <Sparkles size={14} className="text-emerald-400" />,
  <Bot size={14} className="text-emerald-400" />,
]

function SuggestionCards({ suggestions, onSelect, onDismiss }) {
  if (!suggestions || suggestions.length === 0) return null
  return (
    <div className="mt-5 relative">
      <div className="flex items-center justify-between mb-2.5 ml-10">
        <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">Suggestions</p>
        {onDismiss && (<button onClick={onDismiss} className="text-gray-600 hover:text-gray-400 transition-colors p-1 -mr-1" title="Dismiss suggestions"><X size={14} /></button>)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 ml-10">
        {suggestions.map((sug, i) => (
          <button key={i} onClick={() => onSelect(sug)} className="group bg-[#000000] border border-[#1a1a1a] hover:border-emerald-500/40 hover:bg-emerald-500/5 rounded-xl p-3 text-left transition-all duration-200 flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-emerald-500/20 transition-colors">{SUGGESTION_ICONS[i % 4]}</div>
            <div className="flex-1 min-w-0"><p className="text-xs text-gray-400 group-hover:text-emerald-300 leading-relaxed transition-colors line-clamp-2">{sug}</p></div>
            <ArrowRight size={14} className="text-gray-700 group-hover:text-emerald-400 transition-colors shrink-0 mt-1" />
          </button>
        ))}
      </div>
    </div>
  )
}

/* Check Web Speech API support */
const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

export default function Chat({ messages, setMessages, initialSuggestions = [] }) {
  const navigate = useNavigate()
  const { activeWorkspaceId } = useAuth()
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem(ACTIVE_KEY) || null)
  const [searchQuery, setSearchQuery] = useState('')

  // Drag-to-resize sidebar
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_W_KEY)
    return saved ? parseInt(saved, 10) : 220
  })
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartW = useRef(0)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [indexEmpty, setIndexEmpty] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Voice input
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)

  useEffect(() => { getHealth().then(h => setIndexEmpty(!h?.index_loaded)).catch(() => {}) }, [])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Load sessions from DB when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) return
    getSessions(activeWorkspaceId)
      .then(data => {
        setSessions(data)
        // If saved active session exists in the list, load its messages
        const savedId = localStorage.getItem(ACTIVE_KEY)
        if (savedId && data.find(s => s.id === savedId)) {
          setActiveSessionId(savedId)
          getSessionMessages(savedId).then(msgs => setMessages(msgs)).catch(() => {})
        } else if (data.length > 0) {
          setActiveSessionId(data[0].id)
          localStorage.setItem(ACTIVE_KEY, data[0].id)
          getSessionMessages(data[0].id).then(msgs => setMessages(msgs)).catch(() => {})
        } else {
          setActiveSessionId(null)
          setMessages([])
        }
      })
      .catch(() => setSessions([]))
  }, [activeWorkspaceId]) // eslint-disable-line

  // Persist sidebar width
  useEffect(() => { localStorage.setItem(SIDEBAR_W_KEY, String(sidebarWidth)) }, [sidebarWidth])

  // Drag handlers
  const onDragStart = useCallback((e) => {
    e.preventDefault()
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartW.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return
      const delta = e.clientX - dragStartX.current
      let newW = dragStartW.current + delta
      if (newW < 60) newW = 0
      if (newW > 320) newW = 320
      setSidebarWidth(newW)
    }
    const onUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const expandSidebar = () => setSidebarWidth(220)

  // Voice input
  const toggleVoice = useCallback(() => {
    if (!SpeechRecognition) return
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop()
      setIsListening(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognitionRef.current = recognition
    recognition.onresult = (event) => {
      let interim = '', final = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript
        else interim += event.results[i][0].transcript
      }
      setInput(final || interim)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)
    recognition.start()
    setIsListening(true)
  }, [isListening])

  const createNewSession = async () => {
    if (!activeWorkspaceId) return
    try {
      const newId = generateId()
      const ns = await createSession(activeWorkspaceId, 'New Chat', newId)
      setSessions(prev => [{ ...ns, message_count: 0 }, ...prev])
      setActiveSessionId(ns.id)
      localStorage.setItem(ACTIVE_KEY, ns.id)
      setMessages([]); setInput(''); setSearchQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch (err) {
      toast.error('Failed to create session')
    }
  }

  const switchSession = async (id) => {
    setActiveSessionId(id)
    localStorage.setItem(ACTIVE_KEY, id)
    try {
      const msgs = await getSessionMessages(id)
      setMessages(msgs)
    } catch {
      setMessages([])
    }
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleDeleteSession = async (id, e) => {
    e.stopPropagation()
    try {
      await deleteSessionById(id)
      const updated = sessions.filter(s => s.id !== id)
      setSessions(updated)
      if (activeSessionId === id) {
        if (updated.length > 0) switchSession(updated[0].id)
        else { setActiveSessionId(null); localStorage.removeItem(ACTIVE_KEY); setMessages([]) }
      }
    } catch {
      toast.error('Failed to delete session')
    }
  }

  const send = async (overrideText) => {
    const text = (overrideText || input).trim()
    if (!text || loading) return
    let sessionId = activeSessionId
    if (!sessionId) {
      // Auto-create session
      if (!activeWorkspaceId) return
      try {
        const newId = generateId()
        const ns = await createSession(activeWorkspaceId, text.slice(0, 30), newId)
        setSessions(prev => [{ ...ns, message_count: 0 }, ...prev])
        setActiveSessionId(ns.id)
        localStorage.setItem(ACTIVE_KEY, ns.id)
        sessionId = ns.id
      } catch {
        toast.error('Failed to create session')
        return
      }
    }
    // Update title if still "New Chat"
    const cs = sessions.find(s => s.id === sessionId)
    if (cs && cs.title === 'New Chat') {
      const newTitle = text.slice(0, 30)
      updateSession(sessionId, { title: newTitle }).catch(() => {})
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s))
    }
    const userMsg = { role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    // Save user message to DB
    saveMessage(sessionId, 'user', text).catch(() => {})
    if (!overrideText) setInput('')
    setLoading(true); setSuggestions([]); setSuggestionsLoading(false)
    try {
      const history = messages.map(m => [m.role === 'user' ? m.content : '', m.role === 'assistant' ? m.content : ''])
      const res = await sendChat(text, history, sessionId, activeWorkspaceId)
      const newMsg = { role: 'assistant', content: res.answer, faithfulness_score: res.faithfulness_score, source_count: res.source_count, source_files: res.source_files }
      setMessages(m => [...m, newMsg])
      // Save assistant message to DB
      saveMessage(sessionId, 'assistant', res.answer, {
        faithfulness_score: res.faithfulness_score,
        source_count: res.source_count,
        source_files: res.source_files || [],
      }).catch(() => {})
      setSuggestionsLoading(true)
      const allMsgs = [...messages, userMsg, newMsg]
      getSuggestions(allMsgs.map(m => ({ role: m.role, content: m.content })))
        .then(data => setSuggestions(data.suggestions || []))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestionsLoading(false))
    } catch (err) {
      const detail = err.response?.data?.detail || err.message
      toast.error(detail)
      setMessages(m => [...m, { role: 'assistant', content: `❌ ${detail}` }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const regenerate = () => {
    if (messages.length < 2) return
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    setMessages(m => m.slice(0, -1))
    send(lastUser.content)
  }

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  const filteredSessions = sessions.filter(s => s.title?.toLowerCase().includes(searchQuery.toLowerCase()))
  const charCount = input.length
  const sidebarVisible = sidebarWidth > 0

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="relative shrink-0 flex" style={{ width: sidebarWidth }}>
        {sidebarVisible && (
          <div className="w-full bg-[#000000] border-r border-[#1a1a1a] flex flex-col pt-24 overflow-hidden">
            <div className="p-3 border-b border-[#1a1a1a] flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type="text" placeholder="Search chats…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-[#000000] border border-[#1a1a1a] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/60" />
              </div>
              <button onClick={createNewSession} className="btn-primary p-2 rounded-lg shrink-0 flex items-center justify-center" title="New Chat"><Plus size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {filteredSessions.length === 0 ? (
                <p className="text-[10px] text-gray-600 text-center mt-4 px-2">No chats found.</p>
              ) : filteredSessions.map(s => (
                <button key={s.id} onClick={() => switchSession(s.id)}
                  className={clsx('w-full text-left px-3 py-2.5 rounded-lg text-xs transition-all group',
                    s.id === activeSessionId ? 'bg-[#000000] border-l-2 border-l-emerald-500 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-[#000000]')}>
                  <div className="flex items-center justify-between gap-1">
                    <p className="truncate font-medium flex-1">{s.title || 'New Chat'}</p>
                    <button onClick={(e) => handleDeleteSession(s.id, e)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-0.5 shrink-0" title="Delete session"><Trash2 size={12} /></button>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-0.5">{new Date(s.updated_at || s.created_at || s.updatedAt || s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Drag handle */}
        {sidebarVisible && (
          <div onMouseDown={onDragStart} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-emerald-500/40 transition-colors z-20" />
        )}
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute top-24 left-6 z-10 flex items-center mb-4">
          <button onClick={() => sidebarVisible ? setSidebarWidth(0) : expandSidebar()}
            className="p-2.5 rounded-xl bg-[#050505] border border-[#1a1a1a] text-gray-500 hover:text-emerald-400 hover:border-emerald-500/30 transition-all shadow-lg" title="Toggle Sidebar">
            {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {indexEmpty && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 mb-4 flex items-center gap-3 mx-6 mt-24">
            <AlertTriangle size={16} className="text-yellow-400 shrink-0" />
            <div className="flex-1"><p className="text-sm text-yellow-300">No documents indexed</p><p className="text-xs text-yellow-500/70">Go to Workspace to upload documents first.</p></div>
            <button onClick={() => navigate('/workspace')} className="btn-primary text-xs py-1.5 px-3 shrink-0">Go to Workspace</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 pt-24 pb-4 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <MessageSquare size={32} className="text-gray-700 mb-3" />
              <p className="text-sm text-gray-400 font-medium">Start a conversation</p>
              <p className="text-xs text-gray-600 mt-1 mb-8">Ask anything about your documents</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-lg mx-auto w-full">
                {initialSuggestions.map((sug, i) => (
                  <button key={i} onClick={() => send(sug)}
                    className="bg-[#000000] border border-[#1a1a1a] hover:border-emerald-500/50 hover:bg-emerald-500/5 rounded-xl p-3 text-left text-xs text-gray-400 hover:text-emerald-400 transition-colors shadow-sm">
                    <div className="flex items-center gap-1.5 mb-1.5"><Sparkles size={12} className="text-emerald-500" /><span className="font-medium text-gray-300">Suggestion</span></div>
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (<Message key={i} msg={msg} isLast={i === messages.length - 1 && msg.role === 'assistant'} onRegenerate={regenerate} />))
          )}
          {loading && <TypingDots />}
          {!loading && suggestionsLoading && <SuggestionSkeleton />}
          {!loading && !suggestionsLoading && suggestions.length > 0 && (
            <SuggestionCards suggestions={suggestions} onSelect={(text) => { setInput(text); setTimeout(() => inputRef.current?.focus(), 50) }} onDismiss={() => setSuggestions([])} />
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="mx-6 mb-6 bg-[#0a0a0a] border border-[#1a1a1a] shadow-lg rounded-[2rem] flex items-end gap-3 p-2 px-5 focus-within:border-[#2a2a2a] focus-within:ring-1 focus-within:ring-[#2a2a2a] transition-all">
          <div className="flex-1 relative">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value.slice(0, 2000))} onKeyDown={handleKey}
              placeholder="Ask anything about your documents… (Enter to send, Shift+Enter for new line)" rows={1}
              className="w-full bg-transparent resize-none text-base text-gray-200 placeholder-gray-600 focus:outline-none leading-relaxed py-3 max-h-40 overflow-y-auto"
              style={{ minHeight: '48px' }} />
            {charCount > 1500 && (<span className={clsx('absolute bottom-1 right-2 text-[10px]', charCount >= 2000 ? 'text-red-400' : 'text-gray-500')}>{charCount}/2000</span>)}
          </div>
          {/* Voice input — completely hidden if unsupported */}
          {SpeechRecognition && (
            <button onClick={toggleVoice} className={clsx('w-10 h-10 mb-1.5 rounded-full flex items-center justify-center transition-all shrink-0', isListening ? 'bg-red-500/20 border border-red-500/40 text-red-400' : 'bg-[#141414] border border-[#1a1a1a] text-gray-500 hover:text-emerald-400 hover:border-emerald-500/30')} title={isListening ? 'Stop listening' : 'Voice input'}>
              <Mic size={16} />
              {isListening && <span className="absolute w-2.5 h-2.5 rounded-full bg-red-500 animate-ping top-1 right-1" />}
            </button>
          )}
          <button onClick={() => send()} disabled={!input.trim() || loading}
            className="w-10 h-10 mb-1.5 rounded-full bg-emerald-500 flex items-center justify-center text-black hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:bg-[#1a1a1a] disabled:text-gray-500 shrink-0 shadow-md relative">
            <Send size={16} className={loading ? 'opacity-0' : ''} />
            {loading && <Spinner size={16} className="absolute text-emerald-500" />}
          </button>
        </div>
      </div>
    </div>
  )
}
