import { useEffect, useState } from "react"

interface ClueVersion {
  v: number
  title: string
  bias_corrected_summary: string
  source_credibility: { score: number; notes: string; bias_flags: string[]; origin_source: { url: string; outlet: string; is_republication: boolean } }
  relevance_score: number
  timeline_date: string
  key_points: string[]
}

interface Clue {
  id: string
  current: number
  versions: ClueVersion[]
}

export function ClueDetailSidebar({ topicId, clueId, onClose }: { topicId: string; clueId: string; onClose: () => void }) {
  const [clue, setClue] = useState<Clue | null>(null)

  useEffect(() => {
    fetch(`/api/topics/${topicId}/clues/${clueId}`)
      .then(r => r.json())
      .then(setClue)
      .catch(() => {})
  }, [topicId, clueId])

  const cur = clue?.versions.find(v => v.v === clue.current)

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="font-mono text-sm text-blue-700">{clueId}</span>
        <button className="text-gray-400 hover:text-gray-700" onClick={onClose}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!clue && <div className="text-gray-400 text-sm">Loading…</div>}
        {cur && (
          <>
            <h3 className="text-sm font-semibold text-gray-900">{cur.title}</h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{cur.timeline_date}</span>
              <span>·</span>
              <span className={`font-medium ${cur.source_credibility.score >= 80 ? "text-green-600" : cur.source_credibility.score >= 50 ? "text-yellow-600" : "text-red-600"}`}>
                credibility {cur.source_credibility.score}
              </span>
            </div>
            {cur.source_credibility.bias_flags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {cur.source_credibility.bias_flags.map(f => (
                  <span key={f} className="text-xs bg-red-50 text-red-600 border border-red-100 px-1.5 rounded">{f}</span>
                ))}
              </div>
            )}
            <p className="text-sm text-gray-700 leading-relaxed">{cur.bias_corrected_summary}</p>
            {cur.source_credibility.origin_source.outlet && (
              <p className="text-xs text-gray-400">
                Origin: <span className="font-medium">{cur.source_credibility.origin_source.outlet}</span>
                {cur.source_credibility.origin_source.is_republication && " (republication)"}
              </p>
            )}
            {cur.key_points.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Key points:</p>
                <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
                  {cur.key_points.map((kp, i) => <li key={i}>{kp}</li>)}
                </ul>
              </div>
            )}
            <p className="text-xs text-gray-400">{cur.source_credibility.notes}</p>
          </>
        )}
      </div>
    </div>
  )
}
