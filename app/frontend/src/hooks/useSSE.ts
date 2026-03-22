import { useEffect, useRef, useCallback } from "react"

export type SSEEvent =
  | { type: "progress"; stage: string; pct: number; msg: string }
  | { type: "forum_turn"; turn: Record<string, unknown> }
  | { type: "stage_complete"; stage: string; session_id?: string }
  | { type: "error"; message: string }
  | { type: "ping" }

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
      // Reconnect after 3s
      setTimeout(connect, 3000)
    }
  }, [topicId])

  useEffect(() => {
    connect()
    return () => { esRef.current?.close(); esRef.current = null }
  }, [connect])
}
