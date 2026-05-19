import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, Briefcase,
  BarChart2, Database, Settings, LogOut, Shield
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/',            icon: LayoutDashboard, label: 'Overview' },
  { to: '/chat',        icon: MessageSquare,   label: 'Chat' },
  { to: '/workspace',   icon: Briefcase,       label: 'Workspace' },
  { to: '/analytics',   icon: BarChart2,       label: 'Analytics' },
  { to: '/datasources', icon: Database,        label: 'Data Sources' },
  { to: '/config',      icon: Settings,        label: 'Config' },
]

const ADMIN_NAV = { to: '/admin', icon: Shield, label: 'Admin Panel' }

const DocIntelLogo = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="2" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="22" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="2" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="22" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="4.9" cy="4.9" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19.1" cy="4.9" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="4.9" cy="19.1" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19.1" cy="19.1" r="1.5" fill="currentColor" stroke="none" />
    <path d="M14 6H8a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9l-3-3z" />
    <path d="M14 6v3h3" />
    <line x1="9" y1="11" x2="15" y2="11" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="15" x2="12" y2="15" />
  </svg>
)

export default function Navbar() {
  const loc = useLocation()
  const { user, logout } = useAuth()
  const [isScrolled, setIsScrolled] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef(null)

  useEffect(() => {
    const handleScroll = (e) => setIsScrolled(e.detail.scrollTop > 20)
    window.addEventListener('app-scroll', handleScroll)
    return () => window.removeEventListener('app-scroll', handleScroll)
  }, [])

  // Close menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const userInitial = user?.username?.[0]?.toUpperCase() || '?'

  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full flex items-center justify-between px-6 py-4 pointer-events-none">
      
      {/* Left: Logo */}
      <div className="flex items-center gap-3 w-[200px] pointer-events-auto">
        <DocIntelLogo className="w-8 h-8 text-emerald-500 shrink-0" />
        <div className={clsx(
          "transition-all duration-300 ease-in-out overflow-hidden flex flex-col justify-center",
          isScrolled ? "max-w-0 opacity-0" : "max-w-[150px] opacity-100"
        )}>
          <p className="text-xl font-bold leading-none tracking-tight whitespace-nowrap">
            <span className="text-emerald-500">Doc</span>
            <span className="text-gray-300">Intel</span>
          </p>
          <p className="text-[10px] text-gray-500 mt-1 font-medium tracking-wide uppercase whitespace-nowrap">RAG Platform</p>
        </div>
      </div>

      {/* Center: Oval Navigation */}
      <nav className="flex items-center gap-1.5 bg-[#0a0a0a] border border-[#1a1a1a] rounded-full p-1.5 shadow-sm pointer-events-auto">
        {(user?.username === 'admin' ? [...NAV, ADMIN_NAV] : NAV).map(({ to, icon: Icon, label }) => {
          const active = to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              className={clsx(
                'group flex items-center h-10 rounded-full transition-all duration-300 ease-in-out overflow-hidden',
                active 
                  ? 'bg-emerald-500/10 text-emerald-400 px-4' 
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#141414] px-3'
              )}
              title={label}
            >
              <Icon size={18} className="shrink-0" />
              <span 
                className={clsx(
                  'whitespace-nowrap font-medium text-sm transition-all duration-300',
                  active
                    ? 'max-w-[120px] opacity-100 ml-2'
                    : 'max-w-0 opacity-0 group-hover:max-w-[120px] group-hover:opacity-100 group-hover:ml-2'
                )}
              >
                {label}
              </span>
            </NavLink>
          )
        })}
      </nav>

      {/* Right: User Profile */}
      <div className="w-[200px] flex justify-end pointer-events-auto" ref={userMenuRef}>
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-9 h-9 rounded-full bg-[#0a0a0a] border border-[#1a1a1a] flex items-center justify-center text-sm font-semibold text-gray-300 cursor-pointer hover:border-emerald-500/50 transition-colors"
          >
            {userInitial}
          </button>
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#000000]" />
          
          {showUserMenu && (
            <div className="absolute top-11 right-0 z-50 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-3 w-52 shadow-2xl animate-in fade-in">
              <div className="px-2 py-1 mb-2 border-b border-[#1a1a1a] pb-3">
                <p className="text-sm text-white font-medium">{user?.username}</p>
                <p className="text-[10px] text-gray-500 truncate">{user?.email}</p>
              </div>
              <button
                onClick={() => { logout(); setShowUserMenu(false) }}
                className="w-full text-left px-2 py-2 rounded-lg text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
              >
                <LogOut size={13} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

    </header>
  )
}
