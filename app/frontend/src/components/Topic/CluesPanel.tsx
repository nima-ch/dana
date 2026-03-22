import { useEffect, useState } from "react"

interface ClueVersion {
  v: number
  title: string
  timeline_date: string
  party_relevance: string[]
  domain_tags: string[]
  bias_corrected_summary: string
  relevance_score: number
  clue_type: string
  source_credibility: {
    score: number
    notes: string
    bias_flags: string[]
    origin_source: { url: string; outlet: string; is_republication: boolean }
  }
  key_points: string[]
}

interface Clue {
  id: string
  current: number
  added_by: string
  status: string
  versions: ClueVersion[]
}

function credColor(score: number) {
  if (score >= 80) return "text-green-700 bg-green-50 border-green-200"
  if (score >= 50) return "text-yellow-700 bg-yellow-50 border-yellow-200"
  return "text-red-700 bg-red-50 border-red-200"
}

function ClueCard({ clue, diffVersion }: { clue: Clue; diffVersion?: number }) {
  const [showHistory, setShowHistory] = useState(false)
  const cur = clue.versions.find(v => v.v === clue.current)!
  const isNew = diffVersion !== undefined && !clue.versions.some(v => v.v <= (diffVersion ?? 0))
  const isUpdated = diffVersion !== undefined && !isNew && clue.current > (diffVersion ?? 0)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{cur.title}</span>
            {isNew && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 rounded">New</span>}
            {isUpdated && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 rounded">Updated</span>}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-gray-400">{cur.timeline_date}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500">{cur.clue_type}</span>
            {cur.party_relevance.map(p => (
              <span key={p} className="text-xs bg-gray-100 text-gray-600 px-1.5 rounded">{p}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs border px-1.5 py-0.5 rounded ${credColor(cur.source_credibility.score)}`}>
            {cur.source_credibility.score}
          </span>
          <span className="text-xs text-gray-400">v{clue.current}</span>
          {clue.versions.length > 1 && (
            <button
              className="text-xs text-blue-500 hover:underline"
              onClick={() => setShowHistory(h => !h)}
            >
              {showHistory ? "hide" : "history"}
            </button>
          )}
        </div>
      </div>

      {cur.source_credibility.bias_flags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {cur.source_credibility.bias_flags.map(f => (
            <span key={f} className="text-xs bg-red-50 text-red-600 border border-red-100 px-1.5 rounded">{f}</span>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-600 leading-relaxed">{cur.bias_corrected_summary}</p>

      {cur.source_credibility.origin_source.outlet && (
        <p className="text-xs text-gray-400">
          Origin: {cur.source_credibility.origin_source.outlet}
          {cur.source_credibility.origin_source.is_republication && " (republication)"}
        </p>
      )}

      {showHistory && (
        <div className="border-t border-gray-100 pt-2 space-y-2">
          {clue.versions.map(v => (
            <div key={v.v} className="text-xs text-gray-500">
              <span className="font-medium">v{v.v}</span> · {v.timeline_date} · {v.title}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CluesPanel({ topicId }: { topicId: string }) {
  const [clues, setClues] = useState<Clue[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ party: "", domain: "", type: "" })

  useEffect(() => {
    fetch(`/api/topics/${topicId}/clues`)
      .then(r => r.json())
      .then(d => { setClues(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [topicId])

  const filtered = clues.filter(clue => {
    const cur = clue.versions.find(v => v.v === clue.current)!
    if (filter.party && !cur.party_relevance.includes(filter.party)) return false
    if (filter.domain && !cur.domain_tags.includes(filter.domain)) return false
    if (filter.type && cur.clue_type !== filter.type) return false
    return true
  })

  const allParties = [...new Set(clues.flatMap(c => c.versions.find(v => v.v === c.current)?.party_relevance ?? []))]
  const allDomains = [...new Set(clues.flatMap(c => c.versions.find(v => v.v === c.current)?.domain_tags ?? []))]
  const allTypes = [...new Set(clues.map(c => c.versions.find(v => v.v === c.current)?.clue_type ?? ""))]

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">Loading clues…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Clues ({filtered.length})</h2>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select
          className="text-xs border border-gray-200 rounded px-2 py-1"
          value={filter.party}
          onChange={e => setFilter(f => ({ ...f, party: e.target.value }))}
        >
          <option value="">All parties</option>
          {allParties.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          className="text-xs border border-gray-200 rounded px-2 py-1"
          value={filter.domain}
          onChange={e => setFilter(f => ({ ...f, domain: e.target.value }))}
        >
          <option value="">All domains</option>
          {allDomains.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          className="text-xs border border-gray-200 rounded px-2 py-1"
          value={filter.type}
          onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}
        >
          <option value="">All types</option>
          {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(filter.party || filter.domain || filter.type) && (
          <button
            className="text-xs text-gray-400 hover:text-gray-600"
            onClick={() => setFilter({ party: "", domain: "", type: "" })}
          >
            clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-gray-400 text-sm text-center py-8">No clues match the current filters.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(clue => <ClueCard key={clue.id} clue={clue} />)}
        </div>
      )}
    </div>
  )
}
