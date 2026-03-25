import { useEffect, useRef, useCallback } from "react"

export type SSEEvent =
  | { type: "think"; icon: string; label: string; detail?: string }
  | { type: "progress"; stage: string; pct: number; msg: string }
  | { type: "forum_turn"; turn: Record<string, unknown> }
  | { type: "expert_assessment"; expert: string; domain: string; summary: string; scenario_assessments?: unknown[]; weight_challenges?: unknown[] }
  | { type: "verdict_content"; scenarios: { title: string; probability: number }[]; headline: string; final_assessment?: string; confidence_note?: string }
  | { type: "weight_result"; parties: { name: string; weight: number }[] }
  | { type: "clue_discovered"; clue_id: string; title: string; source: string; relevance: number }
  | { type: "stage_complete"; stage: string; session_id?: string }
  | { type: "error"; message: string }
  | { type: "ping" }

// Always-on SSE connection — connects as long as topicId is provided
export function useSSE(topicId: string | null, onEvent: (event: SSEEvent) => void) {
  const esRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    if (!topicId) return
    if (esRef.current) { esRef.current.close(); esRef.current = null }

    const es = new EventSource(`/api/topics/${topicId}/stream`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent
        if (event.type !== "ping") onEventRef.current(event)
      } catch { /* ignore malformed */ }
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      setTimeout(connect, 3000)
    }
  }, [topicId])

  useEffect(() => {
    connect()
    return () => { esRef.current?.close(); esRef.current = null }
  }, [connect])
}
