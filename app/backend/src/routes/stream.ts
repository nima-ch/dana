import { Elysia } from "elysia"

export type SSEEvent =
  | { type: "progress"; stage: string; pct: number; msg: string }
  | { type: "forum_turn"; turn: Record<string, unknown> }
  | { type: "stage_complete"; stage: string; session_id?: string }
  | { type: "error"; message: string }
  | { type: "ping" }

// In-memory event bus per topic — maps topic_id to array of subscriber callbacks
const subscribers = new Map<string, Set<(event: SSEEvent) => void>>()

export function subscribe(topicId: string, cb: (event: SSEEvent) => void): () => void {
  if (!subscribers.has(topicId)) subscribers.set(topicId, new Set())
  subscribers.get(topicId)!.add(cb)
  return () => subscribers.get(topicId)?.delete(cb)
}

export function emit(topicId: string, event: SSEEvent): void {
  subscribers.get(topicId)?.forEach(cb => cb(event))
}

export function makeProgressEmitter(topicId: string, stage: string) {
  return (msg: string, pct = 0) => emit(topicId, { type: "progress", stage, pct, msg })
}

export const streamRouter = new Elysia({ prefix: "/api/topics" })
  .get("/:id/stream", ({ params, set }) => {
    const topicId = params.id

    set.headers["Content-Type"] = "text/event-stream"
    set.headers["Cache-Control"] = "no-cache"
    set.headers["Connection"] = "keep-alive"
    set.headers["X-Accel-Buffering"] = "no"

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: SSEEvent) => {
          try {
            controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
          } catch {
            // client disconnected
          }
        }

        // Send initial ping
        send({ type: "ping" })

        // Keep-alive ping every 15s
        const pingInterval = setInterval(() => send({ type: "ping" }), 15_000)

        const unsubscribe = subscribe(topicId, send)

        // Cleanup when client disconnects
        const cleanup = () => {
          clearInterval(pingInterval)
          unsubscribe()
          try { controller.close() } catch { /* already closed */ }
        }

        // Store cleanup on the controller for potential use
        ;(controller as unknown as Record<string, unknown>).__cleanup = cleanup
      },
    })

    return new Response(stream, { headers: set.headers as Record<string, string> })
  })
