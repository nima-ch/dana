import { useEffect, useState, useCallback } from "react"
import { api } from "../../api/client"
import { ConfirmationBanner } from "./ConfirmationBanner"

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

const BIAS_OPTIONS = [
  "state_media", "propaganda", "selective_reporting", "unverified_source",
  "editorial_bias", "conflict_of_interest", "single_source", "outdated",
]

function credColor(score: number) {
  if (score >= 80) return "text-green-700 bg-green-50 border-green-200"
  if (score >= 50) return "text-yellow-700 bg-yellow-50 border-yellow-200"
  return "text-red-700 bg-red-50 border-red-200"
}

function ClueCard({ clue, topicId, onUpdate, onDelete, onReload }: {
  clue: Clue
  topicId: string
  onUpdate: (id: string, data: Record<string, unknown>) => void
  onDelete: (id: string) => void
  onReload: () => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(false)
  const [smartEditing, setSmartEditing] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [busy, setBusy] = useState("")
  const cur = clue.versions.find(v => v.v === clue.current)!

  const [draft, setDraft] = useState({
    credibility_score: cur.source_credibility.score,
    bias_flags: [...cur.source_credibility.bias_flags],
    relevance_score: cur.relevance_score,
    bias_corrected_summary: cur.bias_corrected_summary,
  })

  const handleSave = () => {
    onUpdate(clue.id, draft)
    setEditing(false)
  }

  const toggleBias = (flag: string) => {
    setDraft(d => ({
      ...d,
      bias_flags: d.bias_flags.includes(flag)
        ? d.bias_flags.filter(f => f !== flag)
        : [...d.bias_flags, flag],
    }))
  }

  const handleSmartEdit = async () => {
    if (!feedback.trim()) return
    setBusy("Researching...")
    try {
      await api.clues.smartEdit(topicId, clue.id, feedback)
      setFeedback("")
      setSmartEditing(false)
      onReload()
    } catch (e) {
      alert(`Smart edit failed: ${e}`)
    }
    setBusy("")
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      {busy && (
        <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded px-3 py-1.5">
          <div className="animate-spin w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full" />
          {busy}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{cur.title}</span>
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
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-xs border px-1.5 py-0.5 rounded ${credColor(cur.source_credibility.score)}`}>
            {cur.source_credibility.score}
          </span>
          <span className="text-xs text-gray-400">v{clue.current}</span>
          {!editing && (
            <button className="text-xs text-blue-400 hover:text-blue-600" onClick={() => setEditing(true)}>edit</button>
          )}
          {!editing && (
            <button className="text-xs text-purple-400 hover:text-purple-600" onClick={() => setSmartEditing(s => !s)}
              title="AI-assisted edit with feedback">smart</button>
          )}
          <button className="text-xs text-red-400 hover:text-red-600" onClick={() => onDelete(clue.id)}>✕</button>
          {clue.versions.length > 1 && (
            <button className="text-xs text-blue-500 hover:underline" onClick={() => setShowHistory(h => !h)}>
              {showHistory ? "hide" : "history"}
            </button>
          )}
        </div>
      </div>

      {/* Smart edit feedback area */}
      {smartEditing && !editing && (
        <div className="border-t border-gray-100 pt-2 space-y-2">
          <p className="text-xs text-gray-500">Describe what needs to change. The system will research and update automatically.</p>
          <textarea className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-16"
            placeholder="e.g. 'This credibility is too high, the source is known for propaganda...' or 'The date is wrong, this happened on March 10...'"
            value={feedback} onChange={e => setFeedback(e.target.value)} />
          <div className="flex gap-2">
            <button className="text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              onClick={handleSmartEdit} disabled={!!busy || !feedback.trim()}>
              {busy ? "Researching..." : "Research & Update"}
            </button>
            <button className="text-xs text-gray-400" onClick={() => { setSmartEditing(false); setFeedback("") }}>Cancel</button>
          </div>
        </div>
      )}

      {editing ? (
        <div className="space-y-3 border-t border-gray-100 pt-2">
          {/* Credibility slider */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Credibility: {draft.credibility_score}</label>
            <input type="range" min={0} max={100} value={draft.credibility_score}
              className="w-full h-1.5 accent-blue-600"
              onChange={e => setDraft(d => ({ ...d, credibility_score: parseInt(e.target.value) }))} />
          </div>
          {/* Relevance slider */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Relevance: {draft.relevance_score}</label>
            <input type="range" min={0} max={100} value={draft.relevance_score}
              className="w-full h-1.5 accent-blue-600"
              onChange={e => setDraft(d => ({ ...d, relevance_score: parseInt(e.target.value) }))} />
          </div>
          {/* Bias flags */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Bias Flags</label>
            <div className="flex gap-1 flex-wrap">
              {BIAS_OPTIONS.map(flag => (
                <button key={flag}
                  className={`text-xs px-2 py-0.5 rounded border ${draft.bias_flags.includes(flag)
                    ? "bg-red-100 text-red-700 border-red-300" : "bg-gray-50 text-gray-500 border-gray-200"}`}
                  onClick={() => toggleBias(flag)}
                >
                  {flag.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          {/* Summary edit */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Summary</label>
            <textarea className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-16"
              value={draft.bias_corrected_summary}
              onChange={e => setDraft(d => ({ ...d, bias_corrected_summary: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button className="text-xs px-3 py-1 bg-blue-600 text-white rounded" onClick={handleSave}>Save</button>
            <button className="text-xs text-gray-400" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {cur.source_credibility.bias_flags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {cur.source_credibility.bias_flags.map(f => (
                <span key={f} className="text-xs bg-red-50 text-red-600 border border-red-100 px-1.5 rounded">{f}</span>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-600 leading-relaxed">{cur.bias_corrected_summary}</p>
          {cur.source_credibility.origin_source?.outlet && (
            <p className="text-xs text-gray-400">
              Origin: {cur.source_credibility.origin_source.outlet}
              {cur.source_credibility.origin_source.is_republication && " (republication)"}
            </p>
          )}
        </>
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

// Smart bulk import modal
function BulkImportModal({ topicId, onClose, onImported }: {
  topicId: string
  onClose: () => void
  onImported: () => void
}) {
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ imported: number } | null>(null)

  const urlCount = (content.match(/https?:\/\/[^\s<>")\]]+/g) || []).length

  const handleImport = async () => {
    if (!content.trim()) return
    setLoading(true)
    try {
      const res = await api.clues.bulkImport(topicId, content)
      setResult(res)
      onImported()
    } catch {
      setResult({ imported: -1 })
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Smart Import</h3>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>✕</button>
        </div>

        <p className="text-xs text-gray-500">
          Paste any intelligence brief, news compilation, analysis, or mixed content.
          The system will extract URLs and fetch accessible sources, then extract every distinct factual claim as a structured clue with source attribution, dates, credibility, and party relevance.
        </p>

        <textarea
          className="w-full text-xs border border-gray-300 rounded px-3 py-2 h-64 font-mono"
          placeholder="Paste your intelligence brief, news articles, analysis, or mixed content with embedded URLs..."
          value={content}
          onChange={e => setContent(e.target.value)}
        />

        {content.trim() && (
          <p className="text-xs text-gray-400">
            {content.length.toLocaleString()} chars · {urlCount} URL{urlCount !== 1 ? "s" : ""} detected
          </p>
        )}

        {result && (
          <p className={`text-xs ${result.imported >= 0 ? "text-green-600" : "text-red-600"}`}>
            {result.imported >= 0 ? `Imported ${result.imported} clue(s)` : "Import failed — check content and try again"}
          </p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <div className="animate-spin w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full" />
            Processing... This may take a few minutes for large documents with many URLs.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="text-xs text-gray-400" onClick={onClose}>Close</button>
          <button
            className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={handleImport}
            disabled={loading || !content.trim()}
          >
            {loading ? "Extracting..." : "Extract Clues"}
          </button>
        </div>
      </div>
    </div>
  )
}

interface CluesPanelProps {
  topicId: string
  status: string
  onApprove?: () => void
  onReanalyze?: () => void
  approveLoading?: boolean
}

export function CluesPanel({ topicId, status, onApprove, onReanalyze, approveLoading }: CluesPanelProps) {
  const [clues, setClues] = useState<Clue[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ party: "", domain: "", type: "" })
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [researchQuery, setResearchQuery] = useState("")
  const [researching, setResearching] = useState(false)
  const [researchResult, setResearchResult] = useState<{ imported: number; query: string } | null>(null)

  const reviewMode = status === "review_enrichment"

  const load = useCallback(() => {
    api.clues.list(topicId)
      .then(d => { setClues(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [topicId])

  useEffect(load, [load])

  const handleUpdate = async (id: string, data: Record<string, unknown>) => {
    const updated = await api.clues.update(topicId, id, data)
    setClues(cs => cs.map(c => c.id === id ? updated : c))
  }

  const handleDelete = async (id: string) => {
    await api.clues.delete(topicId, id)
    setClues(cs => cs.filter(c => c.id !== id))
  }

  const handleResearch = async () => {
    if (!researchQuery.trim()) return
    setResearching(true)
    setResearchResult(null)
    try {
      const res = await api.clues.research(topicId, researchQuery.trim())
      setResearchResult({ imported: res.imported, query: res.query })
      setResearchQuery("")
      load()
    } catch {
      setResearchResult({ imported: -1, query: researchQuery })
    }
    setResearching(false)
  }

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

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">Loading clues...</div>

  return (
    <div className="space-y-4">
      {reviewMode && onApprove && (
        <ConfirmationBanner
          message={`${clues.length} clues gathered. Review, edit, or add more before running the forum.`}
          detail="Adjust credibility scores, flag biases, import additional sources, or remove irrelevant clues."
          actionLabel="Approve & Run Analysis"
          onConfirm={onApprove}
          loading={approveLoading}
        />
      )}
      {!["draft", "review_parties"].includes(status) && onReanalyze && (
        <ConfirmationBanner
          message={`${clues.length} clues available. You can run a fresh analysis with the current data.`}
          detail="This will create a new forum session, expert council, and verdict. Previous analysis is preserved."
          actionLabel="Re-analyze with Current Data"
          onConfirm={onReanalyze}
          loading={approveLoading}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Clues ({filtered.length})</h2>
        <button
          className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          onClick={() => setShowBulkImport(true)}
        >
          + Bulk Import
        </button>
      </div>

      {/* Research bar */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-500 shrink-0">Research:</span>
          <input
            className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 bg-white"
            placeholder="e.g. 'degradation of Iran missile capability after strikes' or 'fate of new supreme leader Mojtaba Khamenei'..."
            value={researchQuery}
            onChange={e => setResearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleResearch()}
            disabled={researching}
          />
          <button
            className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 shrink-0"
            onClick={handleResearch}
            disabled={researching || !researchQuery.trim()}
          >
            {researching ? "Searching..." : "Find Clues"}
          </button>
        </div>
        {researching && (
          <div className="flex items-center gap-2 text-xs text-green-600 mt-1.5">
            <div className="animate-spin w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full" />
            Searching the web and extracting clues...
          </div>
        )}
        {researchResult && (
          <p className={`text-xs mt-1.5 ${researchResult.imported >= 0 ? "text-green-600" : "text-red-600"}`}>
            {researchResult.imported >= 0
              ? `Found ${researchResult.imported} clue(s) for "${researchResult.query}"`
              : "Research failed — try rephrasing"}
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select className="text-xs border border-gray-200 rounded px-2 py-1" value={filter.party}
          onChange={e => setFilter(f => ({ ...f, party: e.target.value }))}>
          <option value="">All parties</option>
          {allParties.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="text-xs border border-gray-200 rounded px-2 py-1" value={filter.domain}
          onChange={e => setFilter(f => ({ ...f, domain: e.target.value }))}>
          <option value="">All domains</option>
          {allDomains.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="text-xs border border-gray-200 rounded px-2 py-1" value={filter.type}
          onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}>
          <option value="">All types</option>
          {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(filter.party || filter.domain || filter.type) && (
          <button className="text-xs text-gray-400 hover:text-gray-600"
            onClick={() => setFilter({ party: "", domain: "", type: "" })}>
            clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-gray-400 text-sm text-center py-8">No clues match the current filters.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(clue => (
            <ClueCard key={clue.id} clue={clue} topicId={topicId} onUpdate={handleUpdate} onDelete={handleDelete} onReload={load} />
          ))}
        </div>
      )}

      {showBulkImport && (
        <BulkImportModal
          topicId={topicId}
          onClose={() => setShowBulkImport(false)}
          onImported={load}
        />
      )}
    </div>
  )
}
