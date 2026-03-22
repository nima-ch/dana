import { useState, useEffect } from "react"

interface StepInfo {
  stage: string
  label: string
  status: "pending" | "active" | "done" | "error"
  messages: string[]
}

const ANALYSIS_STAGES = [
  { key: "weight", label: "Weight Calculation" },
  { key: "forum", label: "Forum Debate" },
  { key: "expert_council", label: "Expert Council" },
  { key: "verdict", label: "Verdict Synthesis" },
]

interface Props {
  liveStage: string | null
  completedStages: Set<string>
  progressMsg: string
  error?: string | null
}

export function AnalysisProgressView({ liveStage, completedStages, progressMsg, error }: Props) {
  const [messageLog, setMessageLog] = useState<{ stage: string; msg: string; time: string }[]>([])

  useEffect(() => {
    if (progressMsg && liveStage) {
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      setMessageLog(prev => {
        const last = prev[prev.length - 1]
        if (last?.msg === progressMsg) return prev
        return [...prev.slice(-50), { stage: liveStage, msg: progressMsg, time }]
      })
    }
  }, [progressMsg, liveStage])

  const steps: StepInfo[] = ANALYSIS_STAGES.map(s => ({
    stage: s.key,
    label: s.label,
    status: completedStages.has(s.key) ? "done"
      : liveStage === s.key ? "active"
      : error && liveStage === s.key ? "error"
      : "pending",
    messages: messageLog.filter(m => m.stage === s.key).map(m => m.msg),
  }))

  const allDone = steps.every(s => s.status === "done")

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-lg font-semibold text-gray-800">
          {allDone ? "Analysis Complete" : "Analysis in Progress"}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          {allDone
            ? "All stages finished. Click Forum, Expert Council, or Verdict in the sidebar to view results."
            : "Running weight calculation, forum debate, expert council, and verdict synthesis..."}
        </p>
      </div>

      <div className="space-y-3">
        {steps.map((step, idx) => (
          <div key={step.stage} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className={[
              "flex items-center gap-3 px-4 py-3",
              step.status === "active" ? "bg-blue-50" : "",
              step.status === "done" ? "bg-green-50" : "",
              step.status === "error" ? "bg-red-50" : "",
            ].join(" ")}>
              {/* Step number / icon */}
              <div className={[
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                step.status === "done" ? "bg-green-500 text-white" :
                step.status === "active" ? "bg-blue-500 text-white" :
                step.status === "error" ? "bg-red-500 text-white" :
                "bg-gray-200 text-gray-500",
              ].join(" ")}>
                {step.status === "done" ? "\u2713" :
                 step.status === "active" ? (
                   <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                 ) :
                 step.status === "error" ? "\u2717" :
                 idx + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-800">{step.label}</div>
                {step.status === "active" && step.messages.length > 0 && (
                  <div className="text-xs text-blue-600 truncate mt-0.5">
                    {step.messages[step.messages.length - 1]}
                  </div>
                )}
                {step.status === "done" && (
                  <div className="text-xs text-green-600 mt-0.5">Completed</div>
                )}
              </div>

              {/* Duration or status indicator */}
              {step.status === "active" && (
                <span className="text-xs text-blue-500 tabular-nums shrink-0">
                  <ElapsedTimer />
                </span>
              )}
            </div>

            {/* Expanded message log for active step */}
            {step.status === "active" && step.messages.length > 1 && (
              <div className="border-t border-gray-100 px-4 py-2 bg-gray-50 max-h-32 overflow-y-auto">
                {step.messages.map((msg, i) => {
                  const logEntry = messageLog.find(m => m.msg === msg && m.stage === step.stage)
                  return (
                    <div key={i} className="flex gap-2 text-xs py-0.5">
                      <span className="text-gray-400 tabular-nums shrink-0">{logEntry?.time || ""}</span>
                      <span className="text-gray-600">{msg}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <div className="text-sm font-medium text-red-800">Analysis failed</div>
          <div className="text-xs text-red-600 mt-1">{error}</div>
        </div>
      )}
    </div>
  )
}

function ElapsedTimer() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return <>{m > 0 ? `${m}m ${s}s` : `${s}s`}</>
}
