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
import { ThinkingTrace, type ThinkStep } from "../components/Pipeline/ThinkingTrace"

type Stage = "discovery" | "enrichment" | "forum" | "expert_council" | "verdict"

const STAGES: { key: Stage; label: string; icon: string }[] = [
  { key: "discovery",      label: "Discovery",     icon: "🔍" },
  { key: "enrichment",     label: "Enrichment",    icon: "🔬" },
  { key: "forum",          label: "Forum",         icon: "🗣" },
  { key: "expert_council", label: "Expert Council", icon: "🏛" },
  { key: "verdict",        label: "Verdict",       icon: "⚖" },
]

const STAGE_ORDER: Stage[] = ["discovery", "enrichment", "forum", "expert_council", "verdict"]

function stageIndex(status: string): number {
  if (status === "review_parties") return 1
  if (status === "review_enrichment") return 2
  if (status === "complete" || status === "stale") return STAGE_ORDER.length
  const idx = STAGE_ORDER.indexOf(status as Stage)
  return idx >= 0 ? idx : 0
}

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
  const [thinkStep, setThinkStep] = useState<ThinkStep | null>(null)

  const refreshTopic = useCallback(() => {
    if (!id) return
    api.topics.get(id).then(t => {
      setTopic(t)
      setActiveStage(defaultStageForStatus(t.status))
    }).catch(() => {})
    fetch(`/api/topics/${id}/states`)
      .then(r => r.json())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((s: any[]) => setStates(s))
      .catch(() => {})
  }, [id])

  const handleSSE = useCallback((event: SSEEvent) => {
    if (event.type === "think") {
      setThinkStep({ icon: event.icon, label: event.label, detail: event.detail })

    } else if (event.type === "progress") {
      setProgressMsg(event.msg)
      setLiveStage(event.stage)

    } else if (event.type === "stage_complete") {
      setCompletedStages(prev => new Set([...prev, event.stage]))
      setThinkStep(null)
      if (event.stage === "verdict") {
        setPipelineRunning(false)
        setProgressMsg("")
        setLiveStage(null)
      }
      refreshTopic()

    } else if (event.type === "error") {
      setPipelineRunning(false)
      setProgressMsg(`Error: ${event.message}`)
      setLiveStage(null)
      setThinkStep(null)
      refreshTopic()
    }
  }, [refreshTopic])

  useSSE(id ?? null, handleSSE)

  const handleStartDiscovery = async () => {
    if (!id) return
    try {
      setPipelineRunning(true)
      setCompletedStages(new Set())
      setThinkStep(null)
      setProgressMsg("Starting discovery…")
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
      setThinkStep(null)
      setProgressMsg("Starting enrichment…")
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
      setCompletedStages(new Set())
      setThinkStep(null)
      setProgressMsg("Starting analysis…")
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
    if (!confirm("Run a fresh analysis (weight → forum → expert council → verdict) on the current data? The prior analysis is preserved as a version.")) return
    try {
      setPipelineRunning(true)
      setCompletedStages(new Set())
      setThinkStep(null)
      setProgressMsg("Starting re-analysis…")
      setActiveStage("forum")
      await api.pipeline.reanalyze(id)
    } catch (e) {
      setPipelineRunning(false)
      setProgressMsg(`Failed: ${e}`)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen gap-2 text-gray-400">
      <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  )
  if (error || !topic) return (
    <div className="flex items-center justify-center h-screen text-red-500 text-sm">{error || "Topic not found"}</div>
  )

  const currentStageIdx = stageIndex(topic.status)
  const isDraft = topic.status === "draft"

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 shrink-0 shadow-sm">
        <button
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors text-sm"
          onClick={() => navigate("/")}
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-900 text-sm truncate">{topic.title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {states.length > 1 ? (
            <select
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:ring-1 focus:ring-blue-300"
              value={selectedVersion ?? topic.current_version}
              onChange={e => setSelectedVersion(parseInt(e.target.value))}
            >
              {states.map(s => (
                <option key={s.version} value={s.version}>
                  v{s.version} — {s.label} ({new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })})
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-gray-400 font-mono">v{topic.current_version}</span>
          )}
          <StatusBadge status={topic.status} />
          {isDraft && !pipelineRunning && (
            <button onClick={handleStartDiscovery}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
              Start Discovery
            </button>
          )}
          {!["draft", "review_parties"].includes(topic.status) && !pipelineRunning && (
            <button onClick={handleReanalyze}
              className="px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors shadow-sm">
              Re-analyze
            </button>
          )}
          {topic.status === "stale" && !pipelineRunning && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs text-amber-600">stale</span>
            </div>
          )}
          <button onClick={() => setShowSettings(true)}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            ⚙
          </button>
        </div>
      </header>

      {/* Body: full-screen thinking trace OR 2-zone layout */}
      {pipelineRunning ? (
        /* Pipeline running — thinking trace takes the full remaining height, no sidebar */
        <div className="flex-1 overflow-hidden">
          <ThinkingTrace step={thinkStep} stage={liveStage} progressMsg={progressMsg} />
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Left stage nav — only shown when not running */}
        <aside className="w-48 bg-white border-r border-gray-200 flex flex-col py-3 shrink-0">
          <nav className="space-y-0.5 px-2">
            {STAGES.map((stage, idx) => {
              const isComplete = idx < currentStageIdx || completedStages.has(stage.key)
              const isActive = activeStage === stage.key
              const isAccessible = idx <= currentStageIdx || isComplete
              const isReviewGate = (stage.key === "discovery" && topic.status === "review_parties")
                || (stage.key === "enrichment" && topic.status === "review_enrichment")
              return (
                <button
                  key={stage.key}
                  onClick={() => isAccessible && setActiveStage(stage.key)}
                  className={[
                    "w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2.5 transition-all",
                    isActive ? "bg-blue-50 text-blue-700 font-semibold" : "",
                    !isActive && isAccessible ? "text-gray-600 hover:bg-gray-50" : "",
                    !isAccessible ? "text-gray-300 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  <span className="text-sm shrink-0">{stage.icon}</span>
                  <span className="flex-1 truncate">{stage.label}</span>
                  {isReviewGate && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  {!isReviewGate && isComplete && <span className="text-green-500 text-[9px] shrink-0">✓</span>}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto min-w-0">
          <div className="p-5 space-y-4">
              <StalenessBanner
                topicId={topic.id}
                status={topic.status}
                onUpdate={async () => {
                  if (!id) return
                  try {
                    setPipelineRunning(true)
                    setCompletedStages(new Set())
                    setThinkStep(null)
                    setProgressMsg("Starting delta update…")
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
              {activeStage === "forum" && (
                <ConversationView
                  topicId={topic.id}
                  sessionId={`forum-session-v${selectedVersion ?? Math.max(topic.current_version, 1)}`}
                  isLive={topic.status === "forum"}
                />
              )}
              {activeStage === "expert_council" && (
                <ExpertCouncilPanel topicId={topic.id} version={selectedVersion ?? undefined} />
              )}
              {activeStage === "verdict" && (
                <VerdictPanel topicId={topic.id} version={selectedVersion ?? undefined} />
              )}
            </div>
        </main>
      </div>
      )}

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
