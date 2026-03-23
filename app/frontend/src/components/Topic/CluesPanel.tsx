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
    setResult(null)
    try {
      await api.clues.bulkImportStart(topicId, content)
      // Poll for completion
      for (let i = 0; i < 240; i++) { // up to 20 minutes
        await new Promise(r => setTimeout(r, 5000))
        const res = await api.clues.bulkImportStatus(topicId)
        if (res.status === "done") {
          setResult({ imported: res.imported ?? 0 })
          onImported()
          setLoading(false)
          return
        }
        if (res.status === "error") {
          setResult({ imported: -1 })
          setLoading(false)
          return
        }
      }
      setResult({ imported: -1 })
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

  // Cleanup & Categorize
  const [cleanupGroups, setCleanupGroups] = useState<any[] | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<{ merged: number; deleted: number; final_count: number } | null>(null)

  const handleCleanupPropose = async () => {
    setCleanupBusy(true)
    setCleanupResult(null)
    try {
      await api.clues.cleanupStart(topicId)
      // Poll for results
      const poll = async () => {
        for (let i = 0; i < 120; i++) { // up to 10 minutes
          await new Promise(r => setTimeout(r, 5000))
          const res = await api.clues.cleanupStatus(topicId)
          if (res.status === "done" && res.groups) {
            setCleanupGroups(res.groups)
            setCleanupBusy(false)
            return
          }
          if (res.status === "error") {
            setCleanupBusy(false)
            return
          }
        }
        setCleanupBusy(false)
      }
      poll()
    } catch {
      setCleanupBusy(false)
    }
  }

  const handleCleanupApply = async (groups: any[]) => {
    setCleanupBusy(true)
    try {
      const res = await api.clues.cleanupApply(topicId, groups)
      setCleanupResult(res)
      setCleanupGroups(null)
      load()
    } catch { /* */ }
    setCleanupBusy(false)
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
        <div className="flex gap-2">
          {clues.length >= 10 && (
            <button
              className="text-xs px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
              onClick={handleCleanupPropose}
              disabled={cleanupBusy}
            >
              {cleanupBusy ? "Analyzing..." : "Cleanup & Categorize"}
            </button>
          )}
          <button
            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => setShowBulkImport(true)}
          >
            + Bulk Import
          </button>
        </div>
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

      {cleanupResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
          Cleanup complete: {cleanupResult.merged} merged, {cleanupResult.deleted} removed. {cleanupResult.final_count} clues remaining.
          <button className="text-xs text-green-600 underline ml-2" onClick={() => setCleanupResult(null)}>dismiss</button>
        </div>
      )}

      {cleanupGroups && (
        <CleanupReviewModal
          groups={cleanupGroups}
          onApply={handleCleanupApply}
          onCancel={() => setCleanupGroups(null)}
          loading={cleanupBusy}
        />
      )}
    </div>
  )
}

const CATEGORY_COLORS: Record<string, string> = {
  military_operations: "bg-red-100 text-red-700",
  nuclear_program: "bg-orange-100 text-orange-700",
  protest_movement: "bg-green-100 text-green-700",
  leadership_succession: "bg-purple-100 text-purple-700",
  international_response: "bg-blue-100 text-blue-700",
  economic_impact: "bg-yellow-100 text-yellow-700",
  intelligence: "bg-gray-100 text-gray-700",
  diplomatic: "bg-cyan-100 text-cyan-700",
  internal_politics: "bg-pink-100 text-pink-700",
}

