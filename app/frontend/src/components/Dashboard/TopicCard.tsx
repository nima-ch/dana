import { useNavigate } from "react-router-dom"
import type { Topic } from "../../api/client"

const STATUS_LEFT_BORDER: Record<string, string> = {
  draft:             "border-l-gray-300",
  discovery:         "border-l-blue-400",
  review_parties:    "border-l-amber-400",
  enrichment:        "border-l-indigo-400",
  review_enrichment: "border-l-amber-400",
  forum:             "border-l-blue-500",
  expert_council:    "border-l-purple-500",
  verdict:           "border-l-orange-400",
  complete:          "border-l-green-500",
  stale:             "border-l-red-400",
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  discovery: "Discovering…",
  review_parties: "Review parties",
  enrichment: "Enriching…",
  review_enrichment: "Review clues",
  forum: "Forum running…",
  expert_council: "Expert council…",
  verdict: "Verdict…",
  complete: "Complete",
  stale: "Stale",
}

const STATUS_DOT: Record<string, string> = {
  discovery: "bg-blue-400 animate-pulse",
  enrichment: "bg-indigo-400 animate-pulse",
  forum: "bg-blue-500 animate-pulse",
  expert_council: "bg-purple-500 animate-pulse",
  verdict: "bg-orange-400 animate-pulse",
  review_parties: "bg-amber-400",
  review_enrichment: "bg-amber-400",
  complete: "bg-green-500",
  stale: "bg-red-400",
  draft: "bg-gray-300",
}

export function TopicCard({ topic, onDelete }: { topic: Topic; onDelete: (id: string) => void }) {
  const navigate = useNavigate()
  const date = new Date(topic.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  const borderClass = STATUS_LEFT_BORDER[topic.status] ?? "border-l-gray-300"
  const dotClass = STATUS_DOT[topic.status] ?? "bg-gray-300"
  const label = STATUS_LABELS[topic.status] ?? topic.status

  return (
    <div
      className={`group bg-white rounded-xl border border-gray-200 border-l-4 ${borderClass} p-5 hover:shadow-lg hover:scale-[1.01] transition-all duration-150 cursor-pointer flex flex-col gap-3`}
      onClick={() => navigate(`/topic/${topic.id}`)}
    >
      {/* Title + status */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 flex-1">{topic.title}</h3>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
          <span className="text-[10px] text-gray-500 whitespace-nowrap">{label}</span>
        </div>
      </div>

      {/* Description */}
      {topic.description && (
        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{topic.description}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1 border-t border-gray-50">
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <span className="font-mono">v{topic.current_version}</span>
          <span>·</span>
          <span>{date}</span>
        </div>
        <button
          className="text-[10px] text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => { e.stopPropagation(); onDelete(topic.id) }}
        >
          delete
        </button>
      </div>
    </div>
  )
}
