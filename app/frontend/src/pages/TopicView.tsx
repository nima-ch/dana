import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api, type Topic } from "../api/client"
import { StatusBadge } from "../components/Dashboard/StatusBadge"

type Stage = "discovery" | "enrichment" | "forum" | "expert_council" | "verdict"

const STAGES: { key: Stage; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "enrichment", label: "Enrichment" },
  { key: "forum", label: "Forum" },
  { key: "expert_council", label: "Expert Council" },
  { key: "verdict", label: "Verdict" },
]

const STAGE_ORDER: Stage[] = ["discovery", "enrichment", "forum", "expert_council", "verdict"]

function stageIndex(status: string): number {
  const idx = STAGE_ORDER.indexOf(status as Stage)
  if (status === "complete" || status === "stale") return STAGE_ORDER.length
  return idx
}

export function TopicView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [topic, setTopic] = useState<Topic | null>(null)
  const [activeStage, setActiveStage] = useState<Stage>("discovery")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!id) return
    api.topics.get(id)
      .then(t => { setTopic(t); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [id])

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400 text-sm">Loading…</div>
  if (error || !topic) return (
    <div className="flex items-center justify-center h-screen text-red-500 text-sm">
      {error || "Topic not found"}
    </div>
  )

  const currentStageIdx = stageIndex(topic.status)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button
          className="text-gray-400 hover:text-gray-700 text-sm"
          onClick={() => navigate("/")}
        >
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-900 text-sm truncate">{topic.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">v{topic.current_version}</span>
          <StatusBadge status={topic.status} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — stage navigator */}
        <aside className="w-48 bg-white border-r border-gray-200 flex flex-col py-4 shrink-0">
          <nav className="space-y-1 px-3">
            {STAGES.map((stage, idx) => {
              const isComplete = idx < currentStageIdx
              const isActive = activeStage === stage.key
              const isAccessible = idx <= currentStageIdx

              return (
                <button
                  key={stage.key}
                  onClick={() => isAccessible && setActiveStage(stage.key)}
                  data-stage={stage.key}
                  className={[
                    "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
                    isActive ? "bg-blue-50 text-blue-700 font-medium" : "",
                    !isActive && isAccessible ? "text-gray-700 hover:bg-gray-50" : "",
                    !isAccessible ? "text-gray-300 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  <span className={[
                    "w-2 h-2 rounded-full shrink-0",
                    isComplete ? "bg-green-500" : isActive ? "bg-blue-500" : "bg-gray-200",
                  ].join(" ")} />
                  {stage.label}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main content area */}
        <main className="flex-1 overflow-auto p-6">
          <div className="text-gray-400 text-sm text-center py-12">
            {activeStage} panel — coming soon
          </div>
        </main>
      </div>
    </div>
  )
}
