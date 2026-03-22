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
import { AnalysisProgressView } from "../components/Pipeline/AnalysisProgressView"
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
  if (status === "review_parties") return 1
  if (status === "review_enrichment") return 2
  if (status === "complete" || status === "stale") return STAGE_ORDER.length
  const idx = STAGE_ORDER.indexOf(status as Stage)
  return idx >= 0 ? idx : 0
}

// Map status to which panel should be active
function defaultStageForStatus(status: string): Stage {
  if (status === "review_parties") return "discovery"
  if (status === "review_enrichment") return "enrichment"
  if (status === "forum") return "forum"
  if (status === "expert_council") return "expert_council"
  if (status === "verdict" || status === "complete" || status === "stale") return "verdict"
  return "discovery"
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
  const [approveLoading, setApproveLoading] = useState(false)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [pipelineError, setPipelineError] = useState<string | null>(null)

  const refreshTopic = useCallback(() => {
    if (!id) return
    api.topics.get(id).then(t => {
      setTopic(t)
      // Auto-navigate to the right panel when status changes
      setActiveStage(defaultStageForStatus(t.status))
    }).catch(() => {})
    fetch(`/api/topics/${id}/states`)
      .then(r => r.json())
      .then((s: any[]) => setStates(s))
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (!id) return
    api.topics.get(id)
      .then(t => {
        setTopic(t)
        setActiveStage(defaultStageForStatus(t.status))
        setLoading(false)
      })
      .catch(e => { setError(String(e)); setLoading(false) })

    api.pipeline.status(id).then(s => {
      if (s.running) setPipelineRunning(true)
    }).catch(() => {})

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
        setAnalysisRunning(false)
        setProgressMsg("")
        setLiveStage(null)
      }
      refreshTopic()
    } else if (event.type === "error") {
      setPipelineRunning(false)
      setProgressMsg(`Error: ${event.message}`)
      setPipelineError(event.message)
      setLiveStage(null)
      refreshTopic()
    }
  }, [refreshTopic])

  useSSE(pipelineRunning ? id ?? null : null, handleSSE)

  // Gated pipeline actions
  const handleStartDiscovery = async () => {
    if (!id) return
    try {
      setPipelineRunning(true)
      setCompletedStages(new Set())
      setProgressMsg("Starting discovery...")
      await api.pipeline.discover(id)
    } catch (e) {
      setPipelineRunning(false)
      setProgressMsg(`Failed: ${e}`)
    }
  }

  const handleApproveParties = async () => {
    if (!id) return
    setApproveLoading(true)
    try {
      setPipelineRunning(true)
      setProgressMsg("Starting enrichment...")
      await api.pipeline.enrich(id)
    } catch (e) {
      setPipelineRunning(false)
      setProgressMsg(`Failed: ${e}`)
    }
    setApproveLoading(false)
  }

  const handleApproveClues = async () => {
    if (!id) return
    setApproveLoading(true)
    try {
      setPipelineRunning(true)
      setAnalysisRunning(true)
      setPipelineError(null)
      setCompletedStages(new Set())
      setProgressMsg("Starting analysis (weight, forum, expert council, verdict)...")
      setActiveStage("forum")
      await api.pipeline.analyze(id)
    } catch (e) {
      setPipelineRunning(false)
      setProgressMsg(`Failed: ${e}`)
    }
    setApproveLoading(false)
  }

  const handleReanalyze = async () => {
    if (!id) return
    if (!confirm("This will run a fresh analysis (weight, forum, expert council, verdict) using the current parties and clues. Previous analysis is preserved as a prior version. Continue?")) return
    try {
      setPipelineRunning(true)
      setAnalysisRunning(true)
      setPipelineError(null)
      setCompletedStages(new Set())
      setProgressMsg("Starting clean re-analysis...")
      setActiveStage("forum")
      await api.pipeline.reanalyze(id)
    } catch (e) {
      setPipelineRunning(false)
      setProgressMsg(`Failed: ${e}`)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400 text-sm">Loading...</div>
  if (error || !topic) return (
    <div className="flex items-center justify-center h-screen text-red-500 text-sm">
      {error || "Topic not found"}
    </div>
  )

  const currentStageIdx = stageIndex(topic.status)
  const isDraft = topic.status === "draft"

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button className="text-gray-400 hover:text-gray-700 text-sm" onClick={() => navigate("/")}>
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
          {isDraft && !pipelineRunning && (
            <button onClick={handleStartDiscovery}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
              Start Discovery
            </button>
          )}
          {(topic.status === "complete" || topic.status === "stale") && !pipelineRunning && (
            <button onClick={handleReanalyze}
              className="px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700">
              Re-analyze
            </button>
          )}
          {(topic.status === "complete") && !pipelineRunning && (
            <button onClick={handleStartDiscovery}
              className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700">
              Re-run Discovery
            </button>
          )}
          {topic.status === "stale" && !pipelineRunning && (
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Updates available" />
          )}
          <button onClick={() => setShowSettings(true)}
            className="text-gray-400 hover:text-gray-600 text-sm" title="Settings">
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
              <div key={s.key} className={[
                "w-6 h-1.5 rounded-full transition-colors",
                completedStages.has(s.key) ? "bg-green-500" :
                liveStage === s.key ? "bg-blue-500 animate-pulse" :
                "bg-gray-200",
              ].join(" ")} title={s.label} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-48 bg-white border-r border-gray-200 flex flex-col py-4 shrink-0">
          <nav className="space-y-1 px-3">
            {STAGES.map((stage, idx) => {
              const isComplete = idx < currentStageIdx || completedStages.has(stage.key)
              const isActive = activeStage === stage.key
              const isLive = liveStage === stage.key
              const isAccessible = idx <= currentStageIdx || isComplete
              // Highlight review gates
              const isReviewGate = (stage.key === "discovery" && topic.status === "review_parties")
                || (stage.key === "enrichment" && topic.status === "review_enrichment")

              return (
                <button
                  key={stage.key}
                  onClick={() => isAccessible && setActiveStage(stage.key)}
                  className={[
                    "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
                    isActive ? "bg-blue-50 text-blue-700 font-medium" : "",
                    !isActive && isAccessible ? "text-gray-700 hover:bg-gray-50" : "",
                    !isAccessible ? "text-gray-300 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  <span className={[
                    "w-2 h-2 rounded-full shrink-0",
                    isReviewGate ? "bg-amber-500 animate-pulse" :
                    isComplete ? "bg-green-500" :
                    isLive ? "bg-blue-500 animate-pulse" :
                    isActive ? "bg-blue-500" :
                    "bg-gray-200",
                  ].join(" ")} />
                  {stage.label}
                  {isReviewGate && <span className="text-xs text-amber-600 ml-auto">review</span>}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main content */}
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
                setProgressMsg(`Failed: ${e}`)
              }
            }}
          />

          {activeStage === "discovery" && (
            <PartiesPanel
              topicId={topic.id}
              status={topic.status}
              onApprove={handleApproveParties}
              approveLoading={approveLoading}
            />
          )}
          {activeStage === "enrichment" && (
            <CluesPanel
              topicId={topic.id}
              status={topic.status}
              onApprove={handleApproveClues}
              onReanalyze={handleReanalyze}
              approveLoading={approveLoading}
            />
          )}
          {analysisRunning && (activeStage === "forum" || activeStage === "expert_council" || activeStage === "verdict") ? (
            <AnalysisProgressView
              liveStage={liveStage}
              completedStages={completedStages}
              progressMsg={progressMsg}
              error={pipelineError}
            />
          ) : (
            <>
              {activeStage === "forum" && (
                <ConversationView
                  topicId={topic.id}
                  sessionId={`forum-session-v${selectedVersion ?? Math.max(topic.current_version, 1)}`}
                  isLive={topic.status === "forum" || (pipelineRunning && liveStage === "forum")}
                />
              )}
              {activeStage === "expert_council" && <ExpertCouncilPanel topicId={topic.id} />}
              {activeStage === "verdict" && <VerdictPanel topicId={topic.id} />}
            </>
          )}
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
