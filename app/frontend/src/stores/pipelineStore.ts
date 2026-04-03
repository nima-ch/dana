import { create } from "zustand"
import type { SSEEvent } from "@/hooks/useSSE"

export type PipelineFeedItem =
  | { id: string; type: "think"; icon: string; label: string; detail?: string; ts: number }
  | { id: string; type: "progress"; stage: string; pct: number; msg: string; ts: number }
  | { id: string; type: "forum_turn"; turn: Record<string, unknown>; ts: number }
  | { id: string; type: "clue_discovered"; clue_id: string; title: string; source: string; relevance: number; ts: number }
  | { id: string; type: "stage_complete"; stage: string; ts: number }
  | { id: string; type: "error"; message: string; ts: number }
  | { id: string; type: "weight_result"; parties: { name: string; weight: number }[]; ts: number }
  | { id: string; type: "expert_assessment"; expert: string; domain: string; summary: string; ts: number }
  | { id: string; type: "verdict_content"; headline: string; scenarios?: { title: string; probability: number }[]; ts: number }

interface TopicPipelineState {
  items: PipelineFeedItem[]
  liveStages: Record<string, number>
}

interface PipelineStore {
  sessions: Record<string, TopicPipelineState>
  resetTopic: (topicId: string) => void
  pushEvent: (topicId: string, event: SSEEvent) => void
}

function normalizeEvent(id: string, event: SSEEvent): PipelineFeedItem {
  const ts = Date.now()
  if (event.type === "ping") return { id, ts, type: "error", message: "ping" }
  if (event.type === "think") return { id, ts, ...event }
  if (event.type === "progress") return { id, ts, ...event }
  if (event.type === "forum_turn") return { id, ts, ...event }
  if (event.type === "clue_discovered") return { id, ts, ...event }
  if (event.type === "stage_complete") return { id, ts, ...event }
  if (event.type === "error") return { id, ts, ...event }
  if (event.type === "weight_result") return { id, ts, ...event }
  if (event.type === "expert_assessment") return { id, ts, ...event }
  return { id, ts, type: "verdict_content", headline: event.headline, scenarios: event.scenarios ?? [] }
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  sessions: {},
  resetTopic: (topicId) => set((state) => ({
    sessions: {
      ...state.sessions,
      [topicId]: { items: [], liveStages: {} },
    },
  })),
  pushEvent: (topicId, event) => {
    if (event.type === "ping") return
    set((state) => {
      const current = state.sessions[topicId] ?? { items: [], liveStages: {} }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const nextStages = { ...current.liveStages }
      if (event.type === "progress") nextStages[event.stage] = event.pct
      if (event.type === "stage_complete") nextStages[event.stage] = 100
      return {
        sessions: {
          ...state.sessions,
          [topicId]: {
            items: [...current.items.slice(-99), normalizeEvent(id, event)],
            liveStages: nextStages,
          },
        },
      }
    })
  },
}))