function CleanupReviewModal({ groups, onApply, onCancel, loading }: {
  groups: any[]
  onApply: (groups: any[]) => void
  onCancel: () => void
  loading: boolean
}) {
  const [editedGroups, setEditedGroups] = useState(groups)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const mergeGroups = editedGroups.filter(g => g.action === "merge")
  const keepGroups = editedGroups.filter(g => g.action === "keep")
  const deleteGroups = editedGroups.filter(g => g.action === "delete")
  const totalSource = editedGroups.reduce((s: number, g: any) => s + (g.source_clue_ids?.length || 0), 0)
  const resultCount = mergeGroups.length + keepGroups.length

  const toggleAction = (groupId: string) => {
    setEditedGroups(gs => gs.map(g => {
      if (g.group_id !== groupId) return g
      const next = g.action === "merge" ? "keep" : g.action === "keep" ? "delete" : "merge"
      return { ...g, action: next }
    }))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Cleanup & Categorize</h3>
          <p className="text-xs text-gray-500 mt-1">
            {totalSource} clues → {resultCount} after cleanup ({mergeGroups.length} merged, {keepGroups.length} kept, {deleteGroups.reduce((s: number, g: any) => s + (g.source_clue_ids?.length || 0), 0)} removed)
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {/* Merge groups first */}
          {mergeGroups.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Merge ({mergeGroups.length})</h4>
              {mergeGroups.map(g => (
                <GroupCard key={g.group_id} group={g} expanded={expandedGroup === g.group_id}
                  onToggle={() => setExpandedGroup(e => e === g.group_id ? null : g.group_id)}
                  onChangeAction={() => toggleAction(g.group_id)} />
              ))}
            </div>
          )}

          {keepGroups.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Keep as-is ({keepGroups.length})</h4>
              {keepGroups.map(g => (
                <GroupCard key={g.group_id} group={g} expanded={expandedGroup === g.group_id}
                  onToggle={() => setExpandedGroup(e => e === g.group_id ? null : g.group_id)}
                  onChangeAction={() => toggleAction(g.group_id)} />
              ))}
            </div>
          )}

          {deleteGroups.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Delete ({deleteGroups.reduce((s: number, g: any) => s + (g.source_clue_ids?.length || 0), 0)} clues)</h4>
              {deleteGroups.map(g => (
                <GroupCard key={g.group_id} group={g} expanded={expandedGroup === g.group_id}
                  onToggle={() => setExpandedGroup(e => e === g.group_id ? null : g.group_id)}
                  onChangeAction={() => toggleAction(g.group_id)} />
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-between items-center">
          <span className="text-xs text-gray-400">Click action badges to change merge/keep/delete</span>
          <div className="flex gap-2">
            <button className="text-xs px-4 py-1.5 text-gray-500 hover:text-gray-700" onClick={onCancel}>Cancel</button>
            <button className="text-xs px-4 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              onClick={() => onApply(editedGroups)} disabled={loading}>
              {loading ? "Applying..." : `Apply Cleanup (${totalSource} → ${resultCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function GroupCard({ group, expanded, onToggle, onChangeAction }: {
  group: any; expanded: boolean; onToggle: () => void; onChangeAction: () => void
}) {
  const catColor = CATEGORY_COLORS[group.category] || "bg-gray-100 text-gray-700"
  const actionColor = group.action === "merge" ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
    : group.action === "keep" ? "bg-green-100 text-green-700 hover:bg-green-200"
    : "bg-red-100 text-red-700 hover:bg-red-200"

  return (
    <div className="border border-gray-200 rounded-lg mb-1.5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <button className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${actionColor}`}
          onClick={e => { e.stopPropagation(); onChangeAction() }}>
          {group.action}
        </button>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${catColor}`}>{group.category}</span>
        <span className="text-xs text-gray-800 flex-1 truncate font-medium">{group.merged_title}</span>
        <span className="text-[10px] text-gray-400 shrink-0">{group.source_clue_ids?.length || 0} clues</span>
        <span className="text-gray-300 text-xs">{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-gray-50 border-t border-gray-100 space-y-2">
          <p className="text-xs text-gray-700 leading-relaxed">{group.merged_summary}</p>
          <div className="flex flex-wrap gap-1">
            {(group.source_clue_ids || []).map((id: string) => (
              <span key={id} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-mono">{id}</span>
            ))}
          </div>
          {group.reason && <p className="text-[10px] text-gray-400 italic">{group.reason}</p>}
          <div className="flex gap-2 text-[10px] text-gray-400">
            <span>cred: {group.merged_credibility}</span>
            <span>rel: {group.merged_relevance}</span>
            <span>{group.merged_date}</span>
            {(group.merged_parties || []).length > 0 && <span>parties: {group.merged_parties.join(", ")}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
