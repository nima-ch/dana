import { create } from "zustand"
import { api, type Topic } from "../api/client"

interface TopicsStore {
  topics: Topic[]
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
  create: (title: string, description: string) => Promise<Topic>
  delete: (id: string) => Promise<void>
}

export const useTopicsStore = create<TopicsStore>((set) => ({
  topics: [],
  loading: false,
  error: null,

  fetch: async () => {
    set({ loading: true, error: null })
    try {
      const topics = await api.topics.list()
      set({ topics, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  create: async (title, description) => {
    const topic = await api.topics.create({ title, description })
    set(s => ({ topics: [topic, ...s.topics] }))
    return topic
  },

  delete: async (id) => {
    await api.topics.delete(id)
    set(s => ({ topics: s.topics.filter(t => t.id !== id) }))
  },
}))
