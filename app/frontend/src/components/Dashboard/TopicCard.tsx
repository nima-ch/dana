import { useNavigate } from "react-router-dom"
import type { Topic } from "../../api/client"
import { StatusBadge } from "./StatusBadge"

export function TopicCard({ topic, onDelete }: { topic: Topic; onDelete: (id: string) => void }) {
  const navigate = useNavigate()
  const date = new Date(topic.updated_at).toLocaleDateString()

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => navigate(`/topic/${topic.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2">{topic.title}</h3>
        <StatusBadge status={topic.status} />
      </div>

      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{topic.description}</p>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>v{topic.current_version} · {date}</span>
        <button
          className="text-red-400 hover:text-red-600"
          onClick={e => { e.stopPropagation(); onDelete(topic.id) }}
        >
          delete
        </button>
      </div>
    </div>
  )
}
