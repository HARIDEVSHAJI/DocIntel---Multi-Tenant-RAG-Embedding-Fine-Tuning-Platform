import { useState } from 'react'
import { runEvaluation } from '../api/client'
import { PageHeader, DropZone, StatCard, Spinner } from '../components/ui'
import { BarChart2 } from 'lucide-react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from 'recharts'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const METRIC_COLORS = {
  faithfulness:      '#f97316',
  answer_relevancy:  '#22c55e',
  context_precision: '#3b82f6',
  answer_similarity: '#a855f7',
}

const METRIC_LABELS = {
  faithfulness:      'Faithfulness',
  answer_relevancy:  'Answer Relevancy',
  context_precision: 'Context Precision',
  answer_similarity: 'Answer Similarity',
}

function ScoreCell({ value }) {
  const pct = Math.round((value || 0) * 100)
  const color = pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400'
  return <span className={clsx('font-mono font-semibold text-xs', color)}>{pct}%</span>
}

export default function Evaluation() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const onFiles = (f) => { setFile(f[0]); setResult(null) }

  const handleEval = async () => {
    if (!file) return toast.error('Upload an evaluation CSV first.')
    setLoading(true)
    try {
      const data = await runEvaluation(file)
      setResult(data)
      toast.success(`Evaluated ${data.total} questions successfully!`)
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }

  const radarData = result?.aggregated
    ? Object.entries(result.aggregated).map(([key, val]) => ({
        metric: METRIC_LABELS[key] || key,
        value: Math.round(val * 100),
        fullMark: 100,
      }))
    : []

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Evaluation"
        subtitle="Batch evaluation across 4 metrics: faithfulness, relevancy, precision, similarity"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Upload */}
        <div className="card p-5 space-y-4">
          <div>
            <p className="label">Evaluation CSV</p>
            <DropZone
              onFiles={onFiles}
              accept=".csv"
              multiple={false}
              label={file ? file.name : 'Drop CSV here'}
              sublabel="Columns: question, ground_truth"
            />
          </div>
          <button
            onClick={handleEval}
            disabled={loading || !file}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading ? <><Spinner size={14} />Evaluating…</> : '▶ Run Evaluation'}
          </button>
          <div className="card p-4 space-y-2">
            <p className="section-title">Metrics Explained</p>
            {Object.entries(METRIC_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full mt-1 shrink-0"
                     style={{ background: METRIC_COLORS[key] }} />
                <div>
                  <p className="text-xs font-medium text-gray-300">{label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Radar chart */}
        <div className="md:col-span-2 card p-5">
          <p className="section-title">RAG Metrics Radar</p>
          {radarData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#2a2a2a" />
                  <PolarAngleAxis
                    dataKey="metric"
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                  />
                  <PolarRadiusAxis
                    angle={90} domain={[0, 100]}
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    tickCount={5}
                  />
                  <Radar
                    dataKey="value"
                    stroke="#f97316"
                    fill="#f97316"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#1a1a1a', border: '1px solid #2a2a2a',
                      borderRadius: 8, fontSize: 12,
                    }}
                    formatter={(v) => [`${v}%`, 'Score']}
                  />
                </RadarChart>
              </ResponsiveContainer>

              {/* Aggregated stat cards */}
              <div className="grid grid-cols-2 gap-3 mt-2">
                {Object.entries(result.aggregated).map(([key, val]) => (
                  <div key={key} className="bg-[#0f0f0f] rounded-lg p-3 flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0"
                         style={{ background: METRIC_COLORS[key] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-gray-500 truncate">{METRIC_LABELS[key]}</p>
                    </div>
                    <p className="text-sm font-bold font-mono"
                       style={{ color: METRIC_COLORS[key] }}>
                      {(val * 100).toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-60 flex flex-col items-center justify-center">
              <BarChart2 size={32} className="text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Radar chart appears after evaluation</p>
              <p className="text-xs text-gray-700 mt-1">Upload a CSV and click Run Evaluation</p>
            </div>
          )}
        </div>
      </div>

      {/* Per-question table */}
      {result?.per_sample?.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[#2a2a2a]">
            <p className="section-title mb-0">
              Per-Question Results ({result.total} questions)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e1e]">
                  {['#', 'Question', 'Generated Answer', 'Faith.', 'Relevancy', 'Precision', 'Similarity'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold
                                           uppercase tracking-wider text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.per_sample.map((row, i) => (
                  <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-3 text-gray-600">{i + 1}</td>
                    <td className="px-4 py-3 text-gray-300 max-w-[200px]">
                      <p className="truncate" title={row.question}>{row.question}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-[220px]">
                      <p className="truncate" title={row.generated_answer}>{row.generated_answer}</p>
                    </td>
                    <td className="px-4 py-3"><ScoreCell value={row.faithfulness} /></td>
                    <td className="px-4 py-3"><ScoreCell value={row.answer_relevancy} /></td>
                    <td className="px-4 py-3"><ScoreCell value={row.context_precision} /></td>
                    <td className="px-4 py-3"><ScoreCell value={row.answer_similarity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
