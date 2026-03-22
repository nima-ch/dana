import { useEffect, useState, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api, type Topic } from "../api/client"
import { useSSE, type SSEEvent } from "../hooks/useSSE"
import { StatusBadge } from "../components/Dashboard/StatusBadge"
import { CluesPanel } from "../components/Topic/CluesPanel"
import { PartiesPanel } from "../components/Topic/PartiesPanel"
import { StalenessBanner } from "../components/Topic/StalenessBanner"
import { ConversationView } from "../components/Forum/ConversationView"
import { ExpertCouncilPanel } from "../components/Expert/ExpertCouncilPanel"
import { VerdictPanel } from "../components/Expert/VerdictPanel"
import { SettingsPanel } from "../components/Topic/SettingsPanel"

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
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [progressMsg, setProgressMsg] = useState("")
  const [liveStage, setLiveStage] = useState<string | null>(null)
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set())
  const [states, setStates] = useState<{ version: number; label: string; created_at: string; trigger: string }[]>([])
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const refreshTopic = useCallback(() => {
    if (!id) return
    api.topics.get(id).then(setTopic).catch(() => {})
    fetch(`/api/topics/${id}/states`)
      .then(r => r.json())
      .then((s: any[]) => setStates(s))
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (!id) return
    api.topics.get(id)
      .then(t => { setTopic(t); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })

    // Check if pipeline is already running
    api.pipeline.status(id).then(s => {
      if (s.running) setPipelineRunning(true)
    }).catch(() => {})

    // Load states for version picker
    fetch(`/api/topics/${id}/states`)
      .then(r => r.json())
      .then((s: any[]) => setStates(s))
      .catch(() => {})
  }, [id])

  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type === "progress") {
      setProgressMsg(event.msg)
      setLiveStage(event.stage)
    } else if (event.type === "stage_complete") {
      setCompletedStages(prev => new Set([...prev, event.stage]))
      if (event.stage === "verdict") {
        setPipelineRunning(false)
        setProgressMsg("")
        setLiveStage(null)
        refreshTopic()
      } else {
        refreshTopic()
      }
    } else if (event.type === "error") {
      setPipelineRunning(false)
      setProgressMsg(`Error: ${event.message}`)
      setLiveStage(null)
      refreshTopic()
    }
  }, [refreshTopic])

  useSSE(pipelineRunning ? id ?? null : null, handleSSE)

  const handleRunAnalysis = async () => {
    if (!id) return
    try {
      setPipelineRunning(true)
      setCompletedStages(new Set())
      setProgressMsg("Starting pipeline...")
      await api.pipeline.run(id)
    } catch (e) {
      setPipelineRunning(false)
      setProgressMsg(`Failed to start: ${e}`)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400 text-sm">Loading...</div>
  if (error || !topic) return (
    <div className="flex items-center justify-center h-screen text-red-500 text-sm">
      {error || "Topic not found"}
    </div>
  )

  const currentStageIdx = stageIndex(topic.status)
  const canRun = topic.status === "draft" || topic.status === "complete"

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button
          className="text-gray-400 hover:text-gray-700 text-sm"
          onClick={() => navigate("/")}
        >
          &#8592; Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-900 text-sm truncate">{topic.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          {states.length > 1 && (
            <select
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700"
              value={selectedVersion ?? topic.current_version}
              onChange={e => setSelectedVersion(parseInt(e.target.value))}
            >
              {states.map(s => (
                <option key={s.version} value={s.version}>
                  v{s.version} — {s.label} ({new Date(s.created_at).toLocaleDateString()})
                </option>
              ))}
            </select>
          )}
          {states.length <= 1 && (
            <span className="text-xs text-gray-400">v{topic.current_version}</span>
          )}
          <StatusBadge status={topic.status} />
          {canRun && !pipelineRunning && (
            <button
              onClick={handleRunAnalysis}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Run Analysis
            </button>
          )}
          {topic.status === "stale" && !pipelineRunning && (
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Updates available" />
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="text-gray-400 hover:text-gray-600 text-sm"
            title="Settings"
          >
            &#9881;
          </button>
        </div>
      </header>

      {/* Pipeline progress bar */}
      {pipelineRunning && (
        <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 flex items-center gap-3">
          <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
          <span className="text-xs text-blue-700 flex-1 truncate">{progressMsg}</span>
          <div className="flex gap-1">
            {STAGES.map(s => (
              <div
                key={s.key}
                className={[
                  "w-6 h-1.5 rounded-full transition-colors",
                  completedStages.has(s.key) ? "bg-green-500" :
                  liveStage === s.key ? "bg-blue-500 animate-pulse" :
                  "bg-gray-200"
                ].join(" ")}
                title={s.label}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — stage navigator */}
        <aside className="w-48 bg-white border-r border-gray-200 flex flex-col py-4 shrink-0">
          <nav className="space-y-1 px-3">
            {STAGES.map((stage, idx) => {
              const isComplete = idx < currentStageIdx || completedStages.has(stage.key)
              const isActive = activeStage === stage.key
              const isLive = liveStage === stage.key
              const isAccessible = idx <= currentStageIdx || isComplete

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
                    isComplete ? "bg-green-500" :
                    isLive ? "bg-blue-500 animate-pulse" :
                    isActive ? "bg-blue-500" :
                    "bg-gray-200",
                  ].join(" ")} />
                  {stage.label}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main content area */}
        <main className="flex-1 overflow-auto p-6 space-y-4">
          <StalenessBanner
            topicId={topic.id}
            status={topic.status}
            onUpdate={async () => {
              if (!id) return
              try {
                setPipelineRunning(true)
                setCompletedStages(new Set())
                setProgressMsg("Starting delta update...")
                await api.pipeline.update(id)
              } catch (e) {
                setPipelineRunning(false)
                setProgressMsg(`Failed to start update: ${e}`)
              }
            }}
          />

          {activeStage === "discovery" && <PartiesPanel topicId={topic.id} />}
          {activeStage === "enrichment" && <CluesPanel topicId={topic.id} />}
          {activeStage === "forum" && (
            <div className="h-full">
              <ConversationView
                topicId={topic.id}
                sessionId={`forum-session-v${selectedVersion ?? Math.max(topic.current_version, 1)}`}
                isLive={topic.status === "forum" || (pipelineRunning && liveStage === "forum")}
              />
            </div>
          )}
          {activeStage === "expert_council" && <ExpertCouncilPanel topicId={topic.id} />}
          {activeStage === "verdict" && <VerdictPanel topicId={topic.id} />}
        </main>
      </div>

      {showSettings && topic && (
        <SettingsPanel
          topic={topic}
          onClose={() => setShowSettings(false)}
          onSave={(updated) => setTopic(updated)}
        />
      )}
    </div>
  )
}
