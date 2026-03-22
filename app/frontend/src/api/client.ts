const BASE = "/api"

export interface Topic {
  id: string
  title: string
  description: string
  created_at: string
  updated_at: string
  status: string
  current_version: number
  models: Record<string, string>
  settings: Record<string, unknown>
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as any).message || res.statusText)
  }
  return res.json()
}

export const api = {
  topics: {
    list: () => request<Topic[]>("/topics"),
    get: (id: string) => request<Topic>(`/topics/${id}`),
    create: (data: { title: string; description: string }) =>
      request<Topic>("/topics", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, patch: Partial<Topic>) =>
      request<Topic>(`/topics/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/topics/${id}`, { method: "DELETE" }),
  },
  expertCouncil: {
    get: (topicId: string) => request<any>(`/topics/${topicId}/expert-council`),
    getVersion: (topicId: string, version: number) => request<any>(`/topics/${topicId}/expert-council/${version}`),
  },
  verdict: {
    get: (topicId: string) => request<any>(`/topics/${topicId}/verdict`),
  },
  pipeline: {
    discover: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/discover`, { method: "POST" }
      ),
    enrich: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/enrich`, { method: "POST" }
      ),
    analyze: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/analyze`, { method: "POST" }
      ),
    run: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/run`, { method: "POST" }
      ),
    update: (topicId: string) =>
      request<{ run_id: string; started_at: string; status: string }>(
        `/topics/${topicId}/pipeline/update`, { method: "POST" }
      ),
    status: (topicId: string) =>
      request<{ running: boolean; run_id?: string; started_at?: string }>(
        `/topics/${topicId}/pipeline/status`
      ),
  },
  parties: {
    list: (topicId: string) => request<any[]>(`/topics/${topicId}/parties`),
    update: (topicId: string, partyId: string, data: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/parties/${partyId}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (topicId: string, partyId: string) =>
      request<{ success: boolean }>(`/topics/${topicId}/parties/${partyId}`, { method: "DELETE" }),
    add: (topicId: string, data: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/parties`, { method: "POST", body: JSON.stringify(data) }),
    merge: (topicId: string, sourceIds: string[], target: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/parties/merge`, {
        method: "POST", body: JSON.stringify({ source_ids: sourceIds, target }),
      }),
  },
  clues: {
    list: (topicId: string) => request<any[]>(`/topics/${topicId}/clues`),
    update: (topicId: string, clueId: string, data: Record<string, unknown>) =>
      request<any>(`/topics/${topicId}/clues/${clueId}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (topicId: string, clueId: string) =>
      request<{ success: boolean }>(`/topics/${topicId}/clues/${clueId}`, { method: "DELETE" }),
    bulkImport: (topicId: string, type: "text" | "urls", content: string) =>
      request<{ imported: number; clues: any[] }>(`/topics/${topicId}/clues/bulk`, {
        method: "POST", body: JSON.stringify({ type, content }),
      }),
  },
  settings: {
    get: () => request<{ default_models: Record<string, string> }>("/settings"),
    update: (data: { default_models?: Record<string, string> }) =>
      request<{ default_models: Record<string, string> }>("/settings", { method: "PUT", body: JSON.stringify(data) }),
  },
  models: {
    list: () => request<{ id: string }[]>("/models"),
  },
}
