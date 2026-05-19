import clsx from 'clsx'

// ── Stat card (like the dashboard sample) ─────────────────────────────────────
export function StatCard({ label, value, sub, accent = 'emerald', icon: Icon }) {
  const accents = {
    emerald: 'border-t-emerald-500 text-emerald-400',
    green:  'border-t-green-500  text-green-400',
    red:    'border-t-red-500    text-red-400',
    blue:   'border-t-blue-500   text-blue-400',
    purple: 'border-t-purple-500 text-purple-400',
  }
  return (
    <div className={clsx(
      'card p-5 border-t-2',
      accents[accent] || accents.emerald
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 mb-2">
            {label}
          </p>
          <p className={clsx('text-3xl font-bold leading-none', accents[accent])}>
            {value}
          </p>
          {sub && <p className="text-xs text-gray-500 mt-2">{sub}</p>}
        </div>
        {Icon && (
          <div className={clsx(
            'w-9 h-9 rounded-lg flex items-center justify-center opacity-20',
            `bg-current`
          )}>
            <Icon size={18} className={accents[accent].split(' ')[1]} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page header ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

// ── Loading spinner ────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }) {
  return (
    <svg
      className="animate-spin text-emerald-400"
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && <Icon size={32} className="text-gray-600 mb-3" />}
      <p className="text-sm font-medium text-gray-400">{title}</p>
      {description && <p className="text-xs text-gray-600 mt-1 max-w-xs">{description}</p>}
    </div>
  )
}

// ── Faithfulness badge ─────────────────────────────────────────────────────────
export function FaithfulnessBadge({ score }) {
  if (score == null) return null
  if (score >= 0.65) return <span className="badge-green">🟢 High Faithfulness {(score * 100).toFixed(0)}%</span>
  if (score >= 0.35) return <span className="badge-yellow">🟡 Medium Faithfulness {(score * 100).toFixed(0)}%</span>
  return <span className="badge-red">🔴 Low Faithfulness {(score * 100).toFixed(0)}%</span>
}

// ── Progress bar ───────────────────────────────────────────────────────────────
export function ProgressBar({ value = 0, label }) {
  return (
    <div className="space-y-1.5">
      {label && <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span>{(value * 100).toFixed(0)}%</span>
      </div>}
      <div className="h-1.5 bg-[#222] rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
    </div>
  )
}

// ── File drop zone ─────────────────────────────────────────────────────────────
export function DropZone({ onFiles, accept = '.pdf,.txt', multiple = true, label, sublabel }) {
  const handleChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) onFiles(files)
  }
  return (
    <label className="block w-full cursor-pointer">
      <div className="border-2 border-dashed border-[#2a2a2a] hover:border-emerald-500/40
                      rounded-xl p-8 text-center transition-colors duration-200
                      hover:bg-emerald-500/5">
        <div className="text-3xl mb-2">📂</div>
        <p className="text-sm font-medium text-gray-300">{label || 'Drop files here or click to browse'}</p>
        {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
        <input type="file" className="hidden" accept={accept} multiple={multiple} onChange={handleChange} />
      </div>
    </label>
  )
}
