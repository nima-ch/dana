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
  settings: {
    get: () => request<{ default_models: Record<string, string> }>("/settings"),
    update: (data: { default_models?: Record<string, string> }) =>
      request<{ default_models: Record<string, string> }>("/settings", { method: "PUT", body: JSON.stringify(data) }),
  },
  models: {
    list: () => request<{ id: string }[]>("/models"),
  },
}
