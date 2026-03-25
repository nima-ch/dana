import { useEffect, useRef, useState } from "react"

export interface ThinkStep {
  icon: string
  label: string
  detail?: string
}

const STAGE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  enrichment: "Enrichment",
  weight: "Weighting",
  forum: "Forum",
  expert_council: "Expert Council",
  verdict: "Verdict",
  pipeline: "Running",
}

interface Props {
  step: ThinkStep | null
  stage: string | null
  progressMsg?: string
}

export function ThinkingTrace({ step, stage, progressMsg }: Props) {
  const [current, setCurrent] = useState<ThinkStep | null>(null)
  const [previous, setPrevious] = useState<ThinkStep | null>(null)
  const [prevVisible, setPrevVisible] = useState(false)
  const prevTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!step) return
    // Don't re-render if identical to current
    if (current && step.label === current.label && step.detail === current.detail) return

    // Move current → previous, show it briefly fading out
    setPrevious(current)
    setPrevVisible(true)
    setCurrent(step)

    // Clear previous after fade duration
    if (prevTimerRef.current) clearTimeout(prevTimerRef.current)
    prevTimerRef.current = setTimeout(() => {
      setPrevious(null)
      setPrevVisible(false)
    }, 500)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (prevTimerRef.current) clearTimeout(prevTimerRef.current)
  }, [])

  const stageLabel = stage ? (STAGE_LABELS[stage] ?? stage) : "Running"

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] select-none">
      {/* Stage pill */}
      <div className="flex items-center gap-2 mb-10">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-widest">{stageLabel}</span>
      </div>

      {/* Step display — fixed height container so layout doesn't shift */}
      <div className="relative w-full max-w-md flex flex-col items-center gap-3" style={{ minHeight: 96 }}>
        {/* Previous step — fades up and out */}
        {previous && prevVisible && (
          <div
            key={`prev-${previous.label}`}
            className="absolute inset-x-0 flex flex-col items-center gap-1 text-center pointer-events-none"
            style={{ animation: "thinkFadeOut 450ms ease forwards" }}
          >
            <span className="text-3xl">{previous.icon}</span>
            <span className="text-sm font-medium text-gray-400">{previous.label}</span>
            {previous.detail && <span className="text-xs text-gray-300">{previous.detail}</span>}
          </div>
        )}

        {/* Current step — fades in from below */}
        {current && (
          <div
            key={`cur-${current.label}-${current.detail}`}
            className="flex flex-col items-center gap-1 text-center"
            style={{ animation: "thinkFadeIn 300ms ease forwards" }}
          >
            <span className="text-4xl mb-1">{current.icon}</span>
            <span className="text-base font-semibold text-gray-800">{current.label}</span>
            {current.detail && (
              <span className="text-xs text-gray-400 max-w-xs truncate">{current.detail}</span>
            )}
          </div>
        )}

        {/* Initial loading state */}
        {!current && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-sm text-gray-400">{progressMsg ?? "Starting…"}</span>
          </div>
        )}
      </div>

      {/* Subtle progress message below */}
      {progressMsg && current && (
        <p className="mt-8 text-xs text-gray-300 max-w-sm text-center truncate">{progressMsg}</p>
      )}

      <style>{`
        @keyframes thinkFadeIn {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes thinkFadeOut {
          from { opacity: 0.4; transform: translateY(0); }
          to   { opacity: 0;   transform: translateY(-20px); }
        }
      `}</style>
    </div>
  )
}
